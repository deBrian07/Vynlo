import type { EncryptedBackup, RecoveryKit } from './types';
export interface ProtectionStatus {
  automatic: boolean;
  configured: boolean;
  endpoint?: string;
  lastSuccess?: number;
  lastLocalExport?: number;
  pending: boolean;
  conflict: boolean;
  error?: string;
  recoveryPending: boolean;
}
export interface PreviewSummary {
  ticket: string;
  exportedAt: number;
  conversations: number;
  reminders: number;
  contacts: number;
  snippets: number;
  accounts: number;
  tracking: number;
  source: 'file' | 'cloud';
}
export type BackupRequest =
  | { type: 'backup-status' }
  | { type: 'backup-export-file'; password: string }
  | { type: 'backup-preview-file'; file: unknown; password: string }
  | { type: 'backup-prepare-cloud'; endpoint: string; provision: string }
  | { type: 'backup-recovery-file' }
  | { type: 'backup-enable'; savedRecovery: true }
  | { type: 'backup-pause' }
  | { type: 'backup-now' }
  | { type: 'backup-preview-cloud'; kit: unknown }
  | { type: 'backup-resume-restore' }
  | { type: 'backup-restore'; ticket: string };
export type BackupData = ProtectionStatus | PreviewSummary | EncryptedBackup | RecoveryKit | null;
export type BackupResponse = { ok: true; data: BackupData } | { ok: false; error: string };
