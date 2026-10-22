import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, Inbox, LoaderCircle } from 'lucide-react';

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
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
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`v-modal ${wide ? 'wide' : ''}`}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="modal-header">
        <h2 id={id}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
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
}: {
  title: string;
  children: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
  label?: string;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{children}</p>
      <footer className="form-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="danger" onClick={onConfirm}>
          {label}
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
