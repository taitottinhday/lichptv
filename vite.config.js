import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    allowedHosts: ['lichptv-production.up.railway.app'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4173',
        changeOrigin: false
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
