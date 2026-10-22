import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, Check, LoaderCircle, Search, Sparkles, Tag, Trash2 } from 'lucide-react';
import { Empty } from '../../components/ui';
import type { ConversationRef } from '../../types/model';
import { classificationClient } from './client';
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

export function ClassificationSettings() {
  const [status, setStatus] = useState(initialStatus);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    const load = () =>
      void classificationClient.status().then(
        (value) => {
          if (live) {
            setStatus(value);
            setReady(true);
          }
        },
        () => {
          if (live)
            setError('Local AI settings could not be loaded. Reload this page to try again.');
        },
      );
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.classificationPreferences) {
        setConnected(false);
        load();
      }
    };
    load();
    chrome.storage?.onChanged?.addListener(changed);
    return () => {
      live = false;
      chrome.storage?.onChanged?.removeListener(changed);
    };
  }, []);
  const configure = async (enabled: boolean, automatic: boolean) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setStatus(await classificationClient.configure({ enabled, automatic }));
      setMessage(
        enabled ? 'Local AI preferences saved.' : 'Local AI is off. Manual tags still work.',
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const check = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    setConnected(false);
    try {
      const granted = await chrome.permissions.request({ origins: ['http://127.0.0.1/*'] });
      if (!granted)
        throw new Error('Allow local connection access to check Ollama. Nothing was sent.');
      const result = await classificationClient.check();
      setConnected(true);
      setStatus(await classificationClient.status());
      setMessage(
        `Connected to Ollama ${result.version}. ${MODEL} is installed. You can now enable suggestions.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const origin =
    typeof chrome !== 'undefined' && chrome.runtime?.id
      ? `chrome-extension://${chrome.runtime.id}`
      : 'chrome-extension://YOUR_EXTENSION_ID';
  return (
    <section
      className="settings-section classification-settings"
      aria-label="Local email classification"
    >
      <h2>
        Local email classification <span className="tag">Experimental</span>
      </h2>
      <p className="muted">
        Sort conversations into Vynlo tags with Tev1 0.8B on your computer. Only the subject of a
        supported conversation you open is processed. Gmail labels stay unchanged.
      </p>
      <ol className="classification-setup">
        <li>
          Install{' '}
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
            Ollama
          </a>{' '}
          (0.35 or later).
        </li>
        <li>
          In Terminal, run <code>ollama pull tev1:0.8b</code>.
        </li>
        <li>Keep Ollama running, then check the connection below.</li>
      </ol>
      <button type="button" onClick={() => void check()} disabled={busy || !ready}>
        {busy ? (
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
        ) : (
          <Sparkles size={14} aria-hidden="true" />
        )}
        Check local connection
      </button>
      <p className="muted">
        This check sends no email content. Chrome may describe local access broadly; Vynlo connects
        only to 127.0.0.1:11434.
      </p>
      <label className="setting-row">
        <span>
          Enable local AI suggestions
          <small className="muted">
            Allow opened conversation subjects to be sent to your local Ollama. Suggestions need
            your review.
          </small>
        </span>
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy || !ready || (!status.enabled && !connected)}
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
          disabled={busy || !ready || !status.enabled}
          onChange={(event) => void configure(status.enabled, event.target.checked)}
        />
      </label>
      {!status.enabled && !connected && (
        <p className="muted">
          Check the connection before enabling AI. You can use manual tags without Ollama.
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
        <summary>Having trouble connecting?</summary>
        <p className="muted">
          Quit Ollama before starting it with this command. It allows this extension and disables
          Ollama cloud features.
        </p>
        <code className="classification-command">
          OLLAMA_NO_CLOUD=1 OLLAMA_ORIGINS={origin} ollama serve
        </code>
        <p className="muted">
          The model is experimental. A confident prediction can still be wrong; review suggestions
          before relying on them.
        </p>
      </details>
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
