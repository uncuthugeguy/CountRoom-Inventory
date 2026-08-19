/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import path from 'node:path'
import os from 'node:os'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // node_modules lives inside the Google-Drive-synced project folder, whose
  // FUSE mount refuses to unlink files mid-sync (same root cause as the
  // schema.sql hardlink issue) -- Vite's default node_modules/.vite cache
  // dir sits right in that sync path, so cache invalidation intermittently
  // throws EPERM on unlink and the dev server won't start. Pointing the
  // cache outside the synced tree avoids that entirely.
  cacheDir: path.join(os.tmpdir(), 'stockflow-pwa-vite-cache'),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'StockFlow Inventory',
        short_name: 'StockFlow',
        description: 'Barcode-driven inventory management for Mac and iPhone.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
