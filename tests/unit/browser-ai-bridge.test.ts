import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createBrowserInferenceBridge } from '../../src/features/classification/browser/bridge';
import {
  IDLE_TIMEOUT_MS,
  INFERENCE_TIMEOUT_MS,
} from '../../src/features/classification/browser/model';
vi.mock('../../src/features/classification/browser/assets', () => ({
  createModelAssets: () => ({
    status: async () => ({ state: 'cached', downloadedBytes: 10, totalBytes: 10 }),
    clear: vi.fn(async () => {}),
  }),
}));
type Listener = (value: unknown) => void;
let onConnect: (port: unknown) => void;
let workerMessage: Listener;
let disconnectListener: () => void;
let post: ReturnType<typeof vi.fn>;
let disconnected: ReturnType<typeof vi.fn>;
let createDocument: ReturnType<typeof vi.fn>;
let closeDocument: ReturnType<typeof vi.fn>;
let contexts: unknown[];
const getURL = (path: string) => `chrome-extension://extension/${path}`;
const status = { state: 'ready', downloadedBytes: 10, totalBytes: 10 };
function connect(sender: unknown = { id: 'extension', url: getURL('inference.html') }) {
  onConnect({
    name: 'vynlo-browser-inference-v1',
    sender,
    postMessage: post,
    disconnect: disconnected,
    onDisconnect: {
      addListener: (listener: () => void) => {
        disconnectListener = listener;
      },
    },
    onMessage: {
      addListener: (listener: Listener) => {
        workerMessage = listener;
      },
    },
  });
}
beforeEach(() => {
  contexts = [];
  post = vi.fn((request: { id: string; type: string }) => {
    if (request.type === 'status' || request.type === 'prepare')
      queueMicrotask(() => workerMessage({ id: request.id, ok: true, data: status }));
    if (request.type === 'check')
      queueMicrotask(() => workerMessage({ id: request.id, ok: true, data: { available: true } }));
  });
  disconnected = vi.fn();
  createDocument = vi.fn(async () => {
    contexts = [{}];
    connect();
  });
  closeDocument = vi.fn(async () => {
    contexts = [];
  });
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension',
      getURL,
      getContexts: vi.fn(async () => contexts),
      onConnect: {
        addListener: (listener: typeof onConnect) => {
          onConnect = listener;
        },
      },
    },
    offscreen: { Reason: { WORKERS: 'WORKERS' }, createDocument, closeDocument },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('does not create a GPU document for status and shares one document across checks', async () => {
  const bridge = createBrowserInferenceBridge();
  expect(await bridge.status()).toMatchObject({ state: 'cached' });
  expect(createDocument).not.toHaveBeenCalled();
  await bridge.check();
  await bridge.check();
  expect(createDocument).toHaveBeenCalledTimes(1);
  expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({ reasons: ['WORKERS'] }));
  await bridge.release();
  expect(closeDocument).toHaveBeenCalledTimes(1);
  expect(bridge.idleTimeoutMs).toBe(IDLE_TIMEOUT_MS);
});
it('recreates an orphaned offscreen document after worker restart', async () => {
  contexts = [{}];
  const bridge = createBrowserInferenceBridge();
  await bridge.check();
  expect(closeDocument).toHaveBeenCalledTimes(1);
  expect(createDocument).toHaveBeenCalledTimes(1);
  await bridge.release();
});
it('rejects unknown and Gmail-hosted inference ports', async () => {
  const bridge = createBrowserInferenceBridge();
  connect({ id: 'other', url: getURL('inference.html') });
  connect({ id: 'extension', url: 'https://mail.google.com/mail/u/0/', tab: { id: 1 } });
  await bridge.check();
  expect(createDocument).toHaveBeenCalledTimes(1);
  await bridge.release();
});
it('terminates timed out inference and cannot accept its late result', async () => {
  vi.useFakeTimers();
  const bridge = createBrowserInferenceBridge();
  await bridge.check();
  await bridge.status();
  const inference = bridge.infer('Project review');
  const rejected = expect(inference).rejects.toThrow(/too long/);
  await vi.advanceTimersByTimeAsync(INFERENCE_TIMEOUT_MS + 1);
  await rejected;
  expect(disconnected).toHaveBeenCalled();
  expect(closeDocument).toHaveBeenCalled();
  const request = post.mock.calls.find(([value]) => value.type === 'infer')![0];
  workerMessage({ id: request.id, ok: true, data: { category: 'work' } });
});
it('cancels pending work immediately when the user releases the GPU', async () => {
  const bridge = createBrowserInferenceBridge();
  await bridge.check();
  const inference = bridge.infer('Project review');
  const rejected = expect(inference).rejects.toThrow(/stopped/);
  // Let the asynchronous RPC register before cancellation.
  await Promise.resolve();
  await Promise.resolve();
  await bridge.release();
  await rejected;
  expect(closeDocument).toHaveBeenCalled();
});
it('rejects malformed worker replies and handles worker disconnects', async () => {
  const bridge = createBrowserInferenceBridge();
  await bridge.check();
  post.mockImplementationOnce((request: { id: string }) =>
    queueMicrotask(() => workerMessage({ id: request.id, ok: true, data: {} })),
  );
  await expect(bridge.infer('Project review')).rejects.toThrow(/unsupported decision/);
  const inference = bridge.infer('Project review');
  const rejected = expect(inference).rejects.toThrow(/unavailable/);
  await Promise.resolve();
  await Promise.resolve();
  disconnectListener();
  await rejected;
  await bridge.release();
});
