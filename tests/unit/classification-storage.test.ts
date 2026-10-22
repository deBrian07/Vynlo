import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { VynloDatabase } from '../../src/services/storage/database';
import { validBackup } from '../../src/services/validation';
import { DEFAULT_SETTINGS } from '../../src/types/model';
import type { TaggedConversation } from '../../src/features/classification/model';

const tag = (accountId = 'a@example.com'): TaggedConversation => ({
  id: `${accountId}:1234567890abcdef`,
  accountId,
  threadId: '1234567890abcdef',
  title: 'Project review',
  url: `https://mail.google.com/mail/?authuser=${accountId}#all/1234567890abcdef`,
  category: 'work',
  source: 'manual',
  reviewed: true,
  createdAt: 1,
  updatedAt: 1,
});

describe('email tag persistence', () => {
  it('migrates a version-one database without losing records', async () => {
    const factory = new IDBFactory();
    const old = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open('upgrade', 1);
      request.onupgradeneeded = () => {
        for (const name of ['accounts', 'conversations', 'contacts', 'reminders', 'snippets']) {
          const store = request.result.createObjectStore(name, { keyPath: 'id' });
          if (['conversations', 'contacts', 'reminders'].includes(name))
            store.createIndex('accountId', 'accountId');
          if (name === 'reminders') store.createIndex('conversationId', 'conversationId');
        }
        request.result.createObjectStore('metadata');
        request
          .transaction!.objectStore('accounts')
          .put({ id: 'a@example.com', email: 'a@example.com', createdAt: 1 });
      };
      request.onsuccess = () => resolve(request.result);
    });
    old.close();
    const database = new VynloDatabase('upgrade', factory);
    expect((await database.read()).accounts).toHaveLength(1);
    expect((await database.read()).emailTags).toEqual([]);
    await database.update((rows) => rows.emailTags.push(tag()));
    await database.close();
    expect((await database.read('a@example.com')).emailTags).toEqual([tag()]);
    await database.close();
  });
  it('isolates identical thread IDs across accounts and requires a known namespace', async () => {
    const database = new VynloDatabase('scope', new IDBFactory());
    await database.update((rows) => {
      for (const accountId of ['a@example.com', 'b@example.com']) {
        rows.accounts.push({ id: accountId, email: accountId, createdAt: 1 });
        rows.emailTags.push(tag(accountId));
      }
    });
    expect((await database.read('a@example.com')).emailTags).toEqual([tag()]);
    expect((await database.read('b@example.com')).emailTags).toEqual([tag('b@example.com')]);
    expect((await database.read(null)).emailTags).toEqual([]);
    await database.close();
  });
  it('accepts older backups but rejects duplicate, orphaned or forged tag records', async () => {
    const backup = {
      accounts: [{ id: 'a@example.com', email: 'a@example.com', createdAt: 1 }],
      conversations: [],
      contacts: [],
      reminders: [],
      snippets: [],
      settings: DEFAULT_SETTINGS,
      schemaVersion: 1,
      exportedAt: 1,
    };
    expect(validBackup(backup)).toBe(true);
    expect(validBackup({ ...backup, emailTags: [tag()] })).toBe(true);
    for (const emailTags of [
      [tag(), tag()],
      [tag('b@example.com')],
      [{ ...tag(), category: 'made-up' }],
      [{ ...tag(), url: 'https://evil.example' }],
      [{ ...tag(), source: 'model' }],
      [{ ...tag(), reviewed: false }],
    ]) {
      expect(validBackup({ ...backup, emailTags })).toBe(false);
    }
  });
});
