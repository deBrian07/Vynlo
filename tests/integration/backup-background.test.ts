// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createBackupService } from '../../src/features/backups/service';
import type { MessageSender } from '../../src/services/background';
import type { Response as CoreResponse } from '../../src/types/messages';
import type { Snapshot } from '../../src/types/model';
import { BackupStateStore } from '../../src/features/backups/state';
import { deriveVault } from '../../src/features/backups/crypto';

const control = vi.hoisted(() => ({
  service: undefined as ReturnType<typeof createBackupService> | undefined,
}));
vi.mock('wxt/utils/define-background', () => ({
  defineBackground: (callback: () => void) => callback,
}));
vi.mock('../../src/features/backups/service', async (original) => {
  const actual = await original<typeof import('../../src/features/backups/service')>();
  return {
    ...actual,
    createBackupService: (...args: Parameters<typeof actual.createBackupService>) => {
      control.service = actual.createBackupService(...args);
      return control.service;
    },
  };
});

const trusted = { id: 'extension', url: 'chrome-extension://extension/options.html' };
const gmail = {
  id: 'extension',
  url: 'https://mail.google.com/mail/u/0/',
  frameId: 0,
  tab: { id: 1 },
};
const ref = {
  accountId: 'a@example.com',
  threadId: 'abcdef1234567890',
  title: 'Persisted reference',
  url: 'https://mail.google.com/mail/?authuser=a%40example.com#all/abcdef1234567890',
};
type MessageListener = (
  message: unknown,
  sender: MessageSender,
  respond: (value: unknown) => void,
) => boolean;
function chromeFixture() {
  const stored: Record<string, unknown> = {};
  const messages: MessageListener[] = [];
  const startups: (() => void)[] = [];
  const installs: (() => void)[] = [];
  const alarms: ((alarm: { name: string }) => void)[] = [];
  const chrome = {
    runtime: {
      id: 'extension',
      getURL: (path: string) => `chrome-extension://extension${path}`,
      openOptionsPage: vi.fn(async () => {}),
      onMessage: { addListener: (fn: MessageListener) => messages.push(fn) },
      onStartup: { addListener: (fn: () => void) => startups.push(fn) },
      onInstalled: { addListener: (fn: () => void) => installs.push(fn) },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(stored, structuredClone(values));
        }),
        setAccessLevel: vi.fn(async () => {}),
      },
    },
    alarms: {
      create: vi.fn(async () => {}),
      clear: vi.fn(async () => true),
      onAlarm: { addListener: (fn: (alarm: { name: string }) => void) => alarms.push(fn) },
    },
    notifications: {
      create: vi.fn(async () => 'id'),
      clear: vi.fn(async () => true),
      onClicked: { addListener: vi.fn() },
    },
    permissions: { contains: vi.fn(async () => false) },
    tabs: { create: vi.fn(async () => ({})) },
  };
  const send = <T = CoreResponse>(message: unknown, sender: MessageSender = trusted): Promise<T> =>
    new Promise((resolve) => {
      if (!messages[0]) throw new Error('Production message listener was not registered.');
      expect(messages[0](message, sender, (response) => resolve(response as T))).toBe(true);
    });
  return { chrome, stored, send, startups, installs, alarms };
}
let env: ReturnType<typeof chromeFixture>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules();
  control.service = undefined;
  vi.stubGlobal('indexedDB', new IDBFactory());
  env = chromeFixture();
  vi.stubGlobal('chrome', env.chrome);
  fetcher = vi.fn(async () => {
    throw new Error('Unexpected network request');
  });
  vi.stubGlobal('fetch', fetcher);
  const module = await import('../../entrypoints/background');
  (module.default as unknown as () => void)();
  await env.send({ type: 'snapshot' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
async function snapshot(): Promise<Snapshot> {
  const response = await env.send({ type: 'snapshot' });
  if (!response.ok) throw new Error(response.error);
  return response.data as Snapshot;
}

describe('production background backup wiring', () => {
  it('starts local-only, protects storage, and routes backup requests away from Gmail', async () => {
    expect(env.chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    expect(await env.send({ type: 'backup-status' })).toMatchObject({
      ok: true,
      data: { configured: false, automatic: false },
    });
    expect(await env.send({ type: 'backup-recovery-file' }, gmail)).toMatchObject({ ok: false });
    expect(
      await env.send({ type: 'backup-export-file', password: 'not for Gmail pages' }, gmail),
    ).toMatchObject({ ok: false });
    env.alarms[0]?.({ name: 'vynlo-workspace-backup' });
    await env.send({ type: 'snapshot' });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await snapshot()).snippets).toHaveLength(6);
  });
  it('preserves a committed core mutation if optional backup scheduling fails', async () => {
    const changed = vi
      .spyOn(control.service!, 'changed')
      .mockRejectedValueOnce(new Error('backup journal unavailable'));
    const response = await env.send({
      type: 'track',
      ref,
      status: 'waiting',
      note: 'Keep this note',
    });
    expect(response.ok).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    expect((await snapshot()).conversations[0]).toMatchObject({
      note: 'Keep this note',
      status: 'waiting',
    });
  });
  it('retains conversations and settings through startup and extension updates', async () => {
    expect((await env.send({ type: 'track', ref, status: 'waiting' })).ok).toBe(true);
    const before = await snapshot();
    expect(
      (await env.send({ type: 'settings', settings: { ...before.settings, theme: 'dark' } })).ok,
    ).toBe(true);
    const reconcile = vi.spyOn(control.service!, 'changed');
    env.startups[0]?.();
    env.installs[0]?.();
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2));
    const after = await snapshot();
    expect(after.conversations).toEqual(before.conversations);
    expect(after.settings.theme).toBe('dark');
    expect(after.snippets.map((snippet) => snippet.id)).toEqual(
      before.snippets.map((snippet) => snippet.id),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('clears backup configuration only for a trusted clear request', async () => {
    expect((await env.send({ type: 'track', ref, status: 'waiting' })).ok).toBe(true);
    const secret = 'b'.repeat(64);
    const { vaultId } = await deriveVault(secret);
    await new BackupStateStore().write({
      version: 1,
      cloud: {
        format: 'vynlo-recovery-kit',
        version: 1,
        endpoint: 'https://backup.example.workers.dev',
        vaultId,
        secret,
        enabled: false,
        dirty: true,
      },
    });
    const beforeClear = vi.spyOn(control.service!, 'beforeClear');
    expect((await env.send({ type: 'clear' }, gmail)).ok).toBe(false);
    expect(beforeClear).not.toHaveBeenCalled();
    expect(await env.send({ type: 'backup-status' })).toMatchObject({
      ok: true,
      data: { configured: true },
    });
    expect((await snapshot()).conversations).toHaveLength(1);
    expect((await env.send({ type: 'clear' })).ok).toBe(true);
    expect(beforeClear).toHaveBeenCalledOnce();
    expect((await snapshot()).conversations).toHaveLength(0);
    expect(await env.send({ type: 'backup-status' })).toMatchObject({
      ok: true,
      data: { configured: false, automatic: false },
    });
    expect(env.chrome.alarms.clear).toHaveBeenCalledWith('vynlo-workspace-backup');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
