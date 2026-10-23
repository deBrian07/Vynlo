import type { TaggedConversation, UserCategory } from '../../features/classification/model';
import type { Account, Contact, Conversation, Reminder, Snippet } from '../../types/model';
import { DEFAULT_SETTINGS } from '../../types/model';
import { validBackup } from '../validation';

export interface Records {
  categories: UserCategory[];
  emailTags: TaggedConversation[];
  accounts: Account[];
  conversations: Conversation[];
  reminders: Reminder[];
  contacts: Contact[];
  snippets: Snippet[];
}
const TABLES = [
  'accounts',
  'conversations',
  'reminders',
  'contacts',
  'snippets',
  'emailTags',
  'categories',
] as const;
export const DATABASE_VERSION = 3;
export const emptyRecords = (): Records => ({
  categories: [],
  emailTags: [],
  accounts: [],
  conversations: [],
  reminders: [],
  contacts: [],
  snippets: [],
});
function assertRecords(records: Records): void {
  if (!validBackup({ ...records, settings: DEFAULT_SETTINGS, schemaVersion: 1, exportedAt: 0 }))
    throw new Error('Local data could not be verified. No records were changed.');
}
const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Local storage could not be read.'));
  });
const complete = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(new Error('Local storage could not be updated.'));
  });

/** Runs only in the extension origin. Version upgrades never delete existing stores. */
export class VynloDatabase {
  private connection?: Promise<IDBDatabase>;
  constructor(
    private name = 'vynlo',
    private factory: IDBFactory = indexedDB,
  ) {}
  private open(): Promise<IDBDatabase> {
    this.connection ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, DATABASE_VERSION);
      let abandoned = false;
      request.onupgradeneeded = () => {
        for (const name of TABLES) {
          if (!request.result.objectStoreNames.contains(name)) {
            const store = request.result.createObjectStore(name, { keyPath: 'id' });
            if (
              ['conversations', 'contacts', 'reminders', 'emailTags', 'categories'].includes(name)
            )
              store.createIndex('accountId', 'accountId');
            if (name === 'reminders') store.createIndex('conversationId', 'conversationId');
          }
        }
        if (!request.result.objectStoreNames.contains('metadata'))
          request.result.createObjectStore('metadata');
      };
      request.onsuccess = () => {
        if (abandoned) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => {
          request.result.close();
          this.connection = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        if (abandoned) return;
        this.connection = undefined;
        reject(new Error('Vynlo could not open local storage.'));
      };
      request.onblocked = () => {
        abandoned = true;
        this.connection = undefined;
        reject(new Error('Close other Vynlo pages and try again.'));
      };
    });
    return this.connection;
  }
  async read(accountId?: string | null): Promise<Records> {
    const db = await this.open();
    const tx = db.transaction(TABLES, 'readonly');
    const done = complete(tx);
    const values = await Promise.all(
      TABLES.map(async (name) => {
        const store = tx.objectStore(name);
        if (name === 'snippets' || accountId === undefined) return result(store.getAll());
        if (accountId === null) return [];
        if (name === 'accounts') {
          const account = await result(store.get(accountId));
          return account ? [account] : [];
        }
        return result(store.index('accountId').getAll(accountId));
      }),
    );
    await done;
    const records = Object.fromEntries(
      TABLES.map((name, i) => [name, values[i]]),
    ) as unknown as Records;
    assertRecords(records);
    return records;
  }
  async update(change: (records: Records) => void, pendingSettings?: unknown): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([...TABLES, 'metadata'], 'readwrite');
    const done = complete(tx);
    try {
      const values = await Promise.all(TABLES.map((name) => result(tx.objectStore(name).getAll())));
      const records = Object.fromEntries(
        TABLES.map((name, i) => [name, values[i]]),
      ) as unknown as Records;
      assertRecords(records);
      const before = structuredClone(records);
      change(records);
      assertRecords(records);
      for (const name of TABLES) {
        const store = tx.objectStore(name);
        const current = new Map(records[name].map((item) => [item.id, item]));
        const prior = new Map(before[name].map((item) => [item.id, JSON.stringify(item)]));
        for (const id of prior.keys()) if (!current.has(id)) store.delete(id);
        for (const [id, item] of current)
          if (JSON.stringify(item) !== prior.get(id)) store.put(item);
      }
      if (pendingSettings !== undefined)
        tx.objectStore('metadata').put(pendingSettings, 'pendingSettings');
    } catch (error) {
      tx.abort();
      await done.catch(() => undefined);
      throw error;
    }
    await done;
  }
  async pendingSettings(): Promise<unknown> {
    const db = await this.open();
    const tx = db.transaction('metadata', 'readonly');
    return result(tx.objectStore('metadata').get('pendingSettings'));
  }
  /** Inserts snippets only into an empty library, and only once per install. */
  async seedSnippets(snippets: Snippet[]): Promise<number> {
    if (
      snippets.length === 0 ||
      !validBackup({
        accounts: [],
        conversations: [],
        reminders: [],
        contacts: [],
        snippets,
        settings: DEFAULT_SETTINGS,
        schemaVersion: 1,
        exportedAt: 0,
      })
    )
      throw new Error('Starter snippets could not be verified.');
    const db = await this.open();
    const tx = db.transaction(['snippets', 'metadata'], 'readwrite');
    const done = complete(tx);
    try {
      const metadata = tx.objectStore('metadata');
      if (await result(metadata.get('snippetsSeeded'))) {
        await done;
        return 0;
      }
      const existing = await result<Snippet[]>(tx.objectStore('snippets').getAll());
      const added = existing.length === 0 ? snippets : [];
      for (const snippet of added) tx.objectStore('snippets').put(snippet);
      metadata.put(true, 'snippetsSeeded');
      await done;
      return added.length;
    } catch (error) {
      tx.abort();
      await done.catch(() => undefined);
      throw error;
    }
  }
  /** Explicit destructive reset also works when an individual record is corrupt. */
  async clear(pendingSettings: unknown): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([...TABLES, 'metadata'], 'readwrite');
    const done = complete(tx);
    for (const name of TABLES) tx.objectStore(name).clear();
    const metadata = tx.objectStore('metadata');
    metadata.clear();
    metadata.put(pendingSettings, 'pendingSettings');
    await done;
  }
  async finishSettings(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('metadata', 'readwrite');
    const done = complete(tx);
    tx.objectStore('metadata').delete('pendingSettings');
    await done;
  }
  async close(): Promise<void> {
    (await this.connection)?.close();
    this.connection = undefined;
  }
}
