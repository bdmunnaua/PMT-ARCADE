import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Reads FIREBASE_* (and optional VITE_*) from the repository-root .env file.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '../..',
  envPrefix: ['VITE_', 'FIREBASE_'],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
