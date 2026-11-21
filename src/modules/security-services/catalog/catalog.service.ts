import { Injectable, NotFoundException } from '@nestjs/common';
import type { LocationType, Prisma, SecurityPillar } from '@prisma/client';
// ServiceKey is used as a VALUE in the presets map — must stay a value import.
import { ServiceKey } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { filterUiSchemaForLocation } from '../shared/ui-schema.filter';
import { parseCatalogDocument, pricingSchemaZod, uiSchemaZod } from './catalog.schema';
import type {
  CreateServiceDefinitionDto,
  UpdateServiceDefinitionDto,
} from './dto/catalog.dto';

/** The 3 Engineering Pillars — presentation metadata for the Next.js frontend. */
export const PILLAR_METADATA: Record<SecurityPillar, { titleFa: string; subtitleFa: string }> = {
  PHYSICAL: {
    titleFa: 'موانع فیزیکی و سخت',
    subtitleFa: 'سدهای فیزیکی مانند کرکره برقی و جک پارکینگی؛ جلوی ورود را می‌گیرند',
  },
  INTRUSION: {
    titleFa: 'هشدار نفوذ و سرقت',
    subtitleFa: 'دزدگیر و سنسورها؛ هنگام نفوذ فوری خبر می‌دهند',
  },
  MONITORING: {
    titleFa: 'دیده‌بانی و ثبت تصویر',
    subtitleFa: 'دوربین مداربسته؛ دید زنده، ضبط و سند در لحظه حادثه',
  },
};

const PILLAR_ORDER: SecurityPillar[] = ['PHYSICAL', 'INTRUSION', 'MONITORING'];

/**
 * Dual-Path Entry — Path 1: «چه مکانی را می‌خواهید امن کنید؟»
 * Starter configurations per location type (schema-driven UX presets).
 */
export interface RecommendedPreset {
  locationType: LocationType;
  questionFa: string;
  titleFa: string;
  starters: Array<{
    serviceKey: ServiceKey;
    config: Record<string, unknown>;
    hintFa: string;
  }>;
}

export const LOCATION_PRESETS: Record<LocationType, RecommendedPreset> = {
  APARTMENT: {
    locationType: 'APARTMENT',
    questionFa: 'چه مکانی را می‌خواهید امن کنید؟',
    titleFa: 'شروع سریع برای آپارتمان',
    starters: [
      { serviceKey: ServiceKey.ALARM, config: {}, hintFa: 'هشدار فوری نفوذ برای درب و پنجره‌ها' },
      { serviceKey: ServiceKey.CCTV, config: {}, hintFa: 'دیده‌بانی ورودی و پارکینگ' },
    ],
  },
  VILLA: {
    locationType: 'VILLA',
    questionFa: 'چه مکانی را می‌خواهید امن کنید؟',
    titleFa: 'شروع سریع برای ویلا',
    starters: [
      { serviceKey: ServiceKey.CCTV, config: { cameraCount: 4 }, hintFa: 'پوشش حیاط و ورودی مستقل' },
      { serviceKey: ServiceKey.ALARM, config: {}, hintFa: 'هشدار نفوذ در غیبت طولانی' },
    ],
  },
  SHOP: {
    locationType: 'SHOP',
    questionFa: 'چه مکانی را می‌خواهید امن کنید؟',
    titleFa: 'شروع سریع برای مغازه',
    starters: [
      {
        serviceKey: ServiceKey.ELECTRIC_SHUTTER,
        config: { bladeType: 'STEEL_HEAVY', upsBackup: true },
        hintFa: 'کرکره فولادی ضددیلم با UPS برای مغازه حساس',
      },
      {
        serviceKey: ServiceKey.ALARM,
        config: { panicButton: true },
        hintFa: 'دزدگیر با دکمه پنیک زیر صندوق',
      },
      { serviceKey: ServiceKey.CCTV, config: {}, hintFa: 'پوشش ورودی و صندوق فروش' },
    ],
  },
  PARKING: {
    locationType: 'PARKING',
    questionFa: 'چه مکانی را می‌خواهید امن کنید؟',
    titleFa: 'شروع سریع برای پارکینگ',
    starters: [
      { serviceKey: ServiceKey.PARKING_JACK, config: {}, hintFa: 'سد فیزیکی جلوی خودرو' },
      {
        serviceKey: ServiceKey.CCTV,
        config: { nightPlate: true, cameraCount: 2 },
        hintFa: 'دوربین پلاک‌خوان شبانه روی دهانه',
      },
    ],
  },
  WAREHOUSE: {
    locationType: 'WAREHOUSE',
    questionFa: 'چه مکانی را می‌خواهید امن کنید؟',
    titleFa: 'شروع سریع برای انبار',
    starters: [
      { serviceKey: ServiceKey.ALARM, config: {}, hintFa: 'هشدار نفوذ در ساعات غیرکاری' },
      {
        serviceKey: ServiceKey.CCTV,
        config: { storageDays: 30 },
        hintFa: 'ضبط ۳۰ روزه برای ورودی و راهروها',
      },
      { serviceKey: ServiceKey.PARKING_JACK, config: {}, hintFa: 'کنترل تردد بارانداز' },
    ],
  },
};

export interface PublicCatalogService {
  key: ServiceKey;
  pillar: SecurityPillar;
  version: number;
  titleFa: string;
  subtitleFa: string | null;
  descriptionFa: string | null;
  iconKey: string | null;
  supportedLocationTypes: LocationType[];
  warrantyMonths: number;
  uiSchema: unknown;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public 3-pillar catalog; `pricingSchema` stays internal (engine data). */
  async listSchemas(locationType?: LocationType): Promise<{
    pillars: Array<{ pillar: SecurityPillar; titleFa: string; subtitleFa: string; services: PublicCatalogService[] }>;
    recommendedPreset: RecommendedPreset | null;
  }> {
    const definitions = await this.prisma.serviceDefinition.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });

    const pillars = PILLAR_ORDER.map((pillar) => ({
      pillar,
      titleFa: PILLAR_METADATA[pillar].titleFa,
      subtitleFa: PILLAR_METADATA[pillar].subtitleFa,
      services: definitions
        .filter((definition) => definition.pillar === pillar)
        .map((definition) => this.toPublic(definition, locationType)),
    })).filter((pillarGroup) => pillarGroup.services.length > 0);

    return {
      pillars,
      recommendedPreset: locationType ? (LOCATION_PRESETS[locationType] ?? null) : null,
    };
  }

  async getSchema(key: ServiceKey, locationType?: LocationType): Promise<PublicCatalogService> {
    const definition = await this.prisma.serviceDefinition.findUnique({ where: { key } });
    if (!definition || !definition.isActive) {
      throw new NotFoundException({ statusCode: 404, message: 'سرویس مورد نظر یافت نشد یا فعال نیست.' });
    }
    return this.toPublic(definition, locationType);
  }

  // ── Admin (SUPER_ADMIN) ───────────────────────────────────────────────────

  async createService(dto: CreateServiceDefinitionDto) {
    const uiSchema = parseCatalogDocument(uiSchemaZod, dto.uiSchema, 'ساختار uiSchema');
    const pricingSchema = parseCatalogDocument(pricingSchemaZod, dto.pricingSchema, 'ساختار pricingSchema');
    return this.prisma.serviceDefinition.create({
      data: {
        key: dto.key,
        pillar: dto.pillar,
        titleFa: dto.titleFa,
        subtitleFa: dto.subtitleFa,
        descriptionFa: dto.descriptionFa,
        iconKey: dto.iconKey,
        displayOrder: dto.displayOrder ?? 0,
        supportedLocationTypes: dto.supportedLocationTypes,
        baseReadinessScore: dto.baseReadinessScore ?? 0,
        warrantyMonths: dto.warrantyMonths ?? 12,
        typicalDurationMinutes: dto.typicalDurationMinutes ?? 120,
        uiSchema: uiSchema as unknown as Prisma.InputJsonValue,
        pricingSchema: pricingSchema as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Any change to `uiSchema` or `pricingSchema` bumps `version` automatically
   * (customer answers are validated against the schema version they saw).
   */
  async updateService(key: ServiceKey, dto: UpdateServiceDefinitionDto) {
    const data: Prisma.ServiceDefinitionUpdateInput = {};
    let schemaChanged = false;

    if (dto.uiSchema !== undefined) {
      const uiSchema = parseCatalogDocument(uiSchemaZod, dto.uiSchema, 'ساختار uiSchema');
      data.uiSchema = uiSchema as unknown as Prisma.InputJsonValue;
      schemaChanged = true;
    }
    if (dto.pricingSchema !== undefined) {
      const pricingSchema = parseCatalogDocument(pricingSchemaZod, dto.pricingSchema, 'ساختار pricingSchema');
      data.pricingSchema = pricingSchema as unknown as Prisma.InputJsonValue;
      schemaChanged = true;
    }
    if (schemaChanged) {
      data.version = { increment: 1 };
    }

    data.pillar = dto.pillar ?? undefined;
    data.titleFa = dto.titleFa ?? undefined;
    data.subtitleFa = dto.subtitleFa ?? undefined;
    data.descriptionFa = dto.descriptionFa ?? undefined;
    data.iconKey = dto.iconKey ?? undefined;
    data.displayOrder = dto.displayOrder ?? undefined;
    data.supportedLocationTypes = dto.supportedLocationTypes ?? undefined;
    data.baseReadinessScore = dto.baseReadinessScore ?? undefined;
    data.warrantyMonths = dto.warrantyMonths ?? undefined;
    data.typicalDurationMinutes = dto.typicalDurationMinutes ?? undefined;
    data.isActive = dto.isActive ?? undefined;

    return this.prisma.serviceDefinition.update({ where: { key }, data });
  }

  private toPublic(
    definition: {
      key: ServiceKey;
      pillar: SecurityPillar;
      version: number;
      titleFa: string;
      subtitleFa: string | null;
      descriptionFa: string | null;
      iconKey: string | null;
      supportedLocationTypes: LocationType[];
      warrantyMonths: number;
      uiSchema: unknown;
    },
    locationType?: LocationType,
  ): PublicCatalogService {
    return {
      key: definition.key,
      pillar: definition.pillar,
      version: definition.version,
      titleFa: definition.titleFa,
      subtitleFa: definition.subtitleFa,
      descriptionFa: definition.descriptionFa,
      iconKey: definition.iconKey,
      supportedLocationTypes: definition.supportedLocationTypes,
      warrantyMonths: definition.warrantyMonths,
      uiSchema: locationType
        ? filterUiSchemaForLocation(definition.uiSchema, locationType)
        : definition.uiSchema,
    };
  }
}
