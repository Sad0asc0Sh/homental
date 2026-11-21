import { BadRequestException } from '@nestjs/common';
import { PLATFORM_WALLET_OWNER_ID } from './wallet-escrow.constants';
import { WalletEscrowService } from './wallet-escrow.service';

const PLATFORM_ID = PLATFORM_WALLET_OWNER_ID;

interface WalletRow {
  id: string;
  ownerType: string;
  ownerId: string;
  balance: bigint;
  heldInEscrow: bigint;
}

function buildService(splitConfig?: { platformCommissionRate: number; warrantyReserveRate: number }) {
  const customerWallet: WalletRow = {
    id: 'w-customer',
    ownerType: 'CUSTOMER',
    ownerId: 'c1',
    balance: 10_000_000n,
    heldInEscrow: 0n,
  };
  const technicianWallet: WalletRow = {
    id: 'w-tech',
    ownerType: 'TECHNICIAN',
    ownerId: 't1',
    balance: 0n,
    heldInEscrow: 0n,
  };
  const platformWallet: WalletRow = {
    id: 'w-platform',
    ownerType: 'PLATFORM',
    ownerId: PLATFORM_ID,
    balance: 0n,
    heldInEscrow: 0n,
  };
  const all = [customerWallet, technicianWallet, platformWallet];
  const createdTxes: Array<Record<string, unknown>> = [];

  const wallet = {
    // Return COPIES (like Prisma rows) so balanceAfter math stays pre-mutation.
    findUnique: jest.fn(async ({ where }: { where: { ownerType_ownerId: { ownerType: string; ownerId: string } } }) => {
      const found = all.find(
        (w) => w.ownerType === where.ownerType_ownerId.ownerType && w.ownerId === where.ownerType_ownerId.ownerId,
      );
      return found ? { ...found } : null;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: { balance?: { increment?: bigint; decrement?: bigint } } }) => {
      const row = all.find((w) => w.id === where.id) as WalletRow;
      if (data.balance?.increment) row.balance += data.balance.increment;
      if (data.balance?.decrement) row.balance -= data.balance.decrement;
      return { ...row };
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; balance?: { gte?: bigint }; heldInEscrow?: { gte?: bigint } };
        data: {
          balance?: { increment?: bigint; decrement?: bigint };
          heldInEscrow?: { increment?: bigint; decrement?: bigint };
        };
      }) => {
        const row = all.find((w) => w.id === where.id) as WalletRow;
        if (where.balance?.gte !== undefined && row.balance < where.balance.gte) return { count: 0 };
        if (where.heldInEscrow?.gte !== undefined && row.heldInEscrow < where.heldInEscrow.gte) {
          return { count: 0 };
        }
        if (data.balance?.increment) row.balance += data.balance.increment;
        if (data.balance?.decrement) row.balance -= data.balance.decrement;
        if (data.heldInEscrow?.increment) row.heldInEscrow += data.heldInEscrow.increment;
        if (data.heldInEscrow?.decrement) row.heldInEscrow -= data.heldInEscrow.decrement;
        return { count: 1 };
      },
    ),
    upsert: jest.fn(async () => ({ ...platformWallet })),
  };

  const walletTransaction = {
    findUnique: jest.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
      createdTxes.find((tx) => tx['idempotencyKey'] === where.idempotencyKey) ?? null,
    ),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `tx-${createdTxes.length + 1}`, ...data };
      createdTxes.push(row);
      return row;
    }),
  };

  const platformConfig = {
    findUnique: jest.fn().mockResolvedValue(
      splitConfig ? { value: splitConfig } : null, // null → safe defaults 15%/5%
    ),
  };
  const branch = { findUnique: jest.fn().mockResolvedValue(null) };

  const prismaLike: Record<string, unknown> = { wallet, walletTransaction, platformConfig, branch };
  // Interactive transactions receive the SAME delegate mocks, so per-test
  // overrides (e.g. branch rate overrides) apply inside $transaction too.
  prismaLike['$transaction'] = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prismaLike));
  const prisma = prismaLike as unknown as import('@infra/prisma/prisma.service').PrismaService;

  const service = new WalletEscrowService(prisma);
  return { service, prisma, customerWallet, technicianWallet, platformWallet, createdTxes, wallet, walletTransaction };
}

async function seedHold(service: WalletEscrowService, amount = 1_000_000n) {
  await service.holdEscrow({ customerUserId: 'c1', orderId: 'o1', amount, idempotencyKey: 'hold-seed' });
}

describe('WalletEscrowService — holdEscrow (atomic overdraft guard)', () => {
  it('rejects a hold larger than the balance with Persian 400 and mutates NOTHING', async () => {
    const { service, customerWallet } = buildService();
    await expect(
      service.holdEscrow({ customerUserId: 'c1', orderId: 'o1', amount: 20_000_000n, idempotencyKey: 'k1' }),
    ).rejects.toThrow(/موجودی کیف پول کافی نیست/);
    expect(customerWallet.balance).toBe(10_000_000n);
    expect(customerWallet.heldInEscrow).toBe(0n);
  });

  it('holds escrow atomically: balance decreases, escrow increases, signed tx written', async () => {
    const { service, customerWallet, createdTxes } = buildService();
    await service.holdEscrow({ customerUserId: 'c1', orderId: 'o1', amount: 3_000_000n, idempotencyKey: 'k2' });
    expect(customerWallet.balance).toBe(7_000_000n);
    expect(customerWallet.heldInEscrow).toBe(3_000_000n);
    expect(createdTxes[0]).toMatchObject({
      type: 'ESCROW_HOLD',
      orderId: 'o1',
      amount: -3_000_000n,
      balanceAfter: 7_000_000n,
      idempotencyKey: 'k2',
    });
  });

  it('is idempotent on idempotencyKey (replay returns the existing tx)', async () => {
    const { service, customerWallet } = buildService();
    const first = await service.holdEscrow({ customerUserId: 'c1', orderId: 'o1', amount: 1_000_000n, idempotencyKey: 'same-key' });
    const replay = await service.holdEscrow({ customerUserId: 'c1', orderId: 'o1', amount: 1_000_000n, idempotencyKey: 'same-key' });
    expect(replay).toBe(first);
    expect(customerWallet.heldInEscrow).toBe(1_000_000n); // held exactly once
  });
});

describe('WalletEscrowService — refundEscrow', () => {
  it('refunds held escrow back to balance with a REFUND tx', async () => {
    const { service, customerWallet } = buildService();
    await seedHold(service, 3_000_000n);
    await service.refundEscrow({ customerUserId: 'c1', orderId: 'o1', amount: 3_000_000n, idempotencyKey: 'r1', reason: 'لغو سفارش' });
    expect(customerWallet.balance).toBe(10_000_000n);
    expect(customerWallet.heldInEscrow).toBe(0n);
  });

  it('rejects refunding more than what is held', async () => {
    const { service } = buildService();
    await expect(
      service.refundEscrow({ customerUserId: 'c1', orderId: 'o1', amount: 5_000_000n, idempotencyKey: 'r2' }),
    ).rejects.toThrow(/اسکرو/);
  });

  it('is idempotent on idempotencyKey', async () => {
    const { service, customerWallet } = buildService();
    await seedHold(service, 2_000_000n);
    await service.refundEscrow({ customerUserId: 'c1', orderId: 'o1', amount: 2_000_000n, idempotencyKey: 'same' });
    await service.refundEscrow({ customerUserId: 'c1', orderId: 'o1', amount: 2_000_000n, idempotencyKey: 'same' });
    expect(customerWallet.balance).toBe(10_000_000n);
    expect(customerWallet.heldInEscrow).toBe(0n);
  });
});

describe('WalletEscrowService — releaseEscrowAndSplit (zero-drift BigInt split)', () => {
  it('splits 1,000,000 with default 15%/5% → 150k commission + 50k reserve + 850k payout', async () => {
    const { service, platformWallet, technicianWallet, customerWallet, createdTxes } = buildService();
    await seedHold(service);
    const result = await service.releaseEscrowAndSplit({
      orderId: 'o1',
      customerUserId: 'c1',
      technicianUserId: 't1',
      totalAmount: 1_000_000n,
      idempotencyKey: 'esc:release:o1',
    });

    expect(result.commissionRate).toBe(0.15);
    expect(result.reserveRate).toBe(0.05);
    expect(result.platformCommission).toBe(150_000n);
    expect(result.warrantyReserve).toBe(50_000n);
    expect(result.technicianPayout).toBe(800_000n); // 1,000,000 − 150,000 − 50,000
    // Zero-drift invariant
    expect(result.platformCommission + result.warrantyReserve + result.technicianPayout).toBe(1_000_000n);

    expect(platformWallet.balance).toBe(200_000n); // commission + reserve ledger
    expect(technicianWallet.balance).toBe(800_000n);
    expect(customerWallet.heldInEscrow).toBe(0n);

    const keys = createdTxes.map((tx) => tx['idempotencyKey']);
    expect(keys).toEqual([
      'hold-seed',
      'esc:release:o1:release',
      'esc:release:o1:commission',
      'esc:release:o1:reserve',
      'esc:release:o1:payout',
    ]);
    const commissionTx = createdTxes.find((tx) => tx['idempotencyKey'] === 'esc:release:o1:commission');
    expect(commissionTx).toMatchObject({ type: 'PLATFORM_COMMISSION', amount: 150_000n });
    expect(commissionTx?.['metadata']).toMatchObject({ orderId: 'o1', commissionRate: 0.15 });
    const reserveTx = createdTxes.find((tx) => tx['idempotencyKey'] === 'esc:release:o1:reserve');
    expect(reserveTx).toMatchObject({ type: 'WARRANTY_RESERVE', amount: 50_000n });
    expect(reserveTx?.['metadata']).toMatchObject({ orderId: 'o1', reserveRate: 0.05 });
  });

  it('honours Branch.commissionRateOverride 10% (dual-commission showroom partner)', async () => {
    const { service, prisma } = buildService();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({
      id: 'b1',
      commissionRateOverride: 0.1, // showroom partner
      warrantyReserveOverride: null, // falls back to 5% default
    });
    await seedHold(service);
    const result = await service.releaseEscrowAndSplit({
      orderId: 'o1',
      customerUserId: 'c1',
      technicianUserId: 't1',
      branchId: 'b1',
      totalAmount: 1_000_000n,
      idempotencyKey: 'esc:release:branch',
    });
    expect(result.commissionRate).toBe(0.1);
    expect(result.reserveRate).toBe(0.05);
    expect(result.platformCommission).toBe(100_000n);
    expect(result.warrantyReserve).toBe(50_000n);
    expect(result.technicianPayout).toBe(850_000n);
    expect(result.platformCommission + result.warrantyReserve + result.technicianPayout).toBe(1_000_000n);
  });

  it('is idempotent: replaying the release NEVER double-pays', async () => {
    const { service, platformWallet, technicianWallet } = buildService();
    await seedHold(service);
    const params = {
      orderId: 'o1',
      customerUserId: 'c1',
      technicianUserId: 't1',
      totalAmount: 1_000_000n,
      idempotencyKey: 'esc:release:idem',
    };
    const first = await service.releaseEscrowAndSplit(params);
    const replay = await service.releaseEscrowAndSplit(params);

    expect(replay).toEqual(first);
    expect(platformWallet.balance).toBe(200_000n); // credited exactly once
    expect(technicianWallet.balance).toBe(800_000n);
  });
});

describe('WalletEscrowService — topUp', () => {
  it('credits the wallet and records a TOPUP tx', async () => {
    const { service, customerWallet } = buildService();
    await service.topUp({
      ownerType: 'CUSTOMER',
      ownerId: 'c1',
      amount: 2_000_000n,
      idempotencyKey: 'topup-1',
    });
    expect(customerWallet.balance).toBe(12_000_000n);
  });

  it('is idempotent and rejects non-positive amounts', async () => {
    const { service, customerWallet } = buildService();
    await service.topUp({ ownerType: 'CUSTOMER', ownerId: 'c1', amount: 1_000_000n, idempotencyKey: 't-same' });
    await service.topUp({ ownerType: 'CUSTOMER', ownerId: 'c1', amount: 1_000_000n, idempotencyKey: 't-same' });
    expect(customerWallet.balance).toBe(11_000_000n);
    await expect(
      service.topUp({ ownerType: 'CUSTOMER', ownerId: 'c1', amount: 0n, idempotencyKey: 't-zero' }),
    ).rejects.toThrow(BadRequestException);
  });
});
