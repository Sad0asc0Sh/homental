export type AppPlatform = 'web' | 'android-capacitor' | 'ios-capacitor';

export interface PlatformInfo {
  platform: AppPlatform;
  isNative: boolean;
  isAndroid: boolean;
  isIos: boolean;
  isWeb: boolean;
}

export interface CapacitorPluginRegistry {
  Camera?: {
    getPhoto?: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  Geolocation?: {
    getCurrentPosition?: (options?: Record<string, unknown>) => Promise<{
      coords: { latitude: number; longitude: number; accuracy?: number };
    }>;
  };
  BackgroundGeolocation?: {
    addWatcher?: (options: Record<string, unknown>) => Promise<string>;
    removeWatcher?: (options: { id: string }) => Promise<void>;
  };
  PushNotifications?: {
    checkPermissions?: () => Promise<{ receive?: string }>;
    requestPermissions?: () => Promise<{ receive?: string }>;
  };
  App?: {
    addListener?: (
      eventName: 'backButton',
      handler: (event: { canGoBack?: boolean }) => void,
    ) =>
      | Promise<{ remove?: () => Promise<void> | void }>
      | { remove?: () => Promise<void> | void };
  };
  HomentalSpaceScanner?: {
    startScan?: () => Promise<Record<string, unknown>>;
  };
  [pluginName: string]: Record<string, unknown> | undefined;
}

interface CapacitorRuntime {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: CapacitorPluginRegistry;
}

function getCapacitorRuntime(): CapacitorRuntime | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Capacitor?: CapacitorRuntime }).Capacitor;
}

export function getCapacitorPlugins(): CapacitorPluginRegistry | undefined {
  return getCapacitorRuntime()?.Plugins;
}

export function getPlatform(): AppPlatform {
  const capacitor = getCapacitorRuntime();
  if (!capacitor) return 'web';
  const raw = capacitor.getPlatform?.().toLowerCase();
  if (raw === 'android') return 'android-capacitor';
  if (raw === 'ios') return 'ios-capacitor';
  if (capacitor.isNativePlatform?.()) return 'android-capacitor';
  return 'web';
}

export function isNativeApp(): boolean {
  const capacitor = getCapacitorRuntime();
  if (!capacitor) return false;
  if (typeof capacitor.isNativePlatform === 'function') {
    return Boolean(capacitor.isNativePlatform());
  }
  return getPlatform() !== 'web';
}

export function getPlatformInfo(): PlatformInfo {
  const platform = getPlatform();
  const isNative = isNativeApp();
  return {
    platform,
    isNative,
    isAndroid: platform === 'android-capacitor',
    isIos: platform === 'ios-capacitor',
    isWeb: !isNative,
  };
}
