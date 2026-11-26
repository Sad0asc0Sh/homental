import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigService } from '@config/app-config.service';
import { RedisService } from '@infra/redis/redis.service';

// Use a disposable Redis instance via PHASE11B_TEST_REDIS_URL.
const redisUrl = process.env['PHASE11B_TEST_REDIS_URL'];
const redisSuite = redisUrl ? describe : describe.skip;

redisSuite('Phase 11B — live Redis dispatch lock', () => {
  let module: TestingModule;
  let redis: RedisService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [RedisService, { provide: AppConfigService, useValue: { redisUrl } }],
    }).compile();
    redis = module.get(RedisService);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await redis.ping();
        return;
      } catch (error) {
        if (attempt === 19) throw error;
        await delay(50);
      }
    }
  });

  afterAll(async () => { await module?.close(); });

  it('allows one contender and uses token-checked release on the per-order key', async () => {
    const orderId = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => redis.acquireOrderLock(orderId, 5000)));
    const winners = results.filter(({ acquired }) => acquired);
    expect(winners).toHaveLength(1);
    expect(results.every(({ key }) => key === `dispatch:order:lock:${orderId}`)).toBe(true);
    const winner = winners[0];
    if (!winner?.token) throw new Error('Expected a Redis lock owner token');

    await expect(redis.releaseOrderLock(orderId, randomUUID())).resolves.toBe(false);
    await expect(redis.acquireOrderLock(orderId, 5000)).resolves.toMatchObject({ acquired: false, token: null });
    await expect(redis.releaseOrderLock(orderId, winner.token)).resolves.toBe(true);
    const replacement = await redis.acquireOrderLock(orderId, 5000);
    if (!replacement.token) throw new Error('Expected a replacement lock owner token');
    await expect(redis.releaseOrderLock(orderId, winner.token)).resolves.toBe(false);
    await expect(redis.releaseOrderLock(orderId, replacement.token)).resolves.toBe(true);
  });

  it('starts a pattern subscription on a cold connection and closes with an active subscription', async () => {
    const subscriberModule = await Test.createTestingModule({
      providers: [RedisService, { provide: AppConfigService, useValue: { redisUrl } }],
    }).compile();
    const subscriber = subscriberModule.get(RedisService);
    const prefix = `homental:test:${randomUUID()}`;
    const channel = `${prefix}:started`;
    const receiver = jest.fn();
    try {
      await subscriber.subscribePattern(`${prefix}:*`, receiver);
      await redis.publish(channel, { ready: true });
      for (let attempt = 0; attempt < 20 && receiver.mock.calls.length === 0; attempt += 1) await delay(50);
      expect(receiver).toHaveBeenCalledWith(channel, '{"ready":true}');
    } finally {
      await subscriberModule.close();
    }
  });
});
