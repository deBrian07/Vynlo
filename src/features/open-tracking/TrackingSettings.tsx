import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import { CheckCircle2, Link2, LockKeyhole, Unplug } from 'lucide-react';
import { Confirm } from '../../components/ui';
import { trackingClient } from './client';
import { workerEndpoint, type TrackingSnapshot } from './types';
import './tracking.css';

export function TrackingSettings() {
  const [snapshot, setSnapshot] = useState<TrackingSnapshot | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [secret, setSecret] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [disconnect, setDisconnect] = useState(false);
  const [fileReady, setFileReady] = useState(false);
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

  async function importConnection(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || busy) return;
    setError('');
    try {
      if (file.size > 4096) throw new Error('Invalid file');
      const value: unknown = JSON.parse(await file.text());
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid file');
      const data = value as Record<string, unknown>;
      if (
        Object.keys(data).sort().join(',') !== 'endpoint,secret' ||
        typeof data.endpoint !== 'string' ||
        typeof data.secret !== 'string' ||
        !/^[a-zA-Z0-9_-]{32,256}$/.test(data.secret)
      )
        throw new Error('Invalid file');
      const validatedEndpoint = workerEndpoint(data.endpoint);
      setEndpoint(validatedEndpoint);
      setSecret(data.secret);
      setConsent(false);
      setFileReady(true);
    } catch {
      setError(
        'Choose the connection.json file created by Vynlo setup (up to 4 KB). No connection was made.',
      );
    }
  }

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
            <p className="tracking-setup-intro">
              Choose your connection file, then connect. You only do this once per browser.
            </p>
            <form className="tracking-connect-form" onSubmit={(event) => void connect(event)}>
              <fieldset disabled={busy}>
                <label className="file-button tracking-import">
                  Choose connection file
                  <input
                    type="file"
                    accept="application/json,.json"
                    aria-label="Import connection file"
                    onChange={(event) => void importConnection(event)}
                  />
                </label>
                <small className="muted">
                  Choose connection.json from setup. Nothing connects until you approve below.
                </small>
                {fileReady && (
                  <p className="tracking-file-ready" role="status">
                    <CheckCircle2 size={15} />
                    Connection file ready · {endpoint.replace(/^https:\/\//, '')}
                  </p>
                )}
                <details className="tracking-manual">
                  <summary>Enter connection details manually</summary>
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
                    onChange={(event) => {
                      setEndpoint(event.target.value);
                      setFileReady(false);
                      setConsent(false);
                    }}
                  />
                  <label htmlFor="tracking-secret">Connection key</label>
                  <input
                    id="tracking-secret"
                    type="password"
                    minLength={32}
                    maxLength={256}
                    pattern="[a-zA-Z0-9_-]{32,256}"
                    title="Use the 32–256 character connection key from setup."
                    required
                    autoComplete="off"
                    value={secret}
                    onChange={(event) => {
                      setSecret(event.target.value);
                      setFileReady(false);
                      setConsent(false);
                    }}
                    aria-describedby="tracking-key-help"
                  />
                  <small id="tracking-key-help" className="muted">
                    <LockKeyhole size={12} aria-hidden="true" /> Stored in this browser profile,
                    outside Vynlo backups. Never share your key.
                  </small>
                </details>
                <label className="tracking-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>
                    Allow tracking images in drafts I choose. The service receives image requests
                    and network metadata; Vynlo uploads no email text or recipient addresses.
                  </span>
                </label>
                <button
                  type="submit"
                  className="primary"
                  disabled={!consent || !endpoint || !secret}
                >
                  {busy ? 'Connecting…' : 'Connect tracking'}
                </button>
              </fieldset>
            </form>
            <details className="tracking-operator-help">
              <summary>I don’t have a connection file</summary>
              <p>
                Running your own service? Run <code>pnpm tracking:setup</code> from the Vynlo source
                folder. The guided setup opens Cloudflare sign-in and creates everything for you.
                Import the connection file it gives you here.
              </p>
              <p>
                A Cloudflare account is required. Hosting limits apply. If someone else runs your
                service, ask them for your connection file.
              </p>
            </details>
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
          until their 30-day expiry. To stop an individual image sooner, delete its activity entry
          in Open tracking. Chrome must retain access to that Worker.
        </Confirm>
      )}
    </section>
  );
}
