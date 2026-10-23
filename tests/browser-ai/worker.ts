import { createBrowserEngine } from '../../src/features/classification/browser/engine';

const engine = createBrowserEngine({
  onProgress: (status) => self.postMessage({ type: 'progress', status }),
});
interface BenchmarkGpu {
  requestAdapter(options: { powerPreference: string }): Promise<{
    info?: Record<string, unknown>;
    features: { has(name: string): boolean };
    limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
  } | null>;
}
async function adapterInfo() {
  const gpu = (navigator as Navigator & { gpu?: BenchmarkGpu }).gpu;
  const adapter = await gpu?.requestAdapter({ powerPreference: 'low-power' });
  if (!adapter) return null;
  const info = adapter.info;
  return {
    vendor: info?.vendor ?? null,
    architecture: info?.architecture ?? null,
    device: info?.device ?? null,
    description: info?.description ?? null,
    shaderF16: adapter.features.has('shader-f16'),
    maxBufferSize: adapter.limits?.maxBufferSize ?? null,
    maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize ?? null,
  };
}
self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = event.data as { id?: unknown; type?: unknown; subject?: unknown } | null;
  if (!request || typeof request.id !== 'string') return;
  const run = async () => {
    switch (request.type) {
      case 'check':
        await engine.check();
        return { status: await engine.status(), adapter: await adapterInfo() };
      case 'prepare':
        return { status: await engine.prepare(), adapter: await adapterInfo() };
      case 'infer': {
        if (typeof request.subject !== 'string') throw new Error('Synthetic subject is missing.');
        const prediction = await engine.infer(request.subject);
        return { prediction, status: await engine.status() };
      }
      default:
        throw new Error('Unknown benchmark operation.');
    }
  };
  void run().then(
    (data) => self.postMessage({ id: request.id, ok: true, data }),
    (error: unknown) =>
      self.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : 'The local model failed.',
      }),
  );
});
