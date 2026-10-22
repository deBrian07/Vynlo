import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readTrackingAddon, restoreTrackingAddon } from '../../src/features/backups/addons';
import type { RecoveryTrackingRecord } from '../../src/features/backups/types';

const name = 'vynlo-open-tracking';
const config = { endpoint: 'https://tracking.example.workers.dev', secret: 'A_secret_'.repeat(8) };
const record = (id = '1'.repeat(64)): RecoveryTrackingRecord => ({
  id,
  accountId: 'a@example.com',
  label: 'Private label',
  createdAt: 1,
  expiresAt: 100,
  firstOpenedAt: null,
  lastOpenedAt: null,
  openCount: 0,
  armedAt: null,
  endpoint: config.endpoint,
  readToken: '2'.repeat(64),
  deleteToken: '3'.repeat(64),
});
let values: Record<string, unknown>;
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  values = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (next: Record<string, unknown>) => {
          Object.assign(values, structuredClone(next));
        }),
      },
    },
  });
});
function create(version = 1, records: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () =>
      request.result
        .createObjectStore('records', { keyPath: 'id' })
        .createIndex('accountId', 'accountId');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('records', 'readwrite');
      for (const r of records) tx.objectStore('records').put(r);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
describe('optional tracking recovery bridge', () => {
  it('does not create a database when tracking is absent', async () => {
    expect(await readTrackingAddon()).toBeUndefined();
    expect(await indexedDB.databases()).toEqual([]);
    expect(chrome.storage.local.get).toHaveBeenCalledWith('trackingConnection');
    await restoreTrackingAddon(undefined);
    expect(await indexedDB.databases()).toEqual([]);
  });
  it('preserves setup before the first tracked email creates a database', async () => {
    values.trackingConnection = config;
    expect(await readTrackingAddon()).toEqual({
      openTracking: { records: [], connection: config },
    });
    expect(await indexedDB.databases()).toEqual([]);
  });
  it('preserves private records and only the known connection key', async () => {
    await create(1, [record()]);
    values = { trackingConnection: config, unrelatedSecret: 'never read' };
    const addon = await readTrackingAddon();
    expect(addon).toEqual({ openTracking: { records: [record()], connection: config } });
    expect(chrome.storage.local.get).toHaveBeenCalledWith('trackingConnection');
    expect(JSON.stringify(addon)).not.toContain('never read');
  });
  it('restores on a clean install and safely replays without overwriting local updates', async () => {
    await restoreTrackingAddon({ openTracking: { records: [record()], connection: config } });
    const updated = { ...record(), label: 'Existing label' };
    await create(1, [updated]);
    await restoreTrackingAddon({
      openTracking: { records: [record(), record('4'.repeat(64))], connection: config },
    });
    const result = await readTrackingAddon();
    expect(result?.openTracking?.records).toHaveLength(2);
    expect(result?.openTracking?.records.find((r) => r.id === updated.id)?.label).toBe(
      'Existing label',
    );
    expect(values.trackingConnection).toEqual(config);
  });
  it('keeps current connection configuration', async () => {
    values.trackingConnection = { ...config, endpoint: 'https://current.example.workers.dev' };
    await restoreTrackingAddon({ openTracking: { records: [record()], connection: config } });
    expect(values.trackingConnection).toEqual({
      ...config,
      endpoint: 'https://current.example.workers.dev',
    });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
  it('aborts all record writes for an identity or capability conflict', async () => {
    for (const changed of [
      { accountId: 'b@example.com' },
      { endpoint: 'https://other.example.workers.dev' },
      { readToken: '5'.repeat(64) },
      { deleteToken: '6'.repeat(64) },
    ]) {
      vi.stubGlobal('indexedDB', new IDBFactory());
      await create(1, [record()]);
      await expect(
        restoreTrackingAddon({
          openTracking: { records: [record('7'.repeat(64)), { ...record(), ...changed }] },
        }),
      ).rejects.toThrow('conflicts');
      expect((await readTrackingAddon())?.openTracking?.records).toEqual([record()]);
    }
  });
  it('rejects corrupted incoming and existing data and unknown database versions', async () => {
    await expect(
      restoreTrackingAddon({ openTracking: { records: [{ ...record(), readToken: 'bad' }] } }),
    ).rejects.toThrow('verified');
    expect(await indexedDB.databases()).toEqual([]);
    await create(1, [{ ...record(), accountId: 'not an account' }]);
    await expect(readTrackingAddon()).rejects.toThrow('verified');
    await expect(restoreTrackingAddon({ openTracking: { records: [record()] } })).rejects.toThrow(
      'verified',
    );
    vi.stubGlobal('indexedDB', new IDBFactory());
    await create(2);
    await expect(readTrackingAddon()).rejects.toThrow('unsupported version');
    await expect(restoreTrackingAddon({ openTracking: { records: [] } })).rejects.toThrow(
      'unsupported version',
    );
  });
  it('rejects malformed stored connection without silently discarding it', async () => {
    await create();
    values.trackingConnection = { ...config, secret: 'bad' };
    await expect(readTrackingAddon()).rejects.toThrow('verified');
    await expect(
      restoreTrackingAddon({ openTracking: { records: [record()], connection: config } }),
    ).rejects.toThrow('verified');
    expect(values.trackingConnection).toEqual({ ...config, secret: 'bad' });
  });
});
