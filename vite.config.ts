import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/app/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/icons': 'http://localhost:3000',
      '/og': 'http://localhost:3000',
      '/site.webmanifest': 'http://localhost:3000'
    }
  }
});
