import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { LocationType, Prisma, SecurityPillar, ServiceKey, SupplyMode, UrgencyLevel } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import { JsonLogicEvaluator } from '../shared/json-logic.evaluator';
import { PricingService } from '../pricing/pricing.service';
import type {
  Advisory,
  AdvisoryFacts,
  EvaluateAdvisoryResult,
  ServiceConfigAnswer,
  SmartBrief,
} from './advisory.types';
import type { EvaluatePricingOptions } from './advisory.types';
import type {
  BuildFactsInput,
  FactsDefinition,
} from './facts.builder';
import { buildAdvisoryFacts } from './facts.builder';
import { computeReadinessScore } from './readiness.scorer';
import type {
  CreateAdvisoryRuleDto,
  CreateSecurityProfileDto,
  UpdateAdvisoryRuleDto,
  UpdateSecurityProfileDto,
} from './dto/advisory.dto';
import type { CustomerProfile } from '@prisma/client';

/** Hard product cap: never more than 2 actionable suggestions per evaluation. */
const MAX_ADVISORIES = 2;

const ALL_PILLARS: SecurityPillar[] = ['PHYSICAL', 'INTRUSION', 'MONITORING'];

@Injectable()
export class AdvisoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluator: JsonLogicEvaluator,
    private readonly pricingService: PricingService,
  ) {}

  // ── Decoupled evaluation engine (guest-friendly, @Public) ─────────────────

  /**
   * One-call engine for the Next.js Sticky Live Bar: readiness + top-2
   * advisories + smart brief, and — when `includePricing` is set — the live
   * BigInt pricing estimate for the currently active configuration.
   */
  async evaluate(
    input: BuildFactsInput & EvaluatePricingOptions,
  ): Promise<EvaluateAdvisoryResult> {
    const definitions = await this.prisma.serviceDefinition.findMany({
      where: { isActive: true },
    });
    const facts = buildAdvisoryFacts(input, definitions as FactsDefinition[]);
    const matched = await this.matchAdvisories(facts);
    const readiness = computeReadinessScore(facts, definitions, matched.gapPillars);
    const smartBrief = this.buildSmartBrief(input.locationType, facts, definitions);

    let pricing;
    if (input.includePricing === true || input.sliderBps !== undefined) {
      const activeItems = matched.activeServiceKeys.map((serviceKey) => {
        const factsEntry = facts.services[serviceKey];
        const config: Record<string, unknown> = { ...(factsEntry ?? {}) };
        delete config['active']; // not a pricing variable
        delete config['goals']; // qualitative only
        return {
          serviceKey,
          supplyMode: input.supplyMode as SupplyMode | undefined,
          config,
        };
      });
      if (activeItems.length > 0) {
        pricing = await this.pricingService.estimate({
          citySlug: input.citySlug,
          lat: input.lat,
          lng: input.lng,
          urgency: input.urgency as UrgencyLevel | undefined,
          supplyMode: (input.supplyMode as SupplyMode | undefined) ?? undefined,
          sliderBps: input.sliderBps,
          items: activeItems,
        });
      }
    }

    return { readiness, advisories: matched.advisories, smartBrief, pricing };
  }

  /**
   * Rules whose `appliesToLocationTypes` is empty or contains the location.
   * Returns the top-2 advisories AND the full set of pillars with open gaps
   * (derived from ALL matched rules — a hidden 3rd gap still suppresses the
   * gap-free completion bonus).
   */
  private async matchAdvisories(
    facts: AdvisoryFacts,
  ): Promise<{ advisories: Advisory[]; gapPillars: Set<SecurityPillar>; activeServiceKeys: ServiceKey[] }> {
    const rules = await this.prisma.advisoryRule.findMany({
      where: {
        isActive: true,
        OR: [
          { appliesToLocationTypes: { isEmpty: true } },
          { appliesToLocationTypes: { has: facts.locationType as LocationType } },
        ],
      },
      orderBy: { priority: 'asc' },
    });

    const matchedRules = rules.filter((rule) => this.evaluator.evaluateBoolean(rule.condition, facts));
    const gapPillars = new Set<SecurityPillar>(matchedRules.map((rule) => rule.pillar));
    const activeServiceKeys = Object.entries(facts.services)
      .filter(([, value]) => value.active === true)
      .map(([key]) => key as ServiceKey);

    const advisories = matchedRules.slice(0, MAX_ADVISORIES).map((rule) => ({
      code: rule.code,
      pillar: rule.pillar,
      priority: rule.priority,
      messageFa: rule.suggestedActionFa,
      scoreImpact: (rule.scoreImpact as Record<string, unknown> | null) ?? null,
      suggestedAction: rule.suggestedServiceKey
        ? {
            type: 'APPLY_SERVICE_CONFIG' as const,
            serviceKey: rule.suggestedServiceKey,
            configPatch: (rule.suggestedConfig as Record<string, unknown> | null) ?? {},
          }
        : null,
    }));
    return { advisories, gapPillars, activeServiceKeys };
  }

  private buildSmartBrief(
    locationType: string,
    facts: AdvisoryFacts,
    definitions: FactsDefinition[],
  ): SmartBrief {
    const activeServiceKeys = Object.entries(facts.services)
      .filter(([, value]) => value.active === true)
      .map(([key]) => key as ServiceKey);
    const coveredPillars = [
      ...new Set(
        definitions
          .filter((definition) => activeServiceKeys.includes(definition.key))
          .map((definition) => definition.pillar as SecurityPillar),
      ),
    ];
    return {
      locationType,
      activeServiceKeys,
      coveredPillars,
      missingPillars: ALL_PILLARS.filter((pillar) => !coveredPillars.includes(pillar)),
    };
  }

  // ── Customer Security Profiles (strictly customer-scoped) ─────────────────

  private async requireCustomerProfile(userId: string): Promise<CustomerProfile> {
    const profile = await this.prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'فقط کاربران مشتری می‌توانند پروفایل امنیتی بسازند.',
      });
    }
    return profile;
  }

  async createProfile(actor: AuthenticatedUser, dto: CreateSecurityProfileDto) {
    const customerProfile = await this.requireCustomerProfile(actor.id);
    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    if (!address || address.customerId !== customerProfile.id) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'آدرس یافت نشد یا متعلق به شما نیست.',
      });
    }

    const evaluation = await this.evaluate({
      locationType: address.locationType,
      buildingContext: dto.buildingContext ?? null,
      servicesConfig: dto.servicesConfig ?? null,
    });

    const profile = await this.prisma.securityProfile.create({
      data: {
        customerId: customerProfile.id,
        addressId: dto.addressId,
        titleFa: dto.titleFa,
        locationType: address.locationType,
        buildingContext: (dto.buildingContext ?? undefined) as Prisma.InputJsonValue | undefined,
        servicesConfig: (dto.servicesConfig ?? {}) as Prisma.InputJsonValue,
        readinessScore: evaluation.readiness as unknown as Prisma.InputJsonValue,
        lastEvaluatedAt: new Date(),
      },
    });
    return { profile, advisories: evaluation.advisories };
  }

  async listProfiles(actor: AuthenticatedUser) {
    const customerProfile = await this.requireCustomerProfile(actor.id);
    return this.prisma.securityProfile.findMany({
      where: { customerId: customerProfile.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async requireOwnedProfile(actor: AuthenticatedUser, profileId: string) {
    const customerProfile = await this.requireCustomerProfile(actor.id);
    const profile = await this.prisma.securityProfile.findUnique({
      where: { id: profileId },
      include: { address: true },
    });
    if (!profile || profile.customerId !== customerProfile.id) {
      throw new NotFoundException({ statusCode: 404, message: 'پروفایل امنیتی یافت نشد.' });
    }
    return profile;
  }

  async getProfile(actor: AuthenticatedUser, profileId: string) {
    return this.requireOwnedProfile(actor, profileId);
  }

  async updateProfile(actor: AuthenticatedUser, profileId: string, dto: UpdateSecurityProfileDto) {
    const profile = await this.requireOwnedProfile(actor, profileId);

    const buildingContext = dto.buildingContext ?? (profile.buildingContext as Record<string, unknown> | null);
    const servicesConfig = dto.servicesConfig ?? (profile.servicesConfig as Record<string, ServiceConfigAnswer> | null);
    const evaluation = await this.evaluate({
      locationType: profile.address.locationType,
      buildingContext,
      servicesConfig,
    });

    const updated = await this.prisma.securityProfile.update({
      where: { id: profile.id },
      data: {
        titleFa: dto.titleFa ?? undefined,
        buildingContext: (dto.buildingContext ?? undefined) as Prisma.InputJsonValue | undefined,
        servicesConfig: (dto.servicesConfig ?? undefined) as Prisma.InputJsonValue | undefined,
        readinessScore: evaluation.readiness as unknown as Prisma.InputJsonValue,
        lastEvaluatedAt: new Date(),
      },
    });
    return { profile: updated, advisories: evaluation.advisories };
  }

  // ── Admin advisory rules CRUD (SUPER_ADMIN) ───────────────────────────────

  listRules() {
    return this.prisma.advisoryRule.findMany({ orderBy: { priority: 'asc' } });
  }

  async createRule(dto: CreateAdvisoryRuleDto) {
    this.evaluator.validateLogic(dto.condition);
    return this.prisma.advisoryRule.create({
      data: {
        code: dto.code,
        pillar: dto.pillar,
        priority: dto.priority ?? 100,
        appliesToLocationTypes: dto.appliesToLocationTypes ?? [],
        condition: dto.condition as unknown as Prisma.InputJsonValue,
        suggestedActionFa: dto.suggestedActionFa,
        suggestedServiceKey: dto.suggestedServiceKey ?? null,
        suggestedConfig: (dto.suggestedConfig ?? undefined) as Prisma.InputJsonValue | undefined,
        // `scoreImpact` is a NON-nullable JSON column — default to `{}`.
        scoreImpact: (dto.scoreImpact ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateRule(ruleId: string, dto: UpdateAdvisoryRuleDto) {
    if (dto.condition !== undefined) {
      this.evaluator.validateLogic(dto.condition);
    }
    const data: Prisma.AdvisoryRuleUpdateInput = {
      pillar: dto.pillar ?? undefined,
      priority: dto.priority ?? undefined,
      appliesToLocationTypes: dto.appliesToLocationTypes ?? undefined,
      suggestedActionFa: dto.suggestedActionFa ?? undefined,
      suggestedServiceKey: dto.suggestedServiceKey ?? undefined,
      isActive: dto.isActive ?? undefined,
    };
    // `condition` is a NON-nullable JSON column — only set it when provided.
    if (dto.condition !== undefined) {
      data.condition = dto.condition as unknown as Prisma.InputJsonValue;
    }
    if (dto.suggestedConfig !== undefined) {
      data.suggestedConfig = dto.suggestedConfig as unknown as Prisma.InputJsonValue;
    }
    if (dto.scoreImpact !== undefined) {
      data.scoreImpact = dto.scoreImpact as unknown as Prisma.InputJsonValue;
    }
    return this.prisma.advisoryRule.update({ where: { id: ruleId }, data });
  }

  async deleteRule(ruleId: string) {
    await this.prisma.advisoryRule.delete({ where: { id: ruleId } });
    return { deleted: true };
  }
}
