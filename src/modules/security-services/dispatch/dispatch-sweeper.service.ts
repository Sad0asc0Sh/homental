import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OrderState } from '@prisma/client';
import { AppConfigService } from '@config/app-config.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { DispatchService } from './dispatch.service';

const SWEEPER_INTERVAL_MS = 15_000;

/**
 * Marks PENDING offers past their TTL as EXPIRED, then re-waves (or
 * BRANCH_QUEUE-falls-back) every SEARCHING_EXPERT order with zero remaining
 * live offers. An expired TOP wave reopens its initial radius to all tiers.
 */
@Injectable()
export class DispatchSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatchSweeperService.name);
  private intervalRef: ReturnType<typeof setInterval> | undefined;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: DispatchService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    // Tests drive expireStaleOffers() explicitly — no live timer there.
    if (this.config.nodeEnv === 'test') return;
    this.intervalRef = setInterval(() => {
      // Part A: a transient DB/Redis hiccup must never crash the process
      // with an unhandled promise rejection (Node 20+ default behavior).
      if (this.sweeping) return;
      this.sweeping = true;
      void this.expireStaleOffers().catch((error: unknown) => {
        this.logger.error(
          `Sweeper run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }).finally(() => { this.sweeping = false; });
    }, SWEEPER_INTERVAL_MS);
    this.intervalRef.unref?.();
  }

  onModuleDestroy(): void {
    if (this.intervalRef) clearInterval(this.intervalRef);
  }

  async expireStaleOffers(): Promise<{ expired: number; reWavedOrders: number }> {
    const now = new Date();
    const expired = await this.prisma.dispatchOffer.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', respondedAt: now },
    });
    const searching = await this.prisma.serviceOrder.findMany({
      where: { state: OrderState.SEARCHING_EXPERT, dispatchOffers: { none: { status: 'PENDING' } } },
      orderBy: { updatedAt: 'asc' }, take: 100, select: { id: true },
    });
    for (const order of searching) {
      await this.dispatchService.onOrderSearching({ orderId: order.id });
    }
    return { expired: expired.count, reWavedOrders: searching.length };
  }
}
