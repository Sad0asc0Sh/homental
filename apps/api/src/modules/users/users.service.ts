import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CustomerProfile, User } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import type { CreateAddressDto, UpdateAddressDto, UpdateMeDto } from './dto/users.dto';

const USER_PUBLIC_SELECT = {
  id: true,
  phone: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  role: true,
  status: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(user: AuthenticatedUser): Promise<Partial<User> & { branchId: string | null }> {
    const found = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { ...USER_PUBLIC_SELECT },
    });
    if (!found) {
      throw new NotFoundException({ statusCode: 404, message: 'کاربر یافت نشد.' });
    }
    return { ...found, branchId: user.branchId };
  }

  async updateMe(user: AuthenticatedUser, dto: UpdateMeDto): Promise<Partial<User>> {
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: dto.firstName ?? undefined,
        lastName: dto.lastName ?? undefined,
        avatarUrl: dto.avatarUrl ?? undefined,
      },
      select: { ...USER_PUBLIC_SELECT },
    });
  }

  // ── Customer addresses (strictly scoped to the caller's CustomerProfile) ──

  private async requireCustomerProfile(userId: string): Promise<CustomerProfile> {
    const profile = await this.prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'فقط کاربران مشتری می‌توانند آدرس مدیریت کنند.',
      });
    }
    return profile;
  }

  private async assertCityIsValid(cityId: string): Promise<void> {
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!city || !city.isActive) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'شهر انتخابی معتبر نیست یا فعال نیست.',
      });
    }
  }

  async listAddresses(user: AuthenticatedUser) {
    const profile = await this.requireCustomerProfile(user.id);
    return this.prisma.address.findMany({
      where: { customerId: profile.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createAddress(user: AuthenticatedUser, dto: CreateAddressDto) {
    const profile = await this.requireCustomerProfile(user.id);
    await this.assertCityIsValid(dto.cityId);

    const createData = {
      customerId: profile.id,
      cityId: dto.cityId,
      titleFa: dto.titleFa,
      locationType: dto.locationType,
      fullAddressFa: dto.fullAddressFa,
      postalCode: dto.postalCode,
      lat: dto.lat,
      lng: dto.lng,
      isDefault: dto.isDefault ?? false,
    };

    if (!createData.isDefault) {
      return this.prisma.address.create({ data: createData });
    }
    // Atomically make this the only default address of the customer.
    const [, address] = await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { customerId: profile.id, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.address.create({ data: createData }),
    ]);
    return address;
  }

  async updateAddress(user: AuthenticatedUser, addressId: string, dto: UpdateAddressDto) {
    const profile = await this.requireCustomerProfile(user.id);
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.customerId !== profile.id) {
      throw new NotFoundException({ statusCode: 404, message: 'آدرس یافت نشد.' });
    }
    if (dto.cityId) await this.assertCityIsValid(dto.cityId);

    const data = {
      cityId: dto.cityId ?? undefined,
      titleFa: dto.titleFa ?? undefined,
      locationType: dto.locationType ?? undefined,
      fullAddressFa: dto.fullAddressFa ?? undefined,
      postalCode: dto.postalCode ?? undefined,
      lat: dto.lat ?? undefined,
      lng: dto.lng ?? undefined,
      isDefault: dto.isDefault ?? undefined,
    };

    if (dto.isDefault !== true) {
      return this.prisma.address.update({ where: { id: addressId }, data });
    }
    const [, updated] = await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { customerId: profile.id, isDefault: true, id: { not: addressId } },
        data: { isDefault: false },
      }),
      this.prisma.address.update({ where: { id: addressId }, data }),
    ]);
    return updated;
  }

  async deleteAddress(user: AuthenticatedUser, addressId: string) {
    const profile = await this.requireCustomerProfile(user.id);
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.customerId !== profile.id) {
      throw new NotFoundException({ statusCode: 404, message: 'آدرس یافت نشد.' });
    }
    await this.prisma.address.delete({ where: { id: addressId } });
    return { deleted: true };
  }
}
