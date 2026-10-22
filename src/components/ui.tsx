import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X, Inbox, LoaderCircle, AlertTriangle } from 'lucide-react';

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  busy = false,
  restoreFocus = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  restoreFocus?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous =
      dialog.getRootNode() instanceof ShadowRoot
        ? (dialog.getRootNode() as ShadowRoot).activeElement
        : document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (restoreFocus && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [restoreFocus]);
  return (
    <dialog
      ref={ref}
      className={`v-modal ${wide ? 'wide' : ''}`}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="modal-header">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={busy}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div role="status" className="empty">
      <LoaderCircle className="spin" size={24} />
      <p>Loading your workspace…</p>
    </div>
  );
}
export function Confirm({
  title,
  children,
  onConfirm,
  onClose,
  label = 'Delete',
  destructive = true,
}: {
  title: string;
  children: ReactNode;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  label?: string;
  destructive?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const executing = useRef(false);
  const confirm = async () => {
    if (executing.current) return;
    executing.current = true;
    setPending(true);
    setError('');
    try {
      await onConfirm();
    } catch {
      setError('This action could not be completed. Your dialog is still open; please try again.');
    } finally {
      executing.current = false;
      setPending(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} busy={pending}>
      <div className={`confirmation-icon ${destructive ? 'is-danger' : ''}`}>
        <AlertTriangle size={22} aria-hidden="true" />
      </div>
      <p className="confirmation-copy">{children}</p>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <footer className="form-actions">
        <button type="button" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className={destructive ? 'danger-filled' : 'primary'}
          onClick={() => void confirm()}
          disabled={pending}
        >
          {pending ? (
            <>
              <LoaderCircle className="spin" size={14} aria-hidden="true" /> Working…
            </>
          ) : (
            label
          )}
        </button>
      </footer>
    </Modal>
  );
}
export function Logo() {
  return (
    <span className="wordmark">
      <span className="logo-mark" aria-hidden="true">
        v
      </span>
      vynlo<span className="beta">LOCAL</span>
    </span>
  );
}
