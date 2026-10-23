import type { DecisionContext } from '../decision-context';
export const MODEL_REPO = 'raphaelmansuy/tev1-0.8b-onnx-webgpu';
export const MODEL_REVISION = '26a904f1d138eddc711f9f116e045bffc1924dbd';
export const MODEL_CACHE = 'vynlo-tev1-webgpu-v1';
export const MAX_INPUT_TOKENS = 768;
/** The pinned embedding graph binds one [248320, 1024] float16 table to WebGPU Gather. */
export const MIN_GPU_BUFFER_BYTES = 508_559_360;
export const INFERENCE_TIMEOUT_MS = 8_000;
export const LOAD_TIMEOUT_MS = 120_000;
export const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
export const IDLE_TIMEOUT_MS = 30_000;
export const MODEL_ORIGINS = [
  'https://huggingface.co/*',
  'https://*.xethub.hf.co/*',
  'https://*.hf.co/*',
];
export const BROWSER_PREFERENCES_KEY = 'browserClassificationPreferences';
export interface BrowserRuntimeStatus {
  state:
    'not-downloaded' | 'downloading' | 'cached' | 'loading' | 'ready' | 'unsupported' | 'error';
  downloadedBytes: number;
  totalBytes: number;
  /** True only after all pinned files and the cache completion marker exist. */
  modelCached?: boolean;
  message?: string;
  lastInferenceMs?: number;
  lastLoadMs?: number;
}
export type BrowserOperation =
  'status' | 'check' | 'prepare' | 'infer' | 'release' | 'remove-model';
export interface BrowserCommand {
  id: string;
  type: BrowserOperation;
  subject?: string;
  context?: DecisionContext;
}
export const isBrowserOperation = (value: unknown): value is BrowserOperation =>
  ['status', 'check', 'prepare', 'infer', 'release', 'remove-model'].includes(String(value));
export function validBrowserStatus(value: unknown): value is BrowserRuntimeStatus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    [
      'not-downloaded',
      'downloading',
      'cached',
      'loading',
      'ready',
      'unsupported',
      'error',
    ].includes(String(v.state)) &&
    typeof v.downloadedBytes === 'number' &&
    Number.isFinite(v.downloadedBytes) &&
    v.downloadedBytes >= 0 &&
    typeof v.totalBytes === 'number' &&
    Number.isFinite(v.totalBytes) &&
    v.totalBytes >= v.downloadedBytes &&
    (v.modelCached === undefined || typeof v.modelCached === 'boolean') &&
    (v.message === undefined || (typeof v.message === 'string' && v.message.length <= 500)) &&
    (v.lastInferenceMs === undefined ||
      (typeof v.lastInferenceMs === 'number' &&
        Number.isFinite(v.lastInferenceMs) &&
        v.lastInferenceMs >= 0)) &&
    (v.lastLoadMs === undefined ||
      (typeof v.lastLoadMs === 'number' && Number.isFinite(v.lastLoadMs) && v.lastLoadMs >= 0))
  );
}
