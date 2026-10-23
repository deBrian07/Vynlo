import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDLE_TIMEOUT_MS } from '../../src/features/classification/browser/model';

let receiveCommand: (value: unknown) => void;
let disconnect: () => void;
let receiveResult: (event: { data: unknown }) => void;
let workerError: () => void;
let postToWorker: ReturnType<typeof vi.fn>;
let postToBackground: ReturnType<typeof vi.fn>;
let terminate: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  postToWorker = vi.fn();
  postToBackground = vi.fn();
  terminate = vi.fn();
  vi.stubGlobal(
    'Worker',
    class {
      postMessage = postToWorker;
      terminate = terminate;
      addEventListener(type: string, listener: typeof receiveResult & typeof workerError) {
        if (type === 'message') receiveResult = listener;
        if (type === 'error') workerError = listener;
      }
    },
  );
  vi.stubGlobal('chrome', {
    runtime: {
      connect: () => ({
        postMessage: postToBackground,
        onMessage: {
          addListener: (listener: typeof receiveCommand) => {
            receiveCommand = listener;
          },
        },
        onDisconnect: {
          addListener: (listener: typeof disconnect) => {
            disconnect = listener;
          },
        },
      }),
    },
  });
  await import('../../entrypoints/inference/main');
});
afterEach(() => {
  disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('keeps the service worker awake only while a long compute/download task is active', async () => {
  await vi.advanceTimersByTimeAsync(10_000);
  expect(postToBackground).not.toHaveBeenCalled();
  receiveCommand({ id: 'setup', type: 'prepare' });
  expect(postToWorker).toHaveBeenCalledWith({ id: 'setup', type: 'prepare' });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(postToBackground.mock.calls).toEqual([[{ type: 'heartbeat' }], [{ type: 'heartbeat' }]]);
  receiveResult({ data: { id: 'setup', ok: true, data: { state: 'ready' } } });
  postToBackground.mockClear();
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
  expect(terminate).toHaveBeenCalledOnce();
  expect(postToBackground.mock.calls).toEqual([[{ type: 'idle' }]]);
});
it('stops background activity immediately when the service worker disconnects', async () => {
  receiveCommand({ id: 'setup', type: 'prepare' });
  disconnect();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(terminate).toHaveBeenCalledOnce();
  expect(postToBackground).not.toHaveBeenCalled();
});
it('rejects invalid or duplicate commands and keeps bounded control traffic', () => {
  receiveCommand({ id: 'invalid', type: 'infer', subject: 'x'.repeat(501) });
  expect(postToWorker).not.toHaveBeenCalled();
  receiveCommand({ id: 'valid', type: 'infer', subject: 'Project' });
  receiveCommand({ id: 'valid', type: 'infer', subject: 'Duplicate' });
  expect(postToWorker).toHaveBeenCalledTimes(1);
  expect(postToBackground).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'valid', ok: false }),
  );
  workerError();
  expect(terminate).toHaveBeenCalledOnce();
  expect(postToBackground).toHaveBeenCalledWith(expect.objectContaining({ type: 'idle' }));
});
