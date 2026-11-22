import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, WalletOwnerType, WalletTransaction } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { PLATFORM_WALLET_OWNER_ID } from './wallet-escrow.constants';

type Db = Prisma.TransactionClient;

export interface EscrowSplitResult {
  platformCommission: bigint;
  warrantyReserve: bigint;
  technicianPayout: bigint;
  commissionRate: number;
  reserveRate: number;
}

interface EscrowSplitConfig {
  platformCommissionRate?: number;
  warrantyReserveRate?: number;
}

const DEFAULT_SPLIT: Required<EscrowSplitConfig> = {
  platformCommissionRate: 0.15,
  warrantyReserveRate: 0.05,
};

/**
 * Core wallet & escrow ledger (Invariant 11: reusable by every future
 * vertical — NEVER imports security-services). All amounts are integer
 * BigInt Toman (Invariant 1). Every mutation writes a signed WalletTransaction
 * with a `balanceAfter` snapshot and a unique `idempotencyKey`.
 *
 * Every method accepts an optional `Prisma.TransactionClient` so callers
 * (OrdersService, the Task 6 Handover Gate) can compose financial mutations
 * atomically inside their OWN `$transaction`.
 */
@Injectable()
export class WalletEscrowService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Top-up ────────────────────────────────────────────────────────────────

  async topUp(params: {
    ownerType: WalletOwnerType;
    ownerId: string;
    amount: bigint;
    idempotencyKey: string;
    description?: string;
  }): Promise<WalletTransaction> {
    if (params.amount <= 0n) {
      throw new BadRequestException({ statusCode: 400, message: 'مبلغ شارژ باید بزرگ‌تر از صفر باشد.' });
    }
    const existing = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return existing; // idempotent replay

    return this.prisma.$transaction(async (db) => {
      const wallet = await this.requireWalletByOwner(db, params.ownerType, params.ownerId);
      await db.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: params.amount } },
      });
      return db.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'TOPUP',
          status: 'SETTLED',
          amount: params.amount,
          balanceAfter: wallet.balance + params.amount,
          description: params.description,
          idempotencyKey: params.idempotencyKey,
        },
      });
    });
  }

  // ── Escrow hold / refund / release ────────────────────────────────────────

  async holdEscrow(
    params: { customerUserId: string; orderId: string; amount: bigint; idempotencyKey: string },
    tx?: Prisma.TransactionClient,
  ): Promise<WalletTransaction> {
    const db = tx ?? this.prisma;
    const existing = await db.walletTransaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return existing;

    const wallet = await this.requireWalletByOwner(db, 'CUSTOMER', params.customerUserId);
    // Atomic overdraft guard: the conditional updateMany can never drive the
    // balance below zero, no matter how many concurrent holds race.
    const updated = await db.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: params.amount } },
      data: { balance: { decrement: params.amount }, heldInEscrow: { increment: params.amount } },
    });
    if (updated.count === 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'موجودی کیف پول کافی نیست؛ ابتدا کیف پول خود را شارژ کنید.',
      });
    }
    return db.walletTransaction.create({
      data: {
        walletId: wallet.id,
        orderId: params.orderId,
        type: 'ESCROW_HOLD',
        status: 'SETTLED',
        amount: -params.amount,
        balanceAfter: wallet.balance - params.amount,
        description: 'مسدودسازی مبلغ سفارش در اسکرو',
        idempotencyKey: params.idempotencyKey,
      },
    });
  }

  async refundEscrow(
    params: {
      customerUserId: string;
      orderId: string;
      amount: bigint;
      idempotencyKey: string;
      reason?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<WalletTransaction> {
    const db = tx ?? this.prisma;
    const existing = await db.walletTransaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return existing;

    const wallet = await this.requireWalletByOwner(db, 'CUSTOMER', params.customerUserId);
    const updated = await db.wallet.updateMany({
      where: { id: wallet.id, heldInEscrow: { gte: params.amount } },
      data: { heldInEscrow: { decrement: params.amount }, balance: { increment: params.amount } },
    });
    if (updated.count === 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'مبلغ مسدودشده در اسکرو برای بازگشت کافی نیست.',
      });
    }
    return db.walletTransaction.create({
      data: {
        walletId: wallet.id,
        orderId: params.orderId,
        type: 'REFUND',
        status: 'SETTLED',
        amount: params.amount,
        balanceAfter: wallet.balance + params.amount,
        description: params.reason ?? 'بازگشت مبلغ مسدودشده سفارش',
        idempotencyKey: params.idempotencyKey,
      },
    });
  }

  /**
   * Releases the held escrow and splits it zero-drift:
   *   technicianPayout = total − platformCommission − warrantyReserve.
   * Dual-commission model (Invariant 6): `Branch.commissionRateOverride` /
   * `warrantyReserveOverride` win over `PlatformConfig['escrow.split']`.
   * Idempotency keys are derived (`:release` / `:commission` / `:reserve` /
   * `:payout`) so a replayed release NEVER double-pays anyone.
   */
  async releaseEscrowAndSplit(
    params: {
      orderId: string;
      customerUserId: string;
      technicianUserId: string;
      branchId?: string | null;
      totalAmount: bigint;
      idempotencyKey: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<EscrowSplitResult> {
    const run = (db: Db) => this.releaseInner(db, params);
    return tx ? run(tx) : this.prisma.$transaction(async (db) => run(db));
  }

  private async releaseInner(db: Db, params: {
    orderId: string;
    customerUserId: string;
    technicianUserId: string;
    branchId?: string | null;
    totalAmount: bigint;
    idempotencyKey: string;
  }): Promise<EscrowSplitResult> {
    const releaseKey = `${params.idempotencyKey}:release`;
    const existing = await db.walletTransaction.findUnique({ where: { idempotencyKey: releaseKey } });
    if (existing) {
      // Idempotent replay: rebuild the result from the persisted ledger rows.
      const [commission, reserve, payout] = await Promise.all([
        db.walletTransaction.findUnique({ where: { idempotencyKey: `${params.idempotencyKey}:commission` } }),
        db.walletTransaction.findUnique({ where: { idempotencyKey: `${params.idempotencyKey}:reserve` } }),
        db.walletTransaction.findUnique({ where: { idempotencyKey: `${params.idempotencyKey}:payout` } }),
      ]);
      const commissionRate = Number(
        (commission?.metadata as { commissionRate?: number } | undefined)?.commissionRate ?? 0,
      );
      const reserveRate = Number(
        (reserve?.metadata as { reserveRate?: number } | undefined)?.reserveRate ?? 0,
      );
      return {
        platformCommission: commission?.amount ?? 0n,
        warrantyReserve: reserve?.amount ?? 0n,
        technicianPayout: payout?.amount ?? 0n,
        commissionRate,
        reserveRate,
      };
    }

    const { commissionRate, reserveRate } = await this.resolveSplitRates(db, params.branchId);
    // Part A hardening: a misconfigured branch override must never produce a
    // negative technician payout.
    if (commissionRate + reserveRate > 1) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'مجموع نرخ کمیسیون و ذخیره گارانتی نمی‌تواند از ۱۰۰٪ بیشتر باشد.',
      });
    }
    const platformCommission = BigInt(
      Math.round(Number(params.totalAmount) * commissionRate),
    );
    const warrantyReserve = BigInt(Math.round(Number(params.totalAmount) * reserveRate));
    const technicianPayout = params.totalAmount - platformCommission - warrantyReserve; // zero drift

    // 1) Customer: release the held amount.
    const customerWallet = await this.requireWalletByOwner(db, 'CUSTOMER', params.customerUserId);
    const released = await db.wallet.updateMany({
      where: { id: customerWallet.id, heldInEscrow: { gte: params.totalAmount } },
      data: { heldInEscrow: { decrement: params.totalAmount } },
    });
    if (released.count === 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'مبلغ مسدودشده در اسکرو برای آزادسازی کافی نیست.',
      });
    }
    await db.walletTransaction.create({
      data: {
        walletId: customerWallet.id,
        orderId: params.orderId,
        type: 'ESCROW_RELEASE',
        status: 'SETTLED',
        amount: -params.totalAmount,
        balanceAfter: customerWallet.balance,
        description: 'آزادسازی اسکرو و تسویه سفارش',
        idempotencyKey: releaseKey,
      },
    });

    // 2) Platform: commission + warranty reserve (dedicated 5% ledger).
    // The PLATFORM wallet is provisioned by the seed — a missing wallet here
    // means broken initialization and must fail LOUDLY, not silently heal.
    const platformWallet = await db.wallet.findUnique({
      where: { ownerType_ownerId: { ownerType: 'PLATFORM', ownerId: PLATFORM_WALLET_OWNER_ID } },
    });
    if (!platformWallet) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'کیف پول پلتفرم یافت نشد؛ تنظیمات اولیه سامانه ناقص است.',
      });
    }
    if (platformCommission > 0n) {
      await db.wallet.update({
        where: { id: platformWallet.id },
        data: { balance: { increment: platformCommission } },
      });
      await db.walletTransaction.create({
        data: {
          walletId: platformWallet.id,
          orderId: params.orderId,
          type: 'PLATFORM_COMMISSION',
          status: 'SETTLED',
          amount: platformCommission,
          balanceAfter: platformWallet.balance + platformCommission,
          description: 'کمیسیون پلتفرم از سفارش',
          idempotencyKey: `${params.idempotencyKey}:commission`,
          metadata: { orderId: params.orderId, commissionRate },
        },
      });
    }
    if (warrantyReserve > 0n) {
      await db.wallet.update({
        where: { id: platformWallet.id },
        data: { balance: { increment: warrantyReserve } },
      });
      await db.walletTransaction.create({
        data: {
          walletId: platformWallet.id,
          orderId: params.orderId,
          type: 'WARRANTY_RESERVE',
          status: 'SETTLED',
          amount: warrantyReserve,
          balanceAfter: platformWallet.balance + platformCommission + warrantyReserve,
          description: 'ذخیره گارانتی سفارش (۵٪) تا پایان دوره گارانتی',
          idempotencyKey: `${params.idempotencyKey}:reserve`,
          metadata: { orderId: params.orderId, reserveRate },
        },
      });
    }

    // 3) Technician payout.
    const technicianWallet = await this.requireWalletByOwner(db, 'TECHNICIAN', params.technicianUserId);
    await db.wallet.update({
      where: { id: technicianWallet.id },
      data: { balance: { increment: technicianPayout } },
    });
    await db.walletTransaction.create({
      data: {
        walletId: technicianWallet.id,
        orderId: params.orderId,
        type: 'TECHNICIAN_PAYOUT',
        status: 'SETTLED',
        amount: technicianPayout,
        balanceAfter: technicianWallet.balance + technicianPayout,
        description: 'تسویه دستمزد تکنسین سفارش',
        idempotencyKey: `${params.idempotencyKey}:payout`,
      },
    });

    return { platformCommission, warrantyReserve, technicianPayout, commissionRate, reserveRate };
  }

  private async resolveSplitRates(db: Db, branchId?: string | null) {
    const configRow = await db.platformConfig.findUnique({ where: { key: 'escrow.split' } });
    const config = { ...DEFAULT_SPLIT, ...((configRow?.value as EscrowSplitConfig | undefined) ?? {}) };
    let commissionRate = Number(config.platformCommissionRate);
    let reserveRate = Number(config.warrantyReserveRate);

    if (branchId) {
      const branch = await db.branch.findUnique({ where: { id: branchId } });
      if (branch?.commissionRateOverride !== null && branch?.commissionRateOverride !== undefined) {
        commissionRate = Number(branch.commissionRateOverride);
      }
      if (branch?.warrantyReserveOverride !== null && branch?.warrantyReserveOverride !== undefined) {
        reserveRate = Number(branch.warrantyReserveOverride);
      }
    }
    return { commissionRate, reserveRate };
  }

  // ── Read helpers (wallet/me) ──────────────────────────────────────────────

  async getMyWallet(
    userId: string,
    ownerType: Extract<WalletOwnerType, 'CUSTOMER' | 'TECHNICIAN'>,
    page = 1,
    limit = 20,
  ): Promise<{
    wallet: { id: string; balance: bigint; heldInEscrow: bigint };
    transactions: WalletTransaction[];
    total: number;
    page: number;
    limit: number;
  }> {
    const db = this.prisma;
    const wallet = await db.wallet.findUnique({
      where: { ownerType_ownerId: { ownerType, ownerId: userId } },
    });
    if (!wallet) {
      throw new NotFoundException({ statusCode: 404, message: 'کیف پولی برای شما یافت نشد.' });
    }
    const [transactions, total] = await Promise.all([
      db.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);
    return {
      wallet: { id: wallet.id, balance: wallet.balance, heldInEscrow: wallet.heldInEscrow },
      transactions,
      total,
      page,
      limit,
    };
  }

  // ── Super Admin finance & 5% warranty reserve summary ─────────────────────

  async getFinanceSummary() {
    const [
      platformWallet,
      commissionAgg,
      reserveAgg,
      payoutAgg,
      escrowAgg,
      defaultRates,
      branches,
      totalOrdersByBranch,
      completedOrdersByBranch,
    ] = await Promise.all([
      this.prisma.wallet.findUnique({
        where: { ownerType_ownerId: { ownerType: 'PLATFORM', ownerId: PLATFORM_WALLET_OWNER_ID } },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { type: 'PLATFORM_COMMISSION', status: 'SETTLED' },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { type: 'WARRANTY_RESERVE', status: 'SETTLED' },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { type: 'TECHNICIAN_PAYOUT', status: 'SETTLED' },
        _sum: { amount: true },
      }),
      this.prisma.wallet.aggregate({
        where: { ownerType: 'CUSTOMER' },
        _sum: { heldInEscrow: true },
      }),
      this.resolveSplitRates(this.prisma, null),
      this.prisma.branch.findMany({
        orderBy: { createdAt: 'asc' },
        include: { city: { select: { nameFa: true, slug: true } } },
      }),
      this.prisma.serviceOrder.groupBy({
        by: ['branchId'],
        where: { branchId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.serviceOrder.groupBy({
        by: ['branchId'],
        where: { branchId: { not: null }, state: 'COMPLETED_WARRANTY_ACTIVE' },
        _count: { _all: true },
        _sum: { finalQuoteAmount: true },
      }),
    ]);

    const totalOrderMap = new Map<string, number>();
    for (const row of totalOrdersByBranch) {
      if (row.branchId) totalOrderMap.set(row.branchId, row._count._all);
    }

    const completedOrderMap = new Map<string, number>();
    const completedRevenueMap = new Map<string, bigint>();
    for (const row of completedOrdersByBranch) {
      if (row.branchId) {
        completedOrderMap.set(row.branchId, row._count._all);
        completedRevenueMap.set(row.branchId, row._sum.finalQuoteAmount ?? 0n);
      }
    }

    return {
      platformBalance: platformWallet?.balance ?? 0n,
      totalPlatformCommission: commissionAgg._sum.amount ?? 0n,
      totalWarrantyReserve: reserveAgg._sum.amount ?? 0n,
      totalTechnicianPayout: payoutAgg._sum.amount ?? 0n,
      activeHeldInEscrow: escrowAgg._sum.heldInEscrow ?? 0n,
      defaultCommissionRate: defaultRates.commissionRate,
      defaultWarrantyReserveRate: defaultRates.reserveRate,
      branches: branches.map((b) => ({
        branchId: b.id,
        branchCode: b.code,
        nameFa: b.nameFa,
        cityNameFa: b.city?.nameFa ?? null,
        isActive: b.isActive,
        hasPhysicalShowroom: b.hasPhysicalShowroom,
        commissionRateOverride:
          b.commissionRateOverride !== null ? Number(b.commissionRateOverride) : null,
        warrantyReserveOverride:
          b.warrantyReserveOverride !== null ? Number(b.warrantyReserveOverride) : null,
        effectiveCommissionRate:
          b.commissionRateOverride !== null
            ? Number(b.commissionRateOverride)
            : defaultRates.commissionRate,
        effectiveWarrantyReserveRate:
          b.warrantyReserveOverride !== null
            ? Number(b.warrantyReserveOverride)
            : defaultRates.reserveRate,
        orderCount: totalOrderMap.get(b.id) ?? 0,
        completedOrderCount: completedOrderMap.get(b.id) ?? 0,
        completedRevenue: completedRevenueMap.get(b.id) ?? 0n,
      })),
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async requireWalletByOwner(db: Db, ownerType: WalletOwnerType, ownerId: string) {
    const wallet = await db.wallet.findUnique({
      where: { ownerType_ownerId: { ownerType, ownerId } },
    });
    if (!wallet) {
      throw new NotFoundException({ statusCode: 404, message: 'کیف پول یافت نشد.' });
    }
    return wallet;
  }
}
