import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { normalizeIranPhone } from '@common/utils/phone.util';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import type {
  CreateTechnicianDto,
  ListTechniciansDto,
  UpdateTechnicianDto,
} from './dto/users.dto';

export interface TechnicianWithUser {
  profile: {
    id: string;
    userId: string;
    branchId: string | null;
    status: string;
    skills: string[];
    rating: { toNumber(): number };
  };
  user: {
    id: string;
    phone: string;
    firstName: string | null;
    lastName: string | null;
    role: UserRole;
    status: string;
  };
}

@Injectable()
export class AdminTechniciansService {
  constructor(private readonly prisma: PrismaService) {}

  /** BRANCH_ADMIN is strictly locked to their own branch (Invariant 11 scoping). */
  private assertBranchScope(actor: AuthenticatedUser, branchId: string | null): void {
    if (actor.role === UserRole.BRANCH_ADMIN && actor.branchId !== branchId) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'شما فقط به شعبه خودتان دسترسی دارید.',
      });
    }
  }

  async create(actor: AuthenticatedUser, dto: CreateTechnicianDto): Promise<TechnicianWithUser> {
    this.assertBranchScope(actor, dto.branchId);

    const branch = await this.prisma.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch || !branch.isActive) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'شعبه انتخابی معتبر نیست یا فعال نیست.',
      });
    }

    const phone = normalizeIranPhone(dto.phone);
    return this.prisma.$transaction(async (tx) => {
      // Part A hotfix #1: never let this endpoint silently overwrite an
      // admin account or let a branch admin hijack another branch's technician.
      const existing = await tx.user.findUnique({
        where: { phone },
        include: { technicianProfile: true },
      });
      if (existing) {
        if (existing.role === UserRole.SUPER_ADMIN || existing.role === UserRole.BRANCH_ADMIN ||
            existing.role === UserRole.SELLER) {
          throw new ConflictException({
            statusCode: 409,
            message: 'تبدیل حساب مدیر یا تأمین‌کننده به تکنسین از این مسیر مجاز نیست.',
          });
        }
        if (
          actor.role === UserRole.BRANCH_ADMIN &&
          existing.technicianProfile &&
          existing.technicianProfile.branchId !== dto.branchId
        ) {
          throw new ForbiddenException({
            statusCode: 403,
            message: 'انتقال تکنسین بین شعبه‌ها فقط توسط ابرادمین سامانه ممکن است.',
          });
        }
      }

      const identity = { role: UserRole.TECHNICIAN, firstName: dto.firstName, lastName: dto.lastName };
      const user = existing
        ? await tx.user.update({ where: { id: existing.id, role: existing.role }, data: identity })
        : await tx.user.create({ data: { phone, status: 'ACTIVE', ...identity } });
      const profile = await tx.technicianProfile.upsert({
        where: { userId: user.id },
        update: { branchId: dto.branchId, skills: dto.skills },
        create: {
          userId: user.id,
          branchId: dto.branchId,
          skills: dto.skills,
          status: 'PENDING_APPROVAL',
        },
      });
      await tx.wallet.upsert({
        where: { ownerType_ownerId: { ownerType: 'TECHNICIAN', ownerId: user.id } },
        update: {},
        create: { ownerType: 'TECHNICIAN', ownerId: user.id },
      });
      return {
        profile: {
          id: profile.id,
          userId: profile.userId,
          branchId: profile.branchId,
          status: profile.status,
          skills: profile.skills,
          rating: profile.rating,
        },
        user: {
          id: user.id,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          status: user.status,
        },
      };
    });
  }

  async list(actor: AuthenticatedUser, query: ListTechniciansDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    // Part A hotfix #3: a BRANCH_ADMIN without a resolved branch must NEVER
    // fall through to an unfiltered (all-branches) query.
    if (actor.role === UserRole.BRANCH_ADMIN && !actor.branchId) {
      return { items: [], total: 0, page, limit };
    }
    const branchId =
      actor.role === UserRole.BRANCH_ADMIN ? actor.branchId : (query.branchId ?? undefined);
    const where = {
      ...(branchId ? { branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.skill ? { skills: { has: query.skill } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.technicianProfile.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, phone: true, firstName: true, lastName: true, role: true, status: true } },
        },
      }),
      this.prisma.technicianProfile.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async update(actor: AuthenticatedUser, profileId: string, dto: UpdateTechnicianDto) {
    const profile = await this.prisma.technicianProfile.findUnique({ where: { id: profileId } });
    if (!profile) {
      throw new NotFoundException({ statusCode: 404, message: 'تکنسین یافت نشد.' });
    }
    if (actor.role === UserRole.BRANCH_ADMIN && profile.branchId !== actor.branchId) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'شما فقط به تکنسین‌های شعبه خودتان دسترسی دارید.',
      });
    }
    return this.prisma.technicianProfile.update({
      where: { id: profileId },
      data: {
        status: dto.status ?? undefined,
        skills: dto.skills ?? undefined,
      },
    });
  }
}
