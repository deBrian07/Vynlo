import type { Prediction } from '../model';
import { MODEL } from '../model';
import { parsePrediction } from '../inference';
import { createModelAssets, MODEL_DOWNLOAD_BYTES } from './assets';
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
const stopped = 'Local AI stopped. Your tags were kept.';
const busy = 'Local AI is busy. Wait for the current operation or release the GPU.';
const connectionTimeout = 5_000;
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer?: ReturnType<typeof setTimeout>;
  operation: BrowserOperation;
  phase?: BrowserRuntimeStatus['state'];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.length <= 500 ? error.message : unavailable;

/** One extension document and GPU worker, shared by Gmail tabs. No subjects in persistent state. */
export function createBrowserInferenceBridge() {
  let port: chrome.runtime.Port | undefined;
  let creating: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let removing: Promise<void> | undefined;
  let lastStatus: BrowserRuntimeStatus | undefined;
  let generation = 0;
  let accepting: number | undefined;
  let handshake: { resolve(): void; reject(): void } | undefined;
  let work: symbol | undefined;
  const pending = new Map<string, Pending>();
  const assets = createModelAssets();
  const emptyStatus = (): BrowserRuntimeStatus => ({
    state: 'not-downloaded',
    modelCached: false,
    downloadedBytes: 0,
    totalBytes: MODEL_DOWNLOAD_BYTES,
  });
  const cacheStatus = async (): Promise<BrowserRuntimeStatus> => {
    try {
      return await assets.status();
    } catch {
      return {
        ...emptyStatus(),
        state: 'error',
        message: 'Model storage is unavailable. Check your browser storage settings.',
      };
    }
  };
  const rejectAll = (message: string) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    pending.clear();
  };
  const shutdown = async (message?: string) => {
    generation++;
    accepting = undefined;
    handshake?.reject();
    handshake = undefined;
    work = undefined;
    lastStatus = message
      ? { ...(lastStatus ?? emptyStatus()), state: 'error', message }
      : undefined;
    rejectAll(message ?? stopped);
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
  const deadline = (id: string, request: Pending, duration: number) => {
    clearTimeout(request.timer);
    request.timer = setTimeout(() => {
      if (pending.get(id) !== request) return;
      void shutdown(
        request.operation === 'prepare'
          ? 'Model preparation timed out. Cancelled downloads do not enable AI.'
          : 'Local AI took too long. The GPU session was released.',
      ).catch(() => undefined);
    }, duration);
  };
  chrome.runtime.onConnect.addListener((candidate) => {
    if (candidate.name !== PORT) return;
    if (
      candidate.sender?.id !== chrome.runtime.id ||
      candidate.sender?.url !== chrome.runtime.getURL(OFFSCREEN) ||
      candidate.sender?.tab ||
      accepting !== generation ||
      stopping ||
      port
    ) {
      candidate.disconnect();
      return;
    }
    port = candidate;
    handshake?.resolve();
    candidate.onDisconnect.addListener(() => {
      if (port !== candidate) return;
      port = undefined;
      lastStatus = { ...(lastStatus ?? emptyStatus()), state: 'error', message: unavailable };
      rejectAll(unavailable);
    });
    candidate.onMessage.addListener((message: unknown) => {
      // A terminated document may still have a queued event. It must not touch a new session.
      if (port !== candidate || !object(message)) return;
      if (message.type === 'idle' && !pending.size) {
        void shutdown().catch(() => undefined);
        return;
      }
      if (message.type === 'progress' && validBrowserStatus(message.status)) {
        lastStatus = message.status;
        for (const [id, request] of pending) {
          if (request.phase === message.status.state) continue;
          request.phase = message.status.state;
          if (request.operation === 'prepare' && message.status.state === 'loading')
            deadline(id, request, LOAD_TIMEOUT_MS);
          if (request.operation === 'infer' && message.status.state === 'ready')
            deadline(id, request, INFERENCE_TIMEOUT_MS);
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
  const ensureDocument = async (version: number) => {
    if (stopping) await stopping;
    if (version !== generation) throw new Error(stopped);
    if (port) return;
    creating ??= (async () => {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
      });
      if (version !== generation) throw new Error(stopped);
      if (contexts.length) await chrome.offscreen.closeDocument();
      if (version !== generation) throw new Error(stopped);
      accepting = version;
      let timer: ReturnType<typeof setTimeout>;
      const connected = new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(unavailable)), connectionTimeout);
        handshake = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: () => {
            clearTimeout(timer);
            reject(new Error(stopped));
          },
        };
      });
      try {
        // Document creation and the runtime Port handshake are distinct asynchronous events.
        await Promise.all([
          chrome.offscreen.createDocument({
            url: OFFSCREEN,
            reasons: [chrome.offscreen.Reason.WORKERS],
            justification: 'Run user-enabled local email classification in one GPU worker.',
          }),
          connected,
        ]);
        if (version !== generation || !port) throw new Error(stopped);
      } finally {
        clearTimeout(timer!);
        if (accepting === version) accepting = undefined;
        handshake = undefined;
      }
    })().finally(() => {
      creating = undefined;
    });
    await creating;
  };
  const rpc = async (operation: BrowserOperation, subject?: string) => {
    const version = generation;
    try {
      await ensureDocument(version);
    } catch (error) {
      if (version === generation) await shutdown(errorMessage(error));
      throw error;
    }
    if (version !== generation || !port) throw new Error(stopped);
    const id = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const request: Pending = { resolve, reject, operation };
      pending.set(id, request);
      deadline(
        id,
        request,
        operation === 'prepare'
          ? DOWNLOAD_TIMEOUT_MS
          : operation === 'infer'
            ? lastStatus?.state === 'ready'
              ? INFERENCE_TIMEOUT_MS
              : LOAD_TIMEOUT_MS
            : 15_000,
      );
      try {
        port!.postMessage({ id, type: operation, ...(subject === undefined ? {} : { subject }) });
      } catch {
        pending.delete(id);
        clearTimeout(request.timer);
        reject(new Error(unavailable));
      }
    });
  };
  const getStatus = async (): Promise<BrowserRuntimeStatus> => {
    if (removing) await removing;
    if (work && lastStatus) return lastStatus;
    if (lastStatus?.state === 'error')
      return { ...(await cacheStatus()), state: 'error', message: lastStatus.message };
    if (!port) {
      return cacheStatus();
    }
    const result = await rpc('status');
    if (!validBrowserStatus(result)) throw new Error(unavailable);
    lastStatus = result;
    return result;
  };
  const exclusive = async <T>(action: () => Promise<T>) => {
    if (work || removing) throw new Error(busy);
    const token = Symbol();
    work = token;
    try {
      return await action();
    } finally {
      if (work === token) work = undefined;
    }
  };
  return {
    status: getStatus,
    // Return promptly: a Chrome runtime message must not span a multi-minute model download.
    // The settings view follows progress independently; only static file transfers continue.
    prepare: async (): Promise<BrowserRuntimeStatus> => {
      if (work || removing) throw new Error(busy);
      const token = Symbol();
      work = token;
      const version = generation;
      try {
        await ensureDocument(version);
        if (version !== generation) throw new Error(stopped);
        const cached = await cacheStatus();
        if (version !== generation || work !== token) throw new Error(stopped);
        lastStatus = { ...cached, state: 'downloading', message: undefined };
        void rpc('prepare')
          .then((result) => {
            if (version !== generation) return;
            if (!validBrowserStatus(result)) throw new Error(unavailable);
            lastStatus = result;
          })
          .catch(async (error: unknown) => {
            if (version === generation) await shutdown(errorMessage(error));
          })
          .finally(() => {
            if (work === token) work = undefined;
          });
        return lastStatus;
      } catch (error) {
        if (work === token) work = undefined;
        if (version === generation) await shutdown(errorMessage(error));
        throw error;
      }
    },
    check: () =>
      exclusive(async () => {
        const version = generation;
        const status = await cacheStatus();
        if (version !== generation) throw new Error(stopped);
        if (status.state !== 'cached')
          throw new Error('Download the local AI model in Vynlo settings first.');
        const result = await rpc('check');
        if (!object(result) || result.available !== true) throw new Error(unavailable);
        lastStatus =
          lastStatus?.state === 'ready' ? { ...lastStatus, ...status, state: 'ready' } : status;
        return { version: 'browser-webgpu', model: MODEL } as const;
      }),
    infer: (subject: string): Promise<Prediction> =>
      exclusive(async () => {
        if (typeof subject !== 'string' || !subject.trim() || subject.length > 500)
          throw new Error('Choose a tag manually for this subject.');
        const version = generation;
        try {
          const result = await rpc('infer', subject);
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
        } catch (error) {
          // Transformers serializes session execution globally. A rejected run can poison that
          // chain, so recovery needs a new worker/runtime rather than another call to the model.
          if (version === generation) await shutdown(errorMessage(error));
          throw error;
        }
      }),
    release: () => shutdown(),
    removeModel: () => {
      removing ??= (async () => {
        await shutdown();
        await assets.clear();
      })().finally(() => {
        removing = undefined;
      });
      return removing;
    },
    idleTimeoutMs: IDLE_TIMEOUT_MS,
  };
}
