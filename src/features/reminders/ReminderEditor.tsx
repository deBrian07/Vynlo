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
  const initial = localInput(existing?.dueAt ?? Date.now() + defaultHours * 3600000);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (value !== initial && !window.confirm('Discard unsaved reminder changes?')) return;
    onClose();
  };
  const save = async (at: number) => {
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
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(new Date(value).getTime());
        }}
      >
        <label className="field reminder-custom">
          <span>Custom date and time</span>
          <input
            type="datetime-local"
            aria-label="Custom date and time"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
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
