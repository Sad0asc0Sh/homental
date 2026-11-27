import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PropertyAssetKind, PropertyAssetStatus, PropertyType, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { LocalDevMediaStorageProvider } from './media-storage.provider';
import { PropertiesService } from './properties.service';

const customerA: AuthenticatedUser = { id: 'cust-a', phone: '+989120000020', role: UserRole.CUSTOMER, branchId: null };
const customerB: AuthenticatedUser = { id: 'cust-b', phone: '+989120000021', role: UserRole.CUSTOMER, branchId: null };
const seller: AuthenticatedUser = { id: 'seller-1', phone: '+989120000030', role: UserRole.SELLER, branchId: null };

function buildService() {
  const properties = new Map<string, Record<string, unknown>>();
  const assets = new Map<string, Record<string, unknown>>();
  let seq = 1;

  const prisma = {
    city: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'city-mashhad' ? { id: 'city-mashhad' } : null,
      ),
    },
    customerProperty: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `prop-${seq++}`;
        const row = {
          id,
          ...data,
          city: data['cityId'] ? { id: data['cityId'], slug: 'mashhad', nameFa: 'مشهد' } : null,
          isArchived: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          mediaAssets: [],
        };
        properties.set(id, row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: { userId: string; isArchived: boolean } }) =>
        [...properties.values()].filter(
          (row) => row['userId'] === where.userId && row['isArchived'] === where.isArchived,
        ),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const prop = properties.get(where.id);
        if (!prop) return null;
        return {
          ...prop,
          mediaAssets: [...assets.values()].filter((a) => a['propertyId'] === prop['id']),
        };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = properties.get(where.id)!;
        const next = { ...existing, ...data, updatedAt: new Date() };
        properties.set(where.id, next);
        return {
          ...next,
          mediaAssets: [...assets.values()].filter((a) => a['propertyId'] === where.id),
        };
      }),
    },
    propertyMediaAsset: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `asset-${seq++}`;
        const row = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        assets.set(id, row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: { id: string; propertyId: string } }) => {
        const row = assets.get(where.id);
        return row && row['propertyId'] === where.propertyId ? row : null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = assets.get(where.id)!;
        const next = { ...existing, ...data, updatedAt: new Date() };
        assets.set(where.id, next);
        return next;
      }),
    },
    serviceOrder: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaService;

  const service = new PropertiesService(prisma, new LocalDevMediaStorageProvider());
  return { service, prisma };
}

describe('PropertiesService', () => {
  it('allows customer CRUD, rejects other customers and blocks sellers', async () => {
    const { service } = buildService();

    const created = await service.create(customerA, {
      cityId: 'city-mashhad',
      title: 'منزل وکیل‌آباد',
      propertyType: PropertyType.RESIDENTIAL,
      address: 'مشهد، بلوار وکیل‌آباد، پلاک ۱۲',
      lat: 36.3105,
      lng: 59.5663,
      defaultDimensionsJson: { areaM2: 120, ceilingHeightCm: 290 },
    });
    expect(created.title).toBe('منزل وکیل‌آباد');
    expect(created.mediaCount).toBe(0);

    await expect(service.list(customerA)).resolves.toHaveLength(1);
    await expect(service.getOne(customerB, created.id)).rejects.toThrow(ForbiddenException);
    await expect(service.update(customerB, created.id, { title: 'تلاش غیرمجاز' })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.list(seller)).rejects.toThrow(ForbiddenException);
    await expect(service.getOne(seller, created.id)).rejects.toThrow(ForbiddenException);

    const updated = await service.update(customerA, created.id, { title: 'آپارتمان وکیل‌آباد' });
    expect(updated.title).toBe('آپارتمان وکیل‌آباد');

    const archived = await service.archive(customerA, created.id);
    expect(archived.isArchived).toBe(true);
    await expect(service.list(customerA)).resolves.toHaveLength(0);
    await expect(service.getOne(customerA, created.id)).rejects.toThrow(NotFoundException);
  });

  it('validates media presign rules and completes PHOTO -> READY and MODEL_3D_GLB -> PROCESSING', async () => {
    const { service } = buildService();
    const property = await service.create(customerA, {
      title: 'مغازه سجاد',
      propertyType: PropertyType.COMMERCIAL,
      address: 'مشهد، بلوار سجاد، پلاک ۴',
      lat: 36.3018,
      lng: 59.5838,
    });

    await expect(
      service.presignMedia(customerA, property.id, {
        kind: PropertyAssetKind.PHOTO,
        mimeType: 'application/x-msdownload',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.presignMedia(customerA, property.id, {
        kind: PropertyAssetKind.PHOTO,
        mimeType: 'image/jpeg',
        sizeBytes: 25 * 1024 * 1024,
      }),
    ).rejects.toThrow(BadRequestException);

    const photoPresign = await service.presignMedia(customerA, property.id, {
      kind: PropertyAssetKind.PHOTO,
      mimeType: 'image/jpeg',
      sizeBytes: 240_000,
      fileName: 'entrance.jpg',
    });
    expect(photoPresign.uploadUrl).toContain('properties/');
    expect(photoPresign.expiresInSeconds).toBe(900);

    const photoDone = await service.completeMedia(customerA, property.id, photoPresign.assetId, {
      spatialMetadataJson: { scannerSource: 'web-camera', wallCount: 4 },
    });
    expect(photoDone.status).toBe(PropertyAssetStatus.READY);

    const glbPresign = await service.presignMedia(customerA, property.id, {
      kind: PropertyAssetKind.MODEL_3D_GLB,
      mimeType: 'model/gltf-binary',
      sizeBytes: 1_500_000,
      fileName: 'shop-scan.glb',
    });
    const glbDone = await service.completeMedia(customerA, property.id, glbPresign.assetId, {
      spatialMetadataJson: { ceilingHeightCm: 340, scannerSource: 'arcore-future' },
    });
    expect(glbDone.status).toBe(PropertyAssetStatus.PROCESSING);
  });
});
