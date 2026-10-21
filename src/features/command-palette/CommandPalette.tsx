import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { filterCommands, type Command } from './registry';

export type { Command } from './registry';

function focusedElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const executing = useRef(false);
  const id = useId();
  const filtered = filterCommands(commands, query);
  const currentIndex = Math.min(selected, Math.max(filtered.length - 1, 0));
  const current = filtered[currentIndex];

  useEffect(() => {
    mounted.current = true;
    const previous = focusedElement();
    input.current?.focus();
    return () => {
      mounted.current = false;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    list.current?.children[currentIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [currentIndex, query]);

  async function execute(command: Command) {
    if (executing.current) return;
    if (command.disabledReason) {
      setError(command.disabledReason);
      return;
    }
    executing.current = true;
    setBusy(true);
    setError('');
    try {
      await command.run();
      if (mounted.current) onClose();
    } catch {
      if (mounted.current)
        setError('This action could not finish. Check the Gmail view and try again.');
    } finally {
      executing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Vynlo commands"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            event.preventDefault();
            if (focusedElement() === input.current) close.current?.focus();
            else input.current?.focus();
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected(
              filtered.length
                ? (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
                    filtered.length
                : 0,
            );
          }
          if (event.key === 'Enter' && focusedElement() === input.current) {
            event.preventDefault();
            if (current) void execute(current);
          }
        }}
      >
        <div className="palette-search">
          <Search size={20} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-label="Search commands"
            aria-controls={`${id}-list`}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={current ? `${id}-option-${currentIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="What would you like to do?"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
              setError('');
            }}
          />
          <button ref={close} type="button" aria-label="Close command palette" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div
          className="palette-list"
          id={`${id}-list`}
          role="listbox"
          aria-label="Commands"
          aria-busy={busy}
          ref={list}
        >
          {filtered.map((command, index) => (
            <div
              key={command.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={currentIndex === index}
              aria-disabled={Boolean(command.disabledReason) || busy}
              className={`palette-command ${currentIndex === index ? 'is-selected' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void execute(command)}
            >
              <span>{command.title}</span>
              <span className="palette-command-meta">
                {command.disabledReason ?? command.group}
              </span>
            </div>
          ))}
        </div>
        {!filtered.length && (
          <p className="palette-empty" role="status">
            No commands match “{query}”. Try “reminder” or “inbox”.
          </p>
        )}
        {error && (
          <p className="palette-error" role="alert">
            {error}
          </p>
        )}
        <footer className="palette-footer">
          {busy ? 'Working…' : '↑ ↓ to select · Enter to run · Esc to close'}
        </footer>
      </section>
    </div>
  );
}
