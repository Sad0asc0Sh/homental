import { type ExecutionContext } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { firstValueFrom, of } from 'rxjs';
import { BigIntSerializerInterceptor, serializeBigInts } from './bigint-serializer.interceptor';

describe('serializeBigInts', () => {
  it('converts BigInt values to strings', () => {
    expect(serializeBigInts(50_000_000n)).toBe('50000000');
  });

  it('converts Prisma Decimal values to numbers', () => {
    expect(serializeBigInts(new Decimal('12.55'))).toBe(12.55);
  });

  it('serializes nested BigInt and Decimal inside objects and arrays', () => {
    const input = {
      order: { id: 'o1', amount: 123456789012345678n, rate: new Decimal('0.15') },
      items: [{ price: new Decimal('3.75'), qty: 2 }, null],
      createdAt: new Date('2026-11-21T10:00:00.000Z'),
    };
    const output = serializeBigInts(input) as Record<string, unknown>;
    const order = output['order'] as Record<string, unknown>;
    const items = output['items'] as Array<Record<string, unknown> | null>;

    expect(order['amount']).toBe('123456789012345678');
    expect(order['rate']).toBe(0.15);
    expect(items[0]?.['price']).toBe(3.75);
    expect(items[0]?.['qty']).toBe(2);
    expect(items[1]).toBeNull();
    expect(output['createdAt']).toBe('2026-11-21T10:00:00.000Z');
    // The whole point: JSON.stringify must not crash on the result.
    expect(() => JSON.stringify(output)).not.toThrow();
  });

  it('leaves primitives and null untouched', () => {
    expect(serializeBigInts(null)).toBeNull();
    expect(serializeBigInts('hello')).toBe('hello');
    expect(serializeBigInts(42)).toBe(42);
    expect(serializeBigInts(true)).toBe(true);
  });
});

describe('BigIntSerializerInterceptor', () => {
  it('serializes the response of the wrapped handler', async () => {
    const interceptor = new BigIntSerializerInterceptor();
    const context = {} as ExecutionContext;
    const handler = {
      handle: () =>
        of({
          wallet: { balance: 50_000_000n, escrow: [1_000n, 2_000n] },
          score: new Decimal('4.86'),
        }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, handler));
    expect(result).toEqual({
      wallet: { balance: '50000000', escrow: ['1000', '2000'] },
      score: 4.86,
    });
  });
});
