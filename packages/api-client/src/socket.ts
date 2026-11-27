'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { DispatchOfferView, MeteredAdjustment, TechnicianMeteredAdjustment } from './api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3000';

export type SocketConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

let currentSocketState: SocketConnectionState = 'idle';
const socketStateListeners = new Set<(state: SocketConnectionState) => void>();

function publishSocketState(nextState: SocketConnectionState): void {
  if (currentSocketState === nextState) return;
  currentSocketState = nextState;
  socketStateListeners.forEach((listener) => listener(nextState));
}

export function getSocketConnectionState(): SocketConnectionState {
  return currentSocketState;
}

export function subscribeSocketState(
  listener: (state: SocketConnectionState) => void,
): () => void {
  socketStateListeners.add(listener);
  return () => {
    socketStateListeners.delete(listener);
  };
}

/** Subscribes to the shared dispatch socket lifecycle in an SSR-safe manner. */
export function useSocketConnectionState(): SocketConnectionState {
  const [state, setState] = useState<SocketConnectionState>('idle');

  useEffect(() => {
    setState(getSocketConnectionState());
    return subscribeSocketState(setState);
  }, []);

  return state;
}

export const DISPATCH_EVENTS = [
  'ORDER_SEARCHING',
  'DISPATCH_OFFER',
  'OFFER_TAKEN',
  'EXPERT_ASSIGNED',
  'EXPERT_LOCATION_UPDATE',
  'FINAL_QUOTE_READY',
  'WARRANTY_ACTIVATED',
  'METERED_ADJUSTMENT_CHANGED',
] as const;

export type DispatchEventName = (typeof DISPATCH_EVENTS)[number];

export interface DispatchEventPayloads {
  ORDER_SEARCHING: { orderId: string; radiusMeters?: number; offersCreated?: number };
  DISPATCH_OFFER: DispatchOfferView;
  OFFER_TAKEN: { orderId: string; offerId: string; takenByAnotherExpert: boolean };
  EXPERT_ASSIGNED: { orderId: string; technicianUserId: string };
  EXPERT_LOCATION_UPDATE: { orderId: string; lat: number; lng: number; timestamp: string };
  FINAL_QUOTE_READY: { orderId: string; finalQuoteAmount?: number };
  WARRANTY_ACTIVATED: { orderId: string; warrantyId: string; policyNumber: string };
  METERED_ADJUSTMENT_CHANGED: { orderId: string; adjustment: MeteredAdjustment | TechnicianMeteredAdjustment };
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
  onReconnect?: () => void;
};

export function createDispatchSocket(token: string | null): Socket {
  return io(`${WS_URL}/dispatch`, {
    auth: { token: token ?? '' },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });
}

/**
 * Live dispatch socket — connects with the JWT handshake, registers typed
 * event handlers with automatic cleanup on unmount/token change, auto-recovers
 * on network/app-foreground transitions, and exposes `joinOrder` for
 * permission-checked order rooms (`join_order`).
 */
export function useDispatchSocket(
  accessToken: string | null,
  handlers: DispatchSocketHandlers = {},
): {
  socket: Socket | null;
  connected: boolean;
  connectionState: SocketConnectionState;
  joinOrder: (orderId: string) => void;
} {
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef<DispatchSocketHandlers>(handlers);
  handlersRef.current = handlers;
  const joinedOrderIdsRef = useRef<Set<string>>(new Set());
  const hasConnectedOnceRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<SocketConnectionState>('idle');

  useEffect(() => {
    if (!accessToken) {
      hasConnectedOnceRef.current = false;
      setConnected(false);
      setConnectionState('idle');
      publishSocketState('idle');
      return;
    }

    hasConnectedOnceRef.current = false;
    setConnectionState('connecting');
    publishSocketState('connecting');

    const socket = createDispatchSocket(accessToken);
    socketRef.current = socket;

    const updateState = (next: SocketConnectionState, isConnected: boolean) => {
      setConnected(isConnected);
      setConnectionState(next);
      publishSocketState(next);
    };

    socket.on('connect', () => {
      const isReconnect = hasConnectedOnceRef.current;
      hasConnectedOnceRef.current = true;
      updateState('connected', true);
      joinedOrderIdsRef.current.forEach((orderId) => {
        socket.emit('join_order', { orderId });
      });
      if (isReconnect) {
        handlersRef.current.onReconnect?.();
      }
    });

    socket.on('disconnect', () => {
      updateState(socket.active ? 'reconnecting' : 'disconnected', false);
    });

    socket.on('connect_error', () => {
      updateState(socket.active ? 'reconnecting' : 'disconnected', false);
    });

    const onReconnectAttempt = () => {
      updateState('reconnecting', false);
    };
    const onReconnectFailed = () => {
      updateState('disconnected', false);
    };

    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect_error', onReconnectAttempt);
    socket.io.on('reconnect_failed', onReconnectFailed);

    for (const event of DISPATCH_EVENTS) {
      socket.on(event, (payload: unknown) => {
        const handler = handlersRef.current[event] as ((p: unknown) => void) | undefined;
        if (handler) handler(payload);
      });
    }
    socket.on('notification', (payload: unknown) => {
      handlersRef.current.notification?.(payload as { raw: string });
    });

    const reconnectIfNeeded = () => {
      if (socketRef.current && !socketRef.current.connected) {
        updateState('reconnecting', false);
        socketRef.current.connect();
      }
    };
    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        reconnectIfNeeded();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', reconnectIfNeeded);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', reconnectIfNeeded);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect_error', onReconnectAttempt);
      socket.io.off('reconnect_failed', onReconnectFailed);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      hasConnectedOnceRef.current = false;
      setConnected(false);
      setConnectionState('idle');
      publishSocketState('idle');
    };
  }, [accessToken]);

  const joinOrder = useCallback((orderId: string) => {
    if (!orderId) return;
    joinedOrderIdsRef.current.add(orderId);
    if (socketRef.current?.connected) {
      socketRef.current.emit('join_order', { orderId });
    }
  }, []);

  return { socket: socketRef.current, connected, connectionState, joinOrder };
}
