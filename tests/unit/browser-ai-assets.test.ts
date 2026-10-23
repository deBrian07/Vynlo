import { describe, expect, it, vi } from 'vitest';
import {
  createModelAssets,
  MODEL_DOWNLOAD_BYTES,
  TEXT_ASSETS,
} from '../../src/features/classification/browser/assets';
import {
  MODEL_CACHE,
  MODEL_REPO,
  MODEL_REVISION,
} from '../../src/features/classification/browser/model';

const base = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/`;
const marker = 'https://vynlo.invalid/cache/model-complete';
function storageFixture() {
  const stored = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string) => stored.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      // Consume streams so tests also exercise truncation, quota and cancellation failures.
      const body = await response.arrayBuffer();
      stored.set(key, new Response(body, { headers: response.headers }));
    }),
    delete: vi.fn(async (key: string) => stored.delete(key)),
  };
  const storage = {
    open: vi.fn(async () => cache),
    delete: vi.fn(async () => {
      stored.clear();
      return true;
    }),
  } as unknown as CacheStorage;
  return { stored, cache, storage };
}
const seedFiles = (stored: Map<string, Response>) => {
  // Metadata-only cache fixtures avoid allocating 946 MB in unit tests.
  for (const asset of TEXT_ASSETS)
    stored.set(
      base + asset.path,
      new Response('fixture', { headers: { 'X-Vynlo-Asset-Bytes': String(asset.maxBytes) } }),
    );
};
describe('pinned browser model cache', () => {
  it('pins only text model files, without vision or executable downloads', () => {
    expect(TEXT_ASSETS).toHaveLength(9);
    expect(TEXT_ASSETS.some((asset) => /vision|\.js$|\.wasm$/.test(asset.path))).toBe(false);
    expect(MODEL_DOWNLOAD_BYTES).toBe(946078454);
    expect(
      TEXT_ASSETS.filter((asset) => asset.path.endsWith('_data')).every(
        (asset) => 'sha256' in asset && asset.sha256.length === 64,
      ),
    ).toBe(true);
  });
  it('does not call a partially cached model ready until the final completion marker exists', async () => {
    const f = storageFixture();
    seedFiles(f.stored);
    const assets = createModelAssets({ cacheStorage: f.storage, fetcher: vi.fn() });
    expect((await assets.status()).state).toBe('not-downloaded');
    await assets.download(new AbortController().signal);
    expect((await assets.status()).state).toBe('cached');
    expect(f.stored.has(marker)).toBe(true);
  });
  it('never fetches network resources during inference and rejects unpinned requests', async () => {
    const f = storageFixture();
    seedFiles(f.stored);
    const fetcher = vi.fn();
    const assets = createModelAssets({ cacheStorage: f.storage, fetcher });
    await assets.download(new AbortController().signal);
    expect((await assets.fetch(base + 'config.json')).ok).toBe(true);
    await expect(
      assets.fetch(base.replace(MODEL_REVISION, 'main') + 'config.json'),
    ).rejects.toThrow('unapproved');
    await expect(assets.fetch('https://example.com/weights')).rejects.toThrow('unapproved');
    await expect(
      assets.fetch(base + 'config.json', { method: 'POST', body: 'mail content' }),
    ).rejects.toThrow('unapproved');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('streams exact-size files but never marks an interrupted download complete', async () => {
    const f = storageFixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Uint8Array(3198)))
      .mockRejectedValueOnce(new Error('Offline'));
    const assets = createModelAssets({ cacheStorage: f.storage, fetcher });
    await expect(assets.download(new AbortController().signal)).rejects.toThrow();
    expect(f.stored.has(base + 'config.json')).toBe(true);
    expect(f.stored.has(marker)).toBe(false);
    expect((await assets.status()).downloadedBytes).toBe(3198);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  });
  it.each([10, 3200])('rejects a truncated or oversized stream (%i bytes)', async (size) => {
    const f = storageFixture();
    const assets = createModelAssets({
      cacheStorage: f.storage,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(size))),
    });
    await expect(assets.download(new AbortController().signal)).rejects.toThrow('download failed');
    expect(f.stored.has(base + 'config.json')).toBe(false);
    expect(f.stored.has(marker)).toBe(false);
  });
  it('rejects a redirect outside approved model hosts before caching its response', async () => {
    const f = storageFixture();
    const response = new Response(new Uint8Array(3198));
    Object.defineProperty(response, 'url', { value: 'https://untrusted.example/model' });
    const assets = createModelAssets({
      cacheStorage: f.storage,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response),
    });
    await expect(assets.download(new AbortController().signal)).rejects.toThrow('verified');
    expect(f.cache.put).not.toHaveBeenCalled();
  });
  it('honors cancellation without requesting any more files', async () => {
    const f = storageFixture();
    const fetcher = vi.fn();
    const signal = new AbortController();
    signal.abort();
    const assets = createModelAssets({ cacheStorage: f.storage, fetcher });
    await expect(assets.download(signal.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect((await assets.status()).state).toBe('not-downloaded');
  });
  it.each([true, false])(
    'checks decoded size even if CORS hides compression metadata (%s)',
    async (exposeEncoding) => {
      const f = storageFixture();
      seedFiles(f.stored);
      f.stored.delete(base + 'config.json');
      const assets = createModelAssets({
        cacheStorage: f.storage,
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(new Uint8Array(3198), {
            headers: {
              'Content-Length': '1200',
              ...(exposeEncoding ? { 'Content-Encoding': 'gzip' } : {}),
            },
          }),
        ),
      });
      await assets.download(new AbortController().signal);
      expect((await assets.status()).state).toBe('cached');
    },
  );
  it('reports insufficient quota before starting a large download', async () => {
    const f = storageFixture();
    const fetcher = vi.fn();
    const assets = createModelAssets({
      cacheStorage: f.storage,
      fetcher,
      estimateStorage: async () => ({ quota: MODEL_DOWNLOAD_BYTES, usage: 1 }),
    });
    await expect(assets.download(new AbortController().signal)).rejects.toThrow(
      'more browser storage',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect((await assets.status()).state).toBe('not-downloaded');
  });
  it('only needs quota for missing files when resuming', async () => {
    const f = storageFixture();
    seedFiles(f.stored);
    f.stored.delete(base + 'config.json');
    const assets = createModelAssets({
      cacheStorage: f.storage,
      estimateStorage: async () => ({ quota: 4000, usage: 802 }),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(3198))),
    });
    await assets.download(new AbortController().signal);
    expect((await assets.status()).state).toBe('cached');
  });
  it('allows clearing only the dedicated model cache', async () => {
    const f = storageFixture();
    const assets = createModelAssets({ cacheStorage: f.storage, fetcher: vi.fn() });
    await assets.clear();
    expect(f.storage.delete).toHaveBeenCalledWith(MODEL_CACHE);
  });
});
