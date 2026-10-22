import type { BackupRequest, BackupResponse, PreviewSummary, ProtectionStatus } from './contracts';
import type { EncryptedBackup, RecoveryKit } from './types';
import { workerEndpoint } from './crypto';
async function send(message: BackupRequest) {
  let response: BackupResponse;
  try {
    response = (await chrome.runtime.sendMessage(message)) as BackupResponse;
  } catch {
    throw new Error('Vynlo could not connect. Reload settings and try again.');
  }
  if (!response || typeof response.ok !== 'boolean')
    throw new Error('Reload Vynlo to use data protection.');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
async function allow(endpoint: string) {
  const origin = workerEndpoint(endpoint);
  // Invoked synchronously by a click before the first await preserves the permission gesture.
  if (!(await chrome.permissions.request({ origins: [`${origin}/*`] })))
    throw new Error('Allow access to your backup service to continue.');
  return origin;
}
export const backupClient = {
  resumeRestore: async () => (await send({ type: 'backup-resume-restore' })) as ProtectionStatus,
  status: async () => (await send({ type: 'backup-status' })) as ProtectionStatus,
  exportFile: async (password: string) =>
    (await send({ type: 'backup-export-file', password })) as EncryptedBackup,
  previewFile: async (file: unknown, password: string) =>
    (await send({ type: 'backup-preview-file', file, password })) as PreviewSummary,
  prepareCloud: async (endpoint: string, provision: string) => {
    const origin = await allow(endpoint);
    return (await send({
      type: 'backup-prepare-cloud',
      endpoint: origin,
      provision,
    })) as RecoveryKit;
  },
  recoveryFile: async () => (await send({ type: 'backup-recovery-file' })) as RecoveryKit,
  enable: async () =>
    (await send({ type: 'backup-enable', savedRecovery: true })) as ProtectionStatus,
  pause: async () => (await send({ type: 'backup-pause' })) as ProtectionStatus,
  backupNow: async () => (await send({ type: 'backup-now' })) as ProtectionStatus,
  previewCloud: async (kit: unknown) => {
    if (!kit || typeof kit !== 'object' || !('endpoint' in kit) || typeof kit.endpoint !== 'string')
      throw new Error('Choose your Vynlo recovery file.');
    await allow(kit.endpoint);
    return (await send({ type: 'backup-preview-cloud', kit })) as PreviewSummary;
  },
  restore: async (ticket: string) =>
    (await send({ type: 'backup-restore', ticket })) as ProtectionStatus,
};
