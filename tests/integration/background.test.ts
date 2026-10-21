import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBackgroundHandler,
  senderKind,
  type BackgroundPlatform,
} from '../../src/services/background';
import { VynloDatabase } from '../../src/services/storage/database';
import {
  DEFAULT_SETTINGS,
  type Backup,
  type ConversationRef,
  type Snapshot,
} from '../../src/types/model';
import { conversationId, reminderId } from '../../src/services/validation';
const accountA = 'a@example.com';
const accountB = 'b@example.com';
const threadId = 'abcdef1234567890';
const ref = (accountId = accountA): ConversationRef => ({
  accountId,
  threadId,
  title: 'Test conversation',
  url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountId)}#all/${threadId}`,
});
const trusted = { id: 'extension', url: 'chrome-extension://extension/options.html' };
const gmail = {
  id: 'extension',
  url: 'https://mail.google.com/mail/u/0/',
  frameId: 0,
  tab: { id: 1 },
};
let clock: number;
let platform: BackgroundPlatform;
let database: VynloDatabase;
let service: ReturnType<typeof createBackgroundHandler>;
beforeEach(() => {
  clock = 1000;
  let settings: unknown;
  platform = {
    extensionId: 'extension',
    getSettings: async () => settings,
    setSettings: async (v) => {
      settings = structuredClone(v);
    },
    setAlarm: vi.fn(async () => {}),
    clearAlarm: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    clearNotification: vi.fn(async () => {}),
    openTab: vi.fn(async () => {}),
    openOptions: vi.fn(async () => {}),
    publishRevision: vi.fn(async () => {}),
  };
  database = new VynloDatabase('test', new IDBFactory());
  service = createBackgroundHandler({ database, platform, now: () => clock });
});
const send = (m: unknown) => service.handle(m, trusted);
const snapshot = async (accountId?: string) => {
  const response = await service.handle({ type: 'snapshot', accountId }, gmail);
  if (!response.ok) throw new Error(response.error);
  return response.data as Snapshot;
};
describe('background persistence and isolation', () => {
  it('rejects page, subframe and foreign extension senders', async () => {
    expect(senderKind({ ...gmail, id: 'other' }, 'extension')).toBeNull();
    expect(senderKind({ ...gmail, frameId: 1 }, 'extension')).toBeNull();
    expect(senderKind({ ...gmail, url: 'https://evil.test/' }, 'extension')).toBeNull();
    expect((await service.handle({ type: 'clear' }, gmail)).ok).toBe(false);
    expect((await service.handle({ type: 'export' }, gmail)).ok).toBe(false);
  });
  it('isolates identical thread IDs across accounts and prevents cross-account deletion', async () => {
    await Promise.all([
      send({ type: 'track', ref: ref(), status: 'waiting' }),
      send({ type: 'track', ref: ref(accountB), status: 'needs-reply' }),
    ]);
    expect((await snapshot(accountA)).conversations.map((c) => c.status)).toEqual(['waiting']);
    expect((await snapshot(accountB)).conversations.map((c) => c.status)).toEqual(['needs-reply']);
    expect(
      (await send({ type: 'untrack', accountId: accountB, id: conversationId(accountA, threadId) }))
        .ok,
    ).toBe(false);
    expect((await snapshot()).conversations).toEqual([]);
    expect((await snapshot()).accounts).toEqual([]);
    const restarted = createBackgroundHandler({ database, platform, now: () => clock });
    const persisted = await restarted.handle({ type: 'snapshot', accountId: accountA }, gmail);
    expect(persisted.ok && (persisted.data as Snapshot).conversations).toHaveLength(1);
  });
  it('recovers overdue alarms once after worker restart and snoozes durably', async () => {
    await send({ type: 'track', ref: ref(), status: 'follow-up' });
    const id = conversationId(accountA, threadId);
    await send({ type: 'remind', accountId: accountA, conversationId: id, dueAt: 2000 });
    expect(platform.setAlarm).toHaveBeenLastCalledWith(2000);
    clock = 3000;
    service = createBackgroundHandler({ database, platform, now: () => clock });
    await service.reconcile();
    await service.reconcile();
    expect(platform.notify).toHaveBeenCalledTimes(1);
    expect((await snapshot(accountA)).reminders[0]?.state).toBe('due');
    await service.openReminder(reminderId(id));
    expect(platform.openTab).toHaveBeenCalledWith(ref().url);
    await send({
      type: 'reminder-action',
      accountId: accountA,
      id: reminderId(id),
      action: 'snooze',
      dueAt: 5000,
    });
    expect((await snapshot(accountA)).reminders[0]).toMatchObject({
      state: 'pending',
      dueAt: 5000,
      snoozeCount: 1,
    });
    clock = 6000;
    await service.reconcile();
    expect(platform.notify).toHaveBeenCalledTimes(2);
    await send({ type: 'track', ref: ref(), status: 'resolved' });
    expect((await snapshot(accountA)).reminders[0]?.state).toBe('dismissed');
    expect(platform.clearAlarm).toHaveBeenCalled();
  });
  it('remains due when notifications fail and does not repeatedly retry', async () => {
    await send({ type: 'track', ref: ref(), status: 'waiting' });
    await send({
      type: 'remind',
      accountId: accountA,
      conversationId: conversationId(accountA, threadId),
      dueAt: 2000,
    });
    vi.mocked(platform.notify).mockRejectedValue(new Error('permission denied'));
    clock = 3000;
    await service.reconcile();
    await service.reconcile();
    expect(platform.notify).toHaveBeenCalledTimes(1);
    expect((await snapshot(accountA)).reminders[0]?.state).toBe('due');
  });
  it('replaces scheduled times and cascades removals atomically', async () => {
    await send({ type: 'track', ref: ref(), status: 'waiting', note: 'Keep this note' });
    const id = conversationId(accountA, threadId);
    for (const dueAt of [2000, 4000])
      await send({ type: 'remind', accountId: accountA, conversationId: id, dueAt });
    expect((await snapshot(accountA)).reminders).toHaveLength(1);
    expect(platform.setAlarm).toHaveBeenLastCalledWith(4000);
    await send({ type: 'track', ref: ref(), status: 'follow-up' });
    expect((await snapshot(accountA)).conversations[0]?.note).toBe('Keep this note');
    await send({ type: 'untrack', accountId: accountA, id });
    expect((await snapshot(accountA)).reminders).toEqual([]);
  });
  it('round trips validated backups, keeps local edits, and rejects corrupt data', async () => {
    await send({ type: 'track', ref: ref(), status: 'waiting' });
    const exported = await send({ type: 'export' });
    if (!exported.ok) throw new Error('Export failed');
    const backup = exported.data as Backup;
    await send({ type: 'track', ref: ref(), status: 'resolved' });
    expect((await send({ type: 'import', backup })).ok).toBe(true);
    expect((await snapshot(accountA)).conversations[0]?.status).toBe('resolved');
    expect((await send({ type: 'import', backup: { ...backup, schemaVersion: 999 } })).ok).toBe(
      false,
    );
    await send({ type: 'clear' });
    expect((await snapshot(accountA)).conversations).toEqual([]);
    await send({ type: 'import', backup });
    expect((await snapshot(accountA)).conversations[0]?.status).toBe('waiting');
  });
  it('persists settings and restores defaults on clear', async () => {
    await send({ type: 'settings', settings: { ...DEFAULT_SETTINGS, theme: 'dark' } });
    expect((await snapshot()).settings.theme).toBe('dark');
    await send({ type: 'clear' });
    expect((await snapshot()).settings).toEqual(DEFAULT_SETTINGS);
  });
  it('recovers imported settings after a storage write interruption', async () => {
    await send({ type: 'track', ref: ref(), status: 'waiting' });
    const result = await send({ type: 'export' });
    if (!result.ok) throw new Error('Export failed');
    const backup = result.data as Backup;
    backup.settings.theme = 'dark';
    const original = platform.setSettings;
    platform.setSettings = vi.fn(async () => {
      throw new Error('interrupted');
    });
    expect((await send({ type: 'import', backup })).ok).toBe(false);
    expect(await database.pendingSettings()).toMatchObject({ theme: 'dark' });
    platform.setSettings = original;
    service = createBackgroundHandler({ database, platform, now: () => clock });
    await service.reconcile();
    expect((await snapshot()).settings.theme).toBe('dark');
    expect(await database.pendingSettings()).toBeUndefined();
  });
  it('rejects scheduling on a resolved conversation and cross-account snoozes', async () => {
    await send({ type: 'track', ref: ref(), status: 'waiting' });
    const id = conversationId(accountA, threadId);
    await send({ type: 'remind', accountId: accountA, conversationId: id, dueAt: 2000 });
    expect(
      (
        await send({
          type: 'reminder-action',
          accountId: accountB,
          id: reminderId(id),
          action: 'snooze',
          dueAt: 3000,
        })
      ).ok,
    ).toBe(false);
    await send({ type: 'track', ref: ref(), status: 'resolved' });
    expect(
      (await send({ type: 'remind', accountId: accountA, conversationId: id, dueAt: 3000 })).ok,
    ).toBe(false);
  });
});
