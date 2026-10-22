import { useEffect, useRef, useState } from 'react';
import type { GmailAdapter } from '../../gmail/adapter';
import { Modal } from '../../components/ui';
import { trackingClient } from './client';

export function DraftTracking({
  adapter,
  accountId,
  onClose,
  onDone,
}: {
  adapter: GmailAdapter;
  accountId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [label, setLabel] = useState(`Draft · ${new Date().toLocaleDateString()}`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; pixelUrl: string } | null>(null);
  const executing = useRef(false);
  useEffect(() => {
    if (!created) return;
    // The modal is unmounted before native editing, so the Gmail composer is no longer inert.
    try {
      adapter.insertTrackingPixel(created.pixelUrl);
      onDone(
        'Tracking image added. Send through Gmail, then open Vynlo → Open tracking → I’ve sent this.',
      );
      onClose();
    } catch (error) {
      setCreated(null);
      setBusy(false);
      executing.current = false;
      setError(error instanceof Error ? error.message : 'The image could not be inserted.');
      // The remote entry remains paused and visible in history for explicit removal/recovery.
    }
  }, [adapter, created, onClose, onDone]);
  if (created) return null;
  return (
    <Modal title="Track this draft" onClose={onClose} busy={busy} restoreFocus={false}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (executing.current) return;
          executing.current = true;
          setBusy(true);
          setError('');
          void trackingClient
            .create(accountId, label)
            .then(setCreated)
            .catch((error) => {
              executing.current = false;
              setBusy(false);
              setError(error instanceof Error ? error.message : 'Tracking could not be prepared.');
            });
        }}
      >
        <p>
          Add a tiny tracking image to this draft. No message content, recipient or subject is sent
          to your Worker.
        </p>
        <label>
          Local name
          <input
            required
            maxLength={120}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={busy}
          />
        </label>
        <p className="muted">
          After sending through Gmail, open <strong>Open tracking</strong> and choose{' '}
          <strong>I’ve sent this</strong>. Tracking stays paused until then. Vynlo never sends the
          email.
        </p>
        <p className="muted">
          Image blockers, proxies and your own views can affect results. An open signal is not proof
          of a read. You can undo the image insertion with your browser’s undo shortcut.
        </p>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <footer className="form-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !label.trim()}>
            {busy ? 'Preparing…' : 'Add tracking image'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
