import { defineConfig } from 'vite'

// In dev, the app runs on :5173 and the backend on :8787. Proxy the WebSocket
// so the app can always talk to a same-origin `/ws` (matches production, where
// the backend serves both the app and /ws on one port).
const BACKEND = process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:8787'

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: { target: 'esnext' },
})
