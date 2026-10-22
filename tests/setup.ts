import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
afterEach(() => cleanup());
// jsdom does not schedule animation frames unless a visual environment is requested.
globalThis.requestAnimationFrame ??= (callback) =>
  window.setTimeout(() => callback(performance.now()), 16);
globalThis.cancelAnimationFrame ??= (id) => window.clearTimeout(id);
