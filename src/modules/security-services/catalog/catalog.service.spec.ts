import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { LocationType } from '@prisma/client';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { serviceDefinitions } from '../../../../prisma/seed';
import { CatalogService, LOCATION_PRESETS } from './catalog.service';
import type {
  CreateServiceDefinitionDto,
  UpdateServiceDefinitionDto,
} from './dto/catalog.dto';

function cloneSeed() {
  return serviceDefinitions.map((definition) => ({
    ...definition,
    version: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    id: `def-${definition.key}`,
  }));
}

/** Emulates Prisma list filtering (isActive + supportedLocationTypes.has). */
function makeDefinitionFindManyMock(seed: Array<Record<string, unknown>>) {
  return jest.fn(async (args?: {
    where?: { isActive?: boolean; supportedLocationTypes?: { has?: string } };
  }) => {
    let definitions = [...seed];
    const where = args?.where;
    if (where?.isActive === true) {
      definitions = definitions.filter((definition) => definition['isActive'] !== false);
    }
    const has = where?.supportedLocationTypes?.has;
    if (has !== undefined) {
      definitions = definitions.filter((definition) =>
        ((definition['supportedLocationTypes'] as string[] | undefined) ?? []).includes(has),
      );
    }
    return definitions;
  });
}

function buildService(extraSeed: Array<Record<string, unknown>> = []) {
  const prisma = {
    serviceDefinition: {
      findMany: makeDefinitionFindManyMock([...cloneSeed(), ...extraSeed] as Array<Record<string, unknown>>),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
    },
  } as unknown as PrismaService;
  return { service: new CatalogService(prisma), prisma };
}

function requireSeed(key: string) {
  const found = serviceDefinitions.find((definition) => definition.key === key);
  if (!found) throw new Error(`${key} seed definition missing`);
  return found;
}

const cctvSeed = requireSeed('CCTV');
const fieldIds = (uiSchema: Record<string, unknown>): string[] => {
  const steps = (uiSchema as { steps?: Array<{ fields?: Array<{ id?: string }> }> }).steps ?? [];
  return steps.flatMap((step) => (step.fields ?? []).map((field) => field.id ?? ''));
};
const goalCardIds = (uiSchema: Record<string, unknown>): string[] => {
  const goalCards = (uiSchema as { goalCards?: { cards?: Array<{ id?: string }> } }).goalCards;
  return (goalCards?.cards ?? []).map((card) => card.id ?? '');
};

describe('CatalogService — public 3-pillar schemas + locationType filtering', () => {
  it('groups active services under the 3 engineering pillars with Persian metadata', async () => {
    const { service } = buildService();
    const result = await service.listSchemas();

    expect(result.pillars).toHaveLength(3);
    const pillars = result.pillars.map((p) => p.pillar);
    expect(pillars).toEqual(['PHYSICAL', 'INTRUSION', 'MONITORING']);
    expect(result.pillars.every((p) => p.titleFa.length > 0 && p.subtitleFa.length > 0)).toBe(true);

    const byPillar = Object.fromEntries(result.pillars.map((p) => [p.pillar, p.services.map((s) => s.key)]));
    expect(byPillar.PHYSICAL).toEqual(['PARKING_JACK', 'ELECTRIC_SHUTTER']);
    expect(byPillar.INTRUSION).toEqual(['ALARM']);
    expect(byPillar.MONITORING).toEqual(['CCTV']);
    expect(result.recommendedPreset).toBeNull();
  });

  it('WITHOUT locationType returns the raw uiSchema (parking-only field kept)', async () => {
    const { service } = buildService();
    const result = await service.listSchemas();
    const cctv = result.pillars
      .flatMap((p) => p.services)
      .find((s) => s.key === 'CCTV');
    expect(fieldIds(cctv!.uiSchema as Record<string, unknown>)).toContain('nightPlate');
  });

  it('filters location-restricted fields AND goal cards for SHOP', async () => {
    const { service } = buildService();
    const result = await service.listSchemas('SHOP' as LocationType);
    const cctv = result.pillars.flatMap((p) => p.services).find((s) => s.key === 'CCTV');
    const alarm = result.pillars.flatMap((p) => p.services).find((s) => s.key === 'ALARM');

    // nightPlate is restricted to PARKING/WAREHOUSE → hidden from shops
    expect(fieldIds(cctv!.uiSchema as Record<string, unknown>)).not.toContain('nightPlate');
    // panicButton is SHOP-only → visible
    expect(fieldIds(alarm!.uiSchema as Record<string, unknown>)).toContain('panicButton');
    expect(result.recommendedPreset?.locationType).toBe('SHOP');
  });

  it('keeps parking-only fields when the requested locationType is PARKING', async () => {
    const { service } = buildService();
    const result = await service.listSchemas('PARKING' as LocationType);
    const cctv = result.pillars.flatMap((p) => p.services).find((s) => s.key === 'CCTV');
    expect(fieldIds(cctv!.uiSchema as Record<string, unknown>)).toContain('nightPlate');
    expect(goalCardIds(cctv!.uiSchema as Record<string, unknown>)).toContain('NIGHT_PLATE_GOAL');
  });

  it('returns a single active service by key and 404 for inactive/unknown keys', async () => {
    const { service, prisma } = buildService();
    (prisma.serviceDefinition.findUnique as jest.Mock).mockResolvedValue(cloneSeed()[0]);

    const schema = await service.getSchema('CCTV');
    expect(schema.key).toBe('CCTV');

    (prisma.serviceDefinition.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.getSchema('CCTV')).rejects.toThrow(NotFoundException);
  });

  it('excludes location-restricted services from unsupported locations (Part A fix)', async () => {
    const restricted = {
      key: 'SHOP_ONLY_SERVICE',
      pillar: 'PHYSICAL',
      version: 1,
      isActive: true,
      titleFa: 'سرویس ویژه مغازه و انبار',
      subtitleFa: null,
      descriptionFa: null,
      iconKey: null,
      supportedLocationTypes: ['SHOP', 'WAREHOUSE'],
      warrantyMonths: 12,
      uiSchema: {},
    };
    const { service } = buildService([restricted]);

    const shopResult = await service.listSchemas('SHOP' as LocationType);
    const apartmentResult = await service.listSchemas('APARTMENT' as LocationType);
    const shopKeys = shopResult.pillars.flatMap((p) => p.services.map((s) => s.key));
    const apartmentKeys = apartmentResult.pillars.flatMap((p) => p.services.map((s) => s.key));

    expect(shopKeys).toContain('SHOP_ONLY_SERVICE');
    expect(apartmentKeys).not.toContain('SHOP_ONLY_SERVICE');
    // Unfiltered (no locationType) still lists everything.
    const allKeys = (await service.listSchemas()).pillars.flatMap((p) => p.services.map((s) => s.key));
    expect(allKeys).toContain('SHOP_ONLY_SERVICE');
  });

  it('recommended presets cover all five location types (Dual-Path Path 1)', () => {
    const locations: LocationType[] = ['APARTMENT', 'VILLA', 'SHOP', 'PARKING', 'WAREHOUSE'];
    for (const location of locations) {
      const preset = LOCATION_PRESETS[location];
      expect(preset.questionFa).toContain('چه مکانی');
      expect(preset.starters.length).toBeGreaterThan(0);
    }
    expect(LOCATION_PRESETS['SHOP' as LocationType].starters.map((s) => s.serviceKey)).toContain(
      'ELECTRIC_SHUTTER',
    );
  });
});

describe('CatalogService — admin CRUD with Zod validation & version bump', () => {
  function validCreateDto(): CreateServiceDefinitionDto {
    return {
      key: 'CCTV' as never,
      pillar: 'MONITORING' as never,
      titleFa: cctvSeed.titleFa,
      supportedLocationTypes: cctvSeed.supportedLocationTypes,
      uiSchema: cctvSeed.uiSchema as unknown as Record<string, unknown>,
      pricingSchema: cctvSeed.pricingSchema as unknown as Record<string, unknown>,
    };
  }

  it('createService validates documents and persists valid payloads', async () => {
    const { service, prisma } = buildService();
    const created = await service.createService(validCreateDto());
    expect(created).toBeDefined();
    expect(prisma.serviceDefinition.create).toHaveBeenCalledTimes(1);
  });

  it('createService rejects a broken uiSchema with a Persian 400', async () => {
    const { service } = buildService();
    const dto = { ...validCreateDto(), uiSchema: { $schema: 'x', steps: 'not-an-array' } };
    await expect(service.createService(dto)).rejects.toThrow(BadRequestException);
    try {
      await service.createService(dto);
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as Record<string, unknown>;
      expect(body['message']).toContain('uiSchema');
    }
  });

  it('createService rejects pricingSchema whose currency is not TOMAN', async () => {
    const { service } = buildService();
    const dto = validCreateDto();
    dto.pricingSchema = { ...(dto.pricingSchema as object), currency: 'USD' };
    await expect(service.createService(dto)).rejects.toThrow(BadRequestException);
  });

  it('bumps version ONLY when uiSchema or pricingSchema changes', async () => {
    const { service, prisma } = buildService();
    (prisma.serviceDefinition.update as jest.Mock).mockResolvedValue({});

    const schemaChange: UpdateServiceDefinitionDto = {
      pricingSchema: cctvSeed.pricingSchema as unknown as Record<string, unknown>,
    };
    await service.updateService('CCTV', schemaChange);
    expect(prisma.serviceDefinition.update).toHaveBeenCalledWith({
      where: { key: 'CCTV' },
      data: expect.objectContaining({ version: { increment: 1 } }),
    });

    (prisma.serviceDefinition.update as jest.Mock).mockClear();
    const labelChange: UpdateServiceDefinitionDto = { titleFa: 'دوربین مداربسته هوشمند' };
    await service.updateService('CCTV', labelChange);
    const updateCall = (prisma.serviceDefinition.update as jest.Mock).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data['version']).toBeUndefined();
    expect(updateCall.data['titleFa']).toBe('دوربین مداربسته هوشمند');
  });
});
