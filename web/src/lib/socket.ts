'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3000';

export const DISPATCH_EVENTS = [
  'ORDER_SEARCHING',
  'DISPATCH_OFFER',
  'OFFER_TAKEN',
  'EXPERT_ASSIGNED',
  'EXPERT_LOCATION_UPDATE',
  'FINAL_QUOTE_READY',
  'WARRANTY_ACTIVATED',
] as const;

export type DispatchEventName = (typeof DISPATCH_EVENTS)[number];

export interface DispatchEventPayloads {
  ORDER_SEARCHING: { orderId: string; radiusMeters?: number; offersCreated?: number };
  DISPATCH_OFFER: { offerId: string; orderId: string; orderNumber: string; score: number; expiresInMs: number };
  OFFER_TAKEN: { orderId: string; offerId: string; takenByAnotherExpert: boolean };
  EXPERT_ASSIGNED: { orderId: string; technicianUserId: string };
  EXPERT_LOCATION_UPDATE: { orderId: string; lat: number; lng: number; timestamp: string };
  FINAL_QUOTE_READY: { orderId: string; finalQuoteAmount?: number };
  WARRANTY_ACTIVATED: { orderId: string; warrantyId: string; policyNumber: string };
  notification: { raw: string };
}

export interface ParsedNotification {
  id?: string;
  type?: string;
  titleFa?: string;
  bodyFa?: string;
  data?: Record<string, unknown> | null;
  createdAt?: string;
}

export function parseNotificationPayload(raw: string): ParsedNotification | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as ParsedNotification;
    }
    return null;
  } catch {
    return null;
  }
}

export type DispatchEventHandler<E extends DispatchEventName> = (
  payload: DispatchEventPayloads[E],
) => void;

export type DispatchSocketHandlers = Partial<{
  [E in DispatchEventName]: DispatchEventHandler<E>;
}> & {
  notification?: (payload: { raw: string }) => void;
};

export function createDispatchSocket(token: string | null): Socket {
  return io(`${WS_URL}/dispatch`, {
    auth: { token: token ?? '' },
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });
}

/**
 * Live dispatch socket — connects with the JWT handshake, registers typed
 * event handlers with automatic cleanup on unmount/token change, and exposes
 * `joinOrder` for permission-checked order rooms (`join_order`).
 */
export function useDispatchSocket(
  accessToken: string | null,
  handlers: DispatchSocketHandlers = {},
): { socket: Socket | null; connected: boolean; joinOrder: (orderId: string) => void } {
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef<DispatchSocketHandlers>(handlers);
  handlersRef.current = handlers;
  const joinedOrderIdsRef = useRef<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      setConnected(false);
      return;
    }
    const socket = createDispatchSocket(accessToken);
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      joinedOrderIdsRef.current.forEach((orderId) => {
        socket.emit('join_order', { orderId });
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    for (const event of DISPATCH_EVENTS) {
      socket.on(event, (payload: unknown) => {
        const handler = handlersRef.current[event] as ((p: unknown) => void) | undefined;
        if (handler) handler(payload);
      });
    }
    socket.on('notification', (payload: unknown) => {
      handlersRef.current.notification?.(payload as { raw: string });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [accessToken]);

  const joinOrder = useCallback((orderId: string) => {
    if (!orderId) return;
    joinedOrderIdsRef.current.add(orderId);
    if (socketRef.current?.connected) {
      socketRef.current.emit('join_order', { orderId });
    }
  }, []);

  return { socket: socketRef.current, connected, joinOrder };
}
