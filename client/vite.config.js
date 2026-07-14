import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        // Use 127.0.0.1 — on Windows, "localhost" often resolves to ::1 (IPv6)
        // while Express may only accept IPv4, causing ECONNREFUSED for the browser.
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
