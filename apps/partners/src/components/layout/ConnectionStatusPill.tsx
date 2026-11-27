'use client';

import { useEffect, useState } from 'react';
import { Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useSocketConnectionState } from '@homental/api-client';

/**
 * Subtle header status pill wired to browser online state and the Socket.io
 * `/dispatch` lifecycle so technicians/branches see offline/reconnect/live state.
 */
export function ConnectionStatusPill() {
  const socketState = useSocketConnectionState();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!online) {
    return (
      <span
        role="status"
        className="chip bg-red-50 !px-2.5 !py-1 text-[11px] font-bold text-red-700"
      >
        <WifiOff size={12} />
        آفلاین
      </span>
    );
  }

  if (
    socketState === 'reconnecting' ||
    socketState === 'connecting' ||
    socketState === 'disconnected'
  ) {
    return (
      <span
        role="status"
        className="chip bg-amber-50 !px-2.5 !py-1 text-[11px] font-bold text-amber-800"
      >
        <RefreshCw size={12} className="animate-spin" />
        در حال اتصال مجدد…
      </span>
    );
  }

  if (socketState === 'connected') {
    return (
      <span
        role="status"
        className="chip bg-emerald-50 !px-2.5 !py-1 text-[11px] font-bold text-emerald-700"
      >
        <Radio size={12} className="animate-pulse" />
        زنده
      </span>
    );
  }

  return (
    <span
      role="status"
      className="chip bg-slate-100 !px-2.5 !py-1 text-[11px] font-bold text-slate-600"
    >
      <Wifi size={12} />
      آنلاین
    </span>
  );
}
