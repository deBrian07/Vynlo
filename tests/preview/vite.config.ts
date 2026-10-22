import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../artifacts/ui-preview', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
  },
});
