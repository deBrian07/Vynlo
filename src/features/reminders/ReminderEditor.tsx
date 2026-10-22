import { useState } from 'react';
import { Modal } from '../../components/ui';
import { reminderDate, type ReminderPreset } from '../../services/reminders/dates';
import type { ConversationRef, Reminder } from '../../types/model';

function localInput(time: number) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function ReminderEditor({
  conversation,
  existing,
  defaultHours,
  onSave,
  onClose,
  onDismiss,
}: {
  conversation: ConversationRef;
  existing?: Reminder;
  defaultHours: number;
  onSave: (at: number) => Promise<void>;
  onClose: () => void;
  onDismiss?: () => Promise<void>;
}) {
  const [initial] = useState(() =>
    localInput(existing?.dueAt ?? Date.now() + defaultHours * 3600000),
  );
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (busy) return;
    if (value !== initial && !window.confirm('Discard unsaved reminder changes?')) return;
    onClose();
  };
  const save = async (at: number) => {
    if (busy) return;
    setError('');
    if (!Number.isFinite(at) || at <= Date.now()) {
      setError('Choose a date and time in the future.');
      return;
    }
    setBusy(true);
    try {
      await onSave(at);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reminder could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={existing ? 'Edit reminder' : 'Set a reminder'} onClose={close}>
      <p className="context-title">{conversation.title}</p>
      <div className="presets">
        {(
          [
            ['later', 'Later today'],
            ['tomorrow', 'Tomorrow'],
            ['three-days', 'In three days'],
            ['week', 'Next week'],
          ] as [ReminderPreset, string][]
        ).map(([preset, label]) => (
          <button key={preset} disabled={busy} onClick={() => void save(reminderDate(preset))}>
            {label}
            <small className="preset-description">
              {new Date(reminderDate(preset)).toLocaleString(undefined, {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </small>
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const at = new Date(value).getTime();
          // Date normalizes nonexistent local times during the spring DST transition.
          // Refuse that silent shift so a custom reminder keeps the user's chosen time.
          if (!Number.isFinite(at) || localInput(at) !== value) {
            setError('This local time is unavailable. Choose another date and time.');
            return;
          }
          void save(at);
        }}
      >
        <label className="field reminder-custom">
          <span>Custom date and time</span>
          <input
            disabled={busy}
            type="datetime-local"
            aria-label="Custom date and time"
            required
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
          />
          <small>
            Uses your current time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.
            Delivery may be delayed while Chrome is closed or your device sleeps. This reminder
            doesn’t check for replies.
          </small>
        </label>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <footer className="form-actions">
          {onDismiss && existing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onDismiss()
                  .then(onClose)
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : 'Reminder could not be dismissed.'),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Dismiss reminder
            </button>
          )}
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save reminder'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
