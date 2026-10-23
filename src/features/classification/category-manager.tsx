import { useId, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Confirm, Modal } from '../../components/ui';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { classificationClient } from './client';
import {
  CATEGORIES,
  CATEGORY_IDS,
  MAX_CUSTOM_CATEGORIES,
  type Category,
  type TaggedConversation,
  type UserCategory,
} from './model';
import './categories.css';

export const categoryOptions = (categories: UserCategory[]) => [
  ...CATEGORY_IDS.map((id) => ({
    id,
    name: CATEGORIES[id].label,
    description: CATEGORIES[id].description,
  })),
  ...categories,
];
export const categoryLabel = (id: Category, categories: UserCategory[]) =>
  categoryOptions(categories).find((category) => category.id === id)?.name ??
  'Unavailable category';
const normalize = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function CategoryManager({
  accountId,
  categories,
  tags,
  onUpdated,
}: {
  accountId?: string | null;
  categories: UserCategory[];
  tags: TaggedConversation[];
  onUpdated: () => void;
}) {
  const [edit, setEdit] = useState<UserCategory | 'new' | null>(null);
  const [remove, setRemove] = useState<UserCategory | null>(null);
  const scoped = categories.filter((category) => category.accountId === accountId);
  const full = scoped.length >= MAX_CUSTOM_CATEGORIES;
  return (
    <section className="category-manager" aria-label="Your categories">
      <div className="card-top">
        <div>
          <h2>Your categories</h2>
          <p className="muted">Teach Vynlo what belongs together, in your own words.</p>
        </div>
        <button
          type="button"
          disabled={!accountId || full}
          title={
            !accountId
              ? 'Select a verified Gmail account first.'
              : full
                ? 'You can create up to 16 categories.'
                : 'Create a category'
          }
          onClick={() => setEdit('new')}
        >
          <Plus size={14} aria-hidden="true" /> New category
        </button>
      </div>
      <p className="muted">
        Manually confirm at least 3 different subjects in a category to make it available for
        automatic suggestions. Examples stay local and guide future suggestions; they do not retrain
        the model. AI suggestions become examples only when you confirm them.
      </p>
      {!accountId && <p className="muted">Select a verified Gmail account to manage categories.</p>}
      {full && (
        <p className="muted">16 of 16 custom categories. Edit or delete one to make room.</p>
      )}
      {scoped.map((category) => {
        const count = new Set(
          tags
            .filter(
              (tag) =>
                tag.accountId === accountId &&
                tag.category === category.id &&
                tag.source === 'manual' &&
                tag.reviewed &&
                normalize(tag.title),
            )
            .map((tag) => normalize(tag.title)),
        ).size;
        return (
          <article className="category-row" key={category.id}>
            <div>
              <h3>{category.name}</h3>
              <p className="muted">{category.description}</p>
              <small>
                {count} confirmed {count === 1 ? 'example' : 'examples'} ·{' '}
                {count < 3 ? '3 examples needed for automatic suggestions' : 'Examples available'}
              </small>
            </div>
            <div className="card-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={`Edit category ${category.name}`}
                onClick={() => setEdit(category)}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="icon-button danger"
                aria-label={`Delete category ${category.name}`}
                onClick={() => setRemove(category)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        );
      })}
      {edit && accountId && (
        <CategoryEditor
          key={`${accountId}:${edit === 'new' ? 'new' : edit.id}`}
          accountId={accountId}
          category={edit === 'new' ? undefined : edit}
          categories={scoped}
          onUpdated={onUpdated}
          onClose={() => setEdit(null)}
        />
      )}
      {remove && (
        <Confirm
          title={`Delete ${remove.name}?`}
          label="Delete category"
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await classificationClient.deleteCategory(remove.accountId, remove.id);
            onUpdated();
            setRemove(null);
          }}
        >
          This removes the category, its Vynlo tags and its confirmed learning examples from this
          account. Your Gmail messages and labels are unchanged.
        </Confirm>
      )}
    </section>
  );
}
function CategoryEditor({
  accountId,
  category,
  categories,
  onUpdated,
  onClose,
}: {
  accountId: string;
  category?: UserCategory;
  categories: UserCategory[];
  onUpdated: () => void;
  onClose: () => void;
}) {
  const descriptionHint = useId();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { requestClose, confirmation } = useUnsavedChanges(
    name !== (category?.name ?? '') || description !== (category?.description ?? ''),
    onClose,
    busy,
  );
  return (
    <>
      <Modal
        title={category ? 'Edit category' : 'Create category'}
        onClose={requestClose}
        busy={busy}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const duplicate = categoryOptions(categories).some(
              (item) => item.id !== category?.id && normalize(item.name) === normalize(name),
            );
            if (!name.trim() || !description.trim()) {
              setError('Add a name and a short description.');
              return;
            }
            if (duplicate) {
              setError('A category with this name already exists. Choose another name.');
              return;
            }
            setBusy(true);
            setError('');
            void classificationClient
              .saveCategory(accountId, name.trim(), description.trim(), category?.id)
              .then(() => {
                onUpdated();
                onClose();
              })
              .catch((cause: unknown) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'Your category could not be saved. Try again.',
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Category name</span>
              <input
                required
                maxLength={50}
                disabled={busy}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Research papers"
              />
            </label>
            <label className="field">
              <span>What belongs here?</span>
              <textarea
                aria-label="What belongs here?"
                aria-describedby={descriptionHint}
                required
                maxLength={160}
                disabled={busy}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Papers, preprints and reading discussions for my research."
              />
              <small id={descriptionHint}>
                Describe the topic, then confirm a few matching conversations. Up to 160 characters.
              </small>
            </label>
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="form-actions">
            <button type="button" disabled={busy} onClick={requestClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save category'}
            </button>
          </footer>
        </form>
      </Modal>
      {confirmation}
    </>
  );
}
