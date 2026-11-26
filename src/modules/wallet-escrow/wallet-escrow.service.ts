import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EscrowPosition, Wallet, WalletOwnerType, WalletTransaction, WalletTransactionType } from '@prisma/client';
import { BPS, rateToBps } from '@common/utils/basis-points.util';
import { PrismaService } from '@infra/prisma/prisma.service';
import { PLATFORM_WALLET_OWNER_ID } from './wallet-escrow.constants';

type Db = Prisma.TransactionClient;
type PersonalWalletOwner = Exclude<WalletOwnerType, 'PLATFORM'>;
type CreditBucket = 'balance' | 'restrictedReserve' | 'restrictedFulfillment';
type PostingOrder = { orderId: string } | { b2bSupplyOrderId: string };

export function toPersonalPosting(posting: WalletTransaction) {
  const { id, orderId, b2bSupplyOrderId, type, status, amount, balanceAfter, description, createdAt } = posting;
  return { id, orderId, b2bSupplyOrderId, type, status, amount, balanceAfter, description, createdAt };
}

export interface ManagedSettlement {
  orderId: string;
  revision: number;
  customerUserId: string;
  technicianUserId: string;
  technicianPayout: bigint;
  platformCommission: bigint;
  warrantyReserve: bigint;
  fulfillmentAllocation: bigint;
  sellers: { userId: string; grossGoods: bigint; appFee: bigint }[];
}

interface PartnerSupplyAmount {
  orderId: string;
  technicianUserId: string;
  amount: bigint;
}

interface PartnerSupplySettlement {
  orderId: string;
  technicianUserId: string;
  freightTotal: bigint;
  sellers: { sellerId: string; userId: string; grossGoods: bigint; appFee: bigint }[];
}

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

export interface SupplierCaseTransfer {
  caseId: string;
  technicianUserId: string;
  sellerUserId: string;
  technicianAmount: bigint;
  orderId?: string | null;
  b2bSupplyOrderId?: string | null;
  type: 'REFUND' | 'ADJUSTMENT';
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
    return this.prisma.$transaction(async (db) => {
      const wallet = await this.requireWalletByOwner(db, params.ownerType, params.ownerId);
      const existing = await db.walletTransaction.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (existing) {
        if (existing.walletId === wallet.id && existing.type === 'TOPUP' && existing.amount === params.amount) {
          return existing;
        }
        throw new ConflictException('شناسه یکتای پرداخت قبلاً استفاده شده است.');
      }
      const updatedWallet = await db.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: params.amount } },
      });
      return db.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'TOPUP',
          status: 'SETTLED',
          amount: params.amount,
          balanceAfter: updatedWallet.balance,
          description: params.description,
          idempotencyKey: params.idempotencyKey,
        },
      });
    });
  }

  // ── Escrow hold / refund / release ────────────────────────────────────────

  /** Post the two signed sides of a resolved supplier case in the caller's transaction. */
  async transferSupplierCaseBalance(params: SupplierCaseTransfer, db: Db): Promise<void> {
    if (params.technicianAmount === 0n) return;
    const [technician, seller] = await Promise.all([
      this.requireWalletByOwner(db, 'TECHNICIAN', params.technicianUserId),
      this.requireWalletByOwner(db, 'SELLER', params.sellerUserId),
    ]);
    await db.$queryRaw`
      SELECT "id" FROM "Wallet"
      WHERE "id" IN (${technician.id}::uuid, ${seller.id}::uuid) ORDER BY "id" FOR UPDATE
    `;

    const key = `case:${params.type === 'REFUND' ? 'refund' : 'exchange'}:${params.caseId}`;
    const postings = await db.walletTransaction.findMany({
      where: { idempotencyKey: { in: [key, `${key}:seller`] } },
    });
    if (postings.length) {
      const priorTechnician = postings.find(({ idempotencyKey }) => idempotencyKey === key);
      const priorSeller = postings.find(({ idempotencyKey }) => idempotencyKey === `${key}:seller`);
      if (priorTechnician?.walletId === technician.id && priorTechnician.amount === params.technicianAmount &&
          priorSeller?.walletId === seller.id && priorSeller.amount === -params.technicianAmount &&
          priorTechnician.type === params.type && priorSeller.type === params.type) return;
      throw new InternalServerErrorException('ثبت مالی درخواست تأمین کالا سازگار نیست.');
    }

    const technicianReceives = params.technicianAmount > 0n;
    const payer = technicianReceives ? seller : technician;
    const receiver = technicianReceives ? technician : seller;
    const amount = technicianReceives ? params.technicianAmount : -params.technicianAmount;
    const [debited] = await db.wallet.updateManyAndReturn({
      where: { id: payer.id, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
      select: { balance: true },
    });
    if (!debited) {
      throw new BadRequestException(technicianReceives
        ? 'موجودی کیف پول فروشنده برای بازگشت وجه کافی نیست.'
        : 'موجودی کیف پول تکنسین برای پرداخت مابه‌التفاوت کافی نیست.');
    }
    const credited = await db.wallet.update({
      where: { id: receiver.id }, data: { balance: { increment: amount } }, select: { balance: true },
    });
    const description = params.type === 'REFUND' ? 'بازگشت وجه کالای استفاده‌نشده' : 'تسویه مابه‌التفاوت تعویض کالا';
    const common = { orderId: params.orderId, b2bSupplyOrderId: params.b2bSupplyOrderId, type: params.type, description,
      metadata: { supplierCaseId: params.caseId } };
    await db.walletTransaction.createMany({ data: [
      { ...common, walletId: technician.id, amount: params.technicianAmount,
        balanceAfter: technicianReceives ? credited.balance : debited.balance, idempotencyKey: key },
      { ...common, walletId: seller.id, amount: -params.technicianAmount,
        balanceAfter: technicianReceives ? debited.balance : credited.balance, idempotencyKey: `${key}:seller` },
    ] });
  }

  async holdEscrow(
    params: { customerUserId: string; orderId: string; amount: bigint; idempotencyKey: string },
    tx?: Prisma.TransactionClient,
  ): Promise<WalletTransaction> {
    if (!tx) return this.prisma.$transaction((db) => this.holdEscrow(params, db));
    if (params.amount <= 0n) throw new BadRequestException('مبلغ امانت باید مثبت باشد.');
    const db = tx;
    const existing = await db.walletTransaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return existing;

    const wallet = await this.requireWalletByOwner(db, 'CUSTOMER', params.customerUserId);
    // Atomic overdraft guard: the conditional updateMany can never drive the
    // balance below zero, no matter how many concurrent holds race.
    const [updated] = await db.wallet.updateManyAndReturn({
      where: { id: wallet.id, balance: { gte: params.amount } },
      data: { balance: { decrement: params.amount }, heldInEscrow: { increment: params.amount } },
      select: { balance: true },
    });
    if (!updated) {
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
        balanceAfter: updated.balance,
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
    if (!tx) return this.prisma.$transaction((db) => this.refundEscrow(params, db));
    if (params.amount <= 0n) throw new BadRequestException('مبلغ بازگشت وجه باید مثبت باشد.');
    const db = tx;
    const existing = await db.walletTransaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return existing;

    const wallet = await this.requireWalletByOwner(db, 'CUSTOMER', params.customerUserId);
    const [updated] = await db.wallet.updateManyAndReturn({
      where: { id: wallet.id, heldInEscrow: { gte: params.amount } },
      data: { heldInEscrow: { decrement: params.amount }, balance: { increment: params.amount } },
      select: { balance: true },
    });
    if (!updated) {
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
        balanceAfter: updated.balance,
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

  async settleManagedOrder(params: ManagedSettlement, tx?: Db): Promise<{ technicianPayout: bigint; warrantyReserve: bigint }> {
    if (!tx) return this.prisma.$transaction((db) => this.settleManagedOrder(params, db));
    const [position] = await tx.$queryRaw<EscrowPosition[]>`
      SELECT * FROM "EscrowPosition" WHERE "orderId" = ${params.orderId}::uuid FOR UPDATE
    `;
    if (!position || position.activeRevision !== params.revision || position.status === 'REFUNDED') {
      throw new ConflictException('امانت معتبر برای این نسخه سفارش وجود ندارد.');
    }

    const { orderId, technicianPayout, platformCommission, warrantyReserve, fulfillmentAllocation } = params;
    const sellers = [...params.sellers].sort((a, b) => a.userId.localeCompare(b.userId));
    const amounts = [technicianPayout, platformCommission, warrantyReserve, fulfillmentAllocation,
      ...sellers.flatMap(({ grossGoods, appFee }) => [grossGoods - appFee, appFee])];
    const creditTotal = amounts.reduce((total, amount) => total + amount, 0n);
    if (amounts.some((amount) => amount < 0n) || creditTotal !== position.heldAmount ||
        new Set(sellers.map(({ userId }) => userId)).size !== sellers.length) {
      throw new InternalServerErrorException('تراز تسویه سفارش نامعتبر است.');
    }
    if (position.status === 'SETTLED') {
      if (position.settledAmount !== creditTotal) throw new InternalServerErrorException('تراز تسویه ثبت‌شده نامعتبر است.');
      return { technicianPayout, warrantyReserve };
    }

    const [payer, technician, platform, sellerCredits] = await Promise.all([
      this.requireWalletByOwner(tx, 'CUSTOMER', params.customerUserId),
      this.requireWalletByOwner(tx, 'TECHNICIAN', params.technicianUserId),
      this.requireWalletByOwner(tx, 'PLATFORM', PLATFORM_WALLET_OWNER_ID),
      Promise.all(sellers.map(async (seller) => ({
        seller,
        wallet: await this.requireWalletByOwner(tx, 'SELLER', seller.userId),
      }))),
    ]);
    if (payer.id !== position.payerWalletId) throw new InternalServerErrorException('مالک امانت معتبر نیست.');
    const walletIds = [payer, technician, platform, ...sellerCredits.map(({ wallet }) => wallet)]
      .map(({ id }) => Prisma.sql`${id}::uuid`);
    await tx.$queryRaw`
      SELECT "id" FROM "Wallet" WHERE "id" IN (${Prisma.join(walletIds)}) ORDER BY "id" FOR UPDATE
    `;

    const [debited] = await tx.wallet.updateManyAndReturn({
      where: { id: payer.id, heldInEscrow: { gte: creditTotal } },
      data: { heldInEscrow: { decrement: creditTotal } },
      select: { balance: true },
    });
    if (!debited) throw new ConflictException('موجودی امانت برای تسویه کافی نیست.');
    const key = `managed:settlement:${orderId}:${params.revision}`;
    await tx.walletTransaction.create({
      data: {
        walletId: payer.id, orderId, amount: -creditTotal, balanceAfter: debited.balance,
        type: 'ESCROW_RELEASE', idempotencyKey: `${key}:release`,
      },
    });

    for (const { seller, wallet } of sellerCredits) {
      await this.credit(tx, { orderId }, wallet.id, 'SELLER_PAYOUT', seller.grossGoods - seller.appFee, 'balance', `${key}:seller:${seller.userId}`);
      if (seller.appFee > 0n) {
        await this.credit(tx, { orderId }, platform.id, 'SELLER_APP_FEE', seller.appFee, 'balance', `${key}:seller-fee:${seller.userId}`);
      }
    }
    await this.credit(tx, { orderId }, technician.id, 'TECHNICIAN_PAYOUT', technicianPayout, 'balance', `${key}:technician`);
    await this.credit(tx, { orderId }, platform.id, 'PLATFORM_COMMISSION', platformCommission, 'balance', `${key}:commission`);
    await this.credit(tx, { orderId }, platform.id, 'WARRANTY_RESERVE', warrantyReserve, 'restrictedReserve', `${key}:reserve`);
    await this.credit(tx, { orderId }, platform.id, 'FULFILLMENT_ALLOCATION', fulfillmentAllocation, 'restrictedFulfillment', `${key}:fulfillment`);
    await tx.escrowPosition.update({
      where: { id: position.id },
      data: { status: 'SETTLED', settledAmount: creditTotal },
    });
    return { technicianPayout, warrantyReserve };
  }

  /** The caller holds the supply order's row lock for refund and settlement. */
  holdPartnerSupply(params: PartnerSupplyAmount, tx: Db): Promise<WalletTransaction> {
    return this.movePartnerSupplyEscrow(tx, params, 'ESCROW_HOLD');
  }

  refundPartnerSupply(params: PartnerSupplyAmount, tx: Db): Promise<WalletTransaction> {
    return this.movePartnerSupplyEscrow(tx, params, 'REFUND');
  }

  private async movePartnerSupplyEscrow(db: Db, params: PartnerSupplyAmount, type: 'ESCROW_HOLD' | 'REFUND') {
    if (params.amount <= 0n) throw new BadRequestException('مبلغ امانت باید مثبت باشد.');
    const isHold = type === 'ESCROW_HOLD';
    const idempotencyKey = `b2b:${isHold ? 'hold' : 'refund'}:${params.orderId}`;
    const wallet = await this.requireWalletByOwner(db, 'TECHNICIAN', params.technicianUserId);
    const existing = await db.walletTransaction.findUnique({ where: { idempotencyKey } });
    const amount = isHold ? -params.amount : params.amount;
    if (existing) {
      if (existing.walletId === wallet.id && existing.b2bSupplyOrderId === params.orderId && existing.type === type && existing.amount === amount) {
        return existing;
      }
      throw new ConflictException('شناسه تراکنش تأمین از قبل استفاده شده است.');
    }

    const [updated] = await db.wallet.updateManyAndReturn({
      where: isHold ? { id: wallet.id, balance: { gte: params.amount } }
        : { id: wallet.id, heldInEscrow: { gte: params.amount } },
      data: isHold ? { balance: { decrement: params.amount }, heldInEscrow: { increment: params.amount } }
        : { balance: { increment: params.amount }, heldInEscrow: { decrement: params.amount } },
      select: { balance: true },
    });
    if (!updated) {
      throw new BadRequestException(isHold ? 'موجودی کیف پول کافی نیست؛ ابتدا کیف پول خود را شارژ کنید.'
        : 'مبلغ امانت سفارش تأمین برای بازگشت وجه کافی نیست.');
    }
    return db.walletTransaction.create({ data: {
      walletId: wallet.id, b2bSupplyOrderId: params.orderId, type, amount, balanceAfter: updated.balance,
      idempotencyKey, description: isHold ? 'مسدودسازی مبلغ سفارش تأمین' : 'بازگشت وجه سفارش تأمین',
    } });
  }

  async settlePartnerSupply(params: PartnerSupplySettlement, db: Db) {
    const { orderId, technicianUserId, freightTotal, sellers } = params;
    const [position] = await db.$queryRaw<EscrowPosition[]>`
      SELECT * FROM "EscrowPosition" WHERE "b2bSupplyOrderId" = ${orderId}::uuid FOR UPDATE
    `;
    if (!position || position.status === 'REFUNDED') throw new ConflictException('امانت سفارش تأمین معتبر نیست.');
    const creditTotal = sellers.reduce((sum, seller) => sum + seller.grossGoods, freightTotal);
    if (!sellers.length || freightTotal < 0n || creditTotal !== position.heldAmount ||
        new Set(sellers.map(({ sellerId }) => sellerId)).size !== sellers.length ||
        sellers.some(({ grossGoods, appFee }) => appFee < 0n || grossGoods < appFee)) {
      throw new InternalServerErrorException('تراز تسویه سفارش تأمین نامعتبر است.');
    }
    if (position.status === 'SETTLED') {
      if (position.settledAmount !== creditTotal) throw new InternalServerErrorException('تراز تسویه ثبت‌شده نامعتبر است.');
      return;
    }

    const [payer, platform, sellerWallets] = await Promise.all([
      this.requireWalletByOwner(db, 'TECHNICIAN', technicianUserId),
      this.requireWalletByOwner(db, 'PLATFORM', PLATFORM_WALLET_OWNER_ID),
      Promise.all(sellers.map(async (seller) => ({ seller, wallet: await this.requireWalletByOwner(db, 'SELLER', seller.userId) }))),
    ]);
    if (payer.id !== position.payerWalletId) throw new InternalServerErrorException('مالک امانت معتبر نیست.');
    const walletIds = [payer, platform, ...sellerWallets.map(({ wallet }) => wallet)].map(({ id }) => Prisma.sql`${id}::uuid`);
    await db.$queryRaw`SELECT "id" FROM "Wallet" WHERE "id" IN (${Prisma.join(walletIds)}) ORDER BY "id" FOR UPDATE`;
    const [debited] = await db.wallet.updateManyAndReturn({
      where: { id: payer.id, heldInEscrow: { gte: creditTotal } },
      data: { heldInEscrow: { decrement: creditTotal } }, select: { balance: true },
    });
    if (!debited) throw new ConflictException('موجودی امانت برای تسویه سفارش تأمین کافی نیست.');
    const reference = { b2bSupplyOrderId: orderId };
    await db.walletTransaction.create({ data: {
      walletId: payer.id, ...reference, type: 'ESCROW_RELEASE', amount: -creditTotal, balanceAfter: debited.balance,
      idempotencyKey: `b2b:release:${orderId}`,
    } });
    for (const { seller, wallet } of sellerWallets) {
      await this.credit(db, reference, wallet.id, 'SELLER_PAYOUT', seller.grossGoods - seller.appFee, 'balance', `b2b:payout:${orderId}:${seller.sellerId}`);
      if (seller.appFee > 0n) {
        await this.credit(db, reference, platform.id, 'SELLER_APP_FEE', seller.appFee, 'balance', `b2b:fee:${orderId}:${seller.sellerId}`);
      }
    }
    if (freightTotal > 0n) {
      await this.credit(db, reference, platform.id, 'FULFILLMENT_ALLOCATION', freightTotal, 'restrictedFulfillment', `b2b:freight:${orderId}`);
    }
    await db.escrowPosition.update({ where: { id: position.id }, data: { status: 'SETTLED', settledAmount: creditTotal } });
  }

  private async credit(
    db: Db,
    reference: PostingOrder,
    walletId: string,
    type: WalletTransactionType,
    amount: bigint,
    bucket: CreditBucket,
    idempotencyKey: string,
  ) {
    const wallet: Wallet = await db.wallet.update({
      where: { id: walletId },
      data: { [bucket]: { increment: amount } },
    });
    await db.walletTransaction.create({
      data: { walletId, ...reference, type, amount, balanceAfter: wallet[bucket], idempotencyKey, metadata: { bucket } },
    });
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
    const platformCommission = (params.totalAmount * rateToBps(commissionRate) + BPS / 2n) / BPS;
    const warrantyReserve = (params.totalAmount * rateToBps(reserveRate) + BPS / 2n) / BPS;
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
        data: { restrictedReserve: { increment: warrantyReserve } },
      });
      await db.walletTransaction.create({
        data: {
          walletId: platformWallet.id,
          orderId: params.orderId,
          type: 'WARRANTY_RESERVE',
          status: 'SETTLED',
          amount: warrantyReserve,
          balanceAfter: platformWallet.restrictedReserve + warrantyReserve,
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
    ownerType: PersonalWalletOwner,
    page = 1,
    limit = 20,
  ): Promise<{
    wallet: { id: string; balance: bigint; heldInEscrow: bigint };
    transactions: ReturnType<typeof toPersonalPosting>[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!['CUSTOMER', 'TECHNICIAN', 'SELLER', 'BRANCH'].includes(ownerType)) throw new ForbiddenException();
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
      transactions: transactions.map(toPersonalPosting),
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
      sellerPayoutAgg,
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
      this.prisma.walletTransaction.aggregate({
        where: { type: 'SELLER_PAYOUT', status: 'SETTLED' },
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
      restrictedReserve: platformWallet?.restrictedReserve ?? 0n,
      restrictedFulfillment: platformWallet?.restrictedFulfillment ?? 0n,
      sellerPayoutsTotal: sellerPayoutAgg._sum.amount ?? 0n,
      technicianPayoutsTotal: payoutAgg._sum.amount ?? 0n,
      totalPlatformCommission: commissionAgg._sum.amount ?? 0n,
      totalWarrantyReserve: reserveAgg._sum.amount ?? 0n,
      totalTechnicianPayout: payoutAgg._sum.amount ?? 0n,
      activeHeldInEscrow: escrowAgg._sum.heldInEscrow ?? 0n,
      defaultCommissionRate: defaultRates.commissionRate,
      defaultWarrantyReserveRate: 0.05,
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
        effectiveWarrantyReserveRate: 0.05,
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
