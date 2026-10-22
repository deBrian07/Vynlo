import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Link2, LockKeyhole, Unplug } from 'lucide-react';
import { Confirm } from '../../components/ui';
import { trackingClient } from './client';
import type { TrackingSnapshot } from './types';
import './tracking.css';

export function TrackingSettings() {
  const [snapshot, setSnapshot] = useState<TrackingSnapshot | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [secret, setSecret] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [disconnect, setDisconnect] = useState(false);
  const executing = useRef(false);
  const endpointInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    void trackingClient
      .snapshot()
      .then((value) => {
        if (alive) setSnapshot(value);
      })
      .catch(() => {
        if (alive)
          setError('Connection settings could not be loaded. Reopen settings to try again.');
      });
    return () => {
      alive = false;
    };
  }, []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (executing.current || !consent) return;
    executing.current = true;
    setBusy(true);
    setError('');
    try {
      // Keep the permission request inside this explicit user gesture.
      await trackingClient.connect(endpoint.trim(), secret.trim());
      setSnapshot(await trackingClient.snapshot());
      setSecret('');
    } catch {
      setError(
        'Could not connect. Check the Worker URL and connection key, allow access to that host, and try again. Your key has not been shown or added to a backup.',
      );
      endpointInput.current?.focus();
    } finally {
      executing.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="settings-section tracking-settings"
      aria-labelledby="tracking-settings-title"
    >
      <div className="tracking-heading">
        <Link2 size={18} aria-hidden="true" />
        <h2 id="tracking-settings-title">Email open tracking</h2>
        <span className="tracking-badge">Optional</span>
      </div>
      <p className="muted">
        Know when a tracking image loads. An open event does not prove someone read your message;
        blocked images can hide real opens.
      </p>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {!snapshot && !error && (
        <p role="status" className="muted">
          Loading connection…
        </p>
      )}
      {snapshot?.connected ? (
        <div className="tracking-connected">
          <p className="tracking-connection-state">
            <CheckCircle2 size={16} aria-hidden="true" /> Connected
          </p>
          <p className="tracking-endpoint">{snapshot.endpoint}</p>
          <p className="muted">
            Tracking stays off until you choose it for a draft. After sending through Gmail,
            activate its entry in Open tracking. Refresh activity manually to check for opens.
          </p>
          <button type="button" onClick={() => setDisconnect(true)}>
            <Unplug size={14} aria-hidden="true" /> Disconnect
          </button>
        </div>
      ) : (
        snapshot && (
          <>
            <ol className="tracking-steps">
              <li>
                <strong>Get your connection details.</strong>
                <span>Use the Worker URL and connection key from your Vynlo service operator.</span>
              </li>
              <li>
                <strong>Connect once in this browser.</strong>
                <span>Chrome asks permission for that Worker host only.</span>
              </li>
              <li>
                <strong>Choose which drafts to track.</strong>
                <span>
                  Send through Gmail, then activate its entry in Open tracking. Vynlo never sends
                  email for you.
                </span>
              </li>
            </ol>
            <details className="tracking-operator-help">
              <summary>Setting up your own service?</summary>
              <p>
                In the Vynlo source folder, run <code>pnpm tracking:setup</code>. The guided setup
                creates your Cloudflare Worker and database, then gives you the URL and connection
                key. A Cloudflare account is required. Review the free-tier limits before deploying.
              </p>
            </details>
            <form className="tracking-connect-form" onSubmit={(event) => void connect(event)}>
              <fieldset disabled={busy}>
                <label htmlFor="tracking-endpoint">Worker URL</label>
                <input
                  ref={endpointInput}
                  id="tracking-endpoint"
                  type="url"
                  required
                  placeholder="https://vynlo.your-account.workers.dev"
                  autoComplete="off"
                  spellCheck={false}
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                />
                <label htmlFor="tracking-secret">Connection key</label>
                <input
                  id="tracking-secret"
                  type="password"
                  required
                  autoComplete="off"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  aria-describedby="tracking-key-help"
                />
                <small id="tracking-key-help" className="muted">
                  <LockKeyhole size={12} aria-hidden="true" /> Stored in this browser profile,
                  outside Vynlo backups. Never share your key.
                </small>
                <label className="tracking-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>
                    I understand that tracking adds a remote image to drafts I choose. The service
                    and its hosting provider receive image requests, including network metadata.
                    Email subjects, bodies and recipient addresses are not uploaded by Vynlo.
                  </span>
                </label>
                <button type="submit" className="primary" disabled={!consent}>
                  {busy ? 'Connecting…' : 'Connect tracking'}
                </button>
              </fieldset>
            </form>
          </>
        )
      )}
      {disconnect && (
        <Confirm
          title="Disconnect open tracking?"
          label="Disconnect"
          onClose={() => setDisconnect(false)}
          onConfirm={async () => {
            await trackingClient.disconnect();
            setSnapshot(await trackingClient.snapshot());
            setDisconnect(false);
            setConsent(false);
          }}
        >
          This removes the connection key from this browser. Existing tracking images keep working
          until their 30-day expiry. To stop an individual image sooner, cancel and delete its
          activity entry while connected.
        </Confirm>
      )}
    </section>
  );
}
