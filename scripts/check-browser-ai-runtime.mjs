/**
 * Execute the actual packaged ONNX runtime under Node's ban on JavaScript
 * string compilation. This CPU Identity-model smoke test checks packaging and
 * initialization only; it does not validate WebGPU or Tev1 model execution.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (!process.execArgv.includes('--disallow-code-generation-from-strings'))
  throw new Error('Run this check with --disallow-code-generation-from-strings.');
const directory = new URL('../public/inference-runtime/', import.meta.url);
// Select the browser bundle's browser backend during import. Its WASM factory
// still uses Node's filesystem when it is loaded later by the smoke session.
const nodeProcess = globalThis.process;
let runtime;
try {
  globalThis.process = undefined;
  runtime = await import(new URL('runtime.js', directory).href);
} finally {
  globalThis.process = nodeProcess;
}
assert.equal(runtime.runtimeVersion, '4.3.1');
assert.equal(typeof runtime.AutoTokenizer?.from_pretrained, 'function');
assert.equal(typeof runtime.Qwen3_5ForCausalLM?.from_pretrained, 'function');
assert.equal(typeof runtime.InferenceSession?.create, 'function');
assert.equal(typeof runtime.Tensor, 'function');
// Float16 tensors can expose raw Uint16 bit patterns. The production classifier
// must decode them before comparing scores (14336 is the bits for 0.5, not a score).
const half = new runtime.Tensor('float16', new Uint16Array([14336, 48128, 49152]), [3]);
const decoded = half.to('float32');
assert.deepEqual(Array.from(decoded.data), [0.5, -1, -2]);
decoded.dispose();
half.dispose();

runtime.env.useWasmCache = false;
runtime.env.backends.onnx.wasm.numThreads = 1;
runtime.env.backends.onnx.wasm.proxy = false;
runtime.env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('ort-wasm-simd-threaded.asyncify.mjs', directory).href,
};
runtime.env.backends.onnx.wasm.wasmBinary = await readFile(
  fileURLToPath(new URL('ort-wasm-simd-threaded.asyncify.wasm', directory)),
);

// A tiny deterministic ONNX protobuf: float32[1] x -> Identity -> y.
// Construct it locally to avoid a network model or another protobuf dependency.
const varint = (value) => {
  const bytes = [];
  do {
    const byte = value & 127;
    value >>>= 7;
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
};
const message = (...parts) => Buffer.concat(parts);
const field = (number, bytes) => message(varint((number << 3) | 2), varint(bytes.length), bytes);
const integer = (number, value) => message(varint(number << 3), varint(value));
const string = (number, value) => field(number, Buffer.from(value));
const tensor = (name) =>
  message(
    string(1, name),
    field(2, field(1, message(integer(1, 1), field(2, field(1, integer(1, 1)))))),
  );
const graph = message(
  field(1, message(string(1, 'x'), string(2, 'y'), string(4, 'Identity'))),
  string(2, 'vynlo-packaged-runtime-smoke'),
  field(11, tensor('x')),
  field(12, tensor('y')),
);
const bytes = message(integer(1, 8), field(7, graph), field(8, integer(2, 13)));
const input = new runtime.Tensor('float32', new Float32Array([3]), [1]);
let session;
let outputs;
try {
  // Deliberately CPU only in this development smoke test. Production inference
  // still explicitly requires WebGPU and never falls back to a CPU model.
  session = await runtime.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  outputs = await session.run({ x: input.ort_tensor });
  assert.deepEqual(Array.from(outputs.y.data), [3]);
  console.log(
    'Packaged ONNX Identity inference passed with JavaScript string compilation disabled.',
  );
  console.log('This checks CPU runtime packaging, not WebGPU availability or Tev1 quality.');
} finally {
  input.dispose();
  for (const output of Object.values(outputs ?? {})) output.dispose();
  await session?.release();
}
