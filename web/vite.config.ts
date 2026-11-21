import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// Port 8787 plutôt que 8000, souvent déjà pris. Surchargeable : SIKIA_API_URL=http://localhost:9000
const API_URL = process.env.SIKIA_API_URL ?? 'http://localhost:8787'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Sikia',
        short_name: 'Sikia',
        description: 'Traduction de la langue des signes, sur votre téléphone',
        lang: 'fr',
        theme_color: '#1c1b19',
        background_color: '#f5f3ee',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Les modèles et le WASM (~20 Mo) ne sont pas préchargés : ils sont mis en cache
        // à la première utilisation, puis servis hors ligne.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: ['mediapipe/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/mediapipe/'),
            handler: 'CacheFirst',
            options: { cacheName: 'mediapipe', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  // En dev, l'API FastAPI est servie sous la même origine : pas de CORS, wss géré par le tunnel.
  server: {
    proxy: {
      '/v1': { target: API_URL, ws: true },
      '/healthz': API_URL,
    },
  },
  test: { include: ['src/**/*.test.ts'] },
})
