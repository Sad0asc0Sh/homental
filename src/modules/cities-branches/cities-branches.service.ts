import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Branch } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import type { CreateBranchDto, CreateCityDto, UpdateBranchDto, UpdateCityDto } from './dto/cities-branches.dto';

/** Public branch fields — commission/warranty overrides are NEVER exposed. */
const PUBLIC_BRANCH_SELECT = {
  id: true,
  code: true,
  nameFa: true,
  addressFa: true,
  phone: true,
  lat: true,
  lng: true,
  serviceRadiusMeters: true,
} as const;

/** Fields a BRANCH_ADMIN may change on their own branch. */
const BRANCH_ADMIN_ALLOWED_FIELDS = new Set(['phone', 'addressFa', 'serviceRadiusMeters']);

function toBranchOperationsView(branch: Branch & { city?: { id: string; slug: string; nameFa: string } }) {
  const { id, code, cityId, adminId, nameFa, addressFa, phone, lat, lng, serviceRadiusMeters,
    hasPhysicalShowroom, isActive, createdAt, updatedAt, city } = branch;
  return {
    id, code, cityId, adminId, nameFa, addressFa, phone, lat, lng, serviceRadiusMeters,
    hasPhysicalShowroom, isActive, createdAt, updatedAt, city,
  };
}

@Injectable()
export class CitiesBranchesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Public ────────────────────────────────────────────────────────────────

  listActiveCities() {
    return this.prisma.city.findMany({
      where: { isActive: true },
      orderBy: { launchOrder: 'asc' },
      select: { id: true, slug: true, nameFa: true, nameEn: true, centerLat: true, centerLng: true },
    });
  }

  async listActiveBranches(citySlug: string) {
    const city = await this.prisma.city.findUnique({ where: { slug: citySlug } });
    if (!city || !city.isActive) {
      throw new NotFoundException({ statusCode: 404, message: 'شهر مورد نظر یافت نشد یا فعال نیست.' });
    }
    return this.prisma.branch.findMany({
      where: { cityId: city.id, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: PUBLIC_BRANCH_SELECT,
    });
  }

  // ── Admin: cities (SUPER_ADMIN only, enforced via @Roles) ─────────────────

  listAllCities() {
    return this.prisma.city.findMany({
      orderBy: [{ launchOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { branches: true } } },
    });
  }

  createCity(dto: CreateCityDto) {
    return this.prisma.city.create({
      data: {
        slug: dto.slug,
        nameFa: dto.nameFa,
        nameEn: dto.nameEn,
        centerLat: dto.centerLat,
        centerLng: dto.centerLng,
        launchOrder: dto.launchOrder ?? 0,
      },
    });
  }

  updateCity(cityId: string, dto: UpdateCityDto) {
    return this.prisma.city.update({
      where: { id: cityId },
      data: {
        slug: dto.slug ?? undefined,
        nameFa: dto.nameFa ?? undefined,
        nameEn: dto.nameEn ?? undefined,
        centerLat: dto.centerLat ?? undefined,
        centerLng: dto.centerLng ?? undefined,
        launchOrder: dto.launchOrder ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
  }

  // ── Admin: branches ───────────────────────────────────────────────────────

  async createBranch(dto: CreateBranchDto) {
    const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
    if (!city || !city.isActive) {
      throw new BadRequestException({ statusCode: 400, message: 'شهر انتخابی معتبر نیست یا فعال نیست.' });
    }
    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: {
          code: dto.code,
          cityId: dto.cityId,
          nameFa: dto.nameFa,
          addressFa: dto.addressFa,
          phone: dto.phone,
          lat: dto.lat,
          lng: dto.lng,
          serviceRadiusMeters: dto.serviceRadiusMeters ?? 15_000,
          hasPhysicalShowroom: dto.hasPhysicalShowroom ?? false,
          commissionRateOverride: dto.commissionRateOverride ?? null,
          warrantyReserveOverride: dto.warrantyReserveOverride ?? null,
          adminId: dto.adminId ?? null,
          isActive: dto.isActive ?? true,
        },
      });
      // Every branch owns a BRANCH wallet from day one (escrow payouts).
      await tx.wallet.create({
        data: { ownerType: 'BRANCH', ownerId: branch.id, branchId: branch.id },
      });
      return branch;
    });
  }

  async listBranches(actor: AuthenticatedUser) {
    if (actor.role === UserRole.BRANCH_ADMIN) {
      if (!actor.branchId) return [];
      const branches = await this.prisma.branch.findMany({
        where: { id: actor.branchId, adminId: actor.id },
        orderBy: { createdAt: 'asc' },
        include: { city: { select: { id: true, slug: true, nameFa: true } } },
      });
      return branches.map(toBranchOperationsView);
    }
    if (actor.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException();
    return this.prisma.branch.findMany({
      orderBy: { createdAt: 'asc' },
      include: { city: { select: { id: true, slug: true, nameFa: true } } },
    });
  }

  async updateBranch(actor: AuthenticatedUser, branchId: string, dto: UpdateBranchDto) {
    if (actor.role !== UserRole.BRANCH_ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException();
    }
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw new NotFoundException({ statusCode: 404, message: 'شعبه یافت نشد.' });
    }

    if (actor.role === UserRole.BRANCH_ADMIN) {
      if (branch.id !== actor.branchId || branch.adminId !== actor.id) {
        throw new ForbiddenException({
          statusCode: 403,
          message: 'شما فقط مجاز به مدیریت شعبه خودتان هستید.',
        });
      }
      // BRANCH_ADMIN may ONLY touch operational fields — commission overrides,
      // warranty reserve and showroom flags are SUPER_ADMIN territory.
      const record = dto as unknown as Record<string, unknown>;
      const attemptedForbidden = Object.keys(record).filter(
        (key) => record[key] !== undefined && !BRANCH_ADMIN_ALLOWED_FIELDS.has(key),
      );
      if (attemptedForbidden.length > 0) {
        throw new ForbiddenException({
          statusCode: 403,
          message:
            'تغییر نرخ کمیسیون، ذخیره گارانتی، نمایشگاه فیزیکی یا داده‌های پایه شعبه فقط توسط ابرادمین سامانه ممکن است.',
        });
      }
      const updated = await this.prisma.branch.update({
        where: { id: branchId },
        data: {
          phone: dto.phone ?? undefined,
          addressFa: dto.addressFa ?? undefined,
          serviceRadiusMeters: dto.serviceRadiusMeters ?? undefined,
        },
      });
      return toBranchOperationsView(updated);
    }

    // SUPER_ADMIN: full update (undefined = leave untouched, null = clear).
    const optional = <T>(value: T | null | undefined): T | null | undefined =>
      value === undefined ? undefined : value;
    return this.prisma.branch.update({
      where: { id: branchId },
      data: {
        code: dto.code ?? undefined,
        cityId: dto.cityId ?? undefined,
        nameFa: dto.nameFa ?? undefined,
        addressFa: dto.addressFa ?? undefined,
        phone: dto.phone ?? undefined,
        lat: dto.lat ?? undefined,
        lng: dto.lng ?? undefined,
        serviceRadiusMeters: dto.serviceRadiusMeters ?? undefined,
        hasPhysicalShowroom: dto.hasPhysicalShowroom ?? undefined,
        commissionRateOverride: optional(dto.commissionRateOverride),
        warrantyReserveOverride: optional(dto.warrantyReserveOverride),
        adminId: optional(dto.adminId),
        isActive: dto.isActive ?? undefined,
      },
    });
  }
}
