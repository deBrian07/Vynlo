import fixtureText from '../fixtures/classification-eval.json?raw';
import {
  summarizeEvaluation,
  validateFixture,
  type EvaluationOutcome,
} from '../../scripts/classification-evaluation';
import type { Prediction } from '../../src/features/classification/model';
import { MODEL_DOWNLOAD_BYTES } from '../../src/features/classification/browser/assets';
import {
  DOWNLOAD_TIMEOUT_MS,
  INFERENCE_TIMEOUT_MS,
  LOAD_TIMEOUT_MS,
  MAX_INPUT_TOKENS,
  MODEL_CACHE,
  MODEL_REPO,
  MODEL_REVISION,
  validBrowserStatus,
  type BrowserRuntimeStatus,
} from '../../src/features/classification/browser/model';

const fixture = validateFixture(JSON.parse(fixtureText));
const element = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing benchmark control: ${id}`);
  return node as T;
};
const statusLabel = element('status');
const progress = element<HTMLProgressElement>('progress');
const checkButton = element<HTMLButtonElement>('check');
const downloadButton = element<HTMLButtonElement>('download');
const runButton = element<HTMLButtonElement>('run');
const exportButton = element<HTMLButtonElement>('export');
const cancelButton = element<HTMLButtonElement>('cancel');
const rows = element('rows');
let worker: Worker | null = null;
let runtimeStatus: BrowserRuntimeStatus | undefined;
let adapter: unknown = null;
let busy = false;
let generation = 0;
let report: Record<string, unknown> | undefined;
interface Pending {
  type: string;
  timer: ReturnType<typeof setTimeout>;
  resolve(value: WorkerResult): void;
  reject(error: Error): void;
}
interface WorkerResult {
  prediction?: Prediction;
  status: BrowserRuntimeStatus;
  adapter?: unknown;
}
const pending = new Map<string, Pending>();
function setBusy(value: boolean) {
  busy = value;
  checkButton.disabled = value;
  downloadButton.disabled = value;
  runButton.disabled = value;
}
function stop(message = 'Cancelled. The worker and GPU session were unloaded.') {
  generation++;
  worker?.terminate();
  worker = null;
  runtimeStatus = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(message));
  }
  pending.clear();
  statusLabel.textContent = message;
}
function setDeadline(id: string, request: Pending, milliseconds: number) {
  clearTimeout(request.timer);
  request.timer = setTimeout(
    () => stop(`Stopped: ${request.type} exceeded its ${milliseconds / 1000}-second deadline.`),
    milliseconds,
  );
  pending.set(id, request);
}
function ensureWorker() {
  if (worker) return worker;
  const instance = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker = instance;
  instance.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (worker !== instance || !event.data || typeof event.data !== 'object') return;
    const message = event.data as Record<string, unknown>;
    if (message.type === 'progress' && validBrowserStatus(message.status)) {
      runtimeStatus = message.status;
      if (message.status.state === 'downloading') {
        progress.max = MODEL_DOWNLOAD_BYTES;
        progress.value = message.status.downloadedBytes;
        statusLabel.textContent = `Downloading: ${(message.status.downloadedBytes / 1_000_000).toFixed(1)} / ${(MODEL_DOWNLOAD_BYTES / 1_000_000).toFixed(1)} MB`;
      } else if (message.status.state === 'loading') {
        statusLabel.textContent = 'Loading cached weights and compiling GPU sessions…';
        for (const [id, request] of pending)
          if (request.type === 'infer' || request.type === 'prepare')
            setDeadline(id, request, LOAD_TIMEOUT_MS);
      } else if (message.status.state === 'ready') {
        for (const [id, request] of pending)
          if (request.type === 'infer') setDeadline(id, request, INFERENCE_TIMEOUT_MS);
      }
      return;
    }
    if (typeof message.id !== 'string') return;
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.ok === true) request.resolve(message.data as WorkerResult);
    else request.reject(new Error(String(message.error ?? 'GPU operation failed.')));
  });
  instance.addEventListener('error', () =>
    stop('The actual WebGPU worker failed to start or run.'),
  );
  return instance;
}
function rpc(type: 'check' | 'prepare' | 'infer', subject?: string): Promise<WorkerResult> {
  const instance = ensureWorker();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const request: Pending = {
      type,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      resolve,
      reject,
    };
    setDeadline(
      id,
      request,
      type === 'prepare'
        ? DOWNLOAD_TIMEOUT_MS
        : type === 'infer'
          ? runtimeStatus?.state === 'ready'
            ? INFERENCE_TIMEOUT_MS
            : LOAD_TIMEOUT_MS
          : 15_000,
    );
    instance.postMessage({ id, type, subject });
  });
}
function updateDevice(result: WorkerResult) {
  runtimeStatus = result.status;
  if (result.adapter !== undefined) adapter = result.adapter;
  element('device').textContent = JSON.stringify({ adapter, cache: result.status }, null, 2);
}
function memoryInfo() {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  return memory
    ? {
        scope: 'Main page JS heap only; excludes dedicated worker, GPU and browser process memory.',
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
      }
    : null;
}
async function action(task: () => Promise<void>) {
  if (busy) return;
  setBusy(true);
  try {
    await task();
  } catch (error) {
    statusLabel.textContent =
      error instanceof Error ? error.message : 'Benchmark operation failed.';
  } finally {
    setBusy(false);
  }
}
checkButton.addEventListener(
  'click',
  () =>
    void action(async () => {
      statusLabel.textContent = 'Checking actual GPU support…';
      updateDevice(await rpc('check'));
      statusLabel.textContent = 'GPU preflight passed. No model files were downloaded.';
    }),
);
downloadButton.addEventListener(
  'click',
  () =>
    void action(async () => {
      statusLabel.textContent = 'Checking GPU, downloading pinned files, then loading the model…';
      updateDevice(await rpc('prepare'));
      statusLabel.textContent = `Model ready. Actual load: ${runtimeStatus?.lastLoadMs ?? 'unavailable'} ms. Choose Run to evaluate.`;
    }),
);
cancelButton.addEventListener('click', () => stop());
element<HTMLButtonElement>('clear-cache').addEventListener('click', () => {
  if (
    !window.confirm(
      'Stop any running evaluation and delete the 946 MB benchmark model cache from this localhost profile? The extension cache is separate.',
    )
  )
    return;
  stop('Cancelling GPU work before deleting the benchmark cache…');
  void caches.delete(MODEL_CACHE).then(
    () => {
      statusLabel.textContent =
        'Benchmark model cache deleted. Download again before another evaluation.';
      element('device').textContent = 'No benchmark model files cached. GPU worker unloaded.';
      progress.value = 0;
    },
    () => {
      statusLabel.textContent =
        'Could not delete the cache. Clear storage for this localhost site in Chrome settings.';
    },
  );
});
runButton.addEventListener(
  'click',
  () =>
    void action(async () => {
      const runGeneration = generation;
      const checked = await rpc('check');
      updateDevice(checked);
      if (!checked.status.modelCached && !['cached', 'ready'].includes(checked.status.state))
        throw new Error(
          'Download the model first. Running the evaluation never downloads weights.',
        );
      const fixtureHash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fixtureText)),
        ),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      const outcomes: EvaluationOutcome[] = [];
      const measurements: unknown[] = [];
      const startedAt = new Date().toISOString();
      const started = performance.now();
      const memoryBefore = memoryInfo();
      let stoppedReason: string | undefined;
      rows.replaceChildren();
      progress.max = fixture.examples.length;
      progress.value = 0;
      exportButton.disabled = true;
      report = undefined;
      for (const example of fixture.examples) {
        if (runGeneration !== generation) {
          stoppedReason = 'Cancelled before completing all fixtures.';
          break;
        }
        statusLabel.textContent = `Running ${outcomes.length + 1} / ${fixture.examples.length}: ${example.id}`;
        const sampleStart = performance.now();
        let outcome: EvaluationOutcome;
        let forwardMs: number | undefined;
        try {
          const result = await rpc('infer', example.subject);
          runtimeStatus = result.status;
          if (!result.prediction) throw new Error('The engine returned no prediction.');
          forwardMs = result.status.lastInferenceMs;
          outcome = {
            id: example.id,
            prediction: result.prediction,
            latencyMs: performance.now() - sampleStart,
          };
          measurements.push({
            id: example.id,
            forwardMs: forwardMs ?? null,
            lastLoadMs: result.status.lastLoadMs ?? null,
            requestWallMs: outcome.latencyMs,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Actual inference failed.';
          outcome = { id: example.id, error: message, latencyMs: performance.now() - sampleStart };
          // A failed or timed-out model must be investigated before spending more resources.
          stoppedReason = message;
        }
        outcomes.push(outcome);
        const row = document.createElement('tr');
        const correct =
          !!outcome.prediction && example.acceptable.includes(outcome.prediction.category);
        for (const value of [
          example.id,
          example.acceptable.join(' / '),
          outcome.prediction?.category ?? outcome.error ?? 'Error',
          forwardMs === undefined ? 'Unavailable' : `${forwardMs} ms`,
          correct ? 'Correct' : outcome.error ? 'Runtime error' : 'Mismatch',
        ]) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        row.className = correct ? 'pass' : 'fail';
        rows.append(row);
        progress.value = outcomes.length;
        if (stoppedReason) break;
      }
      const complete = outcomes.length === fixture.examples.length && !stoppedReason;
      const metrics = complete ? summarizeEvaluation(fixture.examples, outcomes) : null;
      report = {
        schemaVersion: 1,
        scope: 'Actual browser WebGPU engine; synthetic English subject regression only.',
        complete,
        stoppedReason: stoppedReason ?? null,
        startedAt,
        completedAt: new Date().toISOString(),
        totalWallMs: performance.now() - started,
        model: {
          repository: MODEL_REPO,
          revision: MODEL_REVISION,
          downloadBytes: MODEL_DOWNLOAD_BYTES,
        },
        fixture: {
          sha256: fixtureHash,
          count: fixture.examples.length,
          description: fixture.description,
        },
        limits: {
          maxInputTokens: MAX_INPUT_TOKENS,
          readyForwardMs: INFERENCE_TIMEOUT_MS,
          coldLoadMs: LOAD_TIMEOUT_MS,
          downloadMs: DOWNLOAD_TIMEOUT_MS,
        },
        environment: {
          userAgent: navigator.userAgent,
          adapter,
          crossOriginIsolated,
          memoryBefore,
          memoryAfter: memoryInfo(),
        },
        metrics,
        measurements,
        outcomes,
        examples: fixture.examples,
      };
      element('metrics').textContent = JSON.stringify(
        { complete, stoppedReason, metrics, measurements },
        null,
        2,
      );
      element('summary').textContent =
        complete && metrics
          ? `${outcomes.length} actual model outputs. Straightforward accuracy: ${(metrics.straightforward.accuracy * 100).toFixed(1)}%. Macro F1: ${metrics.straightforward.macroF1.toFixed(3)}. Synthetic screen: ${metrics.gate.passed ? 'passed' : 'did not pass'}. Production readiness remains unproven.`
          : `Stopped after ${outcomes.length} / ${fixture.examples.length} fixtures. Partial results can be exported; no complete accuracy claim is available.`;
      exportButton.disabled = false;
      statusLabel.textContent = complete
        ? 'Evaluation complete. Export the JSON report to preserve the evidence.'
        : `Evaluation stopped: ${stoppedReason}`;
      stop(statusLabel.textContent);
    }),
);
exportButton.addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `vynlo-browser-ai-${new Date().toISOString().replaceAll(':', '-')}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('pagehide', () => stop('Page closed. GPU worker unloaded.'));
