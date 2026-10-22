// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  handleBackupRequest,
  type BackupBucket,
  type BackupEnv,
} from '../../cloudflare-backups/src';
import { createBackupService, type BackupPlatform } from '../../src/features/backups/service';
import { BackupStateStore } from '../../src/features/backups/state';
import {
  decryptLocal,
  deriveVault,
  encryptLocal,
  encryptBackup,
} from '../../src/features/backups/crypto';
import type {
  BackupResponse,
  PreviewSummary,
  ProtectionStatus,
} from '../../src/features/backups/contracts';
import type { EncryptedBackup, FullBackup, RecoveryKit } from '../../src/features/backups/types';
import { DEFAULT_SETTINGS, type Backup } from '../../src/types/model';

const extensionId = 'test-extension';
const sender = { id: extensionId, url: `chrome-extension://${extensionId}/options.html` };
const endpoint = 'https://backup.example.workers.dev';
const provision = 'c'.repeat(64);
const password = 'my independent recovery password';
const time = 2_000_000_000_000;
function document(): FullBackup {
  return {
    format: 'vynlo-workspace-backup',
    version: 1,
    workspace: {
      schemaVersion: 1,
      exportedAt: time,
      accounts: [],
      conversations: [],
      contacts: [],
      reminders: [],
      snippets: [
        {
          id: 'sample-snippet',
          title: 'Private title',
          content: 'Private body',
          category: 'Private category',
          createdAt: time,
          updatedAt: time,
        },
      ],
      settings: structuredClone(DEFAULT_SETTINGS),
    },
    addons: {
      openTracking: {
        records: [
          {
            id: 'd'.repeat(64),
            accountId: 'jordan@example.com',
            label: 'Private tracking label',
            createdAt: time,
            expiresAt: time + 1_000_000,
            firstOpenedAt: null,
            lastOpenedAt: null,
            openCount: 0,
            armedAt: null,
            endpoint: 'https://tracking.example.workers.dev',
            readToken: 'e'.repeat(64),
            deleteToken: 'f'.repeat(64),
          },
        ],
      },
    },
  };
}
function value<T>(response: BackupResponse): T {
  if (!response.ok) throw new Error(response.error);
  return response.data as T;
}
function cloud() {
  const objects = new Map<
    string,
    { text: string; etag: string; metadata: Record<string, string> }
  >();
  let revision = 0;
  const bucket: BackupBucket = {
    get: vi.fn(async (key) => {
      const object = objects.get(key);
      return object
        ? {
            httpEtag: object.etag,
            size: Buffer.byteLength(object.text),
            customMetadata: object.metadata,
            body: new Blob([object.text]).stream(),
          }
        : null;
    }),
    put: vi.fn(async (key, text, options) => {
      const prior = objects.get(key);
      if (
        (options.onlyIf.get('If-None-Match') === '*' && prior) ||
        (options.onlyIf.has('If-Match') && options.onlyIf.get('If-Match') !== prior?.etag)
      )
        return null;
      const object = { text, etag: `"revision-${++revision}"`, metadata: options.customMetadata };
      objects.set(key, object);
      return { httpEtag: object.etag };
    }),
  };
  const env: BackupEnv = {
    BACKUPS: bucket,
    ADMIN_SECRET: provision,
    API_LIMITER: { limit: async () => ({ success: true }) },
  };
  const fetcher = vi.fn<typeof fetch>(async (input, init) =>
    handleBackupRequest(new Request(input, init), env),
  );
  return { objects, fetcher, bucket };
}
function fixture(server = cloud(), dbName = crypto.randomUUID()) {
  let workspace = document().workspace;
  let addons = document().addons;
  let currentTime = time;
  const store = new BackupStateStore(`backup-test-${dbName}`);
  const platform: BackupPlatform = {
    extensionId,
    readWorkspace: vi.fn(async () => structuredClone(workspace)),
    restoreWorkspace: vi.fn(async (backup: Backup) => {
      workspace = structuredClone(backup);
    }),
    readAddons: vi.fn(async () => structuredClone(addons)),
    restoreAddons: vi.fn(async (input) => {
      addons = structuredClone(input);
    }),
    hasPermission: vi.fn(async () => true),
    setAlarm: vi.fn(async () => {}),
    clearAlarm: vi.fn(async () => {}),
  };
  const service = createBackupService(platform, store, server.fetcher, () => currentTime);
  const call = (message: unknown) => service.handle(message, sender);
  async function prepare() {
    return value<RecoveryKit>(await call({ type: 'backup-prepare-cloud', endpoint, provision }));
  }
  async function enable() {
    const kit = await prepare();
    value(await call({ type: 'backup-enable', savedRecovery: true }));
    return kit;
  }
  return {
    server,
    dbName,
    store,
    platform,
    service,
    call,
    prepare,
    enable,
    workspace: () => workspace,
    addons: () => addons,
    advance: (ms: number) => {
      currentTime += ms;
    },
  };
}

describe('backup service with real encryption, persistent journal and Worker protocol', () => {
  it('starts completely disabled and never contacts a server on startup or changes', async () => {
    const f = fixture();
    await f.service.initialize();
    await f.service.changed();
    await f.service.process();
    const status = value<ProtectionStatus>(await f.call({ type: 'backup-status' }));
    expect(status).toMatchObject({ configured: false, automatic: false, pending: false });
    expect(f.server.fetcher).not.toHaveBeenCalled();
    expect(f.platform.clearAlarm).toHaveBeenCalled();
  });
  it('exports an encrypted local file and restores only after preview confirmation', async () => {
    const f = fixture();
    const file = value<EncryptedBackup>(await f.call({ type: 'backup-export-file', password }));
    expect(await decryptLocal(file, password)).toEqual(document());
    expect(JSON.stringify(file)).not.toContain('Private body');
    const summary = value<PreviewSummary>(
      await f.call({ type: 'backup-preview-file', file, password }),
    );
    expect(summary).toMatchObject({ snippets: 1, tracking: 1, source: 'file' });
    expect(f.platform.restoreWorkspace).not.toHaveBeenCalled();
    expect(f.platform.restoreAddons).not.toHaveBeenCalled();
    value(await f.call({ type: 'backup-restore', ticket: summary.ticket }));
    expect(f.workspace()).toEqual(document().workspace);
    expect(f.addons()).toEqual(document().addons);
    expect((await f.store.read()).pendingRestore).toBeUndefined();
    expect(f.server.fetcher).not.toHaveBeenCalled();
  });
  it('replays an interrupted confirmed restore after worker restart', async () => {
    const f = fixture();
    const file = await encryptLocal(document(), password);
    const summary = value<PreviewSummary>(
      await f.call({ type: 'backup-preview-file', file, password }),
    );
    vi.mocked(f.platform.restoreAddons).mockRejectedValueOnce(
      new Error('temporary addon storage failure'),
    );
    expect(await f.call({ type: 'backup-restore', ticket: summary.ticket })).toMatchObject({
      ok: false,
    });
    expect((await f.store.read()).pendingRestore?.document).toEqual(document());
    const restarted = fixture(f.server, f.dbName);
    await restarted.service.initialize();
    expect(restarted.platform.restoreWorkspace).toHaveBeenCalledOnce();
    expect(restarted.addons()).toEqual(document().addons);
    expect((await restarted.store.read()).pendingRestore).toBeUndefined();
    expect(value<ProtectionStatus>(await restarted.call({ type: 'backup-status' })).automatic).toBe(
      false,
    );
  });
  it('requires saved recovery confirmation and uploads only ciphertext', async () => {
    const f = fixture();
    const kit = await f.prepare();
    expect(f.server.bucket.put).not.toHaveBeenCalled();
    expect(await f.call({ type: 'backup-enable', savedRecovery: false })).toMatchObject({
      ok: false,
    });
    expect(await f.call({ type: 'backup-enable' })).toMatchObject({ ok: false });
    expect(f.server.bucket.put).not.toHaveBeenCalled();
    const status = value<ProtectionStatus>(
      await f.call({ type: 'backup-enable', savedRecovery: true }),
    );
    expect(status).toMatchObject({ automatic: true, pending: false, lastSuccess: time });
    const stored = f.server.objects.get(`vaults/${kit.vaultId}`)!;
    expect(JSON.parse(stored.text)).toMatchObject({ format: 'vynlo-encrypted-backup', version: 1 });
    for (const sensitive of [
      'Private body',
      'jordan@example.com',
      kit.secret,
      'Private tracking label',
      'readToken',
    ])
      expect(stored.text).not.toContain(sensitive);
    expect((await f.store.read()).cloud?.provision).toBeUndefined();
  });
  it('blocks backup changes while a confirmed restore is incomplete and resumes explicitly', async () => {
    const f = fixture();
    const kit = await f.enable();
    const file = await encryptLocal(document(), password);
    const summary = value<PreviewSummary>(
      await f.call({ type: 'backup-preview-file', file, password }),
    );
    vi.mocked(f.platform.restoreAddons).mockRejectedValueOnce(new Error('addon unavailable'));
    expect(await f.call({ type: 'backup-restore', ticket: summary.ticket })).toMatchObject({
      ok: false,
    });
    f.server.fetcher.mockClear();
    for (const message of [
      { type: 'backup-enable', savedRecovery: true },
      { type: 'backup-prepare-cloud', endpoint, provision },
      { type: 'backup-preview-file', file, password },
      { type: 'backup-preview-cloud', kit },
      { type: 'backup-now' },
    ])
      expect(await f.call(message)).toMatchObject({ ok: false });
    await expect(f.service.process()).rejects.toThrow('pending restore');
    expect(f.server.fetcher).not.toHaveBeenCalled();
    expect(value<ProtectionStatus>(await f.call({ type: 'backup-status' })).recoveryPending).toBe(
      true,
    );
    const resumed = value<ProtectionStatus>(await f.call({ type: 'backup-resume-restore' }));
    expect(resumed).toMatchObject({ recoveryPending: false, automatic: false });
    expect((await f.store.read()).pendingRestore).toBeUndefined();
    expect(f.platform.restoreWorkspace).toHaveBeenCalledTimes(2);
    expect(f.addons()).toEqual(document().addons);
  });
  it('anchors the daily backup deadline to the last upload across worker restarts', async () => {
    const f = fixture();
    await f.enable();
    const restarted = fixture(f.server, f.dbName);
    restarted.advance(6 * 60 * 60_000);
    f.server.fetcher.mockClear();
    await restarted.service.initialize();
    expect(restarted.platform.setAlarm).toHaveBeenLastCalledWith(time + 24 * 60 * 60_000);
    expect(f.server.fetcher).not.toHaveBeenCalled();
    restarted.advance(19 * 60 * 60_000);
    await restarted.service.initialize();
    expect(restarted.platform.setAlarm).toHaveBeenLastCalledWith(time + 25 * 60 * 60_000 + 60_000);
    expect(f.server.fetcher).not.toHaveBeenCalled();
    await restarted.service.process();
    expect(
      value<ProtectionStatus>(await restarted.call({ type: 'backup-status' })).lastSuccess,
    ).toBe(time + 25 * 60 * 60_000);
  });
  it('preserves dirty state when the server cannot confirm an upload revision', async () => {
    const f = fixture();
    await f.enable();
    await f.service.changed();
    f.server.fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ etag: '*' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await f.call({ type: 'backup-now' })).toMatchObject({ ok: false });
    expect((await f.store.read()).cloud).toMatchObject({
      dirty: true,
      enabled: true,
      etag: '"revision-1"',
    });
    expect(f.platform.setAlarm).toHaveBeenLastCalledWith(time + 15 * 60_000);
    f.server.fetcher.mockResolvedValueOnce(new Response('not JSON'));
    expect(await f.call({ type: 'backup-now' })).toMatchObject({ ok: false });
    expect((await f.store.read()).cloud?.dirty).toBe(true);
  });
  it('rejects unauthenticated cloud response schemas before creating a restore preview', async () => {
    const f = fixture();
    const kit = await f.enable();
    f.server.fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ plaintext: document() }), {
        headers: { ETag: '"revision-1"' },
      }),
    );
    expect(await f.call({ type: 'backup-preview-cloud', kit })).toMatchObject({ ok: false });
    expect((await f.store.read()).preview).toBeUndefined();
    f.server.fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }),
    );
    expect(await f.call({ type: 'backup-preview-cloud', kit })).toMatchObject({ ok: false });
    expect(f.platform.restoreWorkspace).not.toHaveBeenCalled();
  });
  it('recovers from a fresh extension store using the saved recovery file', async () => {
    const original = fixture();
    const kit = await original.enable();
    const reinstalled = fixture(original.server);
    const summary = value<PreviewSummary>(
      await reinstalled.call({ type: 'backup-preview-cloud', kit }),
    );
    expect(summary).toMatchObject({ source: 'cloud', snippets: 1, tracking: 1 });
    expect(reinstalled.platform.restoreWorkspace).not.toHaveBeenCalled();
    value(await reinstalled.call({ type: 'backup-restore', ticket: summary.ticket }));
    expect(reinstalled.workspace()).toEqual(document().workspace);
    expect(reinstalled.addons()).toEqual(document().addons);
    expect((await reinstalled.store.read()).cloud).toMatchObject({
      vaultId: kit.vaultId,
      enabled: false,
      etag: '"revision-1"',
    });
    value(await reinstalled.call({ type: 'backup-enable', savedRecovery: true }));
    expect(original.server.objects.get(`vaults/${kit.vaultId}`)?.etag).toBe('"revision-2"');
  });
  it('freezes stale clients instead of overwriting a newer cloud revision', async () => {
    const a = fixture();
    const kit = await a.enable();
    const b = fixture(a.server);
    const preview = value<PreviewSummary>(await b.call({ type: 'backup-preview-cloud', kit }));
    value(await b.call({ type: 'backup-restore', ticket: preview.ticket }));
    value(await b.call({ type: 'backup-enable', savedRecovery: true }));
    const newer = a.server.objects.get(`vaults/${kit.vaultId}`)?.text;
    await a.service.changed();
    expect(await a.call({ type: 'backup-now' })).toMatchObject({ ok: false });
    expect(value<ProtectionStatus>(await a.call({ type: 'backup-status' }))).toMatchObject({
      conflict: true,
      automatic: false,
      pending: true,
    });
    expect(a.server.objects.get(`vaults/${kit.vaultId}`)?.text).toBe(newer);
    expect(await a.call({ type: 'backup-enable', savedRecovery: true })).toMatchObject({
      ok: false,
    });
    expect(a.platform.clearAlarm).toHaveBeenCalled();
  });
  it('cancels restore replay before clearing without losing recovery credentials', async () => {
    const f = fixture();
    const kit = await f.enable();
    const state = await f.store.read();
    state.pendingRestore = { id: 'pending', document: document(), expiresAt: time + 60_000 };
    state.preview = state.pendingRestore;
    await f.store.write(state);
    await f.service.prepareClear();
    const retained = await f.store.read();
    expect(retained.cloud).toMatchObject({ enabled: false, secret: kit.secret });
    expect(retained.pendingRestore).toBeUndefined();
    expect(retained.preview).toBeUndefined();
    await f.service.initialize();
    expect(f.platform.restoreWorkspace).not.toHaveBeenCalled();
  });
  it('pauses and clears without any further uploads', async () => {
    const f = fixture();
    await f.enable();
    value(await f.call({ type: 'backup-pause' }));
    f.server.fetcher.mockClear();
    await f.service.changed();
    await f.service.process();
    await f.service.initialize();
    expect(f.server.fetcher).not.toHaveBeenCalled();
    await f.service.beforeClear();
    await f.service.changed();
    await f.service.process();
    expect(await f.store.read()).toEqual({ version: 1 });
    expect(f.server.fetcher).not.toHaveBeenCalled();
  });
  it('retains dirty state and schedules retry after a failed upload', async () => {
    const f = fixture();
    await f.enable();
    await f.service.changed();
    f.server.fetcher.mockRejectedValueOnce(new TypeError('offline'));
    expect(await f.call({ type: 'backup-now' })).toMatchObject({ ok: false });
    expect(value<ProtectionStatus>(await f.call({ type: 'backup-status' }))).toMatchObject({
      automatic: true,
      pending: true,
    });
    expect(f.platform.setAlarm).toHaveBeenLastCalledWith(time + 15 * 60_000);
    expect((await f.store.read()).cloud?.etag).toBe('"revision-1"');
    f.advance(15 * 60_000);
    await f.service.process();
    expect(value<ProtectionStatus>(await f.call({ type: 'backup-status' })).pending).toBe(false);
  });
  it('rejects wrong passwords, malformed recovery files and expired previews without writes', async () => {
    const f = fixture();
    const file = await encryptLocal(document(), password);
    expect(
      await f.call({ type: 'backup-preview-file', file, password: 'incorrect password' }),
    ).toMatchObject({ ok: false });
    expect(
      await f.call({
        type: 'backup-preview-cloud',
        kit: {
          endpoint,
          secret: 'f'.repeat(64),
          vaultId: 'a'.repeat(64),
          format: 'vynlo-recovery-kit',
          version: 1,
        },
      }),
    ).toMatchObject({ ok: false });
    const preview = value<PreviewSummary>(
      await f.call({ type: 'backup-preview-file', file, password }),
    );
    f.advance(11 * 60_000);
    expect(await f.call({ type: 'backup-restore', ticket: preview.ticket })).toMatchObject({
      ok: false,
    });
    expect(f.platform.restoreWorkspace).not.toHaveBeenCalled();
    expect(f.platform.restoreAddons).not.toHaveBeenCalled();
    expect(f.server.fetcher).not.toHaveBeenCalled();
  });
  it('refuses Gmail and foreign senders access to backups or recovery keys', async () => {
    const f = fixture();
    await f.enable();
    f.server.fetcher.mockClear();
    for (const invalidSender of [
      { id: extensionId, url: 'https://mail.google.com/mail/u/0/', frameId: 0, tab: { id: 3 } },
      { id: 'other-extension', url: `chrome-extension://${extensionId}/options.html` },
      { id: extensionId, url: `chrome-extension://${extensionId}/untrusted.html` },
    ])
      expect(await f.service.handle({ type: 'backup-recovery-file' }, invalidSender)).toMatchObject(
        { ok: false },
      );
    expect(f.server.fetcher).not.toHaveBeenCalled();
  });
  it('requires host permission before contacting the configured service', async () => {
    const f = fixture();
    vi.mocked(f.platform.hasPermission).mockResolvedValue(false);
    expect(await f.call({ type: 'backup-prepare-cloud', endpoint, provision })).toMatchObject({
      ok: false,
    });
    expect(f.server.fetcher).not.toHaveBeenCalled();
    expect((await f.store.read()).cloud).toBeUndefined();
  });
  it('restores neither invalid ciphertext nor a cloud envelope encrypted under another key', async () => {
    const f = fixture();
    const kit = await f.enable();
    const target = f.server.objects.get(`vaults/${kit.vaultId}`)!;
    const other = await deriveVault('a'.repeat(64));
    expect(
      await f.call({
        type: 'backup-preview-cloud',
        kit: { ...kit, secret: 'a'.repeat(64), vaultId: other.vaultId },
      }),
    ).toMatchObject({ ok: false });
    target.text = JSON.stringify(await encryptBackup(document(), 'a'.repeat(64)));
    expect(await f.call({ type: 'backup-preview-cloud', kit })).toMatchObject({ ok: false });
    const record = JSON.parse(target.text) as EncryptedBackup;
    record.ciphertext = 'A'.repeat(24);
    target.text = JSON.stringify(record);
    expect(await f.call({ type: 'backup-preview-cloud', kit })).toMatchObject({ ok: false });
    expect(f.platform.restoreWorkspace).not.toHaveBeenCalled();
    expect(f.platform.restoreAddons).not.toHaveBeenCalled();
  });
  it('does not postpone a queued backup indefinitely while edits continue', async () => {
    const f = fixture();
    await f.enable();
    await f.service.changed();
    const first = vi.mocked(f.platform.setAlarm).mock.calls.at(-1)?.[0];
    f.advance(30_000);
    await f.service.changed();
    expect(vi.mocked(f.platform.setAlarm).mock.calls.at(-1)?.[0]).toBe(first);
    f.advance(30_000);
    await f.service.process();
    expect((await f.store.read()).cloud?.dirty).toBe(false);
  });
});
