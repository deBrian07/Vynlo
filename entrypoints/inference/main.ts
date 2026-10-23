import {
  IDLE_TIMEOUT_MS,
  isBrowserOperation,
  validBrowserStatus,
  type BrowserCommand,
} from '../../src/features/classification/browser/model';

// Runtime code is extension-packaged. Email subjects never leave this worker boundary.
const worker = new Worker(
  new URL('../../src/features/classification/browser/worker.ts', import.meta.url),
  { type: 'module' },
);
const port = chrome.runtime.connect({ name: 'vynlo-browser-inference-v1' });
let idle: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
const active = new Set<string>();
const stop = () => {
  if (idle) clearTimeout(idle);
  clearInterval(heartbeat);
  heartbeat = undefined;
  worker.terminate();
};
const armIdle = () => {
  if (idle) clearTimeout(idle);
  if (!active.size) {
    clearInterval(heartbeat);
    heartbeat = undefined;
    idle = setTimeout(() => {
      worker.terminate();
      port.postMessage({ type: 'idle' });
    }, IDLE_TIMEOUT_MS);
  }
};
port.onMessage.addListener((message: unknown) => {
  if (!message || typeof message !== 'object') return;
  const command = message as BrowserCommand;
  if (
    typeof command.id !== 'string' ||
    command.id.length > 100 ||
    !isBrowserOperation(command.type) ||
    (command.type === 'infer' &&
      (typeof command.subject !== 'string' ||
        !command.subject.trim() ||
        command.subject.length > 500))
  )
    return;
  if (active.size >= 8 || active.has(command.id)) {
    port.postMessage({ id: command.id, ok: false, error: 'Local AI is busy. Try again shortly.' });
    return;
  }
  if (idle) clearTimeout(idle);
  active.add(command.id);
  // Offscreen messages reset the MV3 service worker's idle timer. Only active jobs
  // need a heartbeat; model compilation may otherwise remain silent for >30 seconds.
  heartbeat ??= setInterval(() => port.postMessage({ type: 'heartbeat' }), 10_000);
  worker.postMessage(command);
});
worker.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  const value = message as Record<string, unknown>;
  if (value.type === 'progress' && validBrowserStatus(value.status)) {
    port.postMessage(value);
    return;
  }
  if (typeof value.id !== 'string' || !active.delete(value.id)) return;
  port.postMessage(value);
  armIdle();
});
worker.addEventListener('error', () => {
  for (const id of active)
    port.postMessage({
      id,
      ok: false,
      error: 'The local GPU worker stopped. Retry or choose a tag manually.',
    });
  active.clear();
  stop();
  port.postMessage({ type: 'idle' });
});
port.onDisconnect.addListener(stop);
armIdle();
