import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Live event names emitted over the WS `/dispatch` namespace. */
export const RealtimeEvent = {
  ORDER_SEARCHING: 'ORDER_SEARCHING',
  DISPATCH_OFFER: 'DISPATCH_OFFER',
  OFFER_TAKEN: 'OFFER_TAKEN',
  EXPERT_ASSIGNED: 'EXPERT_ASSIGNED',
  EXPERT_LOCATION_UPDATE: 'EXPERT_LOCATION_UPDATE',
  FINAL_QUOTE_READY: 'FINAL_QUOTE_READY',
  WARRANTY_ACTIVATED: 'WARRANTY_ACTIVATED',
  METERED_ADJUSTMENT_CHANGED: 'METERED_ADJUSTMENT_CHANGED',
  NOTIFICATION: 'notification',
} as const;

export type RealtimeEventName = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

const USER_ROOM_PREFIX = 'user:';
const ORDER_ROOM_PREFIX = 'order:';

/**
 * Typed emit helpers for the realtime gateway. Multi-instance horizontal
 * scaling stays ready: cross-instance fan-out flows over Redis Pub/Sub
 * (`notifications:user:*` bridge in RealtimeModule) while direct emits hit
 * the local socket server.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | undefined;

  registerServer(server: Server): void {
    this.server = server;
  }

  emitToUser(userId: string, event: RealtimeEventName, payload: Record<string, unknown>): void {
    if (!this.server) {
      this.logger.warn(`Realtime emit skipped (${event}) — gateway not initialised yet`);
      return;
    }
    this.server.to(`${USER_ROOM_PREFIX}${userId}`).emit(event, payload);
  }

  emitToOrder(orderId: string, event: RealtimeEventName, payload: Record<string, unknown>): void {
    if (!this.server) {
      this.logger.warn(`Realtime emit skipped (${event}) — gateway not initialised yet`);
      return;
    }
    this.server.to(`${ORDER_ROOM_PREFIX}${orderId}`).emit(event, payload);
  }
}
