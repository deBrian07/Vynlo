import { describe, expect, it } from 'vitest';
import { repairTev1Normalization } from '../../src/features/classification/browser/onnx-normalization';

const encode = new TextEncoder();
const decode = new TextDecoder();
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
function int(value: number): Uint8Array {
  const bytes: number[] = [];
  do {
    bytes.push((value % 128) | (value >= 128 ? 128 : 0));
    value = Math.floor(value / 128);
  } while (value);
  return Uint8Array.from(bytes);
}
const number = (field: number, value: number) => join(int(field * 8), int(value));
const binary = (field: number, value: Uint8Array) =>
  join(int(field * 8 + 2), int(value.length), value);
const text = (field: number, value: string) => binary(field, encode.encode(value));
function fields(bytes: Uint8Array): { number: number; value: Uint8Array }[] {
  const output: { number: number; value: Uint8Array }[] = [];
  let i = 0;
  const read = () => {
    let v = 0,
      factor = 1,
      byte: number;
    do {
      byte = bytes[i++]!;
      v += (byte & 127) * factor;
      factor *= 128;
    } while (byte > 127);
    return v;
  };
  while (i < bytes.length) {
    const key = read();
    const wire = key % 8;
    const length = wire === 2 ? read() : wire === 5 ? 4 : wire === 1 ? 8 : 0;
    const start = i;
    if (wire === 0) read();
    else i += length;
    output.push({ number: Math.floor(key / 8), value: bytes.slice(start, i) });
  }
  return output;
}
const strings = (bytes: Uint8Array, field: number) =>
  fields(bytes)
    .filter((part) => part.number === field)
    .map((part) => decode.decode(part.value));
type Scale = { name: string; dimension: number; op: string };
function scales(): Scale[] {
  const result: Scale[] = [];
  for (let layer = 0; layer < 24; layer++) {
    for (const part of ['input_layernorm', 'post_attention_layernorm'])
      result.push({
        name: `model.layers.${layer}.${part}.weight`,
        dimension: 1024,
        op:
          layer === 0 && part === 'input_layernorm'
            ? 'SimplifiedLayerNormalization'
            : 'SkipSimplifiedLayerNormalization',
      });
    if (layer % 4 === 3)
      for (const part of ['q_norm', 'k_norm'])
        result.push({
          name: `model.layers.${layer}.attn.${part}.layernorm.weight`,
          dimension: 256,
          op: 'SimplifiedLayerNormalization',
        });
  }
  result.push({
    name: 'model.layers.24.final_norm_layernorm.weight',
    dimension: 1024,
    op: 'SkipSimplifiedLayerNormalization',
  });
  return result;
}
function initializer(
  scale: Scale,
  options: {
    dimension?: number;
    type?: number;
    externalFile?: string;
    offset?: string;
    length?: string;
    dataLocation?: number;
    extra?: Uint8Array;
  } = {},
) {
  return join(
    number(1, options.dimension ?? scale.dimension),
    number(2, options.type ?? 1),
    text(8, scale.name),
    ...Object.entries({
      location: options.externalFile ?? 'decoder_model_merged_q4f16.onnx_data',
      offset: options.offset ?? '0',
      length: options.length ?? String(scale.dimension * 4),
    }).map(([key, value]) => binary(13, join(text(1, key), text(2, value)))),
    number(14, options.dataLocation ?? 1),
    options.extra ?? new Uint8Array(),
  );
}
function node(
  scale: Scale,
  options: { domain?: string; op?: string; wrongInput?: boolean; extra?: Uint8Array } = {},
) {
  const op = options.op ?? scale.op;
  const inputs =
    scale.op === 'SkipSimplifiedLayerNormalization'
      ? ['hidden', 'residual', scale.name]
      : ['hidden', scale.name];
  if (options.wrongInput) inputs.reverse();
  return join(
    ...inputs.map((name) => text(1, name)),
    text(2, `result.${scale.name}`),
    text(3, `norm.${scale.name}`),
    text(4, op),
    text(7, options.domain ?? (scale.op === 'SimplifiedLayerNormalization' ? '' : 'com.microsoft')),
    options.extra ?? new Uint8Array(),
  );
}
function fixture(
  options: {
    scale?: Parameters<typeof initializer>[1];
    node?: Parameters<typeof node>[1];
    missing?: boolean;
    duplicate?: boolean;
    duplicateConsumer?: boolean;
    extraGraph?: Uint8Array;
  } = {},
) {
  const expected = scales();
  const nodes = expected.map((scale, i) => binary(1, node(scale, i === 0 ? options.node : {})));
  if (options.duplicateConsumer) nodes.push(binary(1, node(expected[0]!)));
  const initializers = expected
    .filter((_, i) => !(options.missing && i === 0))
    .map((scale, i) => binary(5, initializer(scale, i === 0 ? options.scale : {})));
  if (options.duplicate) initializers.push(binary(5, initializer(expected[0]!)));
  const gdn = join(
    number(1, 128),
    number(2, 1),
    text(8, 'model.layers.0.gdn.norm.weight'),
    binary(9, new Uint8Array(512)),
  );
  const gdnNode = join(
    text(1, 'hidden'),
    text(1, 'model.layers.0.gdn.norm.weight'),
    text(2, 'gdn.result'),
    text(3, 'gdn.norm'),
    text(4, 'Mul'),
  );
  const graph = join(
    ...nodes,
    binary(1, gdnNode),
    ...initializers,
    binary(5, gdn),
    text(2, 'synthetic61norms'),
    options.extraGraph ?? new Uint8Array(),
  );
  const unknown = join(int(199 * 8 + 1), Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8));
  return { bytes: join(number(1, 9), binary(7, graph), unknown), gdn, gdnNode, unknown };
}

describe('pinned Tev1 zero-centered normalization repair', () => {
  it('corrects exactly 61 scales immediately before consumers and leaves source scales and GDN untouched', () => {
    const f = fixture();
    const original = f.bytes.slice();
    const repaired = repairTev1Normalization(f.bytes);
    expect(f.bytes).toEqual(original);
    const model = fields(repaired);
    expect(repaired.slice(-f.unknown.length)).toEqual(f.unknown);
    const graph = fields(model.find((field) => field.number === 7)!.value);
    const nodes = graph.filter((field) => field.number === 1).map((field) => field.value);
    expect(nodes).toHaveLength(123);
    expect(nodes.filter((value) => strings(value, 4)[0] === 'Add')).toHaveLength(61);
    for (const [i, scale] of scales().entries()) {
      const add = nodes[i * 2]!;
      const norm = nodes[i * 2 + 1]!;
      const output = `vynlo.normalization.${scale.name}.scale`;
      expect(strings(add, 1)).toEqual([scale.name, 'vynlo.normalization.one']);
      expect(strings(add, 2)).toEqual([output]);
      expect(strings(norm, 1)).toContain(output);
      expect(strings(norm, 1)).not.toContain(scale.name);
      expect(strings(norm, 4)).toEqual([scale.op]);
    }
    expect(nodes.at(-1)).toEqual(f.gdnNode);
    const initializers = graph.filter((field) => field.number === 5).map((field) => field.value);
    expect(initializers).toHaveLength(63);
    for (const scale of scales())
      expect(initializers.find((value) => strings(value, 8)[0] === scale.name)).toEqual(
        initializer(scale),
      );
    expect(initializers).toContainEqual(f.gdn);
    const one = initializers.find((value) => strings(value, 8)[0] === 'vynlo.normalization.one')!;
    expect(fields(one).filter((field) => field.number === 1)).toHaveLength(0);
    expect(fields(one).find((field) => field.number === 9)!.value).toEqual(
      Uint8Array.of(0, 0, 128, 63),
    );
  });
  it('preserves unknown protobuf fields inside modified nodes and the graph', () => {
    const unknown = join(int(200 * 8 + 5), Uint8Array.of(3, 2, 1, 0));
    const f = fixture({ node: { extra: unknown }, extraGraph: unknown });
    const graph = fields(
      fields(repairTev1Normalization(f.bytes)).find((part) => part.number === 7)!.value,
    );
    const norm = graph.filter((part) => part.number === 1)[1]!.value;
    expect(norm.slice(-unknown.length)).toEqual(unknown);
    expect(graph.find((part) => part.number === 200)?.value).toEqual(Uint8Array.of(3, 2, 1, 0));
  });
  it.each([
    { scale: { dimension: 1023 } },
    { scale: { type: 10 } },
    { scale: { externalFile: '../bad.bin' } },
    { scale: { length: '4095' } },
    { scale: { offset: '-1' } },
    { scale: { offset: '1' } },
    { scale: { offset: '424038400' } },
    { scale: { dataLocation: 0 } },
    { scale: { extra: binary(9, new Uint8Array(4096)) } },
    { node: { wrongInput: true } },
    { node: { domain: 'untrusted' } },
    { node: { op: 'Mul' } },
    { missing: true },
    { duplicate: true },
    { duplicateConsumer: true },
  ])('rejects an unexpected scale or consumer layout: %j', (options) => {
    expect(() => repairTev1Normalization(fixture(options).bytes)).toThrow('could not be verified');
  });
  it('rejects repeated repairs and reserved-name collisions', () => {
    expect(() => repairTev1Normalization(repairTev1Normalization(fixture().bytes))).toThrow(
      'could not be verified',
    );
    const collision = binary(11, text(1, 'vynlo.normalization.one'));
    expect(() => repairTev1Normalization(fixture({ extraGraph: collision }).bytes)).toThrow(
      'could not be verified',
    );
  });
  it.each([
    new Uint8Array(),
    Uint8Array.of(0),
    Uint8Array.of(0x3a, 0x7f, 1),
    Uint8Array.of(0x3a, 0x80),
    Uint8Array.of(0x3a, 0x01, 0xff),
    new Uint8Array(2_000_001),
    Uint8Array.of(0x0b, 0x0c),
  ])('fails closed for malformed or oversized protobufs', (bytes) => {
    expect(() => repairTev1Normalization(bytes)).toThrow('could not be verified');
  });
});
