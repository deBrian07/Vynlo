import { useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Confirm, Empty, Modal } from '../../components/ui';
import type { Contact } from '../../types/model';
import type { Request } from '../../types/messages';

export function Contacts({
  contacts,
  accountId,
  onSave,
}: {
  contacts: Contact[];
  accountId?: string;
  onSave: (request: Request) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [edit, setEdit] = useState<Contact | 'new' | null>(null);
  const [remove, setRemove] = useState<Contact | null>(null);
  const [error, setError] = useState('');
  const filtered = contacts.filter((c) =>
    `${c.email} ${c.name} ${c.note} ${c.tags.join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE PEOPLE BEHIND THE EMAIL</p>
          <h1>A little context.</h1>
          <p className="muted">Remember what matters. Keep it local.</p>
        </div>
        <button
          className="primary"
          disabled={!accountId}
          title={accountId ? 'Add a contact note' : 'Select a verified Gmail account first.'}
          onClick={() => setEdit('new')}
        >
          <Plus size={14} /> Add contact
        </button>
      </div>
      <label className="search-box">
        <Search size={16} />
        <input
          aria-label="Search contacts"
          placeholder="Search names, notes or tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {!filtered.length && (
        <Empty
          title={contacts.length ? 'No matching contacts' : 'Good conversations deserve context.'}
        >
          Add someone’s email and a note yourself. Vynlo doesn’t scrape your contacts or guess who a
          conversation is about.
        </Empty>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {filtered.map((c) => (
        <article className="contact-card" key={c.id}>
          <div className="card-top">
            <div>
              <h2>{c.name || c.email}</h2>
              {c.name && <p className="muted">{c.email}</p>}
            </div>
            <div className="card-actions">
              <button
                className="icon-button"
                aria-label={`Edit ${c.email}`}
                onClick={() => setEdit(c)}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button danger"
                aria-label={`Delete ${c.email}`}
                onClick={() => setRemove(c)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <p className="contact-note">{c.note}</p>
          <div className="tags">
            {c.tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        </article>
      ))}
      {edit && accountId && (
        <ContactEditor
          key={edit === 'new' ? 'new' : edit.id}
          contact={edit === 'new' ? undefined : edit}
          accountId={accountId}
          onSave={onSave}
          onClose={() => setEdit(null)}
        />
      )}
      {remove && (
        <Confirm
          title="Delete contact note?"
          onClose={() => setRemove(null)}
          onConfirm={() =>
            void onSave({ type: 'delete-contact', accountId: remove.accountId, id: remove.id })
              .then(() => setRemove(null))
              .catch((e) =>
                setError(e instanceof Error ? e.message : 'Contact note could not be deleted.'),
              )
          }
        >
          Your note for {remove.email} will be removed from this browser.
        </Confirm>
      )}
    </section>
  );
}
function ContactEditor({
  contact,
  accountId,
  onSave,
  onClose,
}: {
  contact?: Contact;
  accountId: string;
  onSave: (r: Request) => Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(contact?.email ?? '');
  const [name, setName] = useState(contact?.name ?? '');
  const [note, setNote] = useState(contact?.note ?? '');
  const [tags, setTags] = useState(contact?.tags.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (
      (email !== (contact?.email ?? '') ||
        name !== (contact?.name ?? '') ||
        note !== (contact?.note ?? '') ||
        tags !== (contact?.tags.join(', ') ?? '')) &&
      !window.confirm('Discard unsaved contact changes?')
    )
      return;
    onClose();
  };
  return (
    <Modal title={contact ? 'Edit contact note' : 'Add contact note'} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void onSave({
            type: 'save-contact',
            contact: {
              accountId,
              email: email.trim().toLowerCase(),
              name: name.trim(),
              note,
              tags: [
                ...new Set(
                  tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                ),
              ],
            },
          })
            .then(onClose)
            .catch((e) =>
              setError(e instanceof Error ? e.message : 'Contact note could not be saved.'),
            )
            .finally(() => setBusy(false));
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Email address</span>
            <input
              aria-label="Contact email"
              type="email"
              required
              disabled={!!contact}
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Display name</span>
            <input
              aria-label="Display name"
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea
              aria-label="Contact notes"
              maxLength={10000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Tags</span>
            <input
              aria-label="Contact tags"
              maxLength={2000}
              placeholder="Colleague, design, coffee"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <small>Separate tags with commas. Up to 50 tags, 100 characters each.</small>
          </label>
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
        </div>
        <footer className="form-actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save contact'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
