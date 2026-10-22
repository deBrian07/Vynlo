import { lazy, Suspense, useEffect, useState } from 'react';
import { Command, PanelsTopLeft } from 'lucide-react';
import type { GmailAdapter } from '../gmail/adapter';
import { getSnapshot, request } from '../services/client';
import {
  DEFAULT_SETTINGS,
  STATUS_LABELS,
  STATUSES,
  type GmailContext,
  type Settings,
  type ShortcutAction,
} from '../types/model';
import { matchShortcut, formatShortcut } from '../features/shortcuts/shortcuts';
import { CommandPalette } from '../features/command-palette/CommandPalette';
import { createCommandRegistry } from '../features/command-palette/registry';
import { Loading, Modal } from './ui';
const Workspace = lazy(() => import('./Workspace'));

export function ContentApp({ adapter }: { adapter: GmailAdapter }) {
  const [context, setContext] = useState<GmailContext>(() => adapter.getContext());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [view, setView] = useState<Settings['landingView']>('dashboard');
  const [edit, setEdit] = useState(0);
  const [remind, setRemind] = useState(0);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => adapter.subscribe(setContext), [adapter]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await getSnapshot();
        if (active) {
          setSettings(data.settings);
          if (!ready && data.settings.openOnStartup) {
            setView(data.settings.landingView);
            setOpen(true);
          }
          setReady(true);
        }
      } catch {
        if (active) setError('Vynlo could not load preferences. Reload Gmail to reconnect.');
      }
    };
    void load();
    chrome.storage.onChanged.addListener(load);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(load);
    };
    // Initial preferences are loaded once; later storage events update them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const show = (next = settings.landingView) => {
    adapter.captureComposer();
    setView(next);
    setOpen(true);
  };
  const perform = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This action could not be completed.');
    }
  };
  const mark = async (status: (typeof STATUSES)[number]) => {
    const ref = adapter.getContext().conversation;
    if (!ref) throw new Error('Open a supported conversation first.');
    await request({ type: 'track', ref, status });
    show();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!settings.enabled || open || palette || help) return;
      const action = (Object.entries(settings.shortcuts) as [ShortcutAction, string][]).find(
        ([, binding]) => matchShortcut(event, binding),
      )?.[0];
      if (!action) return;
      // Context actions never steal a key when unavailable.
      if ((action === 'waiting' || action === 'resolved') && !adapter.getContext().conversation)
        return;
      event.preventDefault();
      event.stopPropagation();
      adapter.captureComposer();
      if (action === 'palette') setPalette(true);
      else if (action === 'dashboard') show('dashboard');
      else if (action === 'snippets') show('snippets');
      else void perform(() => mark(action === 'waiting' ? 'waiting' : 'resolved'));
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });
  const commands = createCommandRegistry([
    {
      id: 'dashboard',
      title: 'Open Vynlo dashboard',
      group: 'Workspace',
      run: () => show('dashboard'),
    },
    {
      id: 'settings',
      title: 'Open Vynlo settings',
      group: 'Workspace',
      run: async () => {
        await request({ type: 'options' });
      },
    },
    ...STATUSES.map((status) => ({
      id: status,
      title: `Mark conversation as ${STATUS_LABELS[status]}`,
      group: 'Conversation',
      disabledReason: context.conversation
        ? undefined
        : context.reason || 'Open a supported conversation first.',
      run: () => mark(status),
    })),
    {
      id: 'reminder',
      title: 'Set a reminder',
      group: 'Conversation',
      disabledReason: context.conversation ? undefined : context.reason,
      run: () => {
        show('dashboard');
        setRemind((n) => n + 1);
      },
    },
    { id: 'snippets', title: 'Open snippets', group: 'Writing', run: () => show('snippets') },
    {
      id: 'insert',
      title: 'Insert a snippet',
      group: 'Writing',
      disabledReason: context.hasComposer ? undefined : 'Focus a Gmail draft first.',
      run: () => show('snippets'),
    },
    ...(['inbox', 'sent', 'drafts', 'starred'] as const).map((v) => ({
      id: v,
      title: `Go to Gmail ${v[0]!.toUpperCase() + v.slice(1)}`,
      group: 'Gmail',
      run: () => adapter.navigateToGmailView(v),
    })),
    {
      id: 'shortcuts',
      title: 'Display keyboard shortcuts',
      group: 'Help',
      run: () => setHelp(true),
    },
  ]);
  if (!ready || !settings.enabled) return null;
  return (
    <div className={`vynlo theme-${settings.theme === 'system' ? context.theme : settings.theme}`}>
      {!open && (
        <div className="gmail-launcher">
          <button
            className="launcher-button"
            aria-label="Open Vynlo"
            onPointerDown={() => adapter.captureComposer()}
            onClick={() => show()}
          >
            <span className="mini-mark">v</span>
            <span>Vynlo</span>
            <PanelsTopLeft size={16} />
          </button>
          {context.conversation && (
            <button
              className="launcher-track"
              onClick={() => {
                show('dashboard');
                setEdit((n) => n + 1);
              }}
              aria-label="Track conversation"
            >
              Track conversation
            </button>
          )}
          <button
            className="launcher-command"
            aria-label="Open command palette"
            title={formatShortcut(settings.shortcuts.palette)}
            onPointerDown={() => adapter.captureComposer()}
            onClick={() => setPalette(true)}
          >
            <Command size={16} />
          </button>
        </div>
      )}
      {open && (
        <Suspense
          fallback={
            <div className="workspace-panel">
              <Loading />
            </div>
          }
        >
          <Workspace
            context={context}
            adapter={adapter}
            initialView={view}
            editSignal={edit}
            reminderSignal={remind}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {help && (
        <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <dl className="shortcut-list">
            {Object.entries(settings.shortcuts).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  <kbd>{formatShortcut(value)}</kbd>
                </dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            Shortcuts pause while typing, including Gmail’s link shortcut. Customize them in
            Settings.
          </p>
        </Modal>
      )}
      {error && (
        <div className="toast error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
