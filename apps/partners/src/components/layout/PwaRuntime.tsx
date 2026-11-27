'use client';

import { useEffect } from 'react';
import { deviceBridge } from '@homental/device-bridge';

/**
 * Registers the safe Service Worker in production (or when NEXT_PUBLIC_ENABLE_SW=true),
 * tags the document with the detected Capacitor/Web platform, and wires the Android
 * hardware back button inside Capacitor shells.
 */
export function PwaRuntime() {
  useEffect(() => {
    document.documentElement.dataset.platform = deviceBridge.getPlatform();

    const unregisterBack = deviceBridge.backButton.register(() => {
      if (window.history.length > 1) {
        window.history.back();
      }
    });

    if (
      'serviceWorker' in navigator &&
      (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENABLE_SW === 'true')
    ) {
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(() => undefined);
    }

    return () => {
      unregisterBack();
    };
  }, []);

  return null;
}
