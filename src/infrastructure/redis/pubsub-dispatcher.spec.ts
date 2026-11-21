import { bigIntSafeReplacer, PubSubDispatcher } from './redis.service';

describe('PubSubDispatcher (Part A hotfix #3 — per-channel routing)', () => {
  it('routes each message strictly to the handlers of its channel', () => {
    const dispatcher = new PubSubDispatcher();
    const receivedOnCh1: string[] = [];
    const receivedOnCh2: string[] = [];

    dispatcher.register('ch1', (message) => receivedOnCh1.push(message));
    dispatcher.register('ch2', (message) => receivedOnCh2.push(message));

    dispatcher.dispatch('ch1', '{"n":1}');
    dispatcher.dispatch('ch2', '{"n":2}');
    dispatcher.dispatch('ch-unknown', '{"n":3}'); // must not crash nor leak

    expect(receivedOnCh1).toEqual(['{"n":1}']);
    expect(receivedOnCh2).toEqual(['{"n":2}']);
  });

  it('delivers one channel message to ALL of its registered handlers', () => {
    const dispatcher = new PubSubDispatcher();
    const calls: string[] = [];
    dispatcher.register('orders', (m) => calls.push(`a:${m}`));
    dispatcher.register('orders', (m) => calls.push(`b:${m}`));
    expect(dispatcher.handlerCount('orders')).toBe(2);

    dispatcher.dispatch('orders', 'x');
    expect(calls).toEqual(['a:x', 'b:x']);
  });

  it('stops routing after unregisterChannel and reports removed handlers', () => {
    const dispatcher = new PubSubDispatcher();
    const received: string[] = [];
    dispatcher.register('ch', (m) => received.push(m));

    expect(dispatcher.unregisterChannel('ch')).toBe(1);
    dispatcher.dispatch('ch', 'late');
    expect(received).toEqual([]);
    expect(dispatcher.unregisterChannel('ch')).toBe(0);
  });
});

describe('bigIntSafeReplacer (Invariant 13 — BigInt-safe pub/sub payloads)', () => {
  it('serializes BigInt values to strings, including nested arrays', () => {
    const json = JSON.stringify(
      { amount: 50_000_000n, escrow: [1_000n, 2_000n], name: 'escrow' },
      bigIntSafeReplacer,
    );
    expect(json).toBe('{"amount":"50000000","escrow":["1000","2000"],"name":"escrow"}');
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('round-trips a wallet payload across a simulated pub/sub boundary', () => {
    const published = JSON.stringify({ orderId: 'o1', commission: 15n }, bigIntSafeReplacer);
    const received = JSON.parse(published) as { orderId: string; commission: string };
    expect(received).toEqual({ orderId: 'o1', commission: '15' });
  });
});
