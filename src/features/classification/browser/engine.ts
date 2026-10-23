import { CATEGORY_IDS, type Prediction } from '../model';
import { buildDecisionMessages, type DecisionMessages } from '../decision-prompt';
import { createModelAssets, MODEL_DOWNLOAD_BYTES, modelAssetUrl } from './assets';
import {
  IDLE_TIMEOUT_MS,
  MAX_INPUT_TOKENS,
  MIN_GPU_BUFFER_BYTES,
  MODEL_REPO,
  MODEL_REVISION,
  type BrowserRuntimeStatus,
} from './model';

type Tensor = {
  type?: string;
  data: ArrayLike<number | bigint>;
  dims: number[];
  to(type: string): Tensor;
  dispose?: () => void | Promise<void>;
};
type TokenInputs = Record<string, Tensor>;
type Tokenizer = {
  apply_chat_template(
    messages: { role: string; content: string }[],
    options: Record<string, unknown>,
  ): TokenInputs;
  encode(value: string, options: Record<string, unknown>): number[];
};
type Model = ((inputs: TokenInputs) => Promise<Record<string, unknown>>) & {
  dispose(): Promise<void>;
  sessions: Record<string, { inputNames: string[] }>;
};
export interface BrowserInferenceRuntime {
  runtimeVersion: string;
  env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    remotePathTemplate: string;
    useBrowserCache: boolean;
    useWasmCache: boolean;
    fetch: typeof fetch;
    logLevel: number;
    backends: {
      onnx: { wasm: Record<string, unknown>; webgpu: Record<string, unknown>; logLevel?: string };
    };
  };
  AutoTokenizer: {
    from_pretrained(repo: string, options: Record<string, unknown>): Promise<Tokenizer>;
  };
  Qwen3_5ForCausalLM: {
    from_pretrained(repo: string, options: Record<string, unknown>): Promise<Model>;
  };
  Tensor: new (type: string, data: bigint[], dims: number[]) => Tensor;
}
interface Gpu {
  requestAdapter(options: { powerPreference: string }): Promise<{
    features: { has(feature: string): boolean };
    limits: { maxStorageBufferBindingSize: number; maxBufferSize: number };
  } | null>;
}
const emptyStatus = (): BrowserRuntimeStatus => ({
  state: 'not-downloaded',
  downloadedBytes: 0,
  totalBytes: MODEL_DOWNLOAD_BYTES,
});
const packageUrl = (file: string) =>
  new URL(`/inference-runtime/${file}`, globalThis.location.href).href;
async function loadPackagedRuntime(): Promise<BrowserInferenceRuntime> {
  return import(/* @vite-ignore */ packageUrl('runtime.js'));
}
async function disposeTensors(value: unknown, seen = new Set<unknown>()): Promise<void> {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if ('dispose' in value && typeof value.dispose === 'function') {
    // A cleanup failure must not strand the engine in its busy state or hide the inference error.
    const dispose = value.dispose;
    await Promise.resolve()
      .then(() => dispose.call(value))
      .catch(() => undefined);
  } else if (!ArrayBuffer.isView(value)) {
    await Promise.allSettled(Object.values(value).map((child) => disposeTensors(child, seen)));
  }
}
export function createBrowserEngine(
  options: {
    loadRuntime?: () => Promise<BrowserInferenceRuntime>;
    assets?: ReturnType<typeof createModelAssets>;
    gpu?: Gpu | null;
    onProgress?: (status: BrowserRuntimeStatus) => void;
    /** Trusted, bundled evaluation code only. Runtime messages cannot override prompts. */
    buildMessages?: (subject: string) => DecisionMessages;
  } = {},
) {
  let current = emptyStatus();
  const emit = (state: BrowserRuntimeStatus) => {
    current = state;
    options.onProgress?.(state);
  };
  const assets = options.assets ?? createModelAssets({ onProgress: emit });
  let runtime: BrowserInferenceRuntime | null = null;
  let model: Model | null = null;
  let tokenizer: Tokenizer | null = null;
  let chatTemplate: string | null = null;
  let letters: number[] = [];
  let loading: Promise<void> | null = null;
  let busy = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const configureRuntime = async () => {
    runtime ??= await (options.loadRuntime ?? loadPackagedRuntime)();
    if (runtime.runtimeVersion !== '4.3.1')
      throw new Error('The packaged AI runtime has an unexpected version.');
    runtime.env.allowLocalModels = false;
    runtime.env.allowRemoteModels = true;
    // This runtime's tokenizer discovery omits the caller's revision. Pin URL
    // construction itself so discovery and model reads still hit only our cache.
    runtime.env.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
    runtime.env.useBrowserCache = false;
    runtime.env.useWasmCache = false;
    runtime.env.fetch = assets.fetch;
    runtime.env.logLevel = 50;
    Object.assign(runtime.env.backends.onnx.wasm, {
      wasmPaths: {
        mjs: packageUrl('ort-wasm-simd-threaded.asyncify.mjs'),
        wasm: packageUrl('ort-wasm-simd-threaded.asyncify.wasm'),
      },
      numThreads: 1,
      proxy: false,
    });
    runtime.env.backends.onnx.webgpu.powerPreference = 'low-power';
    runtime.env.backends.onnx.logLevel = 'fatal';
  };
  const stopIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const status = async (): Promise<BrowserRuntimeStatus> => {
    if (['ready', 'loading', 'downloading', 'unsupported', 'error'].includes(current.state))
      return current;
    return assets.status();
  };
  const release = async () => {
    if (busy || loading) throw new Error('Local AI is still working. Try again when it finishes.');
    stopIdle();
    const previous = model;
    model = null;
    tokenizer = null;
    chatTemplate = null;
    letters = [];
    runtime = null;
    await previous?.dispose();
    emit(await assets.status());
  };
  const startIdle = () => {
    stopIdle();
    idleTimer = setTimeout(() => {
      void release().catch(() => undefined);
    }, IDLE_TIMEOUT_MS);
  };
  const probeGpu = async () => {
    const gpu =
      options.gpu === undefined
        ? (globalThis.navigator as Navigator & { gpu?: Gpu }).gpu
        : options.gpu;
    const adapter = await gpu?.requestAdapter({ powerPreference: 'low-power' });
    if (!adapter || !adapter.features.has('shader-f16')) {
      emit({
        ...(await assets.status()),
        state: 'unsupported',
        message: 'Local AI needs WebGPU with shader-f16 support. Try an updated Chrome browser.',
      });
      throw new Error(current.message);
    }
    if (
      !adapter.limits ||
      !(adapter.limits.maxStorageBufferBindingSize >= MIN_GPU_BUFFER_BYTES) ||
      !(adapter.limits.maxBufferSize >= MIN_GPU_BUFFER_BYTES)
    ) {
      emit({
        ...(await assets.status()),
        state: 'unsupported',
        message:
          'Local AI needs GPU buffers of at least 485 MiB. This device cannot fit the model. Manual tags remain available.',
      });
      throw new Error(current.message);
    }
  };
  const initialize = async (signal?: AbortSignal) => {
    if (model && tokenizer && chatTemplate) return;
    const loadStarted = performance.now();
    await probeGpu();
    signal?.throwIfAborted();
    emit({ ...(await assets.status()), state: 'loading' });
    await configureRuntime();
    tokenizer = await runtime!.AutoTokenizer.from_pretrained(MODEL_REPO, {
      revision: MODEL_REVISION,
    });
    // Transformers.js does not load standalone chat_template.jinja automatically.
    const templateResponse = await assets.fetch(modelAssetUrl('chat_template.jinja'));
    if (!templateResponse.ok) throw new Error('The model chat template is unavailable.');
    chatTemplate = await templateResponse.text();
    if (!chatTemplate.trim() || chatTemplate.length > 20_000)
      throw new Error('The model chat template is invalid.');
    letters = CATEGORY_IDS.map((_, i) => {
      const ids = tokenizer!.encode(String.fromCharCode(65 + i), { add_special_tokens: false });
      if (ids.length !== 1 || ids[0] === undefined || !Number.isInteger(ids[0]) || ids[0] < 0)
        throw new Error('This tokenizer cannot safely score category choices.');
      return ids[0]!;
    });
    if (new Set(letters).size !== letters.length)
      throw new Error('The tokenizer has ambiguous category choices.');
    model = await runtime!.Qwen3_5ForCausalLM.from_pretrained(MODEL_REPO, {
      revision: MODEL_REVISION,
      device: 'webgpu',
      dtype: { embed_tokens: 'fp16', decoder_model_merged: 'q4f16' },
      use_external_data_format: true,
    });
    if (!model.sessions.decoder_model_merged?.inputNames.includes('num_logits_to_keep'))
      throw new Error('This model does not support efficient category scoring.');
    signal?.throwIfAborted();
    emit({
      ...(await assets.status()),
      state: 'ready',
      lastLoadMs: Math.round(performance.now() - loadStarted),
    });
  };
  const check = async () => {
    await probeGpu();
    // Detect a missing/broken packaged runtime before asking the user to download large weights.
    await configureRuntime();
    if (current.state === 'unsupported') emit(await assets.status());
    return { available: true as const };
  };
  const ensureReady = async (signal?: AbortSignal) => {
    if (!loading) {
      loading = initialize(signal)
        .catch(async () => {
          const previous = model;
          model = null;
          tokenizer = null;
          chatTemplate = null;
          letters = [];
          runtime = null;
          await previous?.dispose().catch(() => undefined);
          if (current.state !== 'unsupported')
            emit({
              ...(await assets.status()),
              state: 'error',
              message: 'Local AI could not start. Close other GPU-heavy tabs and try again.',
            });
          throw new Error(current.message);
        })
        .finally(() => {
          loading = null;
        });
    }
    await loading;
  };
  return {
    status,
    check,
    async prepare(signal = new AbortController().signal) {
      if (busy || loading) throw new Error('Local AI is already starting or working.');
      busy = true;
      stopIdle();
      try {
        signal.throwIfAborted();
        // Probe before a large download. Missing GPU support never falls back to CPU.
        await check();
        signal.throwIfAborted();
        await assets.download(signal);
        await ensureReady(signal);
        return status();
      } finally {
        busy = false;
        if (model) startIdle();
      }
    },
    async infer(subject: string): Promise<Prediction> {
      if (busy || loading) throw new Error('Local AI is busy. Try again in a moment.');
      if (typeof subject !== 'string' || !subject.trim() || subject.length > 500)
        throw new Error('This subject is unavailable or too long to classify.');
      busy = true;
      stopIdle();
      let inputs: TokenInputs | undefined;
      let outputs: Record<string, unknown> | undefined;
      try {
        if ((await assets.status()).state !== 'cached')
          throw new Error('Download the model in Settings before using local AI.');
        await ensureReady();
        // Reassert readiness for each request so the bridge enforces the short
        // forward deadline even if a concurrent status/check saw an idle cache.
        emit({ ...current, state: 'ready' });
        const started = performance.now();
        inputs = tokenizer!.apply_chat_template(
          (options.buildMessages ?? buildDecisionMessages)(subject),
          {
            chat_template: chatTemplate,
            add_generation_prompt: true,
            return_dict: true,
            enable_thinking: false,
          },
        );
        const count = inputs.input_ids?.dims.at(-1);
        if (!count || count > MAX_INPUT_TOKENS)
          throw new Error('This subject exceeds the local AI token budget. Choose a tag manually.');
        inputs.num_logits_to_keep = new runtime!.Tensor('int64', [1n], []);
        outputs = await model!(inputs);
        const rawLogits = outputs.logits as Tensor | undefined;
        // ORT stores float16 data as Uint16 bit patterns on some browsers. Match the
        // runtime's generation path: converting to float32 decodes those bits correctly.
        const logits = rawLogits?.to('float32');
        if (logits) outputs.scoring_logits = logits;
        const vocabSize = logits?.dims.at(-1);
        if (
          !logits ||
          !vocabSize ||
          logits.data.length !== vocabSize ||
          letters.some((id) => id >= vocabSize)
        )
          throw new Error('Local AI returned an unsupported score shape.');
        const scores = letters.map((id) => Number(logits.data[id]));
        if (!scores.every(Number.isFinite)) throw new Error('Local AI returned invalid scores.');
        const maximum = Math.max(...scores);
        const weights = scores.map((value) => Math.exp(value - maximum));
        const total = weights.reduce((sum, value) => sum + value, 0);
        const values = weights.map((value) => value / total);
        const best = values.indexOf(Math.max(...values));
        const ranked = [...values].sort((a, b) => b - a);
        const confidence =
          1 +
          values.reduce((sum, value) => sum + (value > 0 ? value * Math.log(value) : 0), 0) /
            Math.log(values.length);
        const category = CATEGORY_IDS[best]!;
        emit({
          ...current,
          state: 'ready',
          lastInferenceMs: Math.round(performance.now() - started),
          message: undefined,
        });
        return {
          category,
          probabilities: Object.fromEntries(
            CATEGORY_IDS.map((key, i) => [key, values[i]]),
          ) as Prediction['probabilities'],
          confidence: Math.max(0, Math.min(1, confidence)),
          needsReview: category === 'other' || ranked[0]! < 0.85 || ranked[0]! - ranked[1]! < 0.25,
        };
      } finally {
        await disposeTensors(inputs);
        await disposeTensors(outputs);
        busy = false;
        if (model) startIdle();
      }
    },
    release,
    async removeModel() {
      await release();
      await assets.clear();
      emit(await assets.status());
    },
  };
}
