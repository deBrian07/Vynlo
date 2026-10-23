import { MODEL_CACHE, MODEL_REPO, MODEL_REVISION, type BrowserRuntimeStatus } from './model';
import { DECODER_SOURCE_SHA256, repairTev1Normalization } from './onnx-normalization';

/** Immutable Hugging Face revision. Sizes and LFS SHA-256 values come from its repository tree. */
export const TEXT_ASSETS = [
  { path: 'config.json', maxBytes: 3198 },
  { path: 'tokenizer_config.json', maxBytes: 7117 },
  { path: 'chat_template.jinja', maxBytes: 7650 },
  { path: 'generation_config.json', maxBytes: 248 },
  {
    path: 'tokenizer.json',
    maxBytes: 12807982,
    sha256: '5f9e4d4901a92b997e463c1f46055088b6cca5ca61a6522d1b9f64c4bb81cb42',
  },
  {
    path: 'onnx/embed_tokens_fp16.onnx',
    maxBytes: 637,
    sha256: 'baf83f8cc8d9f0d4f848df26c147864da325d0c833d812d1fca55180f3cc02ac',
  },
  {
    path: 'onnx/embed_tokens_fp16.onnx_data',
    maxBytes: 508559360,
    sha256: '24375b3c4ceac14cb5a66efa63545eae9ca0f37a6b57ea7a713797784249771b',
  },
  {
    path: 'onnx/decoder_model_merged_q4f16.onnx',
    maxBytes: 653862,
    sha256: 'c66a37bf893eaf8b9adefce72c8d09801e2048d44cfafbb54ff1d0573de7bd40',
  },
  {
    path: 'onnx/decoder_model_merged_q4f16.onnx_data',
    maxBytes: 424038400,
    sha256: '44a0e6938e3114ba9f5f78c7cecf594d490f78e7f242b370e2e15d11ecf63f54',
  },
] as const;
export const MODEL_DOWNLOAD_BYTES = TEXT_ASSETS.reduce((sum, asset) => sum + asset.maxBytes, 0);
const BASE = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/`;
export const modelAssetUrl = (path: (typeof TEXT_ASSETS)[number]['path']) => BASE + path;
const MARKER = 'https://vynlo.invalid/cache/model-complete';
const KEY = `${MODEL_REPO}@${MODEL_REVISION}`;
const byteHeader = 'X-Vynlo-Asset-Bytes';
const approvedUrl = (value: string) => {
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    (url.hostname === 'huggingface.co' ||
      url.hostname.endsWith('.hf.co') ||
      url.hostname.endsWith('.xethub.hf.co'))
  );
};
export function createModelAssets(
  options: {
    cacheStorage?: CacheStorage;
    fetcher?: typeof fetch;
    estimateStorage?: () => Promise<StorageEstimate>;
    onProgress?: (status: BrowserRuntimeStatus) => void;
  } = {},
) {
  const storage = options.cacheStorage ?? globalThis.caches;
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  let downloading = false;
  const open = () => {
    if (!storage) throw new Error('Model storage is unavailable in this browser.');
    return storage.open(MODEL_CACHE);
  };
  const status = async (): Promise<BrowserRuntimeStatus> => {
    const cache = await open();
    let downloadedBytes = 0;
    let complete = true;
    for (const asset of TEXT_ASSETS) {
      const response = await cache.match(BASE + asset.path);
      const valid = response?.headers.get(byteHeader) === String(asset.maxBytes);
      if (valid) downloadedBytes += asset.maxBytes;
      else complete = false;
    }
    const marker = await cache.match(MARKER);
    complete &&= (await marker?.text()) === KEY;
    return {
      state: downloading ? 'downloading' : complete ? 'cached' : 'not-downloaded',
      downloadedBytes,
      totalBytes: MODEL_DOWNLOAD_BYTES,
      modelCached: complete,
    };
  };
  return {
    status,
    async download(signal: AbortSignal): Promise<void> {
      if (downloading) throw new Error('A model download is already running.');
      downloading = true;
      try {
        const cache = await open();
        const estimateStorage =
          options.estimateStorage ??
          globalThis.navigator?.storage?.estimate?.bind(globalThis.navigator.storage);
        if (estimateStorage) {
          // Estimates are advisory; unknown quotas must not prevent a supported browser setup.
          const estimate = await estimateStorage().catch(() => null);
          if (estimate && Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)) {
            const remaining = MODEL_DOWNLOAD_BYTES - (await status()).downloadedBytes;
            if (estimate.quota! - estimate.usage! < remaining)
              throw new Error(
                'Model download needs more browser storage. Free some space and try again.',
              );
          }
        }
        await cache.delete(MARKER);
        let downloadedBytes = 0;
        for (const asset of TEXT_ASSETS) {
          signal.throwIfAborted();
          const cached = await cache.match(BASE + asset.path);
          if (cached?.headers.get(byteHeader) === String(asset.maxBytes)) {
            downloadedBytes += asset.maxBytes;
            continue;
          }
          const url = BASE + asset.path;
          const response = await fetcher(url, {
            signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            redirect: 'follow',
            cache: 'no-store',
          });
          if (!response.ok || (response.url && !approvedUrl(response.url)) || !response.body)
            throw new Error('The model download could not be verified.');
          // Fetch exposes decompressed bytes, while Content-Length may describe compressed
          // bytes and CORS may hide Content-Encoding. Verify the bounded decoded stream instead.
          let received = 0;
          let lastProgress = 0;
          const reader = response.body.getReader();
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                signal.throwIfAborted();
                const chunk = await reader.read();
                if (chunk.done) {
                  if (received !== asset.maxBytes)
                    throw new Error('The model download was incomplete.');
                  controller.close();
                  return;
                }
                received += chunk.value.byteLength;
                if (received > asset.maxBytes)
                  throw new Error('The model file exceeds its expected size.');
                // At most four progress messages per second, independent of network chunk size.
                if (Date.now() - lastProgress > 250) {
                  options.onProgress?.({
                    state: 'downloading',
                    downloadedBytes: downloadedBytes + received,
                    totalBytes: MODEL_DOWNLOAD_BYTES,
                  });
                  lastProgress = Date.now();
                }
                controller.enqueue(chunk.value);
              } catch (error) {
                await reader.cancel().catch(() => undefined);
                controller.error(error);
              }
            },
            cancel: () => reader.cancel(),
          });
          try {
            // CacheStorage consumes the bounded stream; no full weight-file ArrayBuffer copies.
            await cache.put(
              url,
              new Response(body, {
                headers: {
                  [byteHeader]: String(asset.maxBytes),
                  'Content-Type': asset.path.endsWith('.json')
                    ? 'application/json'
                    : 'application/octet-stream',
                },
              }),
            );
          } catch {
            await cache.delete(url);
            throw new Error(
              signal.aborted
                ? 'Model download canceled.'
                : 'Model download failed. Check your connection and available storage.',
            );
          }
          downloadedBytes += asset.maxBytes;
        }
        signal.throwIfAborted();
        await cache.put(MARKER, new Response(KEY));
      } finally {
        downloading = false;
        try {
          options.onProgress?.(await status());
        } catch {
          // Cache status can fail when the browser denies storage; preserve the original result.
        }
      }
    },
    async clear() {
      if (downloading) throw new Error('Cancel the download before removing model files.');
      if (!storage) throw new Error('Model storage is unavailable in this browser.');
      await storage.delete(MODEL_CACHE);
    },
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const value = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (
        method !== 'GET' ||
        init?.body != null ||
        !TEXT_ASSETS.some((asset) => value === BASE + asset.path)
      )
        throw new Error('An unapproved model asset was requested.');
      const cache = await open();
      if ((await (await cache.match(MARKER))?.text()) !== KEY)
        throw new Error('Download the model before using local AI.');
      const response = await cache.match(value);
      const asset = TEXT_ASSETS.find((item) => value === BASE + item.path)!;
      if (!response || response.headers.get(byteHeader) !== String(asset.maxBytes))
        throw new Error('A model file is missing. Download it again.');
      if (asset.path === 'onnx/decoder_model_merged_q4f16.onnx') {
        // Repair only this immutable, verified graph. Keep the original bytes in
        // CacheStorage so an existing 946 MB download remains reusable. The large
        // external weights stay streamed and are never copied or rewritten here.
        const bytes = new Uint8Array(await response.arrayBuffer());
        const digest = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          (byte) => byte.toString(16).padStart(2, '0'),
        ).join('');
        if (
          asset.sha256 !== DECODER_SOURCE_SHA256 ||
          bytes.byteLength !== asset.maxBytes ||
          digest !== DECODER_SOURCE_SHA256
        ) {
          // Evict only the damaged small graph. A retry must not skip it because
          // of its old byte-count header or force another download of the weights.
          await cache.delete(value);
          await cache.delete(MARKER);
          throw new Error('The cached model graph failed verification. Download it again.');
        }
        const corrected = repairTev1Normalization(bytes);
        return new Response(new Uint8Array(corrected).buffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(corrected.byteLength),
          },
        });
      }
      return response;
    },
  };
}
