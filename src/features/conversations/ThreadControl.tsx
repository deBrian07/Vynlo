import { STATUS_LABELS, type Status } from '../../types/model';

export function threadControlPosition(
  rect: { bottom: number; right: number },
  viewportWidth: number,
): { top: number; left: number } {
  const width = 180;
  return {
    top: Math.max(8, rect.bottom + 8),
    left: Math.max(8, Math.min(rect.right - width, viewportWidth - width - 8)),
  };
}

export function ThreadControl({
  status,
  position,
  onClick,
}: {
  status?: Status;
  position: { top: number; left: number };
  onClick: () => void;
}) {
  const label = status ? STATUS_LABELS[status] : 'Track';
  return (
    <button
      className="thread-control"
      style={{ top: position.top, left: position.left }}
      aria-label={status ? `Tracked as ${label}` : 'Track this conversation'}
      onClick={onClick}
    >
      <span className={`status-dot ${status ?? 'untracked'}`} aria-hidden="true" />
      {label}
    </button>
  );
}
