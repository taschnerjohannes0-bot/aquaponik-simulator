import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Für GitHub Pages läuft das Spiel unter /<repo>/, lokal unter /.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Aquaponik-Simulator',
        short_name: 'Aquaponik',
        description: 'Fische, Bakterien und Pflanzen im Gleichgewicht halten: ein realistischer Aquaponik-Simulator.',
        lang: 'de',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#eef3ee',
        theme_color: '#1f5a4a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
