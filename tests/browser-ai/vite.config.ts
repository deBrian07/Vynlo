import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    outDir: fileURLToPath(new URL('../../artifacts/browser-ai-benchmark', import.meta.url)),
    emptyOutDir: true,
  },
});
