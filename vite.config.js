import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { apiApp } from './server/api.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-server',
      configureServer(server) {
        server.middlewares.use('/api', apiApp)
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api', apiApp)
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
