import { DEFAULT_SETTINGS } from '../../types/model';
import { validFullBackup } from './crypto';
import type { FullBackup, RecoveryTrackingRecord } from './types';

const DATABASE = 'vynlo-open-tracking';
const CONNECTION_KEY = 'trackingConnection';
type Addons = FullBackup['addons'];
type Tracking = NonNullable<NonNullable<Addons>['openTracking']>;
function assertAddon(addons: Addons): void {
  if (
    !validFullBackup({
      format: 'vynlo-workspace-backup',
      version: 1,
      workspace: {
        schemaVersion: 1,
        exportedAt: 0,
        settings: DEFAULT_SETTINGS,
        accounts: [],
        conversations: [],
        reminders: [],
        snippets: [],
        contacts: [],
      },
      ...(addons ? { addons } : {}),
    })
  )
    throw new Error(
      'Tracking recovery data could not be verified. No tracking records were changed.',
    );
}
function open(create: boolean): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE);
    request.onupgradeneeded = () => {
      if (!create) {
        request.transaction!.abort();
        return;
      }
      request.result
        .createObjectStore('records', { keyPath: 'id' })
        .createIndex('accountId', 'accountId');
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      if (db.version !== 1 || !db.objectStoreNames.contains('records')) {
        db.close();
        reject(new Error('Tracking storage uses an unsupported version.'));
        return;
      }
      const store = db.transaction('records').objectStore('records');
      if (
        store.keyPath !== 'id' ||
        !store.indexNames.contains('accountId') ||
        store.index('accountId').keyPath !== 'accountId'
      ) {
        db.close();
        reject(new Error('Tracking storage has an unsupported schema.'));
        return;
      }
      resolve(db);
    };
    request.onerror = () => reject(new Error('Tracking storage could not be opened.'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other Vynlo tabs and try again.'));
    };
  });
}
async function connection(): Promise<Tracking['connection']> {
  const values = await chrome.storage.local.get(CONNECTION_KEY);
  const candidate: unknown = values[CONNECTION_KEY];
  if (candidate === undefined) return undefined;
  assertAddon({ openTracking: { records: [], connection: candidate as Tracking['connection'] } });
  return structuredClone(candidate) as Tracking['connection'];
}
/** Never creates the tracking database on a build that has never used tracking. */
export async function readTrackingAddon(): Promise<Addons> {
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === DATABASE)) return undefined;
  const db = await open(false);
  try {
    const records = await new Promise<RecoveryTrackingRecord[]>((resolve, reject) => {
      const tx = db.transaction('records');
      const request = tx.objectStore('records').getAll();
      tx.oncomplete = () => resolve(request.result as RecoveryTrackingRecord[]);
      tx.onabort = tx.onerror = () => reject(new Error('Tracking history could not be read.'));
    });
    const config = await connection();
    const addons: Addons = { openTracking: { records, ...(config ? { connection: config } : {}) } };
    assertAddon(addons);
    return structuredClone(addons);
  } finally {
    db.close();
  }
}
/** Merge capabilities without replacing current records or granting network access. */
export async function restoreTrackingAddon(addons: Addons): Promise<void> {
  assertAddon(addons);
  const incoming = addons?.openTracking;
  if (!incoming) return;
  const existingConfig = await connection();
  const db = await open(true);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const store = tx.objectStore('records');
      const request = store.getAll();
      let failure: Error | undefined;
      request.onsuccess = () => {
        try {
          const existing = request.result as RecoveryTrackingRecord[];
          assertAddon({ openTracking: { records: existing } });
          const byId = new Map(existing.map((record) => [record.id, record]));
          for (const record of incoming.records) {
            const current = byId.get(record.id);
            if (
              current &&
              ['accountId', 'endpoint', 'readToken', 'deleteToken'].some(
                (key) =>
                  current[key as keyof RecoveryTrackingRecord] !==
                  record[key as keyof RecoveryTrackingRecord],
              )
            )
              throw new Error(
                'Tracking recovery conflicts with an existing record. No tracking records were changed.',
              );
          }
          for (const record of incoming.records)
            if (!byId.has(record.id)) store.add(structuredClone(record));
        } catch (error) {
          failure = error instanceof Error ? error : new Error('Tracking recovery failed.');
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(failure ?? new Error('Tracking history could not be restored.'));
    });
    // A journaled retry is safe if storage.local fails after the IndexedDB commit.
    if (!existingConfig && incoming.connection) {
      const latestConfig = await connection();
      if (!latestConfig)
        await chrome.storage.local.set({ [CONNECTION_KEY]: structuredClone(incoming.connection) });
    }
  } finally {
    db.close();
  }
}
