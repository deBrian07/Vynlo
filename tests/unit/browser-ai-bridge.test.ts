import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createBrowserInferenceBridge } from '../../src/features/classification/browser/bridge';
import {
  IDLE_TIMEOUT_MS,
  INFERENCE_TIMEOUT_MS,
} from '../../src/features/classification/browser/model';
vi.mock('../../src/features/classification/browser/assets', () => ({
  createModelAssets: () => ({
    status: () => cacheRead(),
    clear: () => clearCache(),
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
let clearCache = vi.fn(async () => {});
let cacheRead = vi.fn(async () => ({
  state: 'cached',
  downloadedBytes: 10,
  totalBytes: 10,
  modelCached: true,
}));
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
  clearCache = vi.fn(async () => {});
  cacheRead = vi.fn(async () => ({
    state: 'cached',
    downloadedBytes: 10,
    totalBytes: 10,
    modelCached: true,
  }));
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
  await vi.waitFor(() =>
    expect(post.mock.calls.filter(([value]) => value.type === 'infer')).toHaveLength(2),
  );
  disconnectListener();
  await rejected;
  await bridge.release();
});
it('waits for a delayed document Port instead of assuming createDocument connects synchronously', async () => {
  createDocument.mockImplementation(async () => {
    contexts = [{}];
  });
  const bridge = createBrowserInferenceBridge();
  const check = bridge.check();
  await vi.waitFor(() => expect(createDocument).toHaveBeenCalledOnce());
  connect();
  await check;
  await bridge.release();
});
it('cancels creation and rejects a late connection without reviving the cancelled worker', async () => {
  createDocument.mockImplementation(async () => {
    contexts = [{}];
  });
  const bridge = createBrowserInferenceBridge();
  const check = bridge.check();
  const rejected = expect(check).rejects.toThrow(/stopped/);
  await vi.waitFor(() => expect(createDocument).toHaveBeenCalledOnce());
  await bridge.release();
  await rejected;
  connect();
  expect(disconnected).toHaveBeenCalled();
  expect(closeDocument).toHaveBeenCalledOnce();
});
it('ignores queued progress, idle and disconnect events from a previous document', async () => {
  const bridge = createBrowserInferenceBridge();
  await bridge.check();
  const oldMessage = workerMessage;
  const oldDisconnect = disconnectListener;
  await bridge.release();
  await bridge.check();
  oldMessage({ type: 'progress', status: { ...status, state: 'error' } });
  oldMessage({ type: 'idle' });
  oldDisconnect();
  expect(await bridge.status()).toMatchObject({ state: 'ready' });
  expect(closeDocument).toHaveBeenCalledTimes(1);
  await bridge.release();
});
it('starts setup promptly and follows asynchronous completion and failure through status', async () => {
  post.mockImplementation((request: { id: string; type: string }) => {
    if (request.type === 'status')
      queueMicrotask(() => workerMessage({ id: request.id, ok: true, data: status }));
  });
  const bridge = createBrowserInferenceBridge();
  expect(await bridge.prepare()).toMatchObject({ state: 'downloading' });
  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'prepare' })),
  );
  workerMessage({ type: 'progress', status: { ...status, state: 'loading' } });
  expect(await bridge.status()).toMatchObject({ state: 'loading' });
  const request = post.mock.calls.find(([value]) => value.type === 'prepare')![0];
  workerMessage({
    id: request.id,
    ok: false,
    error: 'Model download failed. Check your connection and available storage.',
  });
  await vi.waitFor(async () =>
    expect(await bridge.status()).toMatchObject({
      state: 'error',
      message: expect.stringContaining('Model download failed'),
    }),
  );
  // Polling must not replace a setup error with the worker's old cache status.
  expect(await bridge.status()).toMatchObject({ state: 'error', modelCached: true });
  await bridge.release();
});
it('blocks new setup while model removal is still clearing cache storage', async () => {
  let finish!: () => void;
  clearCache.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const bridge = createBrowserInferenceBridge();
  const removal = bridge.removeModel();
  await vi.waitFor(() => expect(clearCache).toHaveBeenCalledOnce());
  await expect(bridge.prepare()).rejects.toThrow(/busy/);
  finish();
  await removal;
  await bridge.check();
  await bridge.release();
});
it.each(['prepare', 'check'] as const)(
  'does not revive %s cancelled during a cache lookup',
  async (operation) => {
    let complete!: (value: Awaited<ReturnType<typeof cacheRead>>) => void;
    cacheRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const bridge = createBrowserInferenceBridge();
    const task = bridge[operation]();
    const rejected = expect(task).rejects.toThrow(/stopped/);
    await vi.waitFor(() => expect(cacheRead).toHaveBeenCalledOnce());
    await bridge.release();
    const createdBeforeCompletion = createDocument.mock.calls.length;
    complete({ state: 'cached', downloadedBytes: 10, totalBytes: 10, modelCached: true });
    await rejected;
    expect(createDocument).toHaveBeenCalledTimes(createdBeforeCompletion);
    expect(post.mock.calls.some(([value]) => value.type === operation)).toBe(false);
  },
);
