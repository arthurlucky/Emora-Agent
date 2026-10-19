import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5090,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/stream-pm': { target: 'http://localhost:3000', changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true
  }
})