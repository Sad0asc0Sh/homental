import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { map, type Observable } from 'rxjs';

/**
 * Recursively serializes response payloads so JSON.stringify can never crash
 * (Invariant 13): BigInt (Toman amounts) -> string, Prisma Decimal -> number,
 * Date -> ISO string. Plain objects & arrays are walked; other class instances
 * pass through untouched.
 */
export function serializeBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Decimal) return value.toNumber();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => serializeBigInts(item));
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = serializeBigInts(item);
    }
    return result;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

@Injectable()
export class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(serializeBigInts));
  }
}
