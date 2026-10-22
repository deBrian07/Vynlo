import { useEffect, useRef, useState } from 'react';
import { Eye, RefreshCw, Trash2 } from 'lucide-react';
import { Confirm } from '../../components/ui';
import { trackingClient } from './client';
import type { PublicTracking, TrackingSnapshot } from './types';
import './tracking.css';

function date(value: number) {
  return new Date(value).toLocaleString();
}
export function TrackingActivity({ accountId }: { accountId?: string }) {
  const [loaded, setLoaded] = useState<{ accountId: string; snapshot: TrackingSnapshot } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState<PublicTracking | null>(null);
  const [removing, setRemoving] = useState<PublicTracking | null>(null);
  const activeAccount = useRef(accountId);
  activeAccount.current = accountId;
  const executing = useRef(false);
  useEffect(() => {
    let alive = true;
    setError('');
    setRemoving(null);
    setActivating(null);
    if (accountId)
      void trackingClient
        .snapshot(accountId)
        .then((snapshot) => {
          if (alive) setLoaded({ accountId, snapshot });
        })
        .catch(() => {
          if (alive) setError('Tracking activity could not be loaded. Try reopening this panel.');
        });
    return () => {
      alive = false;
    };
  }, [accountId]);
  const snapshot = accountId && loaded?.accountId === accountId ? loaded.snapshot : null;
  const records = snapshot?.records.filter((record) => record.accountId === accountId) ?? [];
  async function refresh() {
    if (!accountId || executing.current) return;
    const account = accountId;
    executing.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await trackingClient.refresh(account);
      if (activeAccount.current === account) setLoaded({ accountId: account, snapshot: next });
    } catch {
      if (activeAccount.current === account)
        setError(
          'Could not refresh. Check your connection and tracking settings, then try again. Previously loaded activity is still shown.',
        );
    } finally {
      executing.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="tracking-activity" aria-labelledby="tracking-activity-title">
      <header className="tracking-activity-header">
        <div>
          <h2 id="tracking-activity-title">Open activity</h2>
          <p className="muted">For drafts you chose to track in this account.</p>
        </div>
        <button
          type="button"
          disabled={!snapshot?.connected || busy || !accountId}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} className={busy ? 'spin' : ''} aria-hidden="true" />
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>
      <p className="tracking-disclosure">
        Send your draft through Gmail, then choose “I’ve sent this” below to activate tracking.
        Vynlo never sends email. Image proxies and automated downloads can create or hide opens;
        viewing your own sent email can also count. “No open detected” does not mean unread.
      </p>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {accountId && snapshot && !snapshot.connected && (
        <p className="tracking-disclosure">
          Disconnected. Saved history is shown below. Reconnect in Settings to refresh opens; you
          can still delete entries to stop their images if Chrome retains access to the Worker.
        </p>
      )}
      {!accountId ? (
        <p className="tracking-empty">Open a supported Gmail account to see its activity.</p>
      ) : !snapshot ? (
        !error && (
          <p role="status" className="tracking-empty">
            Loading activity…
          </p>
        )
      ) : records.length === 0 ? (
        <div className="tracking-empty">
          <Eye size={24} aria-hidden="true" />
          <h3>No tracked drafts yet</h3>
          <p>
            Choose open tracking while composing. Activity begins as a draft; Vynlo cannot confirm
            that you sent it.
          </p>
        </div>
      ) : (
        <ul className="tracking-records">
          {records.map((record) => (
            <li key={record.id} className="tracking-record">
              <div className="tracking-record-top">
                <h3>{record.label || `Draft · ${date(record.createdAt)}`}</h3>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Delete tracking for ${record.label || 'draft'}`}
                  onClick={() => setRemoving(record)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <p
                className={`tracking-open-state ${record.armedAt !== null && record.firstOpenedAt !== null ? 'is-opened' : ''}`}
              >
                <Eye size={14} aria-hidden="true" />
                {record.armedAt === null
                  ? 'Draft · not activated'
                  : record.firstOpenedAt !== null
                    ? 'Open detected'
                    : 'No open detected'}
              </p>
              <p className="muted">Draft created {date(record.createdAt)} · Sending not verified</p>
              {record.armedAt === null && record.expiresAt > Date.now() && (
                <button
                  type="button"
                  className="tracking-activate"
                  onClick={() => setActivating(record)}
                >
                  I’ve sent this
                </button>
              )}
              {record.armedAt !== null && (
                <p className="muted">Tracking activated {date(record.armedAt)}</p>
              )}
              {record.armedAt !== null && record.firstOpenedAt !== null && (
                <p className="muted">
                  First detected {date(record.firstOpenedAt)}
                  {record.lastOpenedAt !== null && record.lastOpenedAt !== record.firstOpenedAt
                    ? ` · Latest ${date(record.lastOpenedAt)}`
                    : ''}{' '}
                  · {record.openCount} image {record.openCount === 1 ? 'load' : 'loads'}
                </p>
              )}
              <p className="muted">
                {record.expiresAt <= Date.now() ? 'Expired' : 'Expires'} {date(record.expiresAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {activating && activating.accountId === accountId && (
        <Confirm
          title="Start checking for opens?"
          label="Activate tracking"
          destructive={false}
          onClose={() => setActivating(null)}
          onConfirm={async () => {
            const account = activating.accountId;
            await trackingClient.activate(account, activating.id);
            const next = await trackingClient.snapshot(account);
            if (activeAccount.current === account) {
              setLoaded({ accountId: account, snapshot: next });
              setActivating(null);
            }
          }}
        >
          Confirm that you sent this draft using Gmail. This only starts recording future image
          loads; it never sends email. Earlier opens cannot be recovered, and image caching may
          prevent later detection. Viewing your own sent message can count as an open.
        </Confirm>
      )}
      {removing && removing.accountId === accountId && (
        <Confirm
          title="Delete this tracking entry?"
          label="Delete tracking"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const account = removing.accountId;
            await trackingClient.remove(account, removing.id);
            const next = await trackingClient.snapshot(account);
            if (activeAccount.current === account) {
              setLoaded({ accountId: account, snapshot: next });
              setRemoving(null);
            }
          }}
        >
          This deletes the activity and stops future tracking for this image on the service. It does
          not change or recall the email.
        </Confirm>
      )}
    </section>
  );
}
