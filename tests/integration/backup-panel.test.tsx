import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BackupPanel } from '../../src/features/backups/BackupPanel';
import { backupClient } from '../../src/features/backups/client';
import type { ProtectionStatus } from '../../src/features/backups/contracts';
vi.mock('../../src/features/backups/client', () => ({
  backupClient: {
    status: vi.fn(),
    exportFile: vi.fn(),
    previewFile: vi.fn(),
    restore: vi.fn(),
    prepareCloud: vi.fn(),
    recoveryFile: vi.fn(),
    enable: vi.fn(),
    pause: vi.fn(),
    backupNow: vi.fn(),
    previewCloud: vi.fn(),
    resumeRestore: vi.fn(),
  },
}));
const off: ProtectionStatus = {
  automatic: false,
  configured: false,
  conflict: false,
  pending: false,
  recoveryPending: false,
};
const kit = {
  format: 'vynlo-recovery-kit' as const,
  version: 1 as const,
  endpoint: 'https://backups.owner.workers.dev',
  secret: 'a'.repeat(64),
  vaultId: 'b'.repeat(64),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(backupClient.status).mockResolvedValue(off);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:backup'), revokeObjectURL: vi.fn() }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
async function mount(restoreDisabled = false) {
  const onRestored = vi.fn(async () => {});
  const result = render(<BackupPanel onRestored={onRestored} restoreDisabled={restoreDisabled} />);
  await waitFor(() => expect(screen.getByText('Off')).toBeInTheDocument());
  return { ...result, onRestored };
}
function choose(container: HTMLElement, label: string, data: unknown, name = 'backup.json') {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>('input[type=file]')).find(
    (el) => el.parentElement?.textContent?.includes(label),
  )!;
  fireEvent.change(input, {
    target: { files: [{ name, size: 128, text: async () => JSON.stringify(data) }] },
  });
}
it('starts off without provisioning or uploading and keeps setup collapsed', async () => {
  await mount();
  expect(backupClient.prepareCloud).not.toHaveBeenCalled();
  expect(backupClient.enable).not.toHaveBeenCalled();
  expect(screen.getByText('Set up automatic backups').closest('details')).not.toHaveAttribute(
    'open',
  );
});
it('requires matching passwords before preparing a local download', async () => {
  await mount();
  const action = screen.getByRole('button', { name: 'Download encrypted backup' });
  fireEvent.change(screen.getByLabelText('Backup password'), {
    target: { value: 'a strong password' },
  });
  expect(action).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Confirm backup password'), {
    target: { value: 'a strong password' },
  });
  vi.mocked(backupClient.exportFile).mockResolvedValue({
    format: 'vynlo-encrypted-backup',
    version: 1,
    algorithm: 'AES-GCM',
    iv: '',
    ciphertext: '',
  });
  fireEvent.click(action);
  await waitFor(() => expect(backupClient.exportFile).toHaveBeenCalledWith('a strong password'));
  expect(await screen.findByRole('status')).toHaveTextContent('Backup prepared');
  expect(screen.getByLabelText('Backup password')).toHaveValue('');
});
it('previews a file and imports only after explicit confirmation', async () => {
  const { container, onRestored } = await mount();
  fireEvent.click(screen.getByText('Restore a backup file'));
  choose(container, 'Choose backup file', { schemaVersion: 1 });
  const preview = await screen.findByRole('button', { name: 'Preview file restore' });
  vi.mocked(backupClient.previewFile).mockResolvedValue({
    ticket: 'preview',
    source: 'file',
    accounts: 2,
    conversations: 3,
    contacts: 1,
    reminders: 2,
    snippets: 4,
    tracking: 0,
    exportedAt: Date.now(),
  });
  fireEvent.click(preview);
  await screen.findByRole('dialog', { name: 'Restore this backup?' });
  expect(backupClient.restore).not.toHaveBeenCalled();
  expect(screen.getByText(/Existing records with the same ID are kept/)).toBeInTheDocument();
  vi.mocked(backupClient.restore).mockResolvedValue(off);
  fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
  await waitFor(() => expect(onRestored).toHaveBeenCalledOnce());
  expect(backupClient.restore).toHaveBeenCalledWith('preview');
});
it('keeps restore failures visible and never reports success', async () => {
  const { container, onRestored } = await mount();
  fireEvent.click(screen.getByText('Restore a backup file'));
  choose(container, 'Choose backup file', {});
  vi.mocked(backupClient.previewFile).mockResolvedValue({
    ticket: 'preview',
    source: 'file',
    accounts: 1,
    conversations: 1,
    contacts: 0,
    reminders: 0,
    snippets: 0,
    tracking: 0,
    exportedAt: Date.now(),
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Preview file restore' }));
  vi.mocked(backupClient.restore).mockRejectedValue(
    new Error('Recovery is incomplete. Keep your backup file.'),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Restore backup' }));
  await waitFor(() =>
    expect(
      screen.getAllByRole('alert').some((el) => el.textContent?.includes('Recovery is incomplete')),
    ).toBe(true),
  );
  expect(onRestored).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('requires saving a recovery file and checking consent before enabling', async () => {
  vi.mocked(backupClient.status).mockResolvedValue({ ...off, configured: true });
  vi.mocked(backupClient.recoveryFile).mockResolvedValue(kit);
  render(<BackupPanel onRestored={async () => {}} />);
  const enable = await screen.findByRole('button', { name: 'Enable automatic backups' });
  expect(enable).toBeDisabled();
  const check = screen.getByLabelText('I saved my recovery file somewhere outside Chrome.');
  expect(check).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save recovery file' }));
  await waitFor(() => expect(check).toBeEnabled());
  expect(enable).toBeDisabled();
  fireEvent.click(check);
  vi.mocked(backupClient.enable).mockResolvedValue({ ...off, configured: true, automatic: true });
  vi.mocked(backupClient.status).mockResolvedValue({ ...off, configured: true, automatic: true });
  fireEvent.click(enable);
  await waitFor(() => expect(backupClient.enable).toHaveBeenCalledOnce());
});
it('protects unsaved preferences from restore and rejects oversized files', async () => {
  const { container, rerender } = await mount(true);
  const fileInputs = container.querySelectorAll<HTMLInputElement>('input[type=file]');
  expect(fileInputs[0]).toBeDisabled();
  rerender(<BackupPanel onRestored={async () => {}} />);
  fireEvent.change(fileInputs[0]!, { target: { files: [{ size: 20 * 1024 * 1024 }] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('too large');
  expect(backupClient.previewFile).not.toHaveBeenCalled();
});
