import { useState } from 'react';
import { Modal } from '../../components/ui';
import {
  STATUS_LABELS,
  STATUSES,
  type Conversation,
  type ConversationRef,
  type Status,
} from '../../types/model';
import type { Request } from '../../types/messages';

export function ConversationEditor({
  refValue,
  existing,
  onSave,
  onRemove,
  onClose,
  onReminder,
}: {
  refValue: ConversationRef;
  existing?: Conversation;
  onSave: (r: Request) => Promise<void>;
  onRemove: () => void;
  onClose: () => void;
  onReminder: () => void;
}) {
  const [status, setStatus] = useState<Status>(existing?.status ?? 'waiting');
  const [note, setNote] = useState(existing?.note ?? '');
  const [schedule, setSchedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (
      (status !== (existing?.status ?? 'waiting') || note !== (existing?.note ?? '')) &&
      !window.confirm('Discard unsaved conversation changes?')
    )
      return;
    onClose();
  };
  return (
    <Modal title={existing ? 'Edit conversation' : 'Track conversation'} onClose={close}>
      <p className="context-title">{refValue.title}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void onSave({ type: 'track', ref: refValue, status, note })
            .then(() => {
              if (schedule && status !== 'resolved') onReminder();
              else onClose();
            })
            .catch((e) =>
              setError(e instanceof Error ? e.message : 'Conversation could not be saved.'),
            )
            .finally(() => setBusy(false));
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Tracking status</span>
            <select
              aria-label="Tracking status"
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Conversation note</span>
            <textarea
              aria-label="Conversation note"
              value={note}
              maxLength={10000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What’s the next step?"
            />
            <small>Saved locally. Only the title and your notes are stored.</small>
          </label>
          {(status === 'waiting' || status === 'follow-up') && (
            <label className="setting-row">
              <span>Set a reminder after saving</span>
              <input
                type="checkbox"
                checked={schedule}
                onChange={(e) => setSchedule(e.target.checked)}
              />
            </label>
          )}
          {status === 'resolved' && (
            <p className="muted">Resolving dismisses this conversation’s reminder.</p>
          )}
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
        </div>
        <footer className="form-actions">
          {existing && (
            <button type="button" className="danger" onClick={onRemove} disabled={busy}>
              Remove tracking
            </button>
          )}
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save conversation'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
