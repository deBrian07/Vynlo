import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Cloud, Download, HardDrive, ShieldCheck, Upload } from 'lucide-react';
import { backupClient } from './client';
import type { PreviewSummary, ProtectionStatus } from './contracts';
import type { RecoveryKit } from './types';
import { MAX_ENVELOPE_BYTES, workerEndpoint } from './crypto';
import { Confirm } from '../../components/ui';
import './backups.css';

function download(data: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function readFile(
  event: ChangeEvent<HTMLInputElement>,
  limit = MAX_ENVELOPE_BYTES,
): Promise<unknown> {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return undefined;
  if (file.size > limit)
    throw new Error('This file is too large. Choose a Vynlo backup or recovery file.');
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error('This file is not valid JSON. Choose a Vynlo backup or recovery file.');
  }
}
const date = (time?: number) => (time ? new Date(time).toLocaleString() : 'Not yet');
export function BackupPanel({
  onRestored,
  restoreDisabled = false,
}: {
  onRestored: () => Promise<void>;
  restoreDisabled?: boolean;
}) {
  const [status, setStatus] = useState<ProtectionStatus | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [file, setFile] = useState<unknown>();
  const [fileName, setFileName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [provision, setProvision] = useState('');
  const [consent, setConsent] = useState(false);
  const [kit, setKit] = useState<RecoveryKit | null>(null);
  const [saved, setSaved] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [recovery, setRecovery] = useState<unknown>();
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  useEffect(() => {
    let alive = true;
    backupClient
      .status()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch(() => {
        if (alive) setError('Data protection could not load. Reload settings to try again.');
      });
    return () => {
      alive = false;
    };
  }, []);
  const run = async (action: () => Promise<void>, success = '') => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'This action could not be completed. Your local data is unchanged.',
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const refresh = async () => setStatus(await backupClient.status());
  const recoveryFile = async () => {
    const current = kit ?? (await backupClient.recoveryFile());
    download(current, 'vynlo-recovery.json');
    setKit(current);
    setDownloaded(true);
    setSaved(false);
  };
  return (
    <section
      className="settings-section backup-panel"
      aria-label="Data protection"
      aria-busy={busy}
    >
      <div className="backup-heading">
        <span className="backup-symbol">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h2>Keep your workspace safe.</h2>
          <p className="muted">
            Updates keep your data. Reinstalling Chrome extensions removes it.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {restoreDisabled && (
        <p className="muted">Save or discard your preference changes before restoring a backup.</p>
      )}
      {status?.recoveryPending && (
        <div className="notice">
          <p>A previous restore needs to finish. Keep your backup file.</p>
          <button
            disabled={busy || restoreDisabled}
            onClick={() =>
              void run(async () => {
                setStatus(await backupClient.resumeRestore());
                await onRestored();
              }, 'Recovery finished. Automatic backups remain paused.')
            }
          >
            Finish recovery
          </button>
        </div>
      )}
      <div className="backup-card">
        <div className="backup-card-title">
          <HardDrive size={18} />
          <h3>Encrypted backup file</h3>
          <span className="backup-badge">No account needed</span>
        </div>
        <p className="muted">
          Save everything in one password-protected file. Keep the file and its password outside
          Chrome.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (password.length < 12 || password !== confirmation)
                throw new Error('Use at least 12 characters and matching passwords.');
              const data = await backupClient.exportFile(password);
              download(data, `vynlo-backup-${new Date().toISOString().slice(0, 10)}.json`);
              setPassword('');
              setConfirmation('');
              await refresh();
            }, 'Backup prepared. Check your Downloads folder and keep the password somewhere safe.');
          }}
        >
          <fieldset disabled={busy || !status} className="backup-fields">
            <div className="backup-inputs">
              <label>
                Backup password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  minLength={12}
                  maxLength={1024}
                  required
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 12 characters"
                />
              </label>
              <label>
                Confirm backup password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  maxLength={1024}
                  required
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            </div>
            <button
              className="primary"
              disabled={password.length < 12 || password !== confirmation}
            >
              <Download size={14} /> Download encrypted backup
            </button>
          </fieldset>
        </form>
        <p className="backup-meta muted">Last file prepared: {date(status?.lastLocalExport)}</p>
        <details>
          <summary>Restore a backup file</summary>
          <div className="backup-detail">
            <label className="file-button">
              <Upload size={14} /> Choose backup file
              <input
                type="file"
                accept="application/json,.json"
                disabled={busy || restoreDisabled || !status || status.recoveryPending}
                onChange={(event) => {
                  const name = event.target.files?.[0]?.name ?? '';
                  void run(async () => {
                    const selected = await readFile(event);
                    if (selected !== undefined) {
                      setFile(selected);
                      setFileName(name);
                      setPreview(null);
                      setRestorePassword('');
                    }
                  });
                }}
              />
            </label>
            {file !== undefined && (
              <>
                <p className="backup-meta">{fileName}</p>
                <label>
                  File password
                  <input
                    type="password"
                    autoComplete="off"
                    value={restorePassword}
                    maxLength={1024}
                    onChange={(e) => setRestorePassword(e.target.value)}
                    placeholder="Not needed for legacy JSON"
                  />
                </label>
                <button
                  disabled={busy || restoreDisabled}
                  onClick={() =>
                    void run(async () =>
                      setPreview(await backupClient.previewFile(file, restorePassword)),
                    )
                  }
                >
                  Preview file restore
                </button>
              </>
            )}
          </div>
        </details>
      </div>
      <div className="backup-card">
        <div className="backup-card-title">
          <Cloud size={18} />
          <h3>Automatic encrypted backups</h3>
          <span className={`backup-badge ${status?.automatic ? 'is-active' : ''}`}>
            {!status
              ? 'Loading…'
              : status.conflict || status.error
                ? 'Needs attention'
                : status.automatic
                  ? status.pending
                    ? 'Changes pending'
                    : 'Backed up'
                  : status.configured
                    ? 'Paused'
                    : 'Off'}
          </span>
        </div>
        <p className="muted">
          Optional. Save encrypted copies to your own Cloudflare storage after changes and daily.
          Vynlo stays fully usable with this off.
        </p>
        {status?.configured && (
          <>
            <p className="backup-meta muted">
              {status.endpoint}
              <br />
              Last confirmed backup: {date(status.lastSuccess)}
            </p>
            {status.error && (
              <p className="error-box" role="alert">
                {status.error}
              </p>
            )}
            <div className="data-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    recoveryFile,
                    'Recovery file prepared. Store it outside Chrome; it unlocks your cloud backup.',
                  )
                }
              >
                <Download size={14} /> Save recovery file
              </button>
              {status.automatic && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () => setStatus(await backupClient.backupNow()),
                        'Cloud backup saved.',
                      )
                    }
                  >
                    Back up now
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () => setStatus(await backupClient.pause()),
                        'Automatic backups paused. Your cloud copy is still stored.',
                      )
                    }
                  >
                    Pause backups
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {!status?.configured && (
          <details>
            <summary>Set up automatic backups</summary>
            <div className="backup-detail">
              <ol className="backup-steps">
                <li>
                  Run <code>pnpm backups:setup</code> in the source checkout. The guided helper
                  opens Cloudflare sign-in and creates your private storage.
                </li>
                <li>Choose the connection file it gives you.</li>
                <li>Save a recovery file, then enable backups.</li>
              </ol>
              <p className="muted">
                You need a Cloudflare account with R2 enabled. Cloudflare may require billing
                details; usage costs depend on its current plan. No deployment happens inside Vynlo.
              </p>
              <label className="file-button">
                <Upload size={14} /> Choose connection file
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={busy || !status}
                  onChange={(event) =>
                    void run(async () => {
                      const input = await readFile(event, 16_384);
                      if (input === undefined) return;
                      if (
                        !input ||
                        typeof input !== 'object' ||
                        !('endpoint' in input) ||
                        typeof input.endpoint !== 'string' ||
                        !('secret' in input) ||
                        typeof input.secret !== 'string' ||
                        !/^[a-f0-9]{64}$/.test(input.secret)
                      )
                        throw new Error(
                          'Choose connection.json from the Vynlo backup setup helper.',
                        );
                      setEndpoint(workerEndpoint(input.endpoint));
                      setProvision(input.secret);
                    })
                  }
                />
              </label>
              {endpoint && (
                <>
                  <p className="backup-meta">Connect to {endpoint}</p>
                  <label className="backup-check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    Save encrypted copies of all my Vynlo accounts, notes, reminders, snippets and
                    supported tracking data to this service.
                  </label>
                  <button
                    disabled={busy || !consent}
                    onClick={() =>
                      void run(async () => {
                        setKit(await backupClient.prepareCloud(endpoint, provision));
                        setProvision('');
                        setSaved(false);
                        setDownloaded(false);
                        await refresh();
                      }, 'Connection ready. Save your recovery file before enabling backups.')
                    }
                  >
                    Prepare cloud backup
                  </button>
                </>
              )}
            </div>
          </details>
        )}
        {status?.configured && !status.automatic && !status.conflict && !status.recoveryPending && (
          <div className="backup-detail">
            <p className="muted">
              A recovery file is the only way to unlock your cloud copy after reinstalling. Anyone
              with this file can read that backup.
            </p>
            <label className="backup-check">
              <input
                type="checkbox"
                checked={saved}
                disabled={!downloaded || busy}
                onChange={(e) => setSaved(e.target.checked)}
              />
              I saved my recovery file somewhere outside Chrome.
            </label>
            <button
              className="primary"
              disabled={busy || !saved}
              onClick={() =>
                void run(async () => {
                  try {
                    setStatus(await backupClient.enable());
                  } finally {
                    await refresh();
                  }
                }, 'Automatic encrypted backups are on.')
              }
            >
              Enable automatic backups
            </button>
          </div>
        )}
        <details>
          <summary>Restore from a cloud backup</summary>
          <div className="backup-detail">
            <p className="muted">
              Choose the recovery file you saved before reinstalling. You will review the contents
              before importing.
            </p>
            <label className="file-button">
              <Upload size={14} /> Choose recovery file
              <input
                type="file"
                accept="application/json,.json"
                disabled={busy || restoreDisabled || !status || status.recoveryPending}
                onChange={(event) =>
                  void run(async () => {
                    const selected = await readFile(event, 16_384);
                    if (selected !== undefined) {
                      setRecovery(selected);
                      setPreview(null);
                    }
                  })
                }
              />
            </label>
            {recovery !== undefined && (
              <button
                disabled={busy || restoreDisabled}
                onClick={() =>
                  void run(async () => setPreview(await backupClient.previewCloud(recovery)))
                }
              >
                Preview cloud restore
              </button>
            )}
          </div>
        </details>
        <p className="backup-meta muted">
          Pausing or clearing Vynlo keeps remote copies. Delete them in your Cloudflare R2
          dashboard. Backups keep the latest snapshot, not a version history.
        </p>
      </div>
      <details>
        <summary>What is protected?</summary>
        <p className="muted">
          Encrypted files and cloud copies include all Vynlo accounts and user-created workspace
          data, plus optional open-tracking records when that module is installed. No email bodies
          or attachments. Working data and recovery keys in this Chrome profile are not encrypted by
          Vynlo. Updates preserve them when the extension ID and Chrome profile stay the same.
          Uninstalling removes them. Keep an external backup or recovery file; there is no password
          reset or key recovery.
        </p>
      </details>
      {preview && (
        <Confirm
          title="Restore this backup?"
          label="Restore backup"
          destructive={false}
          onClose={() => setPreview(null)}
          onConfirm={async () => {
            if (restoreDisabled) throw new Error('Save preferences before restoring.');
            try {
              setStatus(await backupClient.restore(preview.ticket));
              setPreview(null);
              setFile(undefined);
              setRecovery(undefined);
              setRestorePassword('');
              await onRestored();
              setMessage('Backup restored. Automatic backups remain paused.');
            } catch (e) {
              setError(
                e instanceof Error ? e.message : 'Restore failed. Keep your backup and retry.',
              );
              await refresh().catch(() => undefined);
              throw e;
            }
          }}
        >
          Saved {date(preview.exportedAt)}. Add {preview.conversations} conversations,{' '}
          {preview.reminders} reminders, {preview.contacts} contacts, {preview.snippets} snippets
          and {preview.tracking} tracking records across {preview.accounts} accounts. Existing
          records with the same ID are kept. Preferences are replaced and automatic backups are
          paused. This does not merge newer edits into existing records.
        </Confirm>
      )}
    </section>
  );
}
