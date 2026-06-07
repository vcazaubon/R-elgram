import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-180.png'],
      manifest: {
        name: 'Réelgram — ton vault de Reels',
        short_name: 'Réelgram',
        description: 'Bibliothèque privée de vidéos Instagram/Reels sauvegardées.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0a0c',
        theme_color: '#0a0a0c',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Web Share Target (best-effort, Android/PWA-capable): a shared link
        // lands on "/" with the URL in ?import= — App reads it at boot and opens
        // the Import screen pre-filled. iOS doesn't implement this; there the
        // iOS Shortcut (docs/ios-shortcut.md) POSTs to /api/ingest instead.
        share_target: {
          action: '/',
          method: 'GET',
          params: { url: 'import', text: 'import', title: 'title' },
        },
      },
      workbox: {
        // Never let the SPA navigation fallback (or precache) swallow API calls —
        // the backend serves /api same-origin in prod (nginx) / via dev proxy.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
