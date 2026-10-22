import type { Backup } from '../../types/model';

/** Optional capabilities from the separate open-tracking feature, kept inside ciphertext. */
export interface RecoveryTrackingRecord {
  id: string;
  accountId: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  firstOpenedAt: number | null;
  lastOpenedAt: number | null;
  openCount: number;
  armedAt: number | null;
  endpoint: string;
  readToken: string;
  deleteToken: string;
}
export interface FullBackup {
  format: 'vynlo-workspace-backup';
  version: 1;
  workspace: Backup;
  addons?: {
    openTracking?: {
      records: RecoveryTrackingRecord[];
      connection?: { endpoint: string; secret: string };
    };
  };
}
export interface RecoveryKit {
  format: 'vynlo-recovery-kit';
  version: 1;
  endpoint: string;
  vaultId: string;
  secret: string;
}
export interface EncryptedBackup {
  format: 'vynlo-encrypted-backup';
  version: 1;
  algorithm: 'AES-GCM';
  iv: string;
  ciphertext: string;
  kdf?: { algorithm: 'PBKDF2'; iterations: 600000; salt: string };
}
