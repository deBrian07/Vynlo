import { validFullBackup, validRecoveryKit } from './crypto';
import type { FullBackup, RecoveryKit } from './types';

export interface CloudConfig extends RecoveryKit {
  provision?: string;
  etag?: string;
  enabled: boolean;
  dirty: boolean;
  dirtySince?: number;
  lastSuccess?: number;
  error?: string;
  conflict?: boolean;
}
export interface RestorePreview {
  id: string;
  document: FullBackup;
  expiresAt: number;
  cloud?: CloudConfig;
}
export interface BackupState {
  version: 1;
  cloud?: CloudConfig;
  preview?: RestorePreview;
  pendingRestore?: RestorePreview;
  lastLocalExport?: number;
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8640000000000000;
const invalidState = () =>
  new Error(
    'Backup settings could not be verified. Existing data was preserved. Keep your recovery file and contact support.',
  );

async function validCloud(value: unknown): Promise<boolean> {
  if (
    !object(value) ||
    !onlyKeys(value, [
      'format',
      'version',
      'endpoint',
      'secret',
      'vaultId',
      'provision',
      'etag',
      'enabled',
      'dirty',
      'dirtySince',
      'lastSuccess',
      'error',
      'conflict',
    ]) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.dirty !== 'boolean' ||
    (value.dirtySince !== undefined && !timestamp(value.dirtySince)) ||
    (value.conflict !== undefined && typeof value.conflict !== 'boolean') ||
    (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 1000)) ||
    (value.lastSuccess !== undefined && !timestamp(value.lastSuccess)) ||
    (value.etag !== undefined &&
      (typeof value.etag !== 'string' || !/^"[a-zA-Z0-9_-]{1,128}"$/.test(value.etag))) ||
    (value.provision !== undefined &&
      (typeof value.provision !== 'string' || !/^[a-f0-9]{64}$/.test(value.provision)))
  )
    return false;
  // Recovery-kit validation deliberately rejects unknown fields. Validate just its
  // immutable identity, then validate the journal's additional fields above.
  return validRecoveryKit({
    format: value.format,
    version: value.version,
    endpoint: value.endpoint,
    secret: value.secret,
    vaultId: value.vaultId,
  });
}
async function validPreview(value: unknown): Promise<boolean> {
  return (
    object(value) &&
    onlyKeys(value, ['id', 'document', 'expiresAt', 'cloud']) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    value.id.length <= 100 &&
    timestamp(value.expiresAt) &&
    validFullBackup(value.document) &&
    (value.cloud === undefined || (await validCloud(value.cloud)))
  );
}
export async function validBackupState(value: unknown): Promise<boolean> {
  try {
    return (
      object(value) &&
      value.version === 1 &&
      onlyKeys(value, ['version', 'cloud', 'preview', 'pendingRestore', 'lastLocalExport']) &&
      (value.lastLocalExport === undefined || timestamp(value.lastLocalExport)) &&
      (value.cloud === undefined || (await validCloud(value.cloud))) &&
      (value.preview === undefined || (await validPreview(value.preview))) &&
      // A confirmed restore is replayed after a worker restart, even after the
      // original confirmation preview expired. Its full contents still validate.
      (value.pendingRestore === undefined || (await validPreview(value.pendingRestore)))
    );
  } catch {
    return false;
  }
}

/** Extension-owned journal survives worker suspension; never exposed to Gmail. */
export class BackupStateStore {
  private connection?: Promise<IDBDatabase>;
  constructor(
    private name = 'vynlo-backup-state',
    private factory: IDBFactory = indexedDB,
  ) {}
  private open() {
    return (this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const req = this.factory.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('state');
      req.onsuccess = () => {
        const db = req.result;
        if (blocked) {
          db.close();
          return;
        }
        if (!db.objectStoreNames.contains('state')) {
          db.close();
          this.connection = undefined;
          reject(invalidState());
          return;
        }
        db.onversionchange = () => {
          db.close();
          this.connection = undefined;
        };
        resolve(db);
      };
      req.onerror = () => {
        this.connection = undefined;
        reject(new Error('Backup settings could not be opened.'));
      };
      req.onblocked = () => {
        blocked = true;
        this.connection = undefined;
        reject(new Error('Close other Vynlo settings tabs and try again.'));
      };
    }));
  }
  async read(): Promise<BackupState> {
    const db = await this.open();
    const value: unknown = await new Promise((resolve, reject) => {
      const tx = db.transaction('state');
      const req = tx.objectStore('state').get('current');
      const failure = () => reject(new Error('Backup settings could not be read.'));
      req.onerror = failure;
      tx.onabort = tx.onerror = failure;
      tx.oncomplete = () => resolve(req.result);
    });
    if (value === undefined) return { version: 1 };
    if (!(await validBackupState(value))) throw invalidState();
    return value as BackupState;
  }
  async write(value: BackupState) {
    const snapshot = structuredClone(value);
    if (!(await validBackupState(snapshot))) throw invalidState();
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      const req = tx.objectStore('state').put(snapshot, 'current');
      const failure = () => reject(new Error('Backup settings could not be saved.'));
      req.onerror = failure;
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = failure;
    });
  }
}
