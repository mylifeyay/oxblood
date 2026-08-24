import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// GitHub Pages serves a project site from /<repo>/, so the base path has to be
// baked in at build time. Set VITE_BASE=/slot-game/ (with both slashes) when
// building for Pages; local dev and preview stay at the root.
const base = process.env.VITE_BASE ?? '/'

const buildStamp = new Date()
  .toISOString()
  .replace('T', ' ')
  .slice(0, 16)

export default defineConfig(({ mode }) => ({
  base,
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp),
  },
  build: {
    target: 'safari16',
    assetsInlineLimit: 0, // keep fonts and icons as real files so the service worker can precache them
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  plugins: [
    // `npm run dev:https` serves over a self-signed certificate, which is the
    // only way to get a secure context (and therefore a service worker) on a
    // phone pointed at this machine over the LAN.
    mode === 'https' ? basicSsl() : null,

    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // main.ts registers explicitly so it can report status in the UI
      manifest: {
        id: base,
        name: 'Oxblood',
        short_name: 'Oxblood',
        description: 'A five-reel slot machine that pays out in clips from your own camera roll.',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1A0E12',
        theme_color: '#1A0E12',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Ship one self-contained worker rather than a shell plus a separate
        // Workbox chunk loaded through an AMD shim. Both work; this costs 14KB
        // more per worker update and buys one fewer request on a cold install,
        // and no async module boundary between registering and precaching.
        inlineWorkboxRuntime: true,
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,webmanifest,mp4}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        // Imported videos live in IndexedDB and must never touch the HTTP cache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ].filter(Boolean),
}))
