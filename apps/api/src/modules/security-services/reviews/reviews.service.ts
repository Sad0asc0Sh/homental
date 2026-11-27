import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';

/**
 * Reviews feed straight back into the Dispatch engine: every completed order
 * can be rated once, and the technician's normalized rating + count are
 * atomically recalculated here (rating is a dispatch scoring input).
 */
@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async reviewOrder(
    actor: AuthenticatedUser,
    orderId: string,
    dto: { rating: number; commentFa?: string },
  ) {
    if (actor.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException({ statusCode: 403, message: 'فقط مشتری سفارش می‌تواند ثبت امتیاز کند.' });
    }
    const order = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order || order.customerId !== actor.id) {
      throw new NotFoundException({ statusCode: 404, message: 'سفارش یافت نشد.' });
    }
    if (order.state !== 'COMPLETED_WARRANTY_ACTIVE') {
      throw new BadRequestException({
        statusCode: 400,
        message: 'ثبت امتیاز فقط پس از تکمیل سفارش و فعال‌شدن گارانتی ممکن است.',
      });
    }
    if (!order.technicianId) {
      throw new BadRequestException({ statusCode: 400, message: 'این سفارش تکنسین اختصاص‌یافته ندارد.' });
    }

    return this.prisma.$transaction(async (db) => {
      const existing = await db.review.findUnique({ where: { orderId: order.id } });
      if (existing) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'برای هر سفارش فقط یک‌بار می‌توان امتیاز ثبت کرد.',
        });
      }
      const review = await db.review.create({
        data: {
          orderId: order.id,
          authorId: actor.id,
          rating: dto.rating,
          commentFa: dto.commentFa,
        },
      });

      const profile = await db.technicianProfile.findUnique({
        where: { userId: order.technicianId as string },
      });
      if (profile) {
        const oldRating = Number(profile.rating);
        const oldCount = profile.ratingCount;
        const newRating = ((oldRating * oldCount) + dto.rating) / (oldCount + 1);
        await db.technicianProfile.update({
          where: { userId: profile.userId },
          data: { rating: Math.round(newRating * 100) / 100, ratingCount: { increment: 1 } },
        });
      }
      return review;
    });
  }
}
