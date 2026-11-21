import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redis, { Command, type RedisOptions } from 'ioredis';
import type { AppConfigService } from '@config/app-config.service';

export interface NearbyTechnician {
  techId: string;
  distanceMeters: number;
  longitude: number;
  latitude: number;
}

export interface OrderLockAcquisition {
  acquired: boolean;
  /** Caller MUST persist this token; releasing requires the same token. */
  token: string | null;
  key: string;
}

export interface RedisPingResult {
  latencyMs: number;
}

export const GEO_TECH_KEY_PREFIX = 'homental:geo:technicians';
export const ORDER_LOCK_KEY_PREFIX = 'dispatch:order:lock';

/**
 * Compare-and-delete: release only succeeds for the holder's own token.
 * This is the Lua counterpart of `SET key token NX PX ttl`.
 */
const RELEASE_LOCK_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';

/** BigInt-safe JSON replacer — BigInt (Toman amounts) becomes a string (Invariant 13). */
export function bigIntSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Defensive parser for GEOSEARCH … WITHDIST WITHCOORD replies. */
export function parseGeoSearchResponse(raw: unknown): NearbyTechnician[] {
  if (!Array.isArray(raw)) return [];
  const results: NearbyTechnician[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [member, distance, coords] = row as unknown[];
    if (typeof member !== 'string' || typeof distance !== 'string' || !Array.isArray(coords)) {
      continue;
    }
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    const distanceMeters = Number(distance);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(distanceMeters)) {
      continue;
    }
    results.push({ techId: member, distanceMeters, longitude: lng, latitude: lat });
  }
  return results;
}

/**
 * Redis infrastructure — separate command & subscriber clients.
 *
 * `enableOfflineQueue: false` + `maxRetriesPerRequest: 1` make commands fail
 * fast when Redis is unreachable, which keeps /health truthful instead of
 * hanging. Dispatch lock helpers implement the per-order protocol of
 * Invariant 5: `SET dispatch:order:lock:{orderId} token NX PX ttlMs`.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly command: Redis;
  readonly subscriber: Redis;
  private readonly channelListeners = new Map<string, (message: string) => void>();

  constructor(private readonly config: AppConfigService) {
    const options: RedisOptions = {
      maxRetriesPerRequest: 1,
      connectTimeout: 5_000,
      enableOfflineQueue: false,
      retryStrategy: (times: number) => Math.min(times * 200, 2_000),
    };
    this.command = new Redis(this.config.redisUrl, options);
    this.subscriber = new Redis(this.config.redisUrl, options);
    // 'error' MUST be handled or a down Redis crashes the process.
    this.command.on('error', (error: Error) =>
      this.logger.error(`Redis command client error: ${error.message}`),
    );
    this.subscriber.on('error', (error: Error) =>
      this.logger.error(`Redis subscriber client error: ${error.message}`),
    );
  }

  // ── GEO (dispatch technician index, city-scoped) ──────────────────────────

  private geoKey(citySlug: string): string {
    return `${GEO_TECH_KEY_PREFIX}:${citySlug}`;
  }

  async addTechLocation(citySlug: string, techId: string, lat: number, lng: number): Promise<void> {
    await this.command.geoadd(this.geoKey(citySlug), lng, lat, techId);
  }

  async removeTechLocation(citySlug: string, techId: string): Promise<void> {
    await this.command.zrem(this.geoKey(citySlug), techId);
  }

  async countOnlineTechs(citySlug: string): Promise<number> {
    return this.command.zcard(this.geoKey(citySlug));
  }

  async findNearbyTechs(
    citySlug: string,
    lat: number,
    lng: number,
    radiusMeters: number,
    limit: number,
  ): Promise<NearbyTechnician[]> {
    const raw = await this.command.sendCommand(
      new Command(
        'GEOSEARCH',
        [
      this.geoKey(citySlug),
      'FROMLONLAT',
      lng,
      lat,
      'BYRADIUS',
      radiusMeters,
      'm',
      'ASC',
      'COUNT',
      limit,
      'WITHDIST',
          'WITHCOORD',
        ],
        { replyEncoding: 'utf8' },
      ),
    );
    return parseGeoSearchResponse(raw);
  }

  // ── Atomic per-order locks (Invariant 5) ──────────────────────────────────

  orderLockKey(orderId: string): string {
    return `${ORDER_LOCK_KEY_PREFIX}:${orderId}`;
  }

  async acquireOrderLock(orderId: string, ttlMs: number): Promise<OrderLockAcquisition> {
    const key = this.orderLockKey(orderId);
    const token = randomUUID();
    const result = await this.command.set(key, token, 'PX', ttlMs, 'NX');
    if (result === 'OK') return { acquired: true, token, key };
    return { acquired: false, token: null, key };
  }

  async releaseOrderLock(orderId: string, token: string): Promise<boolean> {
    const result = await this.command.eval(RELEASE_LOCK_SCRIPT, 1, this.orderLockKey(orderId), token);
    return Number(result) === 1;
  }

  // ── Pub/Sub (BigInt-safe) ─────────────────────────────────────────────────

  async publish<T>(channel: string, payload: T): Promise<void> {
    await this.command.publish(channel, JSON.stringify(payload, bigIntSafeReplacer));
  }

  async subscribe<T>(channel: string, handler: (payload: T) => void | Promise<void>): Promise<void> {
    const listener = (message: string): void => {
      let payload: T;
      try {
        payload = JSON.parse(message) as T;
      } catch (error: unknown) {
        this.logger.warn(
          `Dropping malformed pub/sub message on "${channel}": ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      void Promise.resolve(handler(payload)).catch((error: unknown) =>
        this.logger.error(
          `Pub/sub handler for "${channel}" failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    };
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', listener);
    this.channelListeners.set(channel, listener);
  }

  async unsubscribe(channel: string): Promise<void> {
    const listener = this.channelListeners.get(channel);
    if (listener) {
      this.subscriber.off('message', listener);
      this.channelListeners.delete(channel);
    }
    await this.subscriber.unsubscribe(channel);
  }

  // ── Health & lifecycle ────────────────────────────────────────────────────

  async ping(): Promise<RedisPingResult> {
    const startedAt = Date.now();
    const reply = await this.command.ping();
    if (reply !== 'PONG') {
      throw new Error(`Unexpected Redis PING reply: ${String(reply)}`);
    }
    return { latencyMs: Date.now() - startedAt };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.command.quit(), this.subscriber.quit()]);
  }
}
