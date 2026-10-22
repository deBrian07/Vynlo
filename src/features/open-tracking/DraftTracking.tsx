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
  const [label, setLabel] = useState(
    () =>
      `Draft · ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; pixelUrl: string } | null>(null);
  const [target] = useState(() => {
    try {
      return adapter.captureTrackingTarget();
    } catch {
      return null;
    }
  });
  const executing = useRef(false);
  useEffect(() => {
    if (!created) return;
    // The modal is unmounted before native editing, so the Gmail composer is no longer inert.
    try {
      if (
        !target ||
        target.accountId !== accountId ||
        adapter.getCurrentAccount()?.id !== accountId
      )
        throw new Error('The account or draft changed. Reopen tracking from the intended draft.');
      adapter.insertTrackingPixel(created.pixelUrl, target);
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
  }, [adapter, accountId, target, created, onClose, onDone]);
  if (created) return null;
  return (
    <Modal title="Track this draft" onClose={onClose} busy={busy} restoreFocus={false}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (executing.current) return;
          if (
            !target ||
            target.accountId !== accountId ||
            adapter.getCurrentAccount()?.id !== accountId
          ) {
            setError('The account or draft changed. Reopen tracking from the intended draft.');
            return;
          }
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
          Add a tracking image, send in Gmail, then activate tracking. Your email text and
          recipients stay out of the tracking service.
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
        <p className="muted">Only visible to you. Use a name you’ll recognize after sending.</p>
        <details className="tracking-reliability">
          <summary>How tracking works</summary>
          <p className="muted">
            Tracking stays paused until you choose “I’ve sent this” in Open tracking. Vynlo never
            sends email. Image blockers, proxies and your own views can affect results; an open
            signal is not proof of a read. Use your browser’s undo shortcut to remove the inserted
            image.
          </p>
        </details>
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
