import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCheck,
  FileText,
  UsersRound,
  Settings2,
  X,
  ShieldCheck,
  ExternalLink,
  BellPlus,
  type LucideIcon,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  type Conversation,
  type ConversationRef,
  type GmailContext,
  type Reminder,
  type Settings,
  type Snapshot,
} from '../types/model';
import type { Request } from '../types/messages';
import type { GmailAdapter } from '../gmail/adapter';
import { getSnapshot, request } from '../services/client';
import { conversationId } from '../services/validation';
import { Dashboard } from '../features/conversations/Dashboard';
import { ConversationEditor } from '../features/conversations/ConversationEditor';
import { ReminderEditor } from '../features/reminders/ReminderEditor';
import { Snippets } from '../features/snippets/Snippets';
import { Contacts } from '../features/contacts/Contacts';
import { SettingsView } from '../features/settings/SettingsView';
import { Confirm, Loading, Logo } from './ui';

type View = Settings['landingView'] | 'settings';
interface Props {
  context?: GmailContext;
  adapter?: GmailAdapter;
  initialView?: View;
  editSignal?: number;
  reminderSignal?: number;
  onClose?: () => void;
  options?: boolean;
}
export default function Workspace({
  context,
  adapter,
  initialView = 'dashboard',
  editSignal = 0,
  reminderSignal = 0,
  onClose,
  options = false,
}: Props) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [editing, setEditing] = useState<ConversationRef | null>(null);
  const [reminder, setReminder] = useState<ConversationRef | null>(null);
  const [removing, setRemoving] = useState<Conversation | null>(null);
  const [welcome, setWelcome] = useState(true);
  const accountId = options ? selectedAccount || undefined : context?.account?.id;
  const generation = useRef(0);
  const liveAccount = useRef(accountId);
  liveAccount.current = accountId;
  const refresh = useCallback(async () => {
    const run = ++generation.current;
    try {
      const result = await getSnapshot(options ? undefined : accountId);
      if (run !== generation.current) return;
      setData(result);
      setError('');
      setLoading(false);
    } catch (e) {
      if (run === generation.current) {
        setError(e instanceof Error ? e.message : 'Your workspace could not be loaded.');
        setLoading(false);
      }
    }
  }, [accountId, options]);
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [refresh]);
  useEffect(() => {
    setView(initialView);
  }, [initialView]);
  useEffect(() => {
    if (options && data?.accounts.length && !selectedAccount)
      setSelectedAccount(data.accounts[0]!.id);
  }, [options, data, selectedAccount]);
  useEffect(() => {
    setEditing(null);
    setReminder(null);
    setRemoving(null);
  }, [accountId]);
  const lastEdit = useRef(0),
    lastReminder = useRef(0);
  useEffect(() => {
    if (editSignal > lastEdit.current) {
      lastEdit.current = editSignal;
      const ref = adapter?.getContext().conversation;
      if (ref) setEditing(ref);
    }
  }, [editSignal, adapter]);
  useEffect(() => {
    if (reminderSignal > lastReminder.current) {
      lastReminder.current = reminderSignal;
      const ref = adapter?.getContext().conversation;
      if (ref) setReminder(ref);
    }
  }, [reminderSignal, adapter]);
  const mutate = async (message: Request) => {
    if ('accountId' in message && message.accountId !== liveAccount.current)
      throw new Error('The Gmail account changed. Reopen this action.');
    if (message.type === 'track' && message.ref.accountId !== liveAccount.current)
      throw new Error('The Gmail account changed. Reopen the conversation.');
    await request(message);
    await refresh();
  };
  const act = (action: () => Promise<unknown>, success?: string) => {
    void action()
      .then(() => {
        if (success) setToast(success);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'This action could not be completed.'),
      );
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const conversations = (data?.conversations ?? []).filter(
    (c) => accountId && c.accountId === accountId,
  );
  const contacts = (data?.contacts ?? []).filter((c) => accountId && c.accountId === accountId);
  const reminders = (data?.reminders ?? []).filter((c) => accountId && c.accountId === accountId);
  const settings = data?.settings ?? DEFAULT_SETTINGS;
  const current = context?.conversation;
  const findExisting = (ref: ConversationRef) =>
    conversations.find((c) => c.id === conversationId(ref.accountId, ref.threadId));
  const findReminder = (ref: ConversationRef) =>
    reminders.find(
      (r) =>
        r.conversationId === conversationId(ref.accountId, ref.threadId) && r.state !== 'dismissed',
    );
  const reminderAction = (r: Reminder, action: 'snooze' | 'dismiss') =>
    mutate({
      type: 'reminder-action',
      accountId: r.accountId,
      id: r.id,
      action,
      ...(action === 'snooze' ? { dueAt: Date.now() + 86400000 } : {}),
    });
  const guardedClose = () => {
    if ((editing || reminder) && !window.confirm('Discard unsaved changes and close Vynlo?'))
      return;
    onClose?.();
  };
  const changeView = (next: View) => {
    if (editing || reminder) return;
    setView(next);
  };
  return (
    <div className={`workspace-panel ${options ? 'full-page' : ''}`} aria-label="Vynlo workspace">
      <header className="workspace-header">
        <Logo />
        <div className="header-actions">
          {current && (
            <>
              <button
                className="icon-button"
                title="Set reminder"
                aria-label="Set reminder for current conversation"
                onClick={() => setReminder(current)}
              >
                <BellPlus size={17} />
              </button>
              <button className="track-current" onClick={() => setEditing(current)}>
                {findExisting(current) ? 'Edit tracking' : 'Track conversation'}
              </button>
            </>
          )}
          {onClose && (
            <button className="icon-button" aria-label="Close Vynlo" onClick={guardedClose}>
              <X size={18} />
            </button>
          )}
        </div>
      </header>
      <div className="account-bar">
        <span className="account-dot" />
        {options ? (
          <select
            aria-label="Workspace account"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
          >
            <option value="">Select account</option>
            {data?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        ) : (
          (context?.account?.email ?? 'Account not identified')
        )}
      </div>
      <nav className="workspace-nav" aria-label="Vynlo navigation">
        {(
          [
            { id: 'dashboard', label: 'Conversations', icon: CheckCheck },
            { id: 'snippets', label: 'Snippets', icon: FileText },
            { id: 'contacts', label: 'Contacts', icon: UsersRound },
            ...(options ? [{ id: 'settings' as const, label: 'Settings', icon: Settings2 }] : []),
          ] satisfies { id: View; label: string; icon: LucideIcon }[]
        ).map((item) => (
          <button
            key={item.id}
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => changeView(item.id)}
          >
            <item.icon size={15} />
            {item.label}
          </button>
        ))}
        {!options && (
          <button onClick={() => act(() => request({ type: 'options' }))}>
            <Settings2 size={15} />
            Settings
            <ExternalLink size={10} />
          </button>
        )}
      </nav>
      <div className="workspace-body">
        {error && (
          <div className="error-box" role="alert">
            {error}
            <button onClick={() => void refresh()}>Try again</button>
          </div>
        )}
        {loading ? (
          <Loading />
        ) : (
          data && (
            <>
              {!options && welcome && !settings.onboarded && (
                <div className="notice">
                  <strong>A quieter way to keep up.</strong>
                  <p>
                    Track the conversations that matter, leave yourself a note and come back at the
                    right time. Everything stays in this browser. Reminders don’t check for replies.
                  </p>
                  <button onClick={() => setWelcome(false)}>Got it</button>
                  <button onClick={() => act(() => request({ type: 'options' }))}>
                    Personalize Vynlo
                  </button>
                </div>
              )}
              {!options && !context?.account && view !== 'snippets' && (
                <div className="notice">
                  {context?.reason ??
                    'Vynlo cannot safely identify this Gmail account. Account data is unavailable.'}
                </div>
              )}
              {!options && context?.account && !current && view === 'dashboard' && (
                <div className="context-hint muted">{context?.reason}</div>
              )}
              {view === 'dashboard' && (
                <Dashboard
                  conversations={conversations}
                  reminders={reminders}
                  settings={settings}
                  onEdit={setEditing}
                  onOpen={(c) =>
                    act(() =>
                      request({ type: 'open', accountId: c.accountId, conversationId: c.id }),
                    )
                  }
                  onResolve={(c) =>
                    act(
                      () => mutate({ type: 'track', ref: c, status: 'resolved' }),
                      'Conversation resolved',
                    )
                  }
                  onReminder={setReminder}
                  onReminderAction={(r, a) =>
                    act(
                      () => reminderAction(r, a),
                      a === 'snooze' ? 'Reminder snoozed for 1 day' : 'Reminder dismissed',
                    )
                  }
                />
              )}
              {view === 'snippets' && (
                <Snippets
                  snippets={data.snippets}
                  onSave={mutate}
                  canInsert={context?.hasComposer}
                  onInsert={
                    adapter
                      ? (text) => {
                          adapter.insertIntoComposer(text);
                          setToast('Snippet inserted. Your email has not been sent.');
                        }
                      : undefined
                  }
                />
              )}
              {view === 'contacts' && (
                <Contacts contacts={contacts} accountId={accountId} onSave={mutate} />
              )}
              {view === 'settings' && options && (
                <SettingsView
                  snapshot={data}
                  onSave={mutate}
                  onRefresh={refresh}
                  onSnippets={() => setView('snippets')}
                />
              )}
            </>
          )
        )}
      </div>
      <footer className="workspace-footer">
        <span>
          <ShieldCheck size={12} /> Local to this browser
        </span>
        <span>Email, without the friction.</span>
      </footer>
      {editing && (
        <ConversationEditor
          key={conversationId(editing.accountId, editing.threadId)}
          refValue={editing}
          existing={findExisting(editing)}
          onSave={mutate}
          onClose={() => setEditing(null)}
          onReminder={() => {
            setReminder(editing);
            setEditing(null);
          }}
          onRemove={() => {
            const c = findExisting(editing);
            if (c) setRemoving(c);
          }}
        />
      )}
      {reminder && (
        <ReminderEditor
          key={conversationId(reminder.accountId, reminder.threadId)}
          conversation={reminder}
          existing={findReminder(reminder)}
          defaultHours={settings.reminderHours}
          onClose={() => setReminder(null)}
          onSave={async (dueAt) => {
            let c = findExisting(reminder);
            if (!c || c.status === 'resolved') {
              await mutate({ type: 'track', ref: reminder, status: 'follow-up' });
              c = {
                ...reminder,
                id: conversationId(reminder.accountId, reminder.threadId),
                status: 'follow-up',
                note: '',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
            }
            await mutate({
              type: 'remind',
              accountId: reminder.accountId,
              conversationId: c.id,
              dueAt,
            });
            setToast('Reminder scheduled');
          }}
          onDismiss={
            findReminder(reminder)
              ? () => reminderAction(findReminder(reminder)!, 'dismiss')
              : undefined
          }
        />
      )}
      {removing && (
        <Confirm
          title="Remove conversation tracking?"
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            act(async () => {
              await mutate({ type: 'untrack', accountId: removing.accountId, id: removing.id });
              setRemoving(null);
              setEditing(null);
            }, 'Tracking removed')
          }
        >
          This removes the status, note and reminder from Vynlo. Your Gmail conversation is
          unchanged.
        </Confirm>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
