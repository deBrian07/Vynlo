import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { VynloDatabase } from '../../src/services/storage/database';
import { createBackgroundHandler, type BackgroundPlatform } from '../../src/services/background';
import { DEFAULT_SETTINGS, type Backup, type Settings } from '../../src/types/model';
import { starterSnippets } from '../../src/features/snippets/starters';

it('preserves the existing version-one workspace and preferences through an extension update', async () => {
  const factory = new IDBFactory();
  let preferences: Settings = structuredClone(DEFAULT_SETTINGS);
  const platform: BackgroundPlatform = {
    extensionId: 'test',
    getSettings: async () => preferences,
    setSettings: async (value) => {
      preferences = value;
    },
    setAlarm: vi.fn(async () => {}),
    clearAlarm: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    clearNotification: vi.fn(async () => {}),
    openTab: vi.fn(async () => {}),
    openOptions: vi.fn(async () => {}),
  };
  const sender = { id: 'test', url: 'chrome-extension://test/options.html' };
  const database = new VynloDatabase('existing-install', factory);
  let service = createBackgroundHandler({
    database,
    platform,
    now: () => 100,
    seedSnippets: starterSnippets,
  });
  for (const accountId of ['a@example.com', 'b@example.com']) {
    const ref = {
      accountId,
      threadId: 'abcdef1234567890',
      title: 'Private reference',
      url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountId)}#all/abcdef1234567890`,
    };
    expect(
      (
        await service.handle(
          { type: 'track', ref, status: 'waiting', note: 'Keep this note' },
          sender,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await service.handle(
          {
            type: 'remind',
            accountId,
            conversationId: `${accountId}:abcdef1234567890`,
            dueAt: 10000,
          },
          sender,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await service.handle(
          {
            type: 'save-contact',
            contact: {
              accountId,
              email: 'friend@example.com',
              name: 'Friend',
              note: 'Existing contact',
              tags: ['test'],
            },
          },
          sender,
        )
      ).ok,
    ).toBe(true);
  }
  await service.handle(
    { type: 'settings', settings: { ...preferences, theme: 'dark', reminderHours: 48 } },
    sender,
  );
  const before = await service.handle({ type: 'export' }, sender);
  await database.close();
  service = createBackgroundHandler({
    database: new VynloDatabase('existing-install', factory),
    platform,
    now: () => 101,
    seedSnippets: starterSnippets,
  });
  // The production onInstalled handler reconciles; it does not clear or recreate databases.
  await service.reconcile();
  const after = await service.handle({ type: 'export' }, sender);
  expect(before.ok && after.ok).toBe(true);
  if (!before.ok || !after.ok) throw new Error('Export failed');
  const a = after.data as Backup,
    b = before.data as Backup;
  for (const key of [
    'accounts',
    'conversations',
    'contacts',
    'reminders',
    'snippets',
    'settings',
  ] as const)
    expect(a[key]).toEqual(b[key]);
  expect(a.conversations).toHaveLength(2);
  expect(a.reminders).toHaveLength(2);
  expect(a.snippets).toHaveLength(6);
  expect(a.settings.theme).toBe('dark');
  expect(platform.setAlarm).toHaveBeenLastCalledWith(10000);
});
