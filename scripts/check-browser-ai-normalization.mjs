/** Verify the production ONNX normalization repair with real packaged CPU inference.
 * No Tev1 weights or private email data are downloaded or evaluated here.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

if (!process.execArgv.includes('--disallow-code-generation-from-strings'))
  throw new Error('Run this check with --disallow-code-generation-from-strings.');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'artifacts/browser-ai-normalization');
await mkdir(directory, { recursive: true });
const entry = path.join(directory, 'entry.mjs');
await writeFile(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/features/classification/browser/onnx-normalization.ts'))};`,
    `export {createModelAssets, TEXT_ASSETS, modelAssetUrl} from ${JSON.stringify(path.join(root, 'src/features/classification/browser/assets.ts'))};`,
    `export {MODEL_REPO, MODEL_REVISION} from ${JSON.stringify(path.join(root, 'src/features/classification/browser/model.ts'))};`,
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
    rollupOptions: { output: { entryFileNames: 'normalization.mjs' } },
  },
});
const {
  repairTev1Normalization,
  NORMALIZATION_REVISION,
  DECODER_SOURCE_SHA256,
  createModelAssets,
  TEXT_ASSETS,
  modelAssetUrl,
  MODEL_REPO,
  MODEL_REVISION,
} = await import(pathToFileURL(path.join(directory, 'code/normalization.mjs')).href);
const sha256 = (value) =>
  createHash('sha256')
    .update(value instanceof ArrayBuffer ? new Uint8Array(value) : value)
    .digest('hex');
const spec = TEXT_ASSETS.find((item) => item.path === 'onnx/decoder_model_merged_q4f16.onnx');
assert.equal(spec.sha256, DECODER_SOURCE_SHA256);
const graphPath = path.join(directory, 'decoder-original.onnx');
let source;
try {
  source = await readFile(graphPath);
} catch {
  /* Only the small graph protobuf, never its external weights, is fetched below. */
}
if (!source || source.length !== spec.maxBytes || sha256(source) !== spec.sha256) {
  console.log(`Downloading pinned decoder graph (${spec.maxBytes} bytes); no model weights.`);
  const response = await fetch(modelAssetUrl(spec.path), {
    credentials: 'omit',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) throw new Error('Pinned decoder graph unavailable.');
  const parts = [];
  let length = 0;
  for await (const part of response.body) {
    length += part.length;
    if (length > spec.maxBytes) throw new Error('Decoder graph exceeded its pinned size.');
    parts.push(part);
  }
  source = Buffer.concat(parts);
  assert.equal(source.length, spec.maxBytes);
  assert.equal(sha256(source), spec.sha256);
  await writeFile(graphPath, source);
}
const unchangedSourceHash = sha256(source);
const repairedSource = repairTev1Normalization(source);
assert.equal(
  sha256(repairedSource),
  'f2e415be0de484d8155f0f95bdbfb9b03a1850ca4adbe23d7ef9e99cd9c6fdbd',
  'The versioned repair must produce the exact reviewed decoder graph.',
);
assert.equal(sha256(source), unchangedSourceHash, 'Repair must not mutate cached bytes.');
assert.throws(() => repairTev1Normalization(repairedSource), /./);

// The real cache fetch boundary must transform the pinned source without
// rewriting its stored bytes or touching the network. Other model files are
// intentionally absent: this tests fetching the graph, not a full model cache.
const graphUrl = modelAssetUrl(spec.path);
const cacheRecords = new Map([
  [graphUrl, new Response(source, { headers: { 'X-Vynlo-Asset-Bytes': String(source.length) } })],
  ['https://vynlo.invalid/cache/model-complete', new Response(`${MODEL_REPO}@${MODEL_REVISION}`)],
]);
const assets = createModelAssets({
  cacheStorage: {
    open: async () => ({ match: async (key) => cacheRecords.get(String(key))?.clone() }),
  },
  fetcher: async () => {
    throw new Error('Normalization validation must not request model weights.');
  },
});
const fetched = new Uint8Array(await (await assets.fetch(graphUrl)).arrayBuffer());
assert.equal(sha256(fetched), sha256(repairedSource));
assert.equal(sha256(await cacheRecords.get(graphUrl).arrayBuffer()), unchangedSourceHash);

// Small local ONNX fixture using the same exact 61 source gamma names, FLOAT
// external tensor layout and fused norm operator contract as the pinned graph.
// A wrong exporter gamma is raw w; the correct zero-centered gamma is 1 + w.
const varint = (input) => {
  let value = BigInt(input);
  const bytes = [];
  do {
    bytes.push(Number(value & 127n) | (value > 127n ? 128 : 0));
    value >>= 7n;
  } while (value);
  return Buffer.from(bytes);
};
const message = (...parts) => Buffer.concat(parts);
const integer = (number, value) => message(varint(number << 3), varint(value));
const field = (number, bytes) => message(varint((number << 3) | 2), varint(bytes.length), bytes);
const text = (number, value) => field(number, Buffer.from(value));
const epsilonBytes = Buffer.alloc(4);
epsilonBytes.writeFloatLE(1e-6);
const epsilon = field(
  5,
  message(text(1, 'epsilon'), varint((2 << 3) | 5), epsilonBytes, integer(20, 1)),
);
const valueInfo = (name, dimension) =>
  message(
    text(1, name),
    field(
      2,
      field(
        1,
        message(
          integer(1, 1),
          field(2, message(field(1, integer(1, 1)), field(1, integer(1, dimension)))),
        ),
      ),
    ),
  );
const normSpecs = [];
for (let i = 0; i < 24; i++) {
  normSpecs.push([`model.layers.${i}.input_layernorm.weight`, 1024]);
  normSpecs.push([`model.layers.${i}.post_attention_layernorm.weight`, 1024]);
  if (i % 4 === 3) {
    normSpecs.push([`model.layers.${i}.attn.q_norm.layernorm.weight`, 256]);
    normSpecs.push([`model.layers.${i}.attn.k_norm.layernorm.weight`, 256]);
  }
}
normSpecs.push(['model.layers.24.final_norm_layernorm.weight', 1024]);
assert.equal(normSpecs.length, 61);
const rawScale = (dimension) =>
  Float32Array.from({ length: dimension }, (_, i) => [-0.75, 0, 0.5, 1][i % 4]);
const inputValues = (dimension) =>
  Float32Array.from({ length: dimension }, (_, i) => [1, -2, 3, -4][i % 4]);
const weightFile = 'decoder_model_merged_q4f16.onnx_data';
const weightParts = [];
let weightOffset = 0;
const initializers = [];
const nodes = [];
const outputs = [];
for (const [name, dimension] of normSpecs) {
  const values = rawScale(dimension);
  const bytes = Buffer.from(values.buffer);
  initializers.push(
    field(
      5,
      message(
        integer(1, dimension),
        integer(2, 1),
        text(8, name),
        field(13, message(text(1, 'location'), text(2, weightFile))),
        field(13, message(text(1, 'offset'), text(2, String(weightOffset)))),
        field(13, message(text(1, 'length'), text(2, String(bytes.length)))),
        integer(14, 1),
      ),
    ),
  );
  weightOffset += bytes.length;
  weightParts.push(bytes);
  const output = `result.${normSpecs.findIndex(([key]) => key === name)}`;
  const skip = name.includes('post_attention_layernorm') || name.includes('final_norm_layernorm');
  nodes.push(
    field(
      1,
      message(
        text(1, `x${dimension}`),
        ...(skip ? [text(1, 'zeros1024')] : []),
        text(1, name),
        text(2, output),
        text(4, skip ? 'SkipSimplifiedLayerNormalization' : 'SimplifiedLayerNormalization'),
        epsilon,
        ...(skip ? [text(7, 'com.microsoft')] : []),
      ),
    ),
  );
  outputs.push(field(12, valueInfo(output, dimension)));
}
// GDN gated norm uses an ordinary gamma, so adding one here would be a regression.
const gatedName = 'model.layers.0.gdn.norm.weight';
initializers.push(
  field(
    5,
    message(
      integer(1, 128),
      integer(2, 1),
      text(8, gatedName),
      field(9, Buffer.from(rawScale(128).buffer)),
    ),
  ),
);
nodes.push(
  field(
    1,
    message(
      text(1, 'x128'),
      text(1, gatedName),
      text(2, 'gated'),
      text(4, 'SimplifiedLayerNormalization'),
      epsilon,
    ),
  ),
);
outputs.push(field(12, valueInfo('gated', 128)));
const graph = message(
  ...nodes,
  text(2, 'vynlo-normalization-arithmetic'),
  ...initializers,
  ...[1024, 256, 128].map((n) => field(11, valueInfo(`x${n}`, n))),
  field(11, valueInfo('zeros1024', 1024)),
  ...outputs,
);
const synthetic = message(
  integer(1, 8),
  field(7, graph),
  field(8, integer(2, 21)),
  field(8, message(text(1, 'com.microsoft'), integer(2, 1))),
);
const repairedSynthetic = repairTev1Normalization(synthetic);
const externalWeights = Buffer.concat(weightParts);
const runtimeDirectory = new URL('../public/inference-runtime/', import.meta.url);
const nodeProcess = globalThis.process;
let runtime;
try {
  globalThis.process = undefined;
  runtime = await import(new URL('runtime.js', runtimeDirectory).href);
} finally {
  globalThis.process = nodeProcess;
}
runtime.env.useWasmCache = false;
runtime.env.backends.onnx.wasm.numThreads = 1;
runtime.env.backends.onnx.wasm.proxy = false;
runtime.env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('ort-wasm-simd-threaded.asyncify.mjs', runtimeDirectory).href,
};
runtime.env.backends.onnx.wasm.wasmBinary = await readFile(
  fileURLToPath(new URL('ort-wasm-simd-threaded.asyncify.wasm', runtimeDirectory)),
);
const tensors = [1024, 256, 128].map((n) => new runtime.Tensor('float32', inputValues(n), [1, n]));
const inputs = Object.fromEntries(
  tensors.map((tensor) => [`x${tensor.dims[1]}`, tensor.ort_tensor]),
);
const zeros = new runtime.Tensor('float32', new Float32Array(1024), [1, 1024]);
tensors.push(zeros);
inputs.zeros1024 = zeros.ort_tensor;
const execute = async (bytes) => {
  const session = await runtime.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    externalData: [{ path: weightFile, data: externalWeights }],
  });
  try {
    return await session.run(inputs);
  } finally {
    await session.release();
  }
};
let unpatched;
let patched;
let maximumPatchedError = 0;
let maximumUnpatchedError = 0;
try {
  unpatched = await execute(synthetic);
  patched = await execute(repairedSynthetic);
  for (let index = 0; index < normSpecs.length; index++) {
    const [, dimension] = normSpecs[index];
    const x = inputValues(dimension);
    const scale = rawScale(dimension);
    const variance = Array.from(x).reduce((sum, value) => sum + value * value, 0) / dimension;
    for (let i = 0; i < dimension; i++) {
      const expected = (x[i] / Math.sqrt(variance + 1e-6)) * (1 + scale[i]);
      maximumPatchedError = Math.max(
        maximumPatchedError,
        Math.abs(patched[`result.${index}`].data[i] - expected),
      );
      maximumUnpatchedError = Math.max(
        maximumUnpatchedError,
        Math.abs(unpatched[`result.${index}`].data[i] - expected),
      );
    }
  }
  assert.ok(maximumPatchedError < 1e-5, `Patched norm error ${maximumPatchedError}`);
  assert.ok(maximumUnpatchedError > 1, 'The fixture must expose the missing-offset bug.');
  assert.deepEqual(Array.from(patched.gated.data), Array.from(unpatched.gated.data));
} finally {
  for (const tensor of tensors) tensor.dispose();
  for (const output of [...Object.values(unpatched ?? {}), ...Object.values(patched ?? {})])
    output.dispose();
}
const report = {
  modelRevision: MODEL_REVISION,
  normalizationRevision: NORMALIZATION_REVISION,
  sourceGraphSha256: unchangedSourceHash,
  repairedGraphSha256: sha256(repairedSource),
  repairedNormalizationCount: normSpecs.length,
  maximumPatchedError,
  maximumUnpatchedError,
  gatedNormalizationUnchanged: true,
  cachedSourceUnchanged: true,
  scope:
    'Actual CPU arithmetic and pinned graph/cache repair only; no Tev1 quality or WebGPU parity claim.',
};
await writeFile(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
