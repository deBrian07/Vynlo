// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  BackupStateStore,
  type BackupState,
  type CloudConfig,
} from '../../src/features/backups/state';
import { deriveVault } from '../../src/features/backups/crypto';
import { DEFAULT_SETTINGS } from '../../src/types/model';
import type { FullBackup } from '../../src/features/backups/types';

const document = (): FullBackup => ({
  format: 'vynlo-workspace-backup',
  version: 1,
  workspace: {
    schemaVersion: 1,
    exportedAt: 1,
    accounts: [],
    conversations: [],
    contacts: [],
    reminders: [],
    snippets: [],
    settings: structuredClone(DEFAULT_SETTINGS),
  },
});
async function cloud(): Promise<CloudConfig> {
  const secret = '1'.repeat(64);
  return {
    format: 'vynlo-recovery-kit',
    version: 1,
    endpoint: 'https://backups.owner.workers.dev',
    secret,
    vaultId: (await deriveVault(secret)).vaultId,
    provision: '2'.repeat(64),
    enabled: false,
    dirty: true,
    etag: '"revision_1"',
    lastSuccess: 1,
    conflict: false,
  };
}
async function raw(factory: IDBFactory, value?: unknown, write = false): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('test', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('state', write ? 'readwrite' : 'readonly');
      const req = write
        ? tx.objectStore('state').put(value, 'current')
        : tx.objectStore('state').get('current');
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

describe('persistent backup journal validation', () => {
  it('reads defaults and preserves a validated cloud state across service instances', async () => {
    const factory = new IDBFactory();
    const store = new BackupStateStore('test', factory);
    expect(await store.read()).toEqual({ version: 1 });
    const state: BackupState = { version: 1, cloud: await cloud(), lastLocalExport: 4 };
    await store.write(state);
    expect(await new BackupStateStore('test', factory).read()).toEqual(state);
  });

  it('replays a validated confirmed restore even after its preview expiry', async () => {
    const factory = new IDBFactory();
    const state: BackupState = {
      version: 1,
      pendingRestore: {
        id: 'confirmed-ticket',
        expiresAt: 0,
        document: document(),
        cloud: await cloud(),
      },
    };
    await new BackupStateStore('test', factory).write(state);
    expect((await new BackupStateStore('test', factory).read()).pendingRestore).toEqual(
      state.pendingRestore,
    );
  });

  it('rejects corrupted cloud capabilities, flags, revisions and unknown fields without removing evidence', async () => {
    const good = await cloud();
    const invalid = [
      { ...good, secret: 'not-a-secret' },
      { ...good, vaultId: '3'.repeat(64) },
      { ...good, provision: 'not-a-provision-key' },
      { ...good, enabled: 'true' },
      { ...good, dirty: 1 },
      { ...good, conflict: 'false' },
      { ...good, etag: 'unquoted' },
      { ...good, lastSuccess: -1 },
      { ...good, lastSuccess: Number.MAX_SAFE_INTEGER },
      { ...good, error: 'x'.repeat(1001) },
      { ...good, endpoint: 'https://evil.example' },
      { ...good, unexpected: true },
    ];
    for (const config of invalid) {
      const factory = new IDBFactory();
      const value = { version: 1, cloud: config };
      await raw(factory, value, true);
      await expect(new BackupStateStore('test', factory).read()).rejects.toThrow(
        'Existing data was preserved',
      );
      expect(await raw(factory)).toEqual(value);
    }
  });

  it('rejects corrupted restore documents and preview identity before replay', async () => {
    const good = { id: 'ticket', expiresAt: 3, document: document() };
    for (const value of [
      {
        version: 1,
        pendingRestore: {
          ...good,
          document: { format: 'vynlo-workspace-backup', version: 1, workspace: {} },
        },
      },
      {
        version: 1,
        pendingRestore: {
          ...good,
          document: { format: 'vynlo-encrypted-backup', ciphertext: 'unvalidated' },
        },
      },
      { version: 1, preview: { ...good, id: '' } },
      { version: 1, preview: { ...good, id: 'x'.repeat(101) } },
      { version: 1, preview: { ...good, expiresAt: NaN } },
      { version: 1, preview: { ...good, cloud: { ...(await cloud()), secret: 'invalid' } } },
      { version: 1, unexpected: true },
      { version: 2 },
      { version: 1, lastLocalExport: -1 },
      null,
    ]) {
      const factory = new IDBFactory();
      await raw(factory, value, true);
      await expect(new BackupStateStore('test', factory).read()).rejects.toThrow(
        'could not be verified',
      );
      expect(await raw(factory)).toEqual(value);
    }
  });

  it('refuses invalid writes and preserves the previously committed recovery journal', async () => {
    const factory = new IDBFactory();
    const store = new BackupStateStore('test', factory);
    const valid: BackupState = { version: 1, cloud: await cloud() };
    await store.write(valid);
    await expect(
      store.write({
        version: 1,
        cloud: { ...valid.cloud!, enabled: 'yes' },
      } as unknown as BackupState),
    ).rejects.toThrow('could not be verified');
    expect(await store.read()).toEqual(valid);
    await store.write({ version: 1 });
    expect(await store.read()).toEqual({ version: 1 });
  });
});
