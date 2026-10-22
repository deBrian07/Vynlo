import { useEffect, useRef, useState } from 'react';
import { GmailAdapter } from '../../src/gmail/adapter';
import { Snippets } from '../../src/features/snippets/Snippets';
import { getSnapshot, request } from '../../src/services/client';
import type { Request } from '../../src/types/messages';
import type { Snippet } from '../../src/types/model';

let fixtureReady: Promise<void> | undefined;
function ensureFixture() {
  return (fixtureReady ??= (async () => {
    const snapshot = await getSnapshot();
    if (snapshot.snippets.some((snippet) => snippet.title === 'Draft safety check')) return;
    await request({
      type: 'save-snippet',
      snippet: {
        title: 'Draft safety check',
        category: 'Fictional QA',
        content: 'Hello {{first_name}} at {{company}}.',
      },
    });
  })());
}

/** Exercises native Chromium editing using actual production components and adapter. */
export function DraftLab() {
  const [adapter] = useState(() => new GmailAdapter());
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [message, setMessage] = useState('');
  const editor = useRef<HTMLDivElement>(null);
  const refresh = async () => {
    const snapshot = await getSnapshot();
    setSnippets(snapshot.snippets);
  };
  useEffect(() => {
    let active = true;
    void ensureFixture()
      .then(() => getSnapshot())
      .then((snapshot) => {
        if (active) setSnippets(snapshot.snippets);
      })
      .catch(() => {
        if (active) setMessage('The local snippets could not be loaded.');
      });
    const composer = editor.current;
    if (composer) {
      composer.setAttribute('g_editable', 'true');
      composer.focus();
      const range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      adapter.captureComposer();
    }
    return () => {
      active = false;
    };
  }, [adapter]);
  const save = async (change: Request) => {
    await request(change);
    await refresh();
  };
  return (
    <div style={{ maxWidth: 1000, width: '100%', margin: '32px auto', padding: '0 24px' }}>
      <header role="banner" style={{ marginBottom: 24 }}>
        <p className="eyebrow">FICTIONAL COMPOSE LAB</p>
        <h1>Try a snippet in a real browser editor.</h1>
        <p className="muted">
          Fictional draft only. Uses Vynlo’s actual snippet dialog and Gmail adapter. This does not
          test Gmail’s autosave or sending behavior.
        </p>
        <button aria-label="Google Account: Jordan Example (jordan@example.com)">
          jordan@example.com
        </button>
      </header>
      <main role="main">
        <label className="field">
          <span>Fictional draft</span>
          <div
            ref={editor}
            role="textbox"
            aria-label="Preview draft"
            contentEditable
            suppressContentEditableWarning
            tabIndex={0}
            style={{
              minHeight: 130,
              padding: 20,
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--bg)',
              whiteSpace: 'pre-wrap',
              marginBottom: 24,
            }}
          >
            {'Existing draft. '}
          </div>
        </label>
        <p role="status" className="muted">
          {message ||
            'Choose Draft safety check below. You can undo insertion with your browser’s normal editing shortcut.'}
        </p>
        <section
          onPointerDownCapture={(event) => {
            if (event.target instanceof Element && event.target.closest('button'))
              adapter.captureComposer();
          }}
          style={{ marginTop: 32 }}
        >
          <Snippets
            snippets={snippets}
            canInsert
            onSave={save}
            onInsert={(text) => {
              adapter.insertIntoComposer(text);
              setMessage(
                'Inserted as plain text. Existing content is preserved. Nothing was sent.',
              );
            }}
          />
        </section>
      </main>
    </div>
  );
}
