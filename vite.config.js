import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: ['lichptv-production.up.railway.app']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
