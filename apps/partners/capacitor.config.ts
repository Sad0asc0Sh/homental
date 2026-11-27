interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: {
    url?: string;
    cleartext?: boolean;
    androidScheme?: 'http' | 'https';
    errorPath?: string;
  };
  android?: {
    allowMixedContent?: boolean;
    backgroundColor?: string;
    captureInput?: boolean;
    webContentsDebuggingEnabled?: boolean;
  };
  plugins?: Record<string, Record<string, unknown>>;
}

const serverUrl = process.env['CAPACITOR_SERVER_URL'] || 'https://partners.homental.ir';
const isHttpDevServer = serverUrl.startsWith('http://');

const config: CapacitorConfig = {
  appId: 'ir.homental.partners',
  appName: 'هومنتال همکاران',
  webDir: 'public',
  server: {
    url: serverUrl,
    cleartext: isHttpDevServer,
    androidScheme: 'https',
    errorPath: '/offline',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#064e3b',
    captureInput: true,
    webContentsDebuggingEnabled: process.env['CAPACITOR_DEBUG'] === 'true',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#064e3b',
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#064e3b',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
