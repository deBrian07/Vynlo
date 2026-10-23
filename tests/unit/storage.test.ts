import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { starterSnippets } from '../../src/features/snippets/starters';
import { VynloDatabase } from '../../src/services/storage/database';
import { DEFAULT_SETTINGS } from '../../src/types/model';

describe('versioned local database', () => {
  it('creates version one stores and preserves data across reconnects', async () => {
    const factory = new IDBFactory();
    const db = new VynloDatabase('persist', factory);
    await db.update((r) =>
      r.accounts.push({ id: 'a@example.com', email: 'a@example.com', createdAt: 1 }),
    );
    await db.close();
    const reopened = new VynloDatabase('persist', factory);
    expect((await reopened.read()).accounts).toHaveLength(1);
    await reopened.close();
  });
  it('rolls back an entire failed change', async () => {
    const db = new VynloDatabase('rollback', new IDBFactory());
    await expect(
      db.update((r) => {
        r.accounts.push({ id: 'a@example.com', email: 'a@example.com', createdAt: 1 });
        throw new Error('stop');
      }),
    ).rejects.toThrow();
    expect((await db.read()).accounts).toEqual([]);
    await db.close();
  });
  it('persists the settings recovery journal atomically with records', async () => {
    const db = new VynloDatabase('journal', new IDBFactory());
    await db.update(
      (r) => r.accounts.push({ id: 'a@example.com', email: 'a@example.com', createdAt: 1 }),
      { theme: 'dark' },
    );
    await db.close();
    expect(await db.pendingSettings()).toEqual({ theme: 'dark' });
    await db.finishSettings();
    expect(await db.pendingSettings()).toBeUndefined();
    await db.close();
  });
  it('does not erase corrupt records on read and supports an explicit reset', async () => {
    const factory = new IDBFactory();
    const db = new VynloDatabase('corruption', factory);
    await db.read();
    await db.close();
    const connection = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open('corruption');
      request.onsuccess = () => resolve(request.result);
    });
    const tx = connection.transaction('conversations', 'readwrite');
    tx.objectStore('conversations').put({
      id: 'broken',
      accountId: 'a@example.com',
      url: 'javascript:bad',
    });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    connection.close();
    await expect(db.read()).rejects.toThrow('could not be verified');
    await db.clear({});
    expect((await db.read()).conversations).toEqual([]);
    await db.close();
  });
  it('seeds an empty snippet library once and can seed again after a reset', async () => {
    const db = new VynloDatabase('seed', new IDBFactory());
    const starters = starterSnippets(10);
    expect(await db.seedSnippets(starters)).toBe(6);
    expect(await db.seedSnippets(starterSnippets(10))).toBe(0);
    expect((await db.read()).snippets.map((snippet) => snippet.id).sort()).toEqual(
      starters.map((snippet) => snippet.id).sort(),
    );
    await expect(db.seedSnippets([{ ...starters[0]!, title: '' }])).rejects.toThrow(
      'could not be verified',
    );
    await db.clear(DEFAULT_SETTINGS);
    expect(await db.seedSnippets(starterSnippets(11))).toBe(6);
    await db.close();
  });
});

it('recovers a blocked schema upgrade after the older page closes', async () => {
  const factory = new IDBFactory();
  const request = factory.open('blocked-upgrade', 2);
  request.onupgradeneeded = () => request.result.createObjectStore('accounts', { keyPath: 'id' });
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const database = new VynloDatabase('blocked-upgrade', factory);
  try {
    await expect(database.read()).rejects.toThrow('Close other Vynlo pages and try again.');
    old.close();
    expect((await database.read()).categories).toEqual([]);
    await database.update((records) =>
      records.accounts.push({ id: 'a@example.com', email: 'a@example.com', createdAt: 1 }),
    );
    expect((await database.read()).accounts).toHaveLength(1);
  } finally {
    old.close();
    await database.close();
  }
});
