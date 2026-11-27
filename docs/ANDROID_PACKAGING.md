# Homental Android Packaging Guide (Capacitor Live Web URL Shell)

Homental ships two independent Android applications backed by the same live Next.js PWAs so UI updates deployed to the web reflect immediately inside the Android apps without rebuilding APKs:

| App | Package ID | Display Name | Default Live URL (`CAPACITOR_SERVER_URL`) | Local Emulator URL |
|---|---|---|---|---|
| Customer | `ir.homental.customer` | هومنتال | `https://homental.ir` | `http://10.0.2.2:3001` |
| Partners & Staff | `ir.homental.partners` | هومنتال همکاران | `https://partners.homental.ir` | `http://10.0.2.2:3002` |

## Prerequisites (Android Packaging Workstation Only)

Web CI, Docker builds, `npm run build`, and `npm run lint` do **not** require Android Studio or the Android SDK. When building native Android packages on a release workstation, install:

1. **JDK 17+** (bundled with Android Studio)
2. **Android Studio + Android SDK** (API 34+ / Build-Tools)
3. **Capacitor CLI & Android platform** (installed on-demand or in the wrapper workspace without polluting Next.js Docker builds)

## 1. Initialize & Sync Android Projects

Run inside either `apps/customer` or `apps/partners`:

```bash
# Example: customer app
cd apps/customer

# 1) Install Capacitor runtime packages in the native build environment
npm install --no-save @capacitor/core @capacitor/cli @capacitor/android \
  @capacitor/app @capacitor/status-bar @capacitor/splash-screen @capacitor/keyboard

# 2) Generate the native android/ project once
npx cap add android

# 3) Sync webDir (public/icons, sw.js) and capacitor.config.ts into android/
CAPACITOR_SERVER_URL=https://homental.ir npm run cap:sync
```

For `apps/partners`, repeat with `CAPACITOR_SERVER_URL=https://partners.homental.ir`:

```bash
cd apps/partners
CAPACITOR_SERVER_URL=https://partners.homental.ir npm run cap:sync
```

> **Security:** `allowMixedContent` is hardcoded to `false` in `capacitor.config.ts`, and `cleartext` is enabled **only** when `CAPACITOR_SERVER_URL` begins with `http://` (local emulator dev). Always use `https://` URLs for store builds.

## 2. Local Android Emulator Testing

1. Start the monorepo API + web frontends (`npm run dev:api`, `npm run dev:customer`, `npm run dev:partners`).
2. Ensure `CORS_ORIGINS` in root `.env` allows the origin loaded in the WebView (when using `http://10.0.2.2:3001` and `http://10.0.2.2:3002`, add them to `CORS_ORIGINS`).
3. Sync with the Android emulator loopback address and open Android Studio:

```bash
cd apps/customer
CAPACITOR_SERVER_URL=http://10.0.2.2:3001 CAPACITOR_DEBUG=true npm run cap:sync
npm run cap:open
```

## 3. Generate Signed `.aab` / `.apk` (Google Play, Cafe Bazaar, Myket)

1. Generate an upload keystore (keep outside git):

```bash
keytool -genkey -v -keystore homental-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias homental
```

2. Configure signing credentials via Gradle properties (`~/.gradle/gradle.properties` or CI secrets), then build from `android/`:

```bash
cd android
# Signed App Bundle (.aab) for Google Play / Cafe Bazaar
./gradlew bundleRelease

# Signed APK (.apk) for Myket / direct partner distribution
./gradlew assembleRelease
```

Artifacts appear under:
- `android/app/build/outputs/bundle/release/app-release.aab`
- `android/app/build/outputs/apk/release/app-release.apk`

## 4. Store Release Checklist (Cafe Bazaar / Myket / Google Play)

- Verify distinct icons (`public/icons/icon-512.png` and `icon-maskable-512.png`) and `applicationId` (`ir.homental.customer` vs `ir.homental.partners`).
- Confirm `versionCode` (increment per release) and `versionName` in `android/app/build.gradle`.
- Verify `CAPACITOR_DEBUG` is unset/`false` (`webContentsDebuggingEnabled: false`) and `CAPACITOR_SERVER_URL` uses `https://`.
- Test hardware back button navigation (`@homental/device-bridge` `backButton`) and offline fallback (`/offline`).

## 5. Wiring Future Native Plugins via `@homental/device-bridge`

`@homental/device-bridge` (`packages/device-bridge`) already inspects `window.Capacitor.Plugins` safely with SSR guards (`typeof window === 'undefined'`). When adding native features later:

- **Background GPS (`technician`)**: install a Capacitor background-geolocation plugin; `deviceBridge.backgroundGeolocation` exposes `startTracking()` / `stopTracking()`.
- **Dispatch Audio Alert (`technician`)**: install local-notifications or custom sound plugin; wire into `deviceBridge.dispatchAlert.triggerDispatchAlert()`.
- **3D Room/Home Scanner (`customer`)**: register native ARCore plugin under `Capacitor.Plugins.HomentalSpaceScanner` implementing `startScan()` (`deviceBridge.spaceScanner`).
