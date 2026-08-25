import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * GitHub Pages has no SPA fallback: it serves a real 404 for any path that
 * isn't a file on disk, so opening /analytics directly — or refreshing on it,
 * or tapping a link someone shared — would 404 instead of loading the app.
 * Pages does serve 404.html for those, so ship index.html under that name too.
 */
function spaFallback(): Plugin {
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    closeBundle() {
      const dist = resolve(import.meta.dirname, 'dist')
      copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/MarioKartELO/',
  plugins: [react(), tailwindcss(), spaFallback()],
})
