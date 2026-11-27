import {
  getCapacitorPlugins,
  getPlatform,
  getPlatformInfo,
  isNativeApp,
  type AppPlatform,
  type PlatformInfo,
} from './platform';

export interface CameraCaptureOptions {
  facingMode?: 'user' | 'environment';
  accept?: string;
}

export interface CameraPhotoResult {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface CameraCapability {
  readonly supported: boolean;
  capturePhoto(options?: CameraCaptureOptions): Promise<CameraPhotoResult | null>;
}

export interface GeolocationOptions {
  enableHighAccuracy?: boolean;
  timeoutMs?: number;
}

export interface GeolocationCoordinatesResult {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
}

export interface GeolocationCapability {
  readonly supported: boolean;
  getCurrentPosition(options?: GeolocationOptions): Promise<GeolocationCoordinatesResult>;
}

export interface BackgroundGeolocationResult {
  supported: boolean;
  reason?: string;
}

export interface BackgroundGeolocationCapability {
  readonly supported: boolean;
  startTracking(): Promise<BackgroundGeolocationResult>;
  stopTracking(): Promise<void>;
}

export type PushPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export interface PushCapability {
  readonly supported: boolean;
  getPermissionState(): Promise<PushPermissionState>;
  requestPermission(): Promise<PushPermissionState>;
}

export interface DispatchAlertCapability {
  readonly supported: boolean;
  triggerDispatchAlert(): Promise<void>;
}

export interface SpaceScanCaptureResult {
  supported: boolean;
  reason?: string;
  roomCount?: number;
  dimensionsSummary?: Record<string, unknown>;
}

export interface SpaceScannerCapability {
  readonly supported: boolean;
  startScan(): Promise<SpaceScanCaptureResult>;
}

export interface BackButtonCapability {
  register(handler: () => void): () => void;
}

export interface DeviceBridge {
  getPlatform(): AppPlatform;
  isNativeApp(): boolean;
  getPlatformInfo(): PlatformInfo;
  camera: CameraCapability;
  geolocation: GeolocationCapability;
  backgroundGeolocation: BackgroundGeolocationCapability;
  push: PushCapability;
  dispatchAlert: DispatchAlertCapability;
  spaceScanner: SpaceScannerCapability;
  backButton: BackButtonCapability;
}

const camera: CameraCapability = {
  get supported(): boolean {
    if (isNativeApp() && typeof getCapacitorPlugins()?.Camera?.getPhoto === 'function') {
      return true;
    }
    return typeof document !== 'undefined';
  },
  async capturePhoto(options?: CameraCaptureOptions): Promise<CameraPhotoResult | null> {
    const nativeCamera = isNativeApp() ? getCapacitorPlugins()?.Camera : undefined;
    if (nativeCamera && typeof nativeCamera.getPhoto === 'function') {
      const result = await nativeCamera.getPhoto({
        quality: 85,
        resultType: 'dataUrl',
        direction: options?.facingMode === 'user' ? 'FRONT' : 'REAR',
      });
      const dataUrl = typeof result['dataUrl'] === 'string' ? result['dataUrl'] : null;
      if (!dataUrl) return null;
      const format = typeof result['format'] === 'string' ? result['format'] : 'jpeg';
      return {
        fileName: `capture.${format}`,
        mimeType: `image/${format}`,
        dataUrl,
      };
    }

    if (typeof document === 'undefined' || typeof FileReader === 'undefined') {
      return null;
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = options?.accept ?? 'image/*';
      if (options?.facingMode) {
        input.setAttribute('capture', options.facingMode);
      }
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          resolve(
            typeof reader.result === 'string'
              ? { fileName: file.name, mimeType: file.type, dataUrl: reader.result }
              : null,
          );
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },
};

const geolocation: GeolocationCapability = {
  get supported(): boolean {
    if (isNativeApp() && typeof getCapacitorPlugins()?.Geolocation?.getCurrentPosition === 'function') {
      return true;
    }
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  },
  async getCurrentPosition(options?: GeolocationOptions): Promise<GeolocationCoordinatesResult> {
    const nativeGeo = isNativeApp() ? getCapacitorPlugins()?.Geolocation : undefined;
    if (nativeGeo && typeof nativeGeo.getCurrentPosition === 'function') {
      const pos = await nativeGeo.getCurrentPosition({
        enableHighAccuracy: options?.enableHighAccuracy ?? true,
        timeout: options?.timeoutMs ?? 8_000,
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyMeters:
          typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : null,
      };
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('Geolocation is not supported in this environment.');
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          resolve({
            lat: coords.latitude,
            lng: coords.longitude,
            accuracyMeters: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
          });
        },
        (error) => reject(new Error(error.message || 'Unable to acquire current position.')),
        {
          enableHighAccuracy: options?.enableHighAccuracy ?? true,
          timeout: options?.timeoutMs ?? 8_000,
        },
      );
    });
  },
};

const backgroundGeolocation: BackgroundGeolocationCapability = {
  get supported(): boolean {
    return isNativeApp() && typeof getCapacitorPlugins()?.BackgroundGeolocation?.addWatcher === 'function';
  },
  async startTracking(): Promise<BackgroundGeolocationResult> {
    if (!this.supported) {
      return {
        supported: false,
        reason: 'Background GPS tracking requires the native Capacitor plugin.',
      };
    }
    return { supported: true };
  },
  async stopTracking(): Promise<void> {
    // Native watcher teardown attaches here once the native plugin is installed.
  },
};

function mapNativePushState(raw: string | undefined): PushPermissionState {
  if (raw === 'granted') return 'granted';
  if (raw === 'denied') return 'denied';
  return 'default';
}

const push: PushCapability = {
  get supported(): boolean {
    if (isNativeApp() && getCapacitorPlugins()?.PushNotifications) {
      return true;
    }
    return typeof window !== 'undefined' && 'Notification' in window;
  },
  async getPermissionState(): Promise<PushPermissionState> {
    const nativePush = isNativeApp() ? getCapacitorPlugins()?.PushNotifications : undefined;
    if (nativePush && typeof nativePush.checkPermissions === 'function') {
      const status = await nativePush.checkPermissions();
      return mapNativePushState(status.receive);
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return window.Notification.permission;
  },
  async requestPermission(): Promise<PushPermissionState> {
    const nativePush = isNativeApp() ? getCapacitorPlugins()?.PushNotifications : undefined;
    if (nativePush && typeof nativePush.requestPermissions === 'function') {
      const status = await nativePush.requestPermissions();
      return mapNativePushState(status.receive);
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return window.Notification.requestPermission();
  },
};

const dispatchAlert: DispatchAlertCapability = {
  get supported(): boolean {
    return (
      isNativeApp() ||
      (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
    );
  },
  async triggerDispatchAlert(): Promise<void> {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([160, 80, 160]);
    }
  },
};

const spaceScanner: SpaceScannerCapability = {
  get supported(): boolean {
    return (
      isNativeApp() &&
      typeof getCapacitorPlugins()?.HomentalSpaceScanner?.startScan === 'function'
    );
  },
  async startScan(): Promise<SpaceScanCaptureResult> {
    const nativeScanner = isNativeApp() ? getCapacitorPlugins()?.HomentalSpaceScanner : undefined;
    if (nativeScanner && typeof nativeScanner.startScan === 'function') {
      const raw = await nativeScanner.startScan();
      return {
        supported: true,
        roomCount: typeof raw['roomCount'] === 'number' ? raw['roomCount'] : undefined,
        dimensionsSummary:
          raw['dimensionsSummary'] && typeof raw['dimensionsSummary'] === 'object'
            ? (raw['dimensionsSummary'] as Record<string, unknown>)
            : undefined,
      };
    }
    return {
      supported: false,
      reason: '3D room and home scanning requires a native Capacitor AR plugin.',
    };
  },
};

const backButton: BackButtonCapability = {
  register(handler: () => void): () => void {
    const appPlugin = isNativeApp() ? getCapacitorPlugins()?.App : undefined;
    if (!appPlugin || typeof appPlugin.addListener !== 'function') {
      return () => undefined;
    }

    let disposed = false;
    let removeListener: (() => Promise<void> | void) | undefined;

    const handleOrPromise = appPlugin.addListener('backButton', () => {
      if (!disposed) handler();
    });

    if (handleOrPromise && typeof (handleOrPromise as Promise<unknown>).then === 'function') {
      void (handleOrPromise as Promise<{ remove?: () => Promise<void> | void }>).then((handle) => {
        if (disposed) {
          void handle?.remove?.();
        } else {
          removeListener = handle?.remove;
        }
      });
    } else if (handleOrPromise && typeof (handleOrPromise as { remove?: unknown }).remove === 'function') {
      removeListener = (handleOrPromise as { remove?: () => Promise<void> | void }).remove;
    }

    return () => {
      disposed = true;
      void removeListener?.();
    };
  },
};

export function createDeviceBridge(): DeviceBridge {
  return {
    getPlatform,
    isNativeApp,
    getPlatformInfo,
    camera,
    geolocation,
    backgroundGeolocation,
    push,
    dispatchAlert,
    spaceScanner,
    backButton,
  };
}

export const deviceBridge: DeviceBridge = createDeviceBridge();
