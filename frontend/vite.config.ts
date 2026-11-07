import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 127.0.0.1 rather than localhost: Node may resolve localhost to ::1 while the API listens on IPv4 only.
const API_TARGET = 'http://127.0.0.1:8001'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
