// Supabase: Frankfurt (frxjddevnehprauoapiv) — migrated 2026-04-19
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// Master plan R-50: surface VAPID configuration drift early. We warn (not
// fail) during build so a Vercel preview without the env still builds —
// but the warning is loud enough to catch in CI/PR review. The runtime
// guard in src/lib/pwa/webPush.ts is the second line of defence.
if (process.env.NODE_ENV === 'production' && !process.env.VITE_VAPID_PUBLIC_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n⚠️  VITE_VAPID_PUBLIC_KEY is empty — Web Push subscriptions will be disabled in this build.\n' +
    '   Set it in Vercel project env vars (Production + Preview) before relying on push.\n'
  )
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Master plan R-54: was 'autoUpdate' (silent install). Switched to
      // 'prompt' so PwaUpdateToast can show users the "רענן" prompt instead
      // of leaving them with stale chunks until they manually reload.
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icons/*.png', 'push-sw.js'],
      manifest: {
        name: 'ישיבת שבי חברון',
        short_name: 'נוכחות',
        description: 'מערכת נוכחות לישיבת שבי חברון',
        theme_color: '#3B82F6',
        background_color: '#EAF4FF',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        dir: 'rtl',
        lang: 'he',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Load our push + badge handler as a classic script inside the generated SW
        importScripts: ['/push-sw.js'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['lucide-react', 'recharts'],
          'db-vendor': ['dexie', 'zustand'],
        },
      },
    },
  },
})
