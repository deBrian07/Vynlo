import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false,
  vite: () => ({ plugins: [tailwindcss()], worker: { format: 'es' } }),
  manifest: {
    name: 'Vynlo',
    description:
      'Email, without the friction. Local conversation tracking, reminders and snippets for Gmail.',
    minimum_chrome_version: '120',
    permissions: ['storage', 'alarms', 'notifications', 'offscreen'],
    optional_host_permissions: [
      'https://huggingface.co/*',
      'https://*.xethub.hf.co/*',
      'https://*.hf.co/*',
    ],
    icons: { 16: '/icons/16.png', 32: '/icons/32.png', 48: '/icons/48.png', 128: '/icons/128.png' },
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; connect-src 'self' https://huggingface.co https://*.xethub.hf.co https://*.hf.co",
    },
  },
});
