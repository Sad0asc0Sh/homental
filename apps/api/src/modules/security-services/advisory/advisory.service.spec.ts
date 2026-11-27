import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { advisoryRules, serviceDefinitions } from '../../../../prisma/seed';
import { buildAdvisoryFacts } from './facts.builder';
import { computeReadinessScore, SCORING } from './readiness.scorer';
import { AdvisoryService } from './advisory.service';
import { JsonLogicEvaluator } from '../shared/json-logic.evaluator';
import type { PricingEstimateResult, PricingService } from '../pricing/pricing.service';

const seedDefinitions = serviceDefinitions.map((definition) => ({
  ...definition,
  version: 1,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  id: `def-${definition.key}`,
}));

const customer = {
  id: 'c1',
  phone: '+989120000020',
  role: UserRole.CUSTOMER,
  branchId: null,
} as AuthenticatedUser;

/**
 * Emulates Prisma's list filtering (`isActive`, `appliesToLocationTypes`
 * isEmpty/has) so tests exercise the service's WHERE contract, not just a
 * dumb passthrough.
 */
function makeRuleFindManyMock(ruleOverrides?: unknown[]) {
  return jest.fn(async (args?: {
    where?: {
      isActive?: boolean;
      OR?: Array<{ appliesToLocationTypes?: { isEmpty?: boolean } | { has?: string } }>;
    };
  }) => {
    let rules: Array<Record<string, unknown>> = [
      ...(ruleOverrides ?? advisoryRules),
    ] as Array<Record<string, unknown>>;
    const where = args?.where;
    if (where?.isActive === true) {
      rules = rules.filter((rule) => rule['isActive'] !== false);
    }
    const orClauses = where?.OR ?? [];
    const allowsEmpty = orClauses.some(
      (clause) =>
        clause.appliesToLocationTypes !== undefined &&
        'isEmpty' in clause.appliesToLocationTypes &&
        clause.appliesToLocationTypes.isEmpty === true,
    );
    const hasClause = orClauses.find(
      (clause) =>
        clause.appliesToLocationTypes !== undefined && 'has' in clause.appliesToLocationTypes,
    )?.appliesToLocationTypes as { has?: string } | undefined;
    if (allowsEmpty || hasClause) {
      rules = rules.filter((rule) => {
        const list = (rule['appliesToLocationTypes'] as string[] | undefined) ?? [];
        return (allowsEmpty && list.length === 0) || (hasClause?.has !== undefined && list.includes(hasClause.has));
      });
    }
    return rules;
  });
}

function buildService(ruleOverrides?: unknown[]) {
  const prisma = {
    serviceDefinition: { findMany: jest.fn().mockResolvedValue(seedDefinitions) },
    advisoryRule: {
      findMany: makeRuleFindManyMock(ruleOverrides),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    customerProfile: { findUnique: jest.fn() },
    address: { findUnique: jest.fn() },
    securityProfile: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaService;
  const estimate: PricingEstimateResult = {
    currency: 'TOMAN', netEstimated: 10_152_000n, estimatedMin: 10_152_000n, estimatedMax: 10_152_000n,
    slider: {
      sliderBps: 0, minDeltaBps: -1500, maxDeltaBps: 2500, packageBaseAmount: 10_152_000n,
      priorityThresholdBps: 500, dispatchAudience: 'ALL',
    },
    invoice: { total: 10_152_000n, buckets: [] },
    summary: { totalHardware: 0n, bundleDiscountPercent: 6 },
    factors: {
      surge: { multiplier: 1, reasonFa: 'تعرفه عادی' },
      urgency: { urgency: 'SCHEDULED', multiplier: 1 },
    },
  };
  const pricingService = { estimate: jest.fn().mockResolvedValue(estimate) };
  const service = new AdvisoryService(prisma, new JsonLogicEvaluator(), pricingService as unknown as PricingService);
  return { service, prisma, pricingService };
}

const codes = (advisories: Array<{ code: string }>) => advisories.map((a) => a.code);

describe('AdvisoryService — all 7 seeded rules (real seed data)', () => {
  it('SHOP + CCTV without ALARM fires SHOP_CCTV_NO_ALARM (and only it)', async () => {
    const { service } = buildService();
    const result = await service.evaluate({
      locationType: 'SHOP',
      servicesConfig: { CCTV: { active: true } },
    });
    expect(codes(result.advisories)).toEqual(['SHOP_CCTV_NO_ALARM']);
    expect(result.advisories[0]?.pillar).toBe('INTRUSION');
    expect(result.advisories[0]?.suggestedAction).toEqual({
      type: 'APPLY_SERVICE_CONFIG',
      serviceKey: 'ALARM',
      configPatch: { doorSensorCount: 1, sirenType: 'INDOOR_OUTDOOR', panicButton: true },
    });
    expect(result.smartBrief.missingPillars).toContain('INTRUSION');
  });

  it('PARKING + 1 camera without nightPlate fires PARKING_CCTV_NO_PLATE_NIGHT', async () => {
    const { service } = buildService();
    const result = await service.evaluate({
      locationType: 'PARKING',
      servicesConfig: { CCTV: { active: true, cameraCount: 1 } },
    });
    expect(codes(result.advisories)).toEqual(['PARKING_CCTV_NO_PLATE_NIGHT']);
  });

  it('APARTMENT (20 units) + DOUBLE_ARM jack without electricLock fires HIGH_TRAFFIC_PARKING_JACK_UPGRADE', async () => {
    const { service } = buildService();
    const result = await service.evaluate({
      locationType: 'APARTMENT',
      buildingContext: { unitsCount: 20 },
      servicesConfig: { PARKING_JACK: { active: true, jackType: 'DOUBLE_ARM' } },
    });
    // APARTMENT_HIGH_UNITS_NO_PARKING_JACK must NOT fire (jack already active)
    expect(codes(result.advisories)).toEqual(['HIGH_TRAFFIC_PARKING_JACK_UPGRADE']);
    expect(result.advisories[0]?.suggestedAction?.configPatch).toEqual({
      jackType: 'HYDRAULIC',
      electricLock: true,
    });
  });

  it('SHOP + standard aluminium shutter without UPS fires SHOP_SENSITIVE_SHUTTER_NO_UPS_HEAVY', async () => {
    const { service } = buildService();
    const result = await service.evaluate({
      locationType: 'SHOP',
      servicesConfig: { ELECTRIC_SHUTTER: { active: true, bladeType: 'ALU_STANDARD' } },
    });
    expect(codes(result.advisories)).toEqual(['SHOP_SENSITIVE_SHUTTER_NO_UPS_HEAVY']);
  });

  it('VILLA without CCTV fires VILLA_NO_CCTV; WAREHOUSE with ALARM but no CCTV fires WAREHOUSE_ALARM_NO_CCTV', async () => {
    const { service: villa } = buildService();
    const villaResult = await villa.evaluate({ locationType: 'VILLA', servicesConfig: {} });
    expect(codes(villaResult.advisories)).toEqual(['VILLA_NO_CCTV']);

    const { service: warehouse } = buildService();
    const warehouseResult = await warehouse.evaluate({
      locationType: 'WAREHOUSE',
      servicesConfig: { ALARM: { active: true } },
    });
    expect(codes(warehouseResult.advisories)).toEqual(['WAREHOUSE_ALARM_NO_CCTV']);
  });

  it('a fully covered SHOP with every protective switch fires nothing AND reaches the top tier', async () => {
    const { service } = buildService();
    const result = await service.evaluate({
      locationType: 'SHOP',
      servicesConfig: {
        CCTV: { active: true, nightPlate: true, colorNight: true, audioRecord: true },
        ALARM: { active: true, panicButton: true },
        ELECTRIC_SHUTTER: { active: true, bladeType: 'STEEL_HEAVY', upsBackup: true },
      },
    });
    expect(result.advisories).toEqual([]);
    // Part A proof: zero open gaps → gap-free completion bonus → ≥ 85 tier.
    expect(result.readiness.total).toBeGreaterThanOrEqual(85);
    expect(result.readiness.levelFa).toBe('امنیت مهندسی کامل');
  });

  it('priority ordering + strict max-2 cap when 3+ rules match simultaneously', async () => {
    const ruleA = { code: 'RULE_A', pillar: 'PHYSICAL', priority: 30, appliesToLocationTypes: [], condition: { '==': [1, 1] }, suggestedActionFa: 'پیشنهاد A', suggestedServiceKey: null, suggestedConfig: null, scoreImpact: {}, isActive: true };
    const ruleB = { code: 'RULE_B', pillar: 'INTRUSION', priority: 5, appliesToLocationTypes: [], condition: { '==': [1, 1] }, suggestedActionFa: 'پیشنهاد B', suggestedServiceKey: null, suggestedConfig: null, scoreImpact: {}, isActive: true };
    const ruleC = { code: 'RULE_C', pillar: 'MONITORING', priority: 12, appliesToLocationTypes: [], condition: { '==': [1, 1] }, suggestedActionFa: 'پیشنهاد C', suggestedServiceKey: null, suggestedConfig: null, scoreImpact: {}, isActive: true };
    // DB returns them ordered by priority ASC (mirror of orderBy in the service)
    const { service } = buildService([ruleB, ruleC, ruleA]);
    const result = await service.evaluate({ locationType: 'APARTMENT', servicesConfig: {} });

    expect(result.advisories).toHaveLength(2); // never 3
    expect(codes(result.advisories)).toEqual(['RULE_B', 'RULE_C']); // priority 5 → 12
  });

  it('inactive rules and other-location rules are never returned', async () => {
    const rules = advisoryRules.map((rule) =>
      rule.code === 'SHOP_CCTV_NO_ALARM' ? { ...rule, isActive: false } : rule,
    );
    const { service } = buildService(rules);
    const result = await service.evaluate({
      locationType: 'SHOP',
      servicesConfig: { CCTV: { active: true } },
    });
    expect(result.advisories).toEqual([]);
  });
});

describe('Facts builder — pricing defaults merged under user answers', () => {
  it('exposes schema defaults so `upsBackup == false` fires without user toggling', () => {
    const facts = buildAdvisoryFacts(
      {
        locationType: 'SHOP',
        servicesConfig: { ELECTRIC_SHUTTER: { active: true, widthCm: 400 } },
      },
      seedDefinitions,
    );
    const shutter = facts.services.ELECTRIC_SHUTTER;
    expect(shutter).toMatchObject({
      active: true,
      widthCm: 400, // user answer wins
      heightCm: 280, // schema default
      bladeType: 'ALU_STANDARD', // schema default
      upsBackup: false, // schema default — rules can rely on it
    });
  });

  it('inactive services are present with active:false (and defaults)', () => {
    const facts = buildAdvisoryFacts({ locationType: 'APARTMENT', servicesConfig: {} }, seedDefinitions);
    expect(facts.services.ALARM?.active).toBe(false);
    expect(facts.services.ALARM?.doorSensorCount).toBe(2);
    expect(facts.building).toEqual({});
  });

  it('goal selections survive into the facts document', () => {
    const facts = buildAdvisoryFacts(
      {
        locationType: 'SHOP',
        servicesConfig: { CCTV: { active: true, goals: ['SHOP_WATCH'] } },
      },
      seedDefinitions,
    );
    expect(facts.services.CCTV?.goals).toEqual(['SHOP_WATCH']);
  });
});

describe('Readiness scorer — context-aware 3-pillar progression', () => {
  it('an empty configuration scores 0 and needs urgent reinforcement', () => {
    const facts = buildAdvisoryFacts({ locationType: 'APARTMENT', servicesConfig: {} }, seedDefinitions);
    const readiness = computeReadinessScore(facts, seedDefinitions);
    expect(readiness).toEqual({
      physical: 0,
      intrusion: 0,
      monitoring: 0,
      total: 0,
      levelFa: 'نیاز به تقویت فوری',
    });
  });

  it('adding a service raises the weighted total (CCTV-only apartment)', () => {
    const facts = buildAdvisoryFacts(
      { locationType: 'APARTMENT', servicesConfig: { CCTV: { active: true } } },
      seedDefinitions,
    );
    const readiness = computeReadinessScore(facts, seedDefinitions);
    // Monitoring is active & gap-free → raw 40 + gap-free completion bonus 35.
    expect(readiness.monitoring).toBe(40 + SCORING.gapFreeCompletionBonus);
    expect(readiness.total).toBe(Math.round(0.35 * (40 + SCORING.gapFreeCompletionBonus))); // 26
    expect(readiness.levelFa).toBe('نیاز به تقویت فوری');
  });

  it('applying an advisory suggestedAction measurably improves score AND tier', async () => {
    const { service } = buildService();
    const before = await service.evaluate({
      locationType: 'APARTMENT',
      servicesConfig: { CCTV: { active: true } },
    });

    // Simulate the one-click APPLY_SERVICE_CONFIG flow (ALARM suggestion):
    const after = await service.evaluate({
      locationType: 'APARTMENT',
      servicesConfig: {
        CCTV: { active: true },
        ALARM: { active: true, sirenType: 'INDOOR_OUTDOOR', panicButton: true, doorSensorCount: 2 },
      },
    });

    expect(after.readiness.intrusion).toBeGreaterThan(before.readiness.intrusion);
    expect(after.readiness.total).toBeGreaterThan(before.readiness.total);
    expect(before.readiness.total).toBe(26); // monitoring 75 × 0.35
    // ALARM raw 45 + panic bonus 4 = 49 → gap-free bonus → 84; total = 0.45×84 + 0.35×75 ≈ 64
    expect(after.readiness.intrusion).toBe(84);
    expect(after.readiness.total).toBe(64);
    expect(after.readiness.levelFa).toBe('پوشش استاندارد');
  });

  it('applying only a configPatch (UPS on steel-path shop) resolves the gap AND lifts the pillar', async () => {
    const { service } = buildService();
    const before = await service.evaluate({
      locationType: 'SHOP',
      servicesConfig: { ELECTRIC_SHUTTER: { active: true, bladeType: 'ALU_STANDARD' } },
    });
    const after = await service.evaluate({
      locationType: 'SHOP',
      servicesConfig: {
        ELECTRIC_SHUTTER: { active: true, bladeType: 'STEEL_HEAVY', upsBackup: true },
      },
    });
    // Before: SHOP_SENSITIVE gap → PHYSICAL gets NO bonus (raw 50) → total 18.
    expect(before.readiness.physical).toBe(50);
    expect(before.readiness.total).toBe(18);
    // After: gap resolved + upsBackup switch bonus → raw 54 +35 = 89.
    expect(after.readiness.physical).toBe(89);
    expect(after.readiness.total).toBe(31); // round(0.35 × 89)
    expect(after.readiness.total).toBeGreaterThan(before.readiness.total);
  });

  it('same active services score differently per location (context-aware weights)', () => {
    const config = { PARKING_JACK: { active: true } };
    const parking = computeReadinessScore(
      buildAdvisoryFacts({ locationType: 'PARKING', servicesConfig: config }, seedDefinitions),
      seedDefinitions,
    );
    const apartment = computeReadinessScore(
      buildAdvisoryFacts({ locationType: 'APARTMENT', servicesConfig: config }, seedDefinitions),
      seedDefinitions,
    );
    // Raw physical 55 + gap-free bonus 35 = 90; weights differ per location.
    expect(parking.total).toBe(45); // 90 × 0.50
    expect(apartment.total).toBe(18); // 90 × 0.20
  });

  it('a pillar with an open advisory gap NEVER receives the completion bonus (Part A)', () => {
    const facts = buildAdvisoryFacts(
      { locationType: 'APARTMENT', servicesConfig: { PARKING_JACK: { active: true } } },
      seedDefinitions,
    );
    const withGap = computeReadinessScore(facts, seedDefinitions, new Set(['PHYSICAL']));
    const gapFree = computeReadinessScore(facts, seedDefinitions, new Set());
    expect(withGap.physical).toBe(55);
    expect(gapFree.physical).toBe(90);
    expect(gapFree.total).toBeGreaterThan(withGap.total);
  });
});

describe('AdvisoryService — customer security profiles (customer-scoped)', () => {
  it('creates a profile on an owned address and persists computed readiness', async () => {
    const { service, prisma } = buildService();
    (prisma.customerProfile.findUnique as jest.Mock).mockResolvedValue({ id: 'cp1', userId: 'c1' });
    (prisma.address.findUnique as jest.Mock).mockResolvedValue({
      id: 'addr1',
      customerId: 'cp1',
      locationType: 'SHOP',
    });
    (prisma.securityProfile.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'sp1',
      ...data,
    }));

    const result = await service.createProfile(customer, {
      addressId: 'addr1',
      titleFa: 'مغازه',
      servicesConfig: { CCTV: { active: true } },
    });

    const readiness = result.profile.readinessScore as unknown as Record<string, unknown>;
    expect(readiness['total']).toBeGreaterThan(0);
    expect(result.profile.lastEvaluatedAt).toBeInstanceOf(Date);
    expect(result.advisories.map((a) => a.code)).toContain('SHOP_CCTV_NO_ALARM');
    expect(prisma.securityProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: 'cp1', locationType: 'SHOP' }),
      }),
    );
  });

  it('rejects profiles on addresses the customer does not own', async () => {
    const { service, prisma } = buildService();
    (prisma.customerProfile.findUnique as jest.Mock).mockResolvedValue({ id: 'cp1', userId: 'c1' });
    (prisma.address.findUnique as jest.Mock).mockResolvedValue({
      id: 'addrX',
      customerId: 'someone-else',
      locationType: 'SHOP',
    });
    await expect(
      service.createProfile(customer, { addressId: 'addrX' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('list and get are scoped to the caller; foreign ids look like 404', async () => {
    const { service, prisma } = buildService();
    (prisma.customerProfile.findUnique as jest.Mock).mockResolvedValue({ id: 'cp1', userId: 'c1' });

    await service.listProfiles(customer);
    expect(prisma.securityProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'cp1' } }),
    );

    (prisma.securityProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'spX',
      customerId: 'other-customer',
      address: { locationType: 'SHOP' },
    });
    await expect(service.getProfile(customer, 'spX')).rejects.toThrow(NotFoundException);
  });

  it('non-customers cannot create security profiles at all', async () => {
    const { service, prisma } = buildService();
    (prisma.customerProfile.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      service.createProfile(customer, { addressId: 'addr1' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('AdvisoryService — one-call Sticky Live Bar (includePricing, Task 4)', () => {
  it('returns readiness + advisories + smartBrief + pricing in ONE call', async () => {
    const { service, pricingService } = buildService();
    const result = await service.evaluate({
      locationType: 'SHOP',
      includePricing: true,
      sliderBps: 500,
      servicesConfig: {
        CCTV: { active: true, cameraCount: 4 },
        ALARM: { active: true },
      },
    });

    expect(result.pricing).toBeDefined();
    expect(result.pricing?.currency).toBe('TOMAN');
    expect(typeof result.pricing?.estimatedMin).toBe('bigint');
    expect(result.pricing?.estimatedMin).toBeLessThanOrEqual(result.pricing!.netEstimated);
    expect(result.pricing!.estimatedMax).toBeGreaterThanOrEqual(result.pricing!.netEstimated);
    // 2 distinct active services → 6% bundle discount in the same response.
    expect(result.pricing?.summary.bundleDiscountPercent).toBe(6);
    expect(pricingService.estimate).toHaveBeenCalledTimes(1);
    expect(pricingService.estimate).toHaveBeenCalledWith(expect.objectContaining({
      sliderBps: 500,
      items: [expect.objectContaining({ serviceKey: 'CCTV' }), expect.objectContaining({ serviceKey: 'ALARM' })],
    }));
    expect(result.readiness).toBeDefined();
    expect(result.smartBrief.activeServiceKeys).toEqual(['CCTV', 'ALARM']);
  });

  it('omits the pricing key entirely when includePricing is not requested', async () => {
    const { service } = buildService();
    const result = await service.evaluate({
      locationType: 'APARTMENT',
      servicesConfig: { CCTV: { active: true } },
    });
    expect(result.pricing).toBeUndefined();
  });

  it('empty active configuration with includePricing → no pricing section, no crash', async () => {
    const { service } = buildService();
    const result = await service.evaluate({
      locationType: 'SHOP',
      includePricing: true,
      servicesConfig: {},
    });
    expect(result.pricing).toBeUndefined();
    expect(result.readiness.total).toBe(0);
  });
});

describe('AdvisoryService — admin rules CRUD (JSON-Logic validated)', () => {
  it('createRule dry-runs the condition; invalid logic is rejected with Persian 400', async () => {
    const { service, prisma } = buildService();
    await service.createRule({
      code: 'TEST_RULE',
      pillar: 'PHYSICAL' as never,
      condition: { '==': [{ var: 'locationType' }, 'SHOP'] },
      suggestedActionFa: 'یک پیشنهاد آزمایشی برای تست.',
    });
    expect((prisma.advisoryRule as unknown as Record<string, jest.Mock>).create).toHaveBeenCalled();

    await expect(
      service.createRule({
        code: 'BAD_RULE',
        pillar: 'PHYSICAL' as never,
        condition: { broken_op: [1] } as never,
        suggestedActionFa: 'متن پیشنهاد.',
      }),
    ).rejects.toThrow(/نامعتبر/);
  });

  it('updateRule validates a changed condition; delete delegates to prisma', async () => {
    const { service, prisma } = buildService();
    await service.updateRule('rule-1', { condition: { '==': [1, 1] } });
    expect((prisma.advisoryRule as unknown as Record<string, jest.Mock>).update).toHaveBeenCalled();

    await service.deleteRule('rule-1');
    expect((prisma.advisoryRule as unknown as Record<string, jest.Mock>).delete).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
    });
  });
});
