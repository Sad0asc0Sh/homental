import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { PrismaService } from '@infra/prisma/prisma.service';

export async function updateManagedFulfillmentStatus(
  prisma: PrismaService, actor: AuthenticatedUser, fulfillmentId: string, target: 'DISPATCHED' | 'DELIVERED',
) {
  if (actor.role !== 'SELLER') throw new ForbiddenException();
  const scope = { id: fulfillmentId, seller: { userId: actor.id }, orderId: { not: null } };
  const shipment = await prisma.supplyFulfillment.findFirst({ where: scope, select: { orderId: true } });
  if (!shipment?.orderId) throw new NotFoundException('مرسوله یافت نشد.');

  return prisma.$transaction(async (db) => {
    // The managed order uses the same row lock for handover and revisions.
    await db.$queryRaw`SELECT "id" FROM "ServiceOrder" WHERE "id" = ${shipment.orderId}::uuid FOR UPDATE`;
    const current = await db.supplyFulfillment.findFirst({ where: scope, select: { status: true } });
    if (!current) throw new NotFoundException('مرسوله یافت نشد.');
    if (current.status === target) return { fulfillmentId, status: target };
    if (current.status !== 'RESERVED' && !(target === 'DELIVERED' && current.status === 'DISPATCHED')) {
      throw new ConflictException('وضعیت مرسوله برای این عملیات مناسب نیست.');
    }
    // B2C stock and escrow post together at the existing managed handover.
    await db.supplyFulfillment.update({ where: { id: fulfillmentId }, data: { status: target } });
    return { fulfillmentId, status: target };
  });
}

export function confirmManagedFulfillment(prisma: PrismaService, actor: AuthenticatedUser, fulfillmentId: string) {
  return updateManagedFulfillmentStatus(prisma, actor, fulfillmentId, 'DELIVERED');
}
