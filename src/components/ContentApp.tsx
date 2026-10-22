import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Command, PanelsTopLeft } from 'lucide-react';
import type { GmailAdapter } from '../gmail/adapter';
import { getSnapshot, request } from '../services/client';
import { conversationId } from '../services/validation';
import {
  DEFAULT_SETTINGS,
  SHORTCUT_LABELS,
  STATUS_LABELS,
  STATUSES,
  type GmailContext,
  type Settings,
  type ShortcutAction,
  type Status,
} from '../types/model';
import { matchShortcut, formatShortcut } from '../features/shortcuts/shortcuts';
import { CommandPalette } from '../features/command-palette/CommandPalette';
import { createCommandRegistry } from '../features/command-palette/registry';
import { Loading, Modal } from './ui';
import { ThreadControl, threadControlPosition } from '../features/conversations/ThreadControl';
import { DraftTracking } from '../features/open-tracking/DraftTracking';
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
  const [draftTracking, setDraftTracking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  const [trackedStatus, setTrackedStatus] = useState<Status | undefined>();
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => adapter.subscribe(setContext), [adapter]);
  useEffect(() => {
    const conversation = context.conversation;
    if (!conversation) {
      setTrackedStatus(undefined);
      return;
    }
    let active = true;
    const load = () => {
      void getSnapshot(conversation.accountId)
        .then((data) => {
          if (!active) return;
          const id = conversationId(conversation.accountId, conversation.threadId);
          setTrackedStatus(data.conversations.find((row) => row.id === id)?.status);
        })
        .catch(() => {
          if (active) setTrackedStatus(undefined);
        });
    };
    load();
    chrome.storage.onChanged.addListener(load);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(load);
    };
  }, [context.conversation]);
  useEffect(() => {
    if (!context.conversation) {
      setAnchor(null);
      return;
    }
    const place = () => {
      const bar = adapter.findConversationToolbar();
      const next = bar
        ? threadControlPosition(bar.getBoundingClientRect(), window.innerWidth)
        : null;
      setAnchor((current) => {
        if (!next) return current === null ? current : null;
        if (current && current.top === next.top && current.left === next.left) return current;
        return next;
      });
    };
    let frame: number | undefined;
    const schedulePlacement = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        place();
      });
    };
    const stop = adapter.onLayout(schedulePlacement);
    window.addEventListener('resize', schedulePlacement);
    document.addEventListener('scroll', schedulePlacement, { capture: true, passive: true });
    return () => {
      stop();
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedulePlacement);
      document.removeEventListener('scroll', schedulePlacement, true);
    };
  }, [adapter, context.conversation]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await getSnapshot();
        if (active) {
          setSettings(data.settings);
          if (!started.current && data.settings.openOnStartup) {
            setView(data.settings.landingView);
            setOpen(true);
          }
          started.current = true;
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
  }, []);
  const show = useCallback(
    (next = settings.landingView) => {
      adapter.captureComposer();
      setView(next);
      setOpen(true);
    },
    [adapter, settings.landingView],
  );
  const perform = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This action could not be completed.');
    }
  }, []);
  const mark = useCallback(
    async (status: Status) => {
      const ref = adapter.getContext().conversation;
      if (!ref) throw new Error('Open a supported conversation first.');
      await request({ type: 'track', ref, status });
      setNotice(`Marked ${STATUS_LABELS[status]}`);
    },
    [adapter],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!settings.enabled || palette || help) return;
      if (
        event.composedPath().some((target) => target instanceof Element && target.closest('dialog'))
      )
        return;
      const action = (Object.entries(settings.shortcuts) as [ShortcutAction, string][]).find(
        ([, binding]) => matchShortcut(event, binding),
      )?.[0];
      if (!action) return;
      if (open && action !== 'palette') return;
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
  }, [adapter, help, mark, open, palette, perform, settings.enabled, settings.shortcuts, show]);
  const commands = createCommandRegistry([
    {
      id: 'dashboard',
      title: 'Open Vynlo dashboard',
      group: 'Workspace',
      shortcut: formatShortcut(settings.shortcuts.dashboard),
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
      shortcut:
        status === 'waiting' || status === 'resolved'
          ? formatShortcut(settings.shortcuts[status])
          : undefined,
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
    {
      id: 'snippets',
      title: 'Open snippets',
      group: 'Writing',
      shortcut: formatShortcut(settings.shortcuts.snippets),
      run: () => show('snippets'),
    },
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
  if (!ready)
    return error ? (
      <div className="vynlo theme-light">
        <div className="gmail-launcher connection-error" role="alert">
          <span>{error}</span>
          <button onClick={() => window.location.reload()}>Reload Gmail</button>
        </div>
      </div>
    ) : null;
  if (!settings.enabled) return null;
  return (
    <div className={`vynlo theme-${settings.theme === 'system' ? context.theme : settings.theme}`}>
      {!open && anchor && (
        <ThreadControl
          status={trackedStatus}
          position={anchor}
          onClick={() => {
            show('dashboard');
            setEdit((n) => n + 1);
          }}
        />
      )}
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
          {context.hasComposer && context.account && (
            <button
              className="launcher-track"
              onPointerDown={() => adapter.captureComposer()}
              onClick={() => {
                adapter.captureComposer();
                const account = adapter.getCurrentAccount();
                if (account) setDraftTracking(account.id);
              }}
            >
              Track this draft
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
            onPalette={() => {
              adapter.captureComposer();
              setPalette(true);
            }}
          />
        </Suspense>
      )}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {draftTracking && (
        <DraftTracking
          adapter={adapter}
          accountId={draftTracking}
          onClose={() => setDraftTracking(null)}
          onDone={setNotice}
        />
      )}
      {help && (
        <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <dl className="shortcut-list">
            {Object.entries(settings.shortcuts).map(([key, value]) => (
              <div key={key}>
                <dt>{SHORTCUT_LABELS[key as ShortcutAction]}</dt>
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
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            onClick={() => {
              show('dashboard');
              setNotice('');
            }}
          >
            View
          </button>
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
