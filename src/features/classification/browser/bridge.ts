import type { Prediction } from '../model';
import { MODEL } from '../model';
import { parsePrediction } from '../inference';
import { createModelAssets } from './assets';
import {
  DOWNLOAD_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  INFERENCE_TIMEOUT_MS,
  LOAD_TIMEOUT_MS,
  validBrowserStatus,
  type BrowserRuntimeStatus,
  type BrowserOperation,
} from './model';

const PORT = 'vynlo-browser-inference-v1';
const OFFSCREEN = 'inference.html';
const unavailable = 'Local GPU inference is unavailable. Open Vynlo settings to check this device.';
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  operation: BrowserOperation;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
/** One hidden extension document, one worker, shared by every Gmail tab. No email in storage. */
export function createBrowserInferenceBridge() {
  let port: chrome.runtime.Port | undefined;
  let creating: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let lastStatus: BrowserRuntimeStatus | undefined;
  const pending = new Map<string, Pending>();
  let active = false;
  let generation = 0;
  const assets = createModelAssets();
  const rejectAll = (message: string) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    pending.clear();
  };
  const shutdown = async (message = 'Local AI stopped. Your tags were kept.') => {
    generation++;
    lastStatus = undefined;
    rejectAll(message);
    const prior = port;
    port = undefined;
    prior?.disconnect();
    stopping ??= (async () => {
      if (creating) await creating.catch(() => undefined);
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
      });
      if (contexts.length) await chrome.offscreen.closeDocument();
    })().finally(() => {
      stopping = undefined;
    });
    await stopping;
  };
  chrome.runtime.onConnect.addListener((candidate) => {
    if (
      candidate.name !== PORT ||
      candidate.sender?.id !== chrome.runtime.id ||
      candidate.sender?.url !== chrome.runtime.getURL(OFFSCREEN) ||
      candidate.sender?.tab
    )
      return;
    if (port) {
      candidate.disconnect();
      return;
    }
    port = candidate;
    candidate.onDisconnect.addListener(() => {
      if (port === candidate) {
        port = undefined;
        lastStatus = undefined;
        rejectAll(unavailable);
      }
    });
    candidate.onMessage.addListener((message: unknown) => {
      if (!object(message)) return;
      if (message.type === 'idle' && !pending.size) {
        void shutdown().catch(() => undefined);
        return;
      }
      if (message.type === 'progress' && validBrowserStatus(message.status)) {
        lastStatus = message.status;
        if (message.status.state === 'ready') {
          for (const [id, request] of pending)
            if (request.operation === 'infer') {
              clearTimeout(request.timer);
              request.timer = setTimeout(() => {
                void shutdown(
                  'Local classification took too long. The GPU session was released; choose a tag manually or try again.',
                ).catch(() => undefined);
              }, INFERENCE_TIMEOUT_MS);
              pending.set(id, request);
            }
        }
        return;
      }
      if (typeof message.id !== 'string') return;
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.ok === true) request.resolve(message.data);
      else
        request.reject(
          new Error(
            typeof message.error === 'string' && message.error.length <= 500
              ? message.error
              : unavailable,
          ),
        );
    });
  });
  const ensureDocument = async () => {
    if (stopping) await stopping;
    if (port) return;
    creating ??= (async () => {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
      });
      // An orphaned document cannot reconnect after a service-worker restart. Recreate it.
      if (contexts.length && !port) await chrome.offscreen.closeDocument();
      if (!port)
        await chrome.offscreen.createDocument({
          url: OFFSCREEN,
          reasons: [chrome.offscreen.Reason.WORKERS],
          justification:
            'Run the user-enabled local email classifier in one GPU worker and release it after inactivity.',
        });
      if (!port) throw new Error(unavailable);
    })().finally(() => {
      creating = undefined;
    });
    await creating;
  };
  const rpc = async (operation: BrowserOperation, subject?: string) => {
    const version = generation;
    await ensureDocument();
    if (version !== generation || !port) throw new Error(unavailable);
    const id = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timeout =
        operation === 'prepare'
          ? DOWNLOAD_TIMEOUT_MS
          : operation === 'infer'
            ? lastStatus?.state === 'ready'
              ? INFERENCE_TIMEOUT_MS
              : LOAD_TIMEOUT_MS
            : 15_000;
      const timer = setTimeout(() => {
        void shutdown(
          operation === 'prepare'
            ? 'Model preparation timed out. Cancelled downloads do not enable AI.'
            : 'Local AI took too long. The GPU session was released.',
        ).catch(() => undefined);
      }, timeout);
      pending.set(id, { resolve, reject, timer, operation });
      try {
        port!.postMessage({ id, type: operation, ...(subject === undefined ? {} : { subject }) });
      } catch {
        pending.delete(id);
        clearTimeout(timer);
        reject(new Error(unavailable));
      }
    });
  };
  const getStatus = async (): Promise<BrowserRuntimeStatus> => {
    if (!port) return assets.status();
    const result = await rpc('status');
    if (!validBrowserStatus(result)) throw new Error(unavailable);
    lastStatus = result;
    return result;
  };
  const exclusive = async <T>(action: () => Promise<T>) => {
    if (active)
      throw new Error('Local AI is busy. Wait for the current operation or release the GPU.');
    active = true;
    try {
      return await action();
    } finally {
      active = false;
    }
  };
  return {
    status: getStatus,
    prepare: () =>
      exclusive(async () => {
        const result = await rpc('prepare');
        if (!validBrowserStatus(result)) throw new Error(unavailable);
        lastStatus = result;
        return result;
      }),
    check: async () => {
      const result = await getStatus();
      if (!['cached', 'ready'].includes(result.state))
        throw new Error('Download the local AI model in Vynlo settings first.');
      // The worker checks actual GPU support without downloading or allocating the model.
      const resultFromWorker = await rpc('check');
      if (!object(resultFromWorker) || resultFromWorker.available !== true)
        throw new Error(unavailable);
      return { version: 'browser-webgpu', model: MODEL } as const;
    },
    infer: (subject: string): Promise<Prediction> =>
      exclusive(async () => {
        if (!subject.trim() || subject.length > 500)
          throw new Error('Choose a tag manually for this subject.');
        const result = await rpc('infer', subject);
        // Reuse the same strict score validation at the worker boundary.
        if (!object(result)) throw new Error(unavailable);
        return parsePrediction({
          model: MODEL,
          answers: {
            category: {
              type: 'choice',
              choice: result.category,
              probabilities: result.probabilities,
              confidence: result.confidence,
            },
          },
        });
      }),
    release: shutdown,
    removeModel: async () => {
      await shutdown();
      await assets.clear();
    },
    idleTimeoutMs: IDLE_TIMEOUT_MS,
  };
}
