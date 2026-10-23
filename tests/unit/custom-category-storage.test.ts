import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
  isCategory,
  type UserCategory,
  type TaggedConversation,
} from '../../src/features/classification/model';
import { createBackgroundHandler } from '../../src/services/background';
import { emptyRecords, VynloDatabase } from '../../src/services/storage/database';
import { validBackup, validUserCategory } from '../../src/services/validation';
import { DEFAULT_SETTINGS, type Backup } from '../../src/types/model';

const accountId = 'a@example.com';
const category = (overrides: Partial<UserCategory> = {}): UserCategory => ({
  id: 'custom:00000000-0000-4000-8000-000000000001',
  accountId,
  name: 'University',
  description: 'Coursework and campus activities',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});
const tag = (categoryId = category().id): TaggedConversation => ({
  id: `${accountId}:1234567890abcdef`,
  accountId,
  threadId: '1234567890abcdef',
  title: 'Homework',
  url: `https://mail.google.com/mail/?authuser=${accountId}#all/1234567890abcdef`,
  category: categoryId,
  source: 'manual',
  reviewed: true,
  createdAt: 1,
  updatedAt: 1,
});
const backup = (): Backup => ({
  ...emptyRecords(),
  accounts: [{ id: accountId, email: accountId, createdAt: 1 }],
  categories: [category()],
  emailTags: [tag()],
  settings: DEFAULT_SETTINGS,
  schemaVersion: 1,
  exportedAt: 1,
});

function background(database: VynloDatabase) {
  return createBackgroundHandler({
    database,
    platform: {
      extensionId: 'test',
      getSettings: async () => DEFAULT_SETTINGS,
      setSettings: vi.fn(async () => {}),
      setAlarm: vi.fn(async () => {}),
      clearAlarm: vi.fn(async () => {}),
      notify: vi.fn(async () => {}),
      clearNotification: vi.fn(async () => {}),
      openTab: vi.fn(async () => {}),
      openOptions: vi.fn(async () => {}),
    },
  });
}
const trusted = { id: 'test', url: 'chrome-extension://test/options.html' };

describe('account-scoped custom category storage', () => {
  it('accepts bounded definitions and rejects malformed custom IDs', () => {
    expect(validUserCategory(category())).toBe(true);
    expect(isCategory(category().id)).toBe(true);
    for (const id of [
      'custom:arbitrary',
      'custom:00000000-0000-0000-0000-000000000001',
      'CUSTOM:00000000-0000-4000-8000-000000000001',
    ])
      expect(isCategory(id)).toBe(false);
    for (const changes of [
      { name: ' ' },
      { name: ' padded' },
      { name: 'x'.repeat(51) },
      { description: 'x'.repeat(161) },
      { accountId: 'A@example.com' },
      { updatedAt: 0 },
    ])
      expect(validUserCategory(category(changes))).toBe(false);
  });
  it('preserves version-two tags when adding the categories store', async () => {
    const factory = new IDBFactory();
    const connection = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open('migration', 2);
      request.onupgradeneeded = () => {
        for (const name of [
          'accounts',
          'conversations',
          'reminders',
          'contacts',
          'snippets',
          'emailTags',
        ]) {
          const store = request.result.createObjectStore(name, { keyPath: 'id' });
          if (!['accounts', 'snippets'].includes(name)) store.createIndex('accountId', 'accountId');
        }
        request.result.createObjectStore('metadata');
        request
          .transaction!.objectStore('accounts')
          .put({ id: accountId, email: accountId, createdAt: 1 });
        request.transaction!.objectStore('emailTags').put({ ...tag(), category: 'work' });
      };
      request.onsuccess = () => resolve(request.result);
    });
    connection.close();
    const database = new VynloDatabase('migration', factory);
    expect((await database.read()).categories).toEqual([]);
    expect((await database.read()).emailTags[0]?.category).toBe('work');
    await database.close();
  });
  it('isolates definitions by account and preserves custom tags across reconnects', async () => {
    const database = new VynloDatabase('scoped', new IDBFactory());
    await database.update((rows) => Object.assign(rows, backup()));
    await database.close();
    expect((await database.read(accountId)).categories).toEqual([category()]);
    expect((await database.read(accountId)).emailTags).toEqual([tag()]);
    expect((await database.read('b@example.com')).categories).toEqual([]);
    expect((await database.read(null)).categories).toEqual([]);
    await database.close();
  });
  it('rejects dangling and cross-account custom tags, duplicate names and excessive definitions', () => {
    expect(validBackup(backup())).toBe(true);
    const b = backup();
    for (const changes of [
      { categories: [] },
      {
        accounts: [...b.accounts, { id: 'b@example.com', email: 'b@example.com', createdAt: 1 }],
        categories: [category({ accountId: 'b@example.com' })],
      },
      {
        categories: [
          category(),
          category({ id: 'custom:00000000-0000-4000-8000-000000000002', name: 'university' }),
        ],
      },
      { categories: [category({ name: 'Work' })] },
      {
        categories: Array.from({ length: 17 }, (_, i) =>
          category({
            id: `custom:00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
            name: `Category ${i}`,
          }),
        ),
      },
    ])
      expect(validBackup({ ...b, ...changes })).toBe(false);
    const { categories: _categories, emailTags: _tags, ...old } = b;
    expect(validBackup(old)).toBe(true);
  });
  it('rolls back category deletion unless its dependent tags are removed together', async () => {
    const database = new VynloDatabase('atomic', new IDBFactory());
    await database.update((rows) => Object.assign(rows, backup()));
    await expect(
      database.update((rows) => {
        rows.categories = [];
      }),
    ).rejects.toThrow('verified');
    expect((await database.read()).categories).toHaveLength(1);
    await database.update((rows) => {
      rows.categories = [];
      rows.emailTags = [];
    });
    expect((await database.read()).categories).toEqual([]);
    await database.close();
  });
  it('merges duplicate names into local IDs and remaps imported tags without changing local definitions', async () => {
    const database = new VynloDatabase('merge', new IDBFactory());
    const local = category({
      id: 'custom:00000000-0000-4000-8000-000000000002',
      description: 'Local definition',
    });
    await database.update((rows) => {
      rows.accounts = backup().accounts;
      rows.categories = [local];
    });
    const service = background(database);
    expect((await service.handle({ type: 'import', backup: backup() }, trusted)).ok).toBe(true);
    expect((await service.handle({ type: 'import', backup: backup() }, trusted)).ok).toBe(true);
    expect((await database.read()).categories).toEqual([local]);
    expect((await database.read()).emailTags[0]?.category).toBe(local.id);
    await database.close();
  });
  it('fails closed on corrupt stored definitions and permits an explicit reset', async () => {
    const factory = new IDBFactory();
    const database = new VynloDatabase('corrupt-categories', factory);
    await database.update((rows) => Object.assign(rows, backup()));
    await database.close();
    const connection = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open('corrupt-categories');
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = connection.transaction('categories', 'readwrite');
    transaction.objectStore('categories').put(category({ name: '' }));
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
    });
    connection.close();
    await expect(database.read(accountId)).rejects.toThrow('verified');
    await expect(database.update(() => {})).rejects.toThrow('verified');
    await database.clear(DEFAULT_SETTINGS);
    expect(await database.read()).toEqual(emptyRecords());
    await database.close();
  });
  it('rejects cross-account category ID collisions without partially importing any data', async () => {
    const database = new VynloDatabase('conflict', new IDBFactory());
    await database.update((rows) => {
      rows.accounts = [{ id: 'b@example.com', email: 'b@example.com', createdAt: 1 }];
      rows.categories = [category({ accountId: 'b@example.com' })];
    });
    expect(
      (await background(database).handle({ type: 'import', backup: backup() }, trusted)).ok,
    ).toBe(false);
    expect((await database.read()).accounts.map((a) => a.id)).toEqual(['b@example.com']);
    expect((await database.read()).emailTags).toEqual([]);
    await database.close();
  });
  it('rejects an import exceeding the local account limit atomically', async () => {
    const database = new VynloDatabase('merge-limit', new IDBFactory());
    await database.update((rows) => {
      rows.accounts = backup().accounts;
      rows.categories = Array.from({ length: 16 }, (_, i) =>
        category({
          id: `custom:00000000-0000-4000-8000-${String(i + 2).padStart(12, '0')}`,
          name: `Existing ${i}`,
        }),
      );
    });
    const prior = await database.read();
    expect(
      (await background(database).handle({ type: 'import', backup: backup() }, trusted)).ok,
    ).toBe(false);
    expect(await database.read()).toEqual(prior);
    await database.close();
  });
  it('exports definitions alongside their learning examples for lossless restore', async () => {
    const database = new VynloDatabase('category-export', new IDBFactory());
    await database.update((rows) => Object.assign(rows, backup()));
    const response = await background(database).handle({ type: 'export' }, trusted);
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('Export failed');
    expect(validBackup(response.data)).toBe(true);
    expect(response.data).toMatchObject({ categories: [category()], emailTags: [tag()] });
    const restored = new VynloDatabase('category-restore', new IDBFactory());
    expect(
      (await background(restored).handle({ type: 'import', backup: response.data }, trusted)).ok,
    ).toBe(true);
    expect((await restored.read(accountId)).categories).toEqual([category()]);
    expect((await restored.read(accountId)).emailTags).toEqual([tag()]);
    await database.close();
    await restored.close();
  });
});
