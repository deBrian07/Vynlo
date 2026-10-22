import { useEffect, useState, type ChangeEvent } from 'react';
import { Download, Upload, ShieldCheck } from 'lucide-react';
import { DEFAULT_SETTINGS, type Backup, type Settings, type Snapshot } from '../../types/model';
import type { Request } from '../../types/messages';
import { request } from '../../services/client';
import { validBackup } from '../../services/validation';
import { validateShortcuts, formatShortcut } from '../shortcuts/shortcuts';
import { Confirm } from '../../components/ui';

function download(data: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SettingsView({
  snapshot,
  onSave,
  onRefresh,
  onSnippets,
}: {
  snapshot: Snapshot;
  onSave: (r: Request) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSnippets: () => void;
}) {
  const [draft, setDraft] = useState(snapshot.settings);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clear, setClear] = useState(false);
  const [pendingImport, setPendingImport] = useState<Backup | null>(null);
  const [storage, setStorage] = useState('Calculating…');
  useEffect(() => {
    let alive = true;
    void navigator.storage
      ?.estimate()
      .then((s) => {
        if (alive)
          setStorage(`${((s.usage ?? 0) / 1024).toFixed(1)} KB used by the extension origin`);
      })
      .catch(() => {
        if (alive) setStorage('Storage estimate unavailable');
      });
    return () => {
      alive = false;
    };
  }, [snapshot]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const shortcutErrors = validateShortcuts(draft.shortcuts);
  const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot.settings);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This action could not be completed.');
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>, snippetsOnly = false) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose a JSON backup smaller than 10 MB.');
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (snippetsOnly) {
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !('schemaVersion' in parsed) ||
          parsed.schemaVersion !== 1 ||
          !('snippets' in parsed) ||
          !Array.isArray(parsed.snippets)
        )
          throw new Error('Choose a version 1 Vynlo snippet export.');
        const backup = {
          ...snapshot,
          schemaVersion: 1,
          exportedAt: Date.now(),
          accounts: [],
          conversations: [],
          contacts: [],
          reminders: [],
          snippets: parsed.snippets,
        };
        if (!validBackup(backup)) throw new Error('This snippet export contains invalid records.');
        setPendingImport(backup);
      } else {
        if (!validBackup(parsed))
          throw new Error(
            'This backup is invalid or uses an unsupported schema version. Nothing was imported.',
          );
        setPendingImport(parsed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The JSON backup could not be read.');
    }
  };
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE YOURSELF AT HOME</p>
          <h1>Your preferences.</h1>
          <p className="muted">Small choices. A smoother inbox.</p>
        </div>
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (Object.keys(shortcutErrors).length)
              throw new Error('Fix shortcut conflicts before saving.');
            await onSave({ type: 'settings', settings: { ...draft, onboarded: true } });
            setDraft({ ...draft, onboarded: true });
          }, 'Preferences saved');
        }}
      >
        <div className="settings-section">
          <h2>General</h2>
          <label className="setting-row">
            <span>
              Gmail enhancements<p>Show the launcher and enable Vynlo shortcuts.</p>
            </span>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => update('enabled', e.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>Default landing view</span>
            <select
              aria-label="Default landing view"
              value={draft.landingView}
              onChange={(e) => update('landingView', e.target.value as Settings['landingView'])}
            >
              <option value="dashboard">Conversations</option>
              <option value="snippets">Snippets</option>
              <option value="contacts">Contacts</option>
            </select>
          </label>
          <label className="setting-row">
            <span>Open workspace when Gmail starts</span>
            <input
              type="checkbox"
              checked={draft.openOnStartup}
              onChange={(e) => update('openOnStartup', e.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>Theme</span>
            <select
              aria-label="Theme"
              value={draft.theme}
              onChange={(e) => update('theme', e.target.value as Settings['theme'])}
            >
              <option value="system">Match Gmail / system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
        <div className="settings-section">
          <h2>Keyboard shortcuts</h2>
          <p className="muted">
            Use Mod for ⌘ on macOS or Ctrl elsewhere. Shortcuts pause in input fields and email
            drafts. Cmd/Ctrl+K opens Vynlo outside editors; Gmail keeps its link action while
            typing.
          </p>
          <div className="shortcut-fields">
            {(Object.keys(draft.shortcuts) as (keyof Settings['shortcuts'])[]).map((key) => (
              <div className="shortcut-editor" key={key}>
                <label htmlFor={`shortcut-${key}`}>{key}</label>
                <input
                  id={`shortcut-${key}`}
                  aria-label={`${key} shortcut`}
                  placeholder="Not assigned"
                  value={draft.shortcuts[key]}
                  onChange={(e) =>
                    update('shortcuts', { ...draft.shortcuts, [key]: e.target.value })
                  }
                />
                {shortcutErrors[key] ? (
                  <p className="shortcut-error">{shortcutErrors[key]}</p>
                ) : (
                  <small className="muted shortcut-error">
                    {formatShortcut(draft.shortcuts[key])}
                  </small>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => update('shortcuts', { ...DEFAULT_SETTINGS.shortcuts })}
          >
            Restore default shortcuts
          </button>
        </div>
        <div className="settings-section">
          <h2>Reminders</h2>
          <label className="setting-row">
            <span>
              Desktop notifications<p>Chrome and operating-system settings may prevent delivery.</p>
            </span>
            <input
              aria-label="Desktop notifications"
              type="checkbox"
              checked={draft.notifications}
              onChange={(e) => update('notifications', e.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>Default reminder interval (hours)</span>
            <input
              aria-label="Default reminder interval"
              type="number"
              min={1}
              max={8760}
              required
              value={draft.reminderHours}
              onChange={(e) => update('reminderHours', Number(e.target.value))}
            />
          </label>
          <label className="setting-row">
            <span>Due-date display</span>
            <select
              aria-label="Due-date display"
              value={draft.dateFormat}
              onChange={(e) => update('dateFormat', e.target.value as Settings['dateFormat'])}
            >
              <option value="relative">Relative</option>
              <option value="absolute">Date and time</option>
            </select>
          </label>
          <p className="muted">
            Reminders use saved timestamps. Changing your time zone changes the displayed local
            time, not the scheduled instant. Vynlo does not detect replies.
          </p>
        </div>
        <footer className="form-actions">
          <button className="primary" disabled={busy || Object.keys(shortcutErrors).length > 0}>
            {busy ? 'Saving…' : 'Save preferences'}
          </button>
        </footer>
      </form>
      <div className="settings-section">
        <h2>Snippets</h2>
        <p className="muted">Templates are available across your Gmail accounts in this browser.</p>
        <div className="data-actions">
          <button onClick={onSnippets}>Manage snippets</button>
          <button
            onClick={() =>
              download({ schemaVersion: 1, snippets: snapshot.snippets }, 'vynlo-snippets.json')
            }
          >
            Export snippets
          </button>
          <label className="file-button">
            Import snippets
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => void importFile(e, true)}
            />
          </label>
        </div>
      </div>
      <div className="settings-section">
        <h2>Data and privacy</h2>
        <p className="muted">
          <ShieldCheck size={14} /> Your data stays in this browser profile. It is not encrypted by
          Vynlo. Backups contain your notes and account addresses; keep them somewhere private.
        </p>
        <div className="data-actions">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const backup = await request({ type: 'export' });
                download(backup, `vynlo-backup-${new Date().toISOString().slice(0, 10)}.json`);
              }, 'Backup downloaded')
            }
          >
            <Download size={13} /> Export all data
          </button>
          <label className="file-button">
            <Upload size={13} /> Import backup
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => void importFile(e)}
            />
          </label>
          <button className="danger" onClick={() => setClear(true)}>
            Clear local data
          </button>
        </div>
        <p className="muted">
          {snapshot.conversations.length} conversations · {snapshot.reminders.length} reminders ·{' '}
          {snapshot.contacts.length} contacts · {snapshot.snippets.length} snippets
        </p>
        <p className="muted">{storage}</p>
        <details>
          <summary>Privacy policy</summary>
          <p className="muted">
            Vynlo reads limited visible Gmail interface metadata to identify the account, active
            conversation title and draft you choose. It stores account addresses, tracked thread
            references, your notes, reminders, templates and preferences in extension-owned
            IndexedDB and Chrome local storage. It does not store message bodies or attachments,
            transmit your data, use analytics, request OAuth, detect replies or send email. Data is
            scoped to this Chrome profile and is not encrypted by Vynlo. Uninstalling removes
            extension data; export a backup first. Source privacy policy: docs/PRIVACY.md.
          </p>
        </details>
      </div>
      <div className="settings-section">
        <h2>About Vynlo</h2>
        <p className="muted">Version {chrome.runtime.getManifest().version} · MIT license</p>
        <p className="muted">Built by Brian Chen. Email, without the friction.</p>
        <p className="muted">
          Source repository: this local checkout. A public GitHub URL has not been configured.
          Documentation: README.md and docs/ in the source distribution. Contributor information is
          maintained in Git history.
        </p>
      </div>
      {clear && (
        <Confirm
          title="Clear all Vynlo data?"
          label="Clear all data"
          onClose={() => setClear(false)}
          onConfirm={() =>
            void run(async () => {
              await onSave({ type: 'clear' });
              setDraft(structuredClone(DEFAULT_SETTINGS));
              setClear(false);
              await onRefresh();
            }, 'Local data cleared')
          }
        >
          This permanently removes all Vynlo conversations, notes, reminders, snippets and
          preferences in this browser profile. Export a backup first. Gmail messages are unchanged.
        </Confirm>
      )}
      {pendingImport && (
        <Confirm
          title="Import Vynlo backup?"
          label="Import backup"
          onClose={() => setPendingImport(null)}
          onConfirm={() =>
            void run(async () => {
              await onSave({ type: 'import', backup: pendingImport });
              setDraft(pendingImport.settings);
              setPendingImport(null);
              await onRefresh();
            }, 'Backup imported')
          }
        >
          Add {pendingImport.conversations.length} conversations, {pendingImport.contacts.length}{' '}
          contact notes and {pendingImport.snippets.length} snippets. Existing local records with
          the same ID are kept. Preferences are replaced by the backup’s preferences.
        </Confirm>
      )}
    </section>
  );
}
