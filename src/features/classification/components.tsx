import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Check, LoaderCircle, Search, Sparkles, Tag, Trash2 } from 'lucide-react';
import { Confirm, Empty } from '../../components/ui';
import type { ConversationRef } from '../../types/model';
import { classificationClient } from './client';
import { BROWSER_PREFERENCES_KEY, MODEL_ORIGINS, type BrowserRuntimeStatus } from './browser/model';
import {
  CATEGORIES,
  CATEGORY_IDS,
  DEFAULT_CLASSIFICATION,
  MODEL,
  type Category,
  type ClassifierStatus,
  type TaggedConversation,
} from './model';

const initialStatus: ClassifierStatus = {
  ...DEFAULT_CLASSIFICATION,
  permission: false,
  model: MODEL,
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'This action could not be completed. Please try again.';

const emptyRuntime: BrowserRuntimeStatus = {
  state: 'not-downloaded',
  downloadedBytes: 0,
  totalBytes: 0,
};
const formatBytes = (value: number) => `${Math.round(value / 1_000_000).toLocaleString()} MB`;

export function ClassificationSettings() {
  const [status, setStatus] = useState(initialStatus);
  const [runtime, setRuntime] = useState<BrowserRuntimeStatus>(emptyRuntime);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const live = useRef(true);
  const operation = useRef(0);
  const poll = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stopPolling = useCallback(() => {
    clearInterval(poll.current);
    poll.current = undefined;
  }, []);
  const invalidateOperation = useCallback(() => {
    operation.current++;
    stopPolling();
  }, [stopPolling]);
  useEffect(() => {
    live.current = true;
    const load = () =>
      void classificationClient.status().then(
        (value) => {
          if (live.current) {
            setStatus(value);
            setReady(true);
          }
        },
        () => {
          if (live.current)
            setError('Local AI settings could not be loaded. Reload this page to try again.');
        },
      );
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[BROWSER_PREFERENCES_KEY]) load();
    };
    load();
    void classificationClient.browserStatus().then(
      (value) => {
        if (live.current) setRuntime(value);
      },
      () => {
        if (live.current) setError('Local AI availability could not be checked.');
      },
    );
    chrome.storage?.onChanged?.addListener(changed);
    return () => {
      live.current = false;
      invalidateOperation();
      chrome.storage?.onChanged?.removeListener(changed);
    };
  }, [invalidateOperation]);
  const run = async (label: string, action: (active: () => boolean) => Promise<void>) => {
    const token = ++operation.current;
    const active = () => live.current && token === operation.current;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await action(active);
    } catch (cause) {
      if (active()) setError(errorMessage(cause));
    } finally {
      if (active()) {
        stopPolling();
        setBusy('');
      }
    }
  };
  const configure = (enabled: boolean, automatic: boolean) =>
    run('saving', async (active) => {
      const value = await classificationClient.configure({ enabled, automatic });
      if (!active()) return;
      setStatus(value);
      setMessage(
        enabled ? 'Local AI preferences saved.' : 'Local AI is off. Manual tags still work.',
      );
    });
  const download = () =>
    run('downloading', async (active) => {
      const granted = await chrome.permissions.request({ origins: MODEL_ORIGINS });
      if (!active()) return;
      if (!granted) throw new Error('Allow model download access to continue. No email was sent.');
      setRuntime({ ...emptyRuntime, state: 'downloading' });
      let checking = false;
      poll.current = setInterval(() => {
        if (checking) return;
        checking = true;
        void classificationClient
          .browserStatus()
          .then(
            (value) => {
              if (active()) setRuntime(value);
            },
            () => {},
          )
          .finally(() => {
            checking = false;
          });
      }, 750);
      const value = await classificationClient.prepare();
      if (!active()) return;
      setRuntime(value);
      setConnected(value.state === 'ready');
      const preferences = await classificationClient.status();
      if (!active()) return;
      setStatus(preferences);
      setMessage(
        value.state === 'ready'
          ? 'Model ready. Enable suggestions below when you are ready.'
          : 'Model saved in this browser. Check GPU availability to enable suggestions.',
      );
    });
  const check = () =>
    run('checking', async (active) => {
      setConnected(false);
      await classificationClient.check();
      const value = await classificationClient.browserStatus();
      if (!active()) return;
      setRuntime(value);
      setConnected(true);
      setMessage('Your GPU is available and the model is downloaded. You can enable suggestions.');
    });
  const release = async () => {
    invalidateOperation();
    setBusy('releasing');
    setError('');
    try {
      await classificationClient.release();
      if (!live.current) return;
      const value = await classificationClient.browserStatus();
      if (!live.current) return;
      setRuntime(value);
      setMessage('GPU memory released. Downloaded model files stay in this browser.');
    } catch (cause) {
      if (live.current) setError(errorMessage(cause));
    } finally {
      if (live.current) setBusy('');
    }
  };
  const cached = runtime.state === 'cached' || runtime.state === 'ready';
  const unsupported = runtime.state === 'unsupported';
  const downloading = busy === 'downloading';
  return (
    <section
      className="settings-section classification-settings"
      aria-label="Local email classification"
    >
      <h2>
        Local email classification <span className="tag">Experimental</span>
      </h2>
      <p className="muted">
        Get suggested Vynlo tags with Tev1 0.8B, directly in Chrome. Only opened conversation
        subjects are processed, locally on your GPU. No Ollama or separate app is needed. Gmail
        labels stay unchanged.
      </p>
      <div className="notice">
        <strong>One download. Local suggestions.</strong>
        <p>
          Download about 950 MB of model files once. This can take a few minutes. Files are cached
          in this browser; no email is sent to the download provider. Manual tags always work
          without a download.
        </p>
        <p className="muted">
          Requires WebGPU. Vynlo runs one classification at a time and releases the model after 30
          seconds of inactivity. There is no slower CPU fallback.
        </p>
        {(downloading || runtime.state === 'downloading') && (
          <div role="status" aria-live="polite">
            <p>
              Downloading model · {formatBytes(runtime.downloadedBytes)}
              {runtime.totalBytes > 0 ? ` of ${formatBytes(runtime.totalBytes)}` : ''}
            </p>
            <progress
              aria-label="Model download progress"
              {...(runtime.totalBytes > 0
                ? {
                    value: Math.min(runtime.downloadedBytes, runtime.totalBytes),
                    max: runtime.totalBytes,
                  }
                : {})}
            />
          </div>
        )}
        {runtime.state === 'loading' && <p role="status">Loading model on your GPU…</p>}
        {cached && (
          <p className="muted">
            Model downloaded · {runtime.state === 'ready' ? 'GPU ready' : 'GPU idle'}
          </p>
        )}
        {runtime.lastInferenceMs !== undefined && (
          <p className="muted">
            Last classification: {(runtime.lastInferenceMs / 1000).toFixed(1)} seconds.
          </p>
        )}
        {runtime.message && (
          <p className={unsupported || runtime.state === 'error' ? 'error-box' : 'muted'}>
            {runtime.message}
          </p>
        )}
        <div className="card-actions">
          {!cached && !downloading && (
            <button
              type="button"
              onClick={() => void download()}
              disabled={!!busy || !ready || unsupported}
            >
              <Sparkles size={14} aria-hidden="true" /> Download model
            </button>
          )}
          {cached && (
            <button type="button" onClick={() => void check()} disabled={!!busy || !ready}>
              {busy === 'checking' && (
                <LoaderCircle size={14} className="spin" aria-hidden="true" />
              )}
              Check GPU availability
            </button>
          )}
          {(downloading || runtime.state === 'loading' || runtime.state === 'ready') && (
            <button type="button" onClick={() => void release()} disabled={busy === 'releasing'}>
              {downloading || runtime.state === 'loading'
                ? 'Cancel and release GPU'
                : 'Release GPU memory'}
            </button>
          )}
          {cached && (
            <button type="button" onClick={() => setConfirmRemove(true)} disabled={!!busy}>
              Remove downloaded model
            </button>
          )}
        </div>
      </div>
      <label className="setting-row">
        <span>
          Enable local AI suggestions
          <small className="muted">
            Allow your GPU to process opened conversation subjects. Suggestions need your review.
          </small>
        </span>
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={!!busy || !ready || (!status.enabled && !connected)}
          onChange={(event) => void configure(event.target.checked, false)}
        />
      </label>
      <label className="setting-row">
        <span>
          Suggest tags automatically
          <small className="muted">
            Classify supported conversations as you open them. Existing tags and manual corrections
            are preserved. No mailbox scan.
          </small>
        </span>
        <input
          type="checkbox"
          checked={status.automatic}
          disabled={!!busy || !ready || !status.enabled}
          onChange={(event) => void configure(status.enabled, event.target.checked)}
        />
      </label>
      {!status.enabled && !connected && (
        <p className="muted">
          Download the model and check your GPU before enabling AI. Manual tags are ready now.
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>Privacy and resource use</summary>
        <p className="muted">
          Model downloads come from Hugging Face. Subjects stay on your device. You can release GPU
          memory or remove the downloaded model at any time. Browser storage can be cleared or
          evicted, which requires downloading the model again.
        </p>
        <p className="muted">
          This experimental model can be wrong even when its scores look confident. Review
          suggestions before relying on them. Accuracy and speed depend on your device.
        </p>
        <a
          href="https://huggingface.co/togethercomputer/Tev1-0.8B-experimental"
          target="_blank"
          rel="noreferrer"
        >
          Tev1 model details and licensing
        </a>
      </details>
      {confirmRemove && (
        <Confirm
          title="Remove downloaded model?"
          label="Remove model"
          onClose={() => setConfirmRemove(false)}
          onConfirm={async () => {
            await classificationClient.removeModel();
            setConnected(false);
            setStatus(await classificationClient.status());
            setRuntime(await classificationClient.browserStatus());
            setConfirmRemove(false);
            setMessage('Model removed. Your saved tags are unchanged.');
          }}
        >
          This turns off AI and removes cached model files. You will need to download them again to
          use suggestions. Saved tags are kept.
        </Confirm>
      )}
    </section>
  );
}

type TagProps = {
  tags: TaggedConversation[];
  current?: ConversationRef | null;
  onUpdated: () => void;
};

export function CurrentEmailTag({ tags, current, onUpdated }: TagProps) {
  return current ? (
    <CurrentTag
      key={`${current.accountId}:${current.threadId}`}
      tags={tags}
      current={current}
      onUpdated={onUpdated}
    />
  ) : null;
}

function CurrentTag({ tags, current, onUpdated }: TagProps & { current: ConversationRef }) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const tag = tags.find(
    (item) => item.accountId === current.accountId && item.threadId === current.threadId,
  );
  useEffect(() => {
    let live = true;
    const load = () =>
      void classificationClient.status().then(
        (value) => {
          if (live) setStatus(value);
        },
        () => {},
      );
    const changed = () => load();
    load();
    chrome.storage?.onChanged?.addListener(changed);
    return () => {
      live = false;
      chrome.storage?.onChanged?.removeListener(changed);
    };
  }, []);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      onUpdated();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="notice current-email-tag" aria-label="Current conversation tag">
      <div className="card-top">
        <div>
          <h2>
            <Tag size={14} aria-hidden="true" /> Current conversation
          </h2>
          <p>{current.title}</p>
        </div>
        {tag && (
          <span className="tag">{tag.reviewed ? 'Reviewed' : 'Suggested · review needed'}</span>
        )}
      </div>
      <div className="card-actions">
        <label htmlFor={id}>Category</label>
        <select
          id={id}
          value={tag?.category ?? ''}
          disabled={busy}
          onChange={(event) => {
            if (event.target.value)
              void act(() => classificationClient.set(current, event.target.value as Category));
          }}
        >
          <option value="" disabled>
            Choose a tag…
          </option>
          {CATEGORY_IDS.map((category) => (
            <option key={category} value={category}>
              {CATEGORIES[category].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !status.enabled || !status.permission}
          title={
            status.enabled && status.permission
              ? 'Ask local Tev1 to classify this subject'
              : 'Enable local AI in Settings first. Manual tags always work.'
          }
          onClick={() => void act(() => classificationClient.suggest(current))}
        >
          <Sparkles size={14} aria-hidden="true" /> Suggest tag
        </button>
        {tag && !tag.reviewed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => classificationClient.set(current, tag.category))}
          >
            <Check size={14} aria-hidden="true" /> Keep {CATEGORIES[tag.category].label}
          </button>
        )}
        {tag && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => classificationClient.remove(current))}
          >
            Remove tag
          </button>
        )}
      </div>
      {busy && (
        <p className="muted" role="status">
          Updating tag…
        </p>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function EmailTags({ tags, current, onUpdated }: TagProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Category | 'all' | 'suggested'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filtered = [...tags]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(
      (tag) =>
        (filter === 'all' || (filter === 'suggested' ? !tag.reviewed : tag.category === filter)) &&
        `${tag.title} ${CATEGORIES[tag.category].label}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    );
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      onUpdated();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="email-tags">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A PLACE FOR EVERY CONVERSATION</p>
          <h1>Email tags</h1>
          <p className="muted">
            Your categories, kept in Vynlo. Review AI suggestions or choose a tag yourself.
          </p>
        </div>
      </div>
      {current ? (
        <CurrentEmailTag tags={tags} current={current} onUpdated={onUpdated} />
      ) : (
        <p className="muted">Open a supported Gmail conversation to add a tag.</p>
      )}
      <div className="filter-bar">
        <label className="search-box">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search email tags"
            placeholder="Find a tagged conversation…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="Filter email tags"
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
        >
          <option value="all">All categories</option>
          <option value="suggested">Needs review</option>
          {CATEGORY_IDS.map((category) => (
            <option value={category} key={category}>
              {CATEGORIES[category].label}
            </option>
          ))}
        </select>
      </div>
      <p className="muted" role="status">
        {filtered.length} {filtered.length === 1 ? 'conversation' : 'conversations'}
      </p>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {!filtered.length && (
        <Empty title={tags.length ? 'No matching conversations' : 'A little order, your way.'}>
          {tags.length
            ? 'Try another search or category.'
            : 'Open a conversation and choose a category. Optional local AI can suggest tags for you.'}
        </Empty>
      )}
      {filtered.map((tag) => (
        <article className="contact-card" key={tag.id}>
          <div className="card-top">
            <div>
              <button
                type="button"
                className="conversation-link"
                disabled={busy}
                onClick={() => void act(() => classificationClient.open(tag))}
              >
                {tag.title}
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
              <div className="tags">
                <span className="tag">{CATEGORIES[tag.category].label}</span>
                <span className="muted">
                  {tag.reviewed ? 'Reviewed' : 'Suggested · review needed'}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={`Remove tag from ${tag.title}`}
              onClick={() => void act(() => classificationClient.remove(tag))}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
          {!tag.reviewed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => classificationClient.set(tag, tag.category))}
            >
              <Check size={14} aria-hidden="true" /> Keep {CATEGORIES[tag.category].label}
            </button>
          )}
          <label className="setting-row">
            <span>Change category</span>
            <select
              aria-label={`Category for ${tag.title}`}
              disabled={busy}
              value={tag.category}
              onChange={(event) =>
                void act(() => classificationClient.set(tag, event.target.value as Category))
              }
            >
              {CATEGORY_IDS.map((category) => (
                <option value={category} key={category}>
                  {CATEGORIES[category].label}
                </option>
              ))}
            </select>
          </label>
        </article>
      ))}
    </section>
  );
}
