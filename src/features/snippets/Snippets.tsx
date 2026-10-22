import { useState } from 'react';
import { Search, Plus, Pencil, Trash2 } from 'lucide-react';
import { Confirm, Empty, Modal } from '../../components/ui';
import { getTemplateVariables, resolveTemplate } from './template';
import type { Snippet } from '../../types/model';
import type { Request } from '../../types/messages';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';

export function Snippets({
  snippets,
  onSave,
  onInsert,
  canInsert = false,
}: {
  snippets: Snippet[];
  onSave: (request: Request) => Promise<void>;
  onInsert?: (text: string) => void;
  canInsert?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [editing, setEditing] = useState<Snippet | 'new' | null>(null);
  const [remove, setRemove] = useState<Snippet | null>(null);
  const [insert, setInsert] = useState<Snippet | null>(null);
  const categories = [...new Set(snippets.map((s) => s.category).filter(Boolean))].sort();
  const filtered = snippets.filter(
    (s) =>
      (category === 'all' || s.category === category) &&
      `${s.title} ${s.content} ${s.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORDS WORTH KEEPING</p>
          <h1>Write it once.</h1>
          <p className="muted">Your voice, ready when you need it.</p>
        </div>
        <button className="primary" onClick={() => setEditing('new')}>
          <Plus size={14} /> New snippet
        </button>
      </div>
      <div className="filter-bar">
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="Search snippets"
            placeholder="Search your snippets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter snippet category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {!filtered.length && (
        <Empty
          title={snippets.length ? 'No matching snippets' : 'Your next email, a little easier.'}
        >
          Save a follow-up, introduction or thank-you message. Use {'{{first_name}}'} for a value
          you’ll fill in before inserting.
        </Empty>
      )}
      {filtered.map((s) => (
        <article className="snippet-card" key={s.id}>
          <div className="card-top">
            <div>
              <h2>{s.title}</h2>
              {s.category && <span className="tag">{s.category}</span>}
            </div>
            <div className="card-actions">
              <button
                className="icon-button"
                aria-label={`Edit ${s.title}`}
                onClick={() => setEditing(s)}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button danger"
                aria-label={`Delete ${s.title}`}
                onClick={() => setRemove(s)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <p className="snippet-preview">{s.content}</p>
          {onInsert && (
            <button
              className="snippet-insert"
              disabled={!canInsert}
              title={
                canInsert
                  ? 'Insert at your draft cursor'
                  : 'Focus a Gmail draft, then reopen snippets.'
              }
              onClick={() => setInsert(s)}
            >
              Insert snippet
            </button>
          )}
        </article>
      ))}
      {editing && (
        <SnippetEditor
          key={editing === 'new' ? 'new' : editing.id}
          snippet={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={onSave}
        />
      )}
      {remove && (
        <Confirm
          title="Delete snippet?"
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await onSave({ type: 'delete-snippet', id: remove.id });
            setRemove(null);
          }}
        >
          “{remove.title}” will be removed from this browser. Export a backup first if you want to
          keep it.
        </Confirm>
      )}
      {insert && (
        <InsertSnippet
          snippet={insert}
          onClose={() => setInsert(null)}
          onInsert={(text) => {
            if (!onInsert) throw new Error('Return to Gmail to insert snippets.');
            onInsert(text);
            setInsert(null);
          }}
        />
      )}
    </section>
  );
}
function SnippetEditor({
  snippet,
  onSave,
  onClose,
}: {
  snippet?: Snippet;
  onSave: (request: Request) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(snippet?.title ?? '');
  const [content, setContent] = useState(snippet?.content ?? '');
  const [category, setCategory] = useState(snippet?.category ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { requestClose: close, confirmation } = useUnsavedChanges(
    title !== (snippet?.title ?? '') ||
      content !== (snippet?.content ?? '') ||
      category !== (snippet?.category ?? ''),
    onClose,
    busy,
  );
  return (
    <>
      <Modal title={snippet ? 'Edit snippet' : 'New snippet'} onClose={close} busy={busy}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (!title.trim() || !content.trim()) {
              setError('Add a snippet name and some text before saving.');
              return;
            }
            try {
              getTemplateVariables(content);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Check template variables.');
              return;
            }
            setBusy(true);
            void onSave({
              type: 'save-snippet',
              snippet: {
                ...(snippet ? { id: snippet.id } : {}),
                title: title.trim(),
                content,
                category: category.trim(),
              },
            })
              .then(onClose)
              .catch((e) =>
                setError(e instanceof Error ? e.message : 'Snippet could not be saved.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Snippet name</span>
              <input
                disabled={busy}
                aria-label="Snippet name"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Category</span>
              <input
                disabled={busy}
                aria-label="Category"
                maxLength={100}
                placeholder="e.g. Follow-ups"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Snippet content</span>
              <textarea
                disabled={busy}
                aria-label="Snippet content"
                required
                maxLength={100000}
                rows={7}
                placeholder={'Hi {{first_name}},\n\nJust following up on our conversation.'}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <small>
                Plain text only. Variables such as {'{{first_name}}'} are filled in by you before
                insertion.
              </small>
            </label>
            {error && (
              <p role="alert" className="error-box">
                {error}
              </p>
            )}
          </div>
          <footer className="form-actions">
            <button type="button" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save snippet'}
            </button>
          </footer>
        </form>
      </Modal>
      {confirmation}
    </>
  );
}
function InsertSnippet({
  snippet,
  onClose,
  onInsert,
}: {
  snippet: Snippet;
  onClose: () => void;
  onInsert: (text: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const { requestClose, confirmation } = useUnsavedChanges(
    Object.values(values).some((v) => v.length > 0),
    onClose,
  );
  let variables: string[] = [];
  try {
    variables = getTemplateVariables(snippet.content);
  } catch {
    /* A malformed imported template gets an explicit resolution error on submit. */
  }
  return (
    <>
      <Modal title={`Insert ${snippet.title}`} onClose={requestClose} restoreFocus={false}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const dialog = e.currentTarget.closest<HTMLDialogElement>('dialog');
            try {
              const text = resolveTemplate(snippet.content, values);
              // A modal makes Gmail's composer inert. Release it before requesting native focus.
              dialog?.close();
              onInsert(text);
            } catch (e) {
              if (dialog && !dialog.open) dialog.showModal();
              setError(
                e instanceof Error ? e.message : 'The draft changed. Focus it and try again.',
              );
            }
          }}
        >
          <div className="form-grid">
            {variables.map((name) => (
              <label className="field" key={name}>
                <span>{name.replaceAll('_', ' ')}</span>
                <input
                  aria-label={name}
                  required
                  maxLength={1000}
                  value={values[name] ?? ''}
                  onChange={(e) => setValues({ ...values, [name]: e.target.value })}
                />
              </label>
            ))}
            <div className="snippet-resolved-preview">
              <span className="eyebrow">PREVIEW</span>
              <p>
                {snippet.content.replace(
                  /\{\{([^{}]*)\}\}/g,
                  (_match, raw: string) =>
                    values[raw.trim()] || `[${raw.trim().replaceAll('_', ' ')}]`,
                )}
              </p>
            </div>
            <p className="muted">
              Inserts plain text at the captured cursor. Existing draft content is preserved.
              Nothing is sent.
            </p>
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="form-actions">
            <button type="button" onClick={requestClose}>
              Cancel
            </button>
            <button className="primary">Insert into draft</button>
          </footer>
        </form>
      </Modal>
      {confirmation}
    </>
  );
}
