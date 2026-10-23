/** Repair only the verified zero-centered RMSNorm scales in the pinned Tev1 conversion.
 * The caller must verify DECODER_SOURCE_SHA256 before invoking this transform.
 * Original scale bytes remain untouched; explicit Add(1) nodes restore Qwen's semantics.
 */
export const NORMALIZATION_REVISION = 'qwen-zero-centered-rmsnorm-v1';
export const DECODER_SOURCE_SHA256 =
  'c66a37bf893eaf8b9adefce72c8d09801e2048d44cfafbb54ff1d0573de7bd40';

const ERROR = 'The local AI model normalization layout could not be verified.';
const PREFIX = 'vynlo.normalization.';
const ONE = `${PREFIX}one`;
const EXTERNAL_FILE = 'decoder_model_merged_q4f16.onnx_data';
const MAX_GRAPH_BYTES = 2_000_000;
const MAX_FIELDS = 100_000;
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

interface Field {
  number: number;
  wire: number;
  raw: Uint8Array;
  payload: Uint8Array;
  integer?: number;
}
function fail(): never {
  throw new Error(ERROR);
}
function readVarint(bytes: Uint8Array, start: number): [number, number] {
  let value = 0;
  let factor = 1;
  for (let i = start; i < bytes.length && i < start + 8; i++) {
    const byte = bytes[i]!;
    value += (byte & 0x7f) * factor;
    if (!Number.isSafeInteger(value)) fail();
    if (byte < 128) return [value, i + 1];
    factor *= 128;
  }
  return fail();
}
function parse(bytes: Uint8Array): Field[] {
  const fields: Field[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (fields.length >= MAX_FIELDS) fail();
    const start = offset;
    const [key, next] = readVarint(bytes, offset);
    offset = next;
    const number = Math.floor(key / 8);
    const wire = key % 8;
    if (number < 1 || number > 536_870_911) fail();
    let integer: number | undefined;
    let payloadStart = offset;
    if (wire === 0) {
      [integer, offset] = readVarint(bytes, offset);
    } else if (wire === 2) {
      const [length, position] = readVarint(bytes, offset);
      payloadStart = position;
      offset = position + length;
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
    } else {
      // Deprecated groups and unsupported encodings are not used by this model.
      fail();
    }
    if (offset > bytes.length) fail();
    fields.push({
      number,
      wire,
      raw: bytes.subarray(start, offset),
      payload: bytes.subarray(payloadStart, offset),
      integer,
    });
  }
  return fields;
}
function select(fields: Field[], number: number): Field[] {
  return fields.filter((field) => field.number === number);
}
function single(fields: Field[], number: number, wire: number): Field {
  const selected = select(fields, number);
  if (selected.length !== 1 || selected[0]!.wire !== wire) fail();
  return selected[0]!;
}
function string(field: Field): string {
  if (field.wire !== 2 || field.payload.length > 4096) fail();
  return decoder.decode(field.payload);
}
function text(fields: Field[], number: number): string {
  return string(single(fields, number, 2));
}
function optionalText(fields: Field[], number: number): string {
  return select(fields, number).length ? text(fields, number) : '';
}
function concatenate(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  if (size > MAX_GRAPH_BYTES) fail();
  const output = new Uint8Array(size);
  let position = 0;
  for (const part of parts) {
    output.set(part, position);
    position += part.length;
  }
  return output;
}
function varint(value: number): Uint8Array {
  const bytes: number[] = [];
  do {
    bytes.push((value % 128) | (value >= 128 ? 128 : 0));
    value = Math.floor(value / 128);
  } while (value);
  return Uint8Array.from(bytes);
}
function binary(number: number, bytes: Uint8Array): Uint8Array {
  return concatenate([varint(number * 8 + 2), varint(bytes.length), bytes]);
}
function encodedText(number: number, value: string): Uint8Array {
  return binary(number, encoder.encode(value));
}
function targets(): Map<string, number> {
  const expected = new Map<string, number>();
  for (let layer = 0; layer < 24; layer++) {
    for (const part of ['input_layernorm', 'post_attention_layernorm'])
      expected.set(`model.layers.${layer}.${part}.weight`, 1024);
    if (layer % 4 === 3)
      for (const part of ['q_norm', 'k_norm'])
        expected.set(`model.layers.${layer}.attn.${part}.layernorm.weight`, 256);
  }
  expected.set('model.layers.24.final_norm_layernorm.weight', 1024);
  return expected;
}
function verifyScale(fields: Field[], dimension: number): void {
  const dims = select(fields, 1);
  if (
    dims.length !== 1 ||
    dims[0]!.wire !== 0 ||
    dims[0]!.integer !== dimension ||
    single(fields, 2, 0).integer !== 1 ||
    single(fields, 14, 0).integer !== 1 ||
    [4, 5, 6, 7, 9, 10, 11].some((field) => select(fields, field).length > 0)
  )
    fail();
  const bindings = new Map<string, string>();
  for (const binding of select(fields, 13)) {
    if (binding.wire !== 2) fail();
    const entry = parse(binding.payload);
    const key = text(entry, 1);
    if (bindings.has(key)) fail();
    bindings.set(key, text(entry, 2));
  }
  const offset = bindings.get('offset');
  if (
    bindings.size !== 3 ||
    bindings.get('location') !== EXTERNAL_FILE ||
    bindings.get('length') !== String(dimension * 4) ||
    offset === undefined ||
    !/^(0|[1-9]\d*)$/.test(offset) ||
    !Number.isSafeInteger(Number(offset)) ||
    Number(offset) % 4 !== 0 ||
    Number(offset) + dimension * 4 > 424_038_400
  )
    fail();
}
function repair(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_GRAPH_BYTES)
    fail();
  const model = parse(bytes);
  const graphField = single(model, 7, 2);
  const graph = parse(graphField.payload);
  const expected = targets();
  const initializers = select(graph, 5);
  const nodes = select(graph, 1);
  if (initializers.length > 2000 || nodes.length > 5000) fail();
  const names = new Set<string>();
  const verified = new Set<string>();
  for (const field of initializers) {
    if (field.wire !== 2) fail();
    const initializer = parse(field.payload);
    const name = text(initializer, 8);
    if (names.has(name) || name.startsWith(PREFIX)) fail();
    names.add(name);
    if (expected.has(name)) {
      verifyScale(initializer, expected.get(name)!);
      verified.add(name);
    }
  }
  if (verified.size !== expected.size) fail();

  const nodeFields = new Map<Field, Field[]>();
  const consumers = new Map<string, Field>();
  for (const field of nodes) {
    if (field.wire !== 2) fail();
    const node = parse(field.payload);
    nodeFields.set(field, node);
    const inputs = select(node, 1).map(string);
    const outputs = select(node, 2).map(string);
    const name = optionalText(node, 3);
    const op = text(node, 4);
    if ([name, ...inputs, ...outputs].some((value) => value.startsWith(PREFIX))) fail();
    for (const [index, input] of inputs.entries()) {
      if (!expected.has(input)) continue;
      const validIndex =
        op === 'SimplifiedLayerNormalization'
          ? 1
          : op === 'SkipSimplifiedLayerNormalization'
            ? 2
            : -1;
      const domain = op === 'SimplifiedLayerNormalization' ? '' : 'com.microsoft';
      if (index !== validIndex || optionalText(node, 7) !== domain || consumers.has(input)) fail();
      consumers.set(input, field);
    }
  }
  if (consumers.size !== expected.size) fail();
  // Avoid collisions with graph input/output/value names as well as nodes and initializers.
  for (const fieldNumber of [11, 12, 13])
    for (const info of select(graph, fieldNumber)) {
      if (info.wire !== 2 || text(parse(info.payload), 1).startsWith(PREFIX)) fail();
    }

  const repaired: Uint8Array[] = [];
  for (const field of graph) {
    const node = nodeFields.get(field);
    if (!node) {
      repaired.push(field.raw);
      continue;
    }
    const scale = select(node, 1)
      .map(string)
      .find((name) => expected.has(name));
    if (!scale) {
      repaired.push(field.raw);
      continue;
    }
    const outputName = `${PREFIX}${scale}.scale`;
    const add = concatenate([
      encodedText(1, scale),
      encodedText(1, ONE),
      encodedText(2, outputName),
      encodedText(3, `${PREFIX}${scale}`),
      encodedText(4, 'Add'),
    ]);
    repaired.push(binary(1, add));
    repaired.push(
      binary(
        1,
        concatenate(
          node.map((part) =>
            part.number === 1 && string(part) === scale ? encodedText(1, outputName) : part.raw,
          ),
        ),
      ),
    );
  }
  // TensorProto FLOAT scalar with raw little-endian IEEE754 1.0. Add broadcasts it.
  const one = concatenate([
    varint(2 * 8),
    varint(1),
    encodedText(8, ONE),
    binary(9, Uint8Array.of(0, 0, 128, 63)),
  ]);
  repaired.push(binary(5, one));
  const patchedGraph = binary(7, concatenate(repaired));
  return concatenate(model.map((field) => (field === graphField ? patchedGraph : field.raw)));
}

export function repairTev1Normalization(bytes: Uint8Array): Uint8Array {
  try {
    return repair(bytes);
  } catch {
    // Invalid UTF-8, malformed protobufs and unexpected layouts all fail closed.
    throw new Error(ERROR);
  }
}
