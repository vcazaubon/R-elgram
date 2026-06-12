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
    // Remote dev: bind all interfaces on a fixed port so it's reachable at
    // http://<server-ip>:10009 (firewall opens 10009/tcp). strictPort: fail
    // loudly instead of silently hopping to another port.
    host: true,
    port: 10009,
    strictPort: true,
    proxy: {
      // /api is proxied to the local FastAPI backend. The target is overridable
      // via VITE_API_PROXY because the default :8000 can be taken by an
      // unrelated service on shared hosts (e.g. the Coolify dashboard maps host
      // :8000 → its own UI, which answers /api/* with a 404). Run the backend on
      // a free port and point here:  VITE_API_PROXY=http://localhost:8001 vite
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 10009,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        'public-share': 'public-share.html',
      },
    },
  },
});
