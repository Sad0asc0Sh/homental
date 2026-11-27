import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PropertyAssetKind, PropertyAssetStatus, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import type {
  CompletePropertyMediaDto,
  CreatePropertyDto,
  PresignPropertyMediaDto,
  UpdatePropertyDto,
} from './dto/properties.dto';
import {
  MEDIA_STORAGE_PROVIDER,
  type MediaStorageProvider,
} from './media-storage.provider';

interface MediaRule {
  allowedMimes: ReadonlySet<string>;
  maxBytes: number;
  completeStatus: PropertyAssetStatus;
  defaultExt: string;
}

const MB = 1024 * 1024;

export const MEDIA_UPLOAD_RULES: Record<PropertyAssetKind, MediaRule> = {
  PHOTO: {
    allowedMimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
    maxBytes: 15 * MB,
    completeStatus: PropertyAssetStatus.READY,
    defaultExt: '.jpg',
  },
  SURVEY_VIDEO: {
    allowedMimes: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
    maxBytes: 150 * MB,
    completeStatus: PropertyAssetStatus.PROCESSING,
    defaultExt: '.mp4',
  },
  MODEL_3D_GLB: {
    allowedMimes: new Set(['model/gltf-binary', 'application/octet-stream']),
    maxBytes: 100 * MB,
    completeStatus: PropertyAssetStatus.PROCESSING,
    defaultExt: '.glb',
  },
  FLOORPLAN_JSON: {
    allowedMimes: new Set(['application/json']),
    maxBytes: 5 * MB,
    completeStatus: PropertyAssetStatus.READY,
    defaultExt: '.json',
  },
};

const ACTIVE_TECHNICIAN_STATES = [
  'EXPERT_ASSIGNED',
  'ON_THE_WAY',
  'INSPECTING',
  'QUOTE_APPROVED',
  'IN_PROGRESS',
  'HANDOVER_OTP_PENDING',
] as const;

const PROPERTY_INCLUDE = {
  city: { select: { id: true, slug: true, nameFa: true } },
  mediaAssets: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
} as const satisfies Prisma.CustomerPropertyInclude;

type PropertyWithAssets = Prisma.CustomerPropertyGetPayload<{
  include: typeof PROPERTY_INCLUDE;
}>;

function sanitizeExtension(fileName: string | undefined, fallbackExt: string): string {
  if (!fileName) return fallbackExt;
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return fallbackExt;
  const rawExt = fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!rawExt || rawExt.length > 10) return fallbackExt;
  return `.${rawExt}`;
}

function toJsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toPropertyView(property: PropertyWithAssets) {
  const ready3d = property.mediaAssets.find(
    (asset) => asset.kind === PropertyAssetKind.MODEL_3D_GLB && asset.status === PropertyAssetStatus.READY,
  ) ?? null;
  const photos = property.mediaAssets.filter((asset) => asset.kind === PropertyAssetKind.PHOTO);
  const latestPhoto = photos.find((asset) => asset.status === PropertyAssetStatus.READY) ?? photos[0] ?? null;

  return {
    id: property.id,
    userId: property.userId,
    cityId: property.cityId,
    city: property.city,
    title: property.title,
    propertyType: property.propertyType,
    address: property.address,
    lat: property.lat,
    lng: property.lng,
    notes: property.notes,
    defaultDimensionsJson: property.defaultDimensionsJson,
    isArchived: property.isArchived,
    mediaCount: property.mediaAssets.length,
    photoCount: photos.length,
    hasReady3dModel: ready3d !== null,
    latestReady3dModel: ready3d,
    latestPhoto,
    mediaAssets: property.mediaAssets,
    createdAt: property.createdAt,
    updatedAt: property.updatedAt,
  };
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storageProvider: MediaStorageProvider,
  ) {}

  private assertNotSeller(actor: AuthenticatedUser): void {
    if (actor.role === UserRole.SELLER) {
      throw new ForbiddenException('فروشندگان مجاز به دسترسی به اطلاعات مکان مشتریان نیستند.');
    }
  }

  private assertCustomer(actor: AuthenticatedUser): void {
    this.assertNotSeller(actor);
    if (actor.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException('این عملیات فقط برای مشتریان مجاز است.');
    }
  }

  private async verifyCityIfProvided(cityId: string | null | undefined): Promise<void> {
    if (!cityId) return;
    const city = await this.prisma.city.findUnique({ where: { id: cityId }, select: { id: true } });
    if (!city) {
      throw new NotFoundException('شهر مورد نظر یافت نشد.');
    }
  }

  private async requireOwnedProperty(actor: AuthenticatedUser, propertyId: string) {
    this.assertCustomer(actor);
    const property = await this.prisma.customerProperty.findUnique({
      where: { id: propertyId },
      include: PROPERTY_INCLUDE,
    });
    if (!property) {
      throw new NotFoundException('ملک مورد نظر یافت نشد.');
    }
    if (property.userId !== actor.id) {
      throw new ForbiddenException('شما مجوز دسترسی به این ملک را ندارید.');
    }
    if (property.isArchived) {
      throw new NotFoundException('ملک مورد نظر بایگانی شده است.');
    }
    return property;
  }

  async create(actor: AuthenticatedUser, dto: CreatePropertyDto) {
    this.assertCustomer(actor);
    await this.verifyCityIfProvided(dto.cityId);

    const created = await this.prisma.customerProperty.create({
      data: {
        userId: actor.id,
        cityId: dto.cityId ?? null,
        title: dto.title.trim(),
        propertyType: dto.propertyType,
        address: dto.address.trim(),
        lat: dto.lat,
        lng: dto.lng,
        notes: dto.notes?.trim() ? dto.notes.trim() : null,
        defaultDimensionsJson: dto.defaultDimensionsJson
          ? toJsonInput(dto.defaultDimensionsJson)
          : Prisma.JsonNull,
      },
      include: PROPERTY_INCLUDE,
    });

    return toPropertyView(created);
  }

  async list(actor: AuthenticatedUser) {
    this.assertCustomer(actor);
    const rows = await this.prisma.customerProperty.findMany({
      where: { userId: actor.id, isArchived: false },
      orderBy: { createdAt: 'desc' },
      include: PROPERTY_INCLUDE,
    });
    return rows.map(toPropertyView);
  }

  async getOne(actor: AuthenticatedUser, propertyId: string) {
    this.assertNotSeller(actor);
    const property = await this.prisma.customerProperty.findUnique({
      where: { id: propertyId },
      include: PROPERTY_INCLUDE,
    });
    if (!property) {
      throw new NotFoundException('ملک مورد نظر یافت نشد.');
    }

    switch (actor.role) {
      case UserRole.SUPER_ADMIN:
        return toPropertyView(property);

      case UserRole.CUSTOMER:
        if (property.userId !== actor.id) {
          throw new ForbiddenException('شما مجوز دسترسی به این ملک را ندارید.');
        }
        if (property.isArchived) {
          throw new NotFoundException('ملک مورد نظر بایگانی شده است.');
        }
        return toPropertyView(property);

      case UserRole.TECHNICIAN: {
        const authorizedOrder = await this.prisma.serviceOrder.findFirst({
          where: {
            propertyId,
            OR: [
              {
                technicianId: actor.id,
                state: { in: [...ACTIVE_TECHNICIAN_STATES] },
              },
              {
                dispatchOffers: {
                  some: {
                    status: 'PENDING',
                    expiresAt: { gt: new Date() },
                    technician: { userId: actor.id },
                  },
                },
              },
            ],
          },
          select: { id: true },
        });
        if (!authorizedOrder) {
          throw new ForbiddenException('شما مجوز مشاهده اطلاعات این ملک را ندارید.');
        }
        return toPropertyView(property);
      }

      case UserRole.BRANCH_ADMIN: {
        if (!actor.branchId) {
          throw new ForbiddenException('دسترسی شعبه برای این حساب تنظیم نشده است.');
        }
        const branchOrder = await this.prisma.serviceOrder.findFirst({
          where: { propertyId, branchId: actor.branchId },
          select: { id: true },
        });
        if (!branchOrder) {
          throw new ForbiddenException('این ملک به سفارش‌های شعبه شما متصل نیست.');
        }
        return toPropertyView(property);
      }

      default:
        throw new ForbiddenException();
    }
  }

  async update(actor: AuthenticatedUser, propertyId: string, dto: UpdatePropertyDto) {
    await this.requireOwnedProperty(actor, propertyId);
    if (dto.cityId !== undefined) {
      await this.verifyCityIfProvided(dto.cityId);
    }

    const updated = await this.prisma.customerProperty.update({
      where: { id: propertyId },
      data: {
        ...(dto.cityId !== undefined ? { cityId: dto.cityId } : {}),
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.propertyType !== undefined ? { propertyType: dto.propertyType } : {}),
        ...(dto.address !== undefined ? { address: dto.address.trim() } : {}),
        ...(dto.lat !== undefined ? { lat: dto.lat } : {}),
        ...(dto.lng !== undefined ? { lng: dto.lng } : {}),
        ...(dto.notes !== undefined
          ? { notes: dto.notes?.trim() ? dto.notes.trim() : null }
          : {}),
        ...(dto.defaultDimensionsJson !== undefined
          ? {
              defaultDimensionsJson:
                dto.defaultDimensionsJson === null
                  ? Prisma.DbNull
                  : toJsonInput(dto.defaultDimensionsJson),
            }
          : {}),
      },
      include: PROPERTY_INCLUDE,
    });

    return toPropertyView(updated);
  }

  async archive(actor: AuthenticatedUser, propertyId: string) {
    await this.requireOwnedProperty(actor, propertyId);
    const archived = await this.prisma.customerProperty.update({
      where: { id: propertyId },
      data: { isArchived: true },
      select: { id: true, isArchived: true },
    });
    return archived;
  }

  async presignMedia(
    actor: AuthenticatedUser,
    propertyId: string,
    dto: PresignPropertyMediaDto,
  ) {
    await this.requireOwnedProperty(actor, propertyId);
    const rule = MEDIA_UPLOAD_RULES[dto.kind];
    const normalizedMime = dto.mimeType.trim().toLowerCase();

    if (!rule.allowedMimes.has(normalizedMime)) {
      throw new BadRequestException('فرمت فایل برای این نوع رسانه مجاز نیست.');
    }
    if (dto.sizeBytes <= 0 || dto.sizeBytes > rule.maxBytes) {
      throw new BadRequestException('حجم فایل خارج از محدوده مجاز است.');
    }

    const ext = sanitizeExtension(dto.fileName, rule.defaultExt);
    const storageKey = `properties/${propertyId}/${dto.kind.toLowerCase()}/${randomUUID()}${ext}`;
    const sizeBytes = BigInt(dto.sizeBytes);

    const presigned = await this.storageProvider.createPresignedUpload({
      storageKey,
      mimeType: normalizedMime,
      sizeBytes,
      kind: dto.kind,
    });

    const asset = await this.prisma.propertyMediaAsset.create({
      data: {
        propertyId,
        uploadedByUserId: actor.id,
        kind: dto.kind,
        status: PropertyAssetStatus.PENDING_UPLOAD,
        storageKey,
        mimeType: normalizedMime,
        sizeBytes,
        publicUrl: presigned.publicUrl,
      },
    });

    return {
      assetId: asset.id,
      uploadUrl: presigned.uploadUrl,
      storageKey: asset.storageKey,
      expiresInSeconds: presigned.expiresInSeconds,
    };
  }

  async completeMedia(
    actor: AuthenticatedUser,
    propertyId: string,
    assetId: string,
    dto: CompletePropertyMediaDto = {},
  ) {
    await this.requireOwnedProperty(actor, propertyId);
    const asset = await this.prisma.propertyMediaAsset.findFirst({
      where: { id: assetId, propertyId },
    });
    if (!asset) {
      throw new NotFoundException('فایل رسانه مورد نظر یافت نشد.');
    }
    if (asset.status === PropertyAssetStatus.FAILED) {
      throw new BadRequestException('امکان تکمیل فایل ناموفق وجود ندارد.');
    }

    const targetStatus =
      asset.status === PropertyAssetStatus.READY || asset.status === PropertyAssetStatus.PROCESSING
        ? asset.status
        : MEDIA_UPLOAD_RULES[asset.kind].completeStatus;

    return this.prisma.propertyMediaAsset.update({
      where: { id: asset.id },
      data: {
        status: targetStatus,
        publicUrl: asset.publicUrl ?? this.storageProvider.resolvePublicUrl(asset.storageKey),
        ...(dto.spatialMetadataJson !== undefined
          ? { spatialMetadataJson: toJsonInput(dto.spatialMetadataJson) }
          : {}),
      },
    });
  }
}
