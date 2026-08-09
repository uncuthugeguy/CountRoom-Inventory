import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Wraps the existing Vite build (dist/) as a native iOS/Android shell.
 * webDir must point at the production build output — run `npm run build`
 * before `npx cap sync` so there's something current to copy in.
 *
 * appId follows Apple/Google's reverse-domain convention and must match
 * whatever bundle ID you register in App Store Connect / Play Console.
 * Change it before your first `cap add` if "com.masonsfinds.stockflow"
 * isn't the identifier you want — it's baked into the generated native
 * projects and is painful to rename after the fact.
 */
const config: CapacitorConfig = {
  appId: 'com.masonsfinds.stockflow',
  appName: 'StockFlow',
  webDir: 'dist',
  server: {
    // Local network calls (Supabase) still go straight over HTTPS from the
    // webview — this only affects how the app itself is served, not API
    // calls, so no androidScheme/iosScheme override is needed for that.
    androidScheme: 'https',
  },
}

export default config
