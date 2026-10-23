/** Real tokenizer + production engine contract, with GPU and model inference explicitly stubbed. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'artifacts/browser-ai-tokenizer');
await mkdir(directory, { recursive: true });
const entry = path.join(directory, 'entry.mjs');
await writeFile(
  entry,
  [
    `export { createBrowserEngine } from ${JSON.stringify(path.join(root, 'src/features/classification/browser/engine.ts'))};`,
    `export { TEXT_ASSETS, modelAssetUrl } from ${JSON.stringify(path.join(root, 'src/features/classification/browser/assets.ts'))};`,
    `export { MODEL_REVISION, MIN_GPU_BUFFER_BYTES } from ${JSON.stringify(path.join(root, 'src/features/classification/browser/model.ts'))};`,
  ].join('\n'),
);
await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: entry,
    outDir: path.join(directory, 'code'),
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'engine.mjs' } },
  },
});
const { createBrowserEngine, TEXT_ASSETS, modelAssetUrl, MODEL_REVISION, MIN_GPU_BUFFER_BYTES } =
  await import(pathToFileURL(path.join(directory, 'code/engine.mjs')).href);
const metadata = new Map();
const names = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja'];
for (const name of names) {
  const spec = TEXT_ASSETS.find((item) => item.path === name);
  const filename = path.join(directory, name);
  const verified = (bytes) =>
    bytes.byteLength === spec.maxBytes &&
    (!spec.sha256 || createHash('sha256').update(bytes).digest('hex') === spec.sha256);
  let bytes;
  try {
    bytes = await readFile(filename);
  } catch {
    /* A missing cache is downloaded below. */
  }
  if (!bytes || !verified(bytes)) {
    console.log(
      `Downloading pinned tokenizer metadata: ${name} (${spec.maxBytes} bytes). No model weights.`,
    );
    const response = await fetch(modelAssetUrl(name), {
      credentials: 'omit',
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.body) throw new Error(`Tokenizer metadata unavailable: ${name}`);
    const parts = [];
    let length = 0;
    for await (const part of response.body) {
      length += part.byteLength;
      if (length > spec.maxBytes) throw new Error('Tokenizer metadata exceeded its pinned size.');
      parts.push(part);
    }
    bytes = Buffer.concat(parts);
    if (!verified(bytes)) throw new Error(`Tokenizer metadata failed verification: ${name}`);
    const temporary = `${filename}.partial`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  metadata.set(modelAssetUrl(name), bytes);
}

const nodeProcess = globalThis.process;
let runtime;
try {
  globalThis.process = undefined;
  runtime = await import(
    pathToFileURL(path.join(root, 'public/inference-runtime/runtime.js')).href
  );
} finally {
  globalThis.process = nodeProcess;
}
const priorLocation = globalThis.location;
globalThis.location = { href: 'http://127.0.0.1:4174/contract-test' };
const lengths = [];
let forwards = 0;
const model = Object.assign(
  async (inputs) => {
    forwards++;
    assert.equal(inputs.input_ids.type, 'int64');
    assert.equal(inputs.attention_mask.type, 'int64');
    assert.deepEqual(inputs.num_logits_to_keep.dims, []);
    assert.deepEqual(Array.from(inputs.num_logits_to_keep.data), [1n]);
    assert.deepEqual(inputs.input_ids.dims, inputs.attention_mask.dims);
    lengths.push(inputs.input_ids.dims.at(-1));
    const data = new Float32Array(40);
    data[32] = 8; // Stub output only: tests tokenization, never model accuracy.
    return { logits: new runtime.Tensor('float32', data, [1, 1, 40]) };
  },
  {
    sessions: { decoder_model_merged: { inputNames: ['num_logits_to_keep'] } },
    dispose: async () => {},
  },
);
const engine = createBrowserEngine({
  gpu: {
    requestAdapter: async () => ({
      features: new Set(['shader-f16']),
      limits: {
        maxBufferSize: MIN_GPU_BUFFER_BYTES,
        maxStorageBufferBindingSize: MIN_GPU_BUFFER_BYTES,
      },
    }),
  },
  loadRuntime: async () => ({
    ...runtime,
    AutoTokenizer: {
      from_pretrained: async (...args) => {
        try {
          return await runtime.AutoTokenizer.from_pretrained(...args);
        } catch (error) {
          console.error('Tokenizer contract setup failed:', error);
          throw error;
        }
      },
    },
    Qwen3_5ForCausalLM: { from_pretrained: async () => model },
  }),
  assets: {
    status: async () => ({ state: 'cached', downloadedBytes: 0, totalBytes: 0, modelCached: true }),
    download: async () => {
      throw new Error('This contract test must not download model weights.');
    },
    clear: async () => {},
    fetch: async (input) => {
      const url = typeof input === 'string' ? input : (input.url ?? String(input));
      const bytes = metadata.get(url);
      if (!bytes) throw new Error(`Unexpected tokenizer asset request: ${url}`);
      return new Response(bytes);
    },
  },
});
try {
  const fixtureText = await readFile(
    path.join(root, 'tests/fixtures/classification-eval.json'),
    'utf8',
  );
  const fixture = JSON.parse(fixtureText);
  for (const example of fixture.examples) await engine.infer(example.subject);
  assert.equal(forwards, fixture.examples.length);
  assert.ok(lengths.every((length) => length > 0 && length <= 768));
  await assert.rejects(engine.infer('🐉'.repeat(250)), /token budget/);
  assert.equal(forwards, fixture.examples.length);
  const report = {
    evidence:
      'Real pinned tokenizer and template through production engine. GPU and model forward are stubbed. No accuracy measurement.',
    modelRevision: MODEL_REVISION,
    fixtureSha256: createHash('sha256').update(fixtureText).digest('hex'),
    examples: lengths.length,
    minimumTokens: Math.min(...lengths),
    maximumTokens: Math.max(...lengths),
    unicodeBudgetRejected: true,
  };
  await writeFile(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await engine.release();
  globalThis.location = priorLocation;
}
