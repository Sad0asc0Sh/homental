import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OrderState } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { DispatchService } from './dispatch.service';

const SWEEPER_INTERVAL_MS = 15_000;

/**
 * Marks PENDING offers past their TTL as EXPIRED, then re-waves (or
 * BRANCH_QUEUE-falls-back) every SEARCHING_EXPERT order with zero remaining
 * live offers. Runs on a self-managed interval (no extra scheduler dep).
 */
@Injectable()
export class DispatchSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatchSweeperService.name);
  private intervalRef: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: DispatchService,
  ) {}

  onModuleInit(): void {
    // Tests drive expireStaleOffers() explicitly — no live timer there.
    if (process.env['NODE_ENV'] === 'test') return;
    this.intervalRef = setInterval(() => {
      // Part A: a transient DB/Redis hiccup must never crash the process
      // with an unhandled promise rejection (Node 20+ default behavior).
      this.expireStaleOffers().catch((error: unknown) => {
        this.logger.error(
          `Sweeper run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, SWEEPER_INTERVAL_MS);
    this.intervalRef.unref?.();
  }

  onModuleDestroy(): void {
    if (this.intervalRef) clearInterval(this.intervalRef);
  }

  async expireStaleOffers(): Promise<{ expired: number; reWavedOrders: number }> {
    const stale = await this.prisma.dispatchOffer.findMany({
      where: { status: 'PENDING', expiresAt: { lte: new Date() } },
      select: { id: true, orderId: true },
    });
    if (stale.length === 0) return { expired: 0, reWavedOrders: 0 };

    await this.prisma.dispatchOffer.updateMany({
      where: { id: { in: stale.map((offer) => offer.id) } },
      data: { status: 'EXPIRED' },
    });

    const orderIds = [...new Set(stale.map((offer) => offer.orderId))];
    let reWavedOrders = 0;
    for (const orderId of orderIds) {
      const order = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } });
      if (!order || order.state !== OrderState.SEARCHING_EXPERT) continue;
      const pending = await this.prisma.dispatchOffer.count({
        where: { orderId, status: 'PENDING' },
      });
      if (pending === 0) {
        await this.dispatchService.startSearch(orderId);
        reWavedOrders += 1;
      }
    }
    this.logger.log(`Sweeper: expired ${stale.length} offers, re-waved ${reWavedOrders} orders`);
    return { expired: stale.length, reWavedOrders };
  }
}
