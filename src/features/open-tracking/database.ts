import type { TrackingRecord } from './types';

/** Separate versioned store: capabilities never enter regular snapshots or JSON backups. */
export class TrackingDatabase {
  private connection?: Promise<IDBDatabase>;
  constructor(private name = 'vynlo-open-tracking') {}
  private open() {
    return (this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () =>
        req.result
          .createObjectStore('records', { keyPath: 'id' })
          .createIndex('accountId', 'accountId');
      req.onsuccess = () => {
        req.result.onversionchange = () => {
          req.result.close();
          this.connection = undefined;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        this.connection = undefined;
        reject(new Error('Open-tracking storage is unavailable.'));
      };
      req.onblocked = () => reject(new Error('Close other Vynlo tabs and try again.'));
    }));
  }
  async read(): Promise<TrackingRecord[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records');
      const req = tx.objectStore('records').getAll();
      tx.oncomplete = () => resolve(req.result as TrackingRecord[]);
      tx.onabort = () => reject(new Error('Tracking history could not be read.'));
    });
  }
  async put(record: TrackingRecord) {
    await this.write((store) => store.put(record));
  }
  async remove(id: string) {
    await this.write((store) => store.delete(id));
  }
  async clear() {
    await this.write((store) => store.clear());
  }
  private async write(action: (store: IDBObjectStore) => unknown) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      action(tx.objectStore('records'));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('Tracking history could not be saved.'));
    });
  }
}
