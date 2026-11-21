import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { ReviewsService } from './reviews.service';

const customer = { id: 'c1', phone: '+989120000020', role: UserRole.CUSTOMER, branchId: null } as AuthenticatedUser;

function buildService(options?: { state?: string; technicianId?: string | null; existingReview?: Record<string, unknown> | null }) {
  const order = {
    id: 'o1',
    orderNumber: 'HM-2026-000001',
    customerId: 'c1',
    technicianId: options?.technicianId ?? 't1',
    state: options?.state ?? 'COMPLETED_WARRANTY_ACTIVE',
  };
  const technicianRow = { userId: 't1', rating: 4.8, ratingCount: 126, completedJobs: 143 };
  const reviews: Array<Record<string, unknown>> = options?.existingReview ? [options.existingReview] : [];

  const prisma = {
    serviceOrder: { findUnique: jest.fn().mockResolvedValue(order) },
    review: {
      findUnique: jest.fn(async ({ where }: { where: { orderId: string } }) =>
        reviews.find((review) => review['orderId'] === where.orderId) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `review-${reviews.length + 1}`, ...data };
        reviews.push(row);
        return row;
      }),
    },
    technicianProfile: {
      findUnique: jest.fn(async () => ({ ...technicianRow })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data['rating'] === 'number') technicianRow.rating = data['rating'];
        if (data['ratingCount']) technicianRow.ratingCount += 1;
        return { ...technicianRow };
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  } as unknown as PrismaService;

  const service = new ReviewsService(prisma);
  return { service, prisma, technicianRow, getReviews: () => reviews };
}

describe('ReviewsService — dispatch feedback loop', () => {
  it('recalculates the technician rating atomically: ((4.8×126)+5)/127 ≈ 4.80', async () => {
    const { service, technicianRow, prisma } = buildService();

    const review = await service.reviewOrder(customer, 'o1', { rating: 5, commentFa: 'کار عالی بود.' });

    expect(review).toMatchObject({ orderId: 'o1', authorId: 'c1', rating: 5 });
    expect(prisma.technicianProfile.update).toHaveBeenCalledWith({
      where: { userId: 't1' },
      data: { rating: 4.8, ratingCount: { increment: 1 } },
    });
    expect(technicianRow.ratingCount).toBe(127);
  });

  it('rejects a second review for the same order (one review per order)', async () => {
    const { service } = buildService({ existingReview: { id: 'r0', orderId: 'o1', rating: 4 } });
    await expect(service.reviewOrder(customer, 'o1', { rating: 1 })).rejects.toThrow(/فقط یک‌بار/);
  });

  it('rejects reviews before completion', async () => {
    const { service } = buildService({ state: 'IN_PROGRESS' });
    await expect(service.reviewOrder(customer, 'o1', { rating: 5 })).rejects.toThrow(BadRequestException);
  });

  it('rejects a foreign order with 404 (no leak)', async () => {
    const { service } = buildService();
    await expect(
      service.reviewOrder(customer, 'o1', { rating: 5 }),
    ).resolves.toBeDefined();
    const { service: foreignService } = buildService();
    // simulate a foreign order by mocking a different customerId
    (foreignService as unknown as { prisma: { serviceOrder: { findUnique: jest.Mock } } }).prisma.serviceOrder.findUnique.mockResolvedValueOnce({
      id: 'o1',
      customerId: 'someone-else',
      state: 'COMPLETED_WARRANTY_ACTIVE',
      technicianId: 't1',
    });
    await expect(foreignService.reviewOrder(customer, 'o1', { rating: 5 })).rejects.toThrow(
      NotFoundException,
    );
  });
});
