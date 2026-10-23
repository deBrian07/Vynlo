import { isCustomCategoryId } from '../features/classification/model';
import {
  DEFAULT_SETTINGS,
  type Backup,
  type Settings,
  type Snapshot,
  type Snippet,
} from '../types/model';
import type { Request, Response } from '../types/messages';
import { VynloDatabase, type Records } from './storage/database';
import {
  contactId,
  conversationId,
  reminderId,
  safeConversationUrl,
  validBackup,
  validRequest,
  validSettings,
} from './validation';

export const REMINDER_ALARM = 'vynlo-next-reminder';
export interface MessageSender {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number };
}
export interface BackgroundPlatform {
  extensionId: string;
  getSettings(): Promise<unknown>;
  setSettings(settings: Settings): Promise<void>;
  setAlarm(at: number): Promise<void>;
  clearAlarm(): Promise<void>;
  notify(id: string): Promise<void>;
  clearNotification(id: string): Promise<void>;
  openTab(url: string): Promise<void>;
  openOptions(): Promise<void>;
  publishRevision?(): Promise<void>;
}
export function senderKind(
  sender: MessageSender,
  extensionId: string,
): 'gmail' | 'extension' | null {
  if (sender.id !== extensionId || !sender.url) return null;
  try {
    const url = new URL(sender.url);
    if (
      url.protocol === 'chrome-extension:' &&
      url.hostname === extensionId &&
      (url.pathname === '/options.html' || url.pathname === '/popup.html')
    )
      return 'extension';
    if (
      url.origin === 'https://mail.google.com' &&
      /^\/mail\//.test(url.pathname) &&
      sender.frameId === 0 &&
      sender.tab?.id !== undefined
    )
      return 'gmail';
  } catch {
    /* Invalid senders are rejected without inspecting page content. */
  }
  return null;
}
export function createBackgroundHandler({
  database = new VynloDatabase(),
  platform,
  now = Date.now,
  seedSnippets,
}: {
  database?: VynloDatabase;
  platform: BackgroundPlatform;
  now?: () => number;
  seedSnippets?: (now: number) => Snippet[];
}) {
  let queue: Promise<unknown> = Promise.resolve();
  let snippetsReady = false;
  const ensureSnippets = async () => {
    if (snippetsReady || !seedSnippets) return;
    await database.seedSnippets(seedSnippets(now()));
    snippetsReady = true;
  };
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };
  const settings = async (): Promise<Settings> => {
    const pending = await database.pendingSettings();
    if (pending !== undefined) {
      if (!validSettings(pending)) throw new Error('Settings need repair.');
      await platform.setSettings(pending);
      await database.finishSettings();
    }
    const stored = await platform.getSettings();
    if (stored === undefined) return structuredClone(DEFAULT_SETTINGS);
    if (!validSettings(stored)) throw new Error('Settings need repair.');
    return stored;
  };
  const snapshot = async (accountId?: string | null): Promise<Snapshot> => {
    const records = await database.read(accountId);
    return {
      ...records,
      accounts: records.accounts.filter((a) => !accountId || a.id === accountId),
      conversations: records.conversations.filter((c) => !accountId || c.accountId === accountId),
      contacts: records.contacts.filter((c) => !accountId || c.accountId === accountId),
      reminders: records.reminders.filter((r) => !accountId || r.accountId === accountId),
      settings: await settings(),
    };
  };
  const reconcileInternal = async () => {
    await ensureSnippets();
    const preferences = await settings();
    const dueNotifications: string[] = [];
    const time = now();
    let changed = false;
    await database.update((records) => {
      for (const reminder of records.reminders) {
        if (reminder.state === 'pending' && reminder.dueAt <= time) {
          reminder.state = 'due';
          reminder.updatedAt = time;
          changed = true;
        }
        // Commit the notification attempt before invoking Chrome: worker restarts never duplicate it.
        if (reminder.state === 'due' && reminder.notifiedAt === undefined) {
          reminder.notifiedAt = time;
          if (preferences.notifications) dueNotifications.push(reminder.id);
        }
      }
    });
    const records = await database.read();
    const future = records.reminders.filter((r) => r.state === 'pending').map((r) => r.dueAt);
    if (future.length) await platform.setAlarm(Math.min(...future));
    else await platform.clearAlarm();
    for (const id of dueNotifications) await platform.notify(id).catch(() => undefined);
    if (changed) await platform.publishRevision?.();
  };
  const requireConversation = (records: Records, accountId: string, id: string) => {
    const conversation = records.conversations.find(
      (c) => c.id === id && c.accountId === accountId,
    );
    if (!conversation) throw new Error('Conversation unavailable.');
    return conversation;
  };
  const apply = async (request: Request): Promise<void> => {
    const time = now();
    await database.update((records) => {
      const ensureAccount = (id: string) => {
        if (!records.accounts.some((a) => a.id === id))
          records.accounts.push({ id, email: id, createdAt: time });
      };
      switch (request.type) {
        case 'track': {
          ensureAccount(request.ref.accountId);
          const id = conversationId(request.ref.accountId, request.ref.threadId);
          let row = records.conversations.find((c) => c.id === id);
          if (!row) {
            row = {
              ...request.ref,
              id,
              status: request.status,
              note: request.note ?? '',
              createdAt: time,
              updatedAt: time,
            };
            records.conversations.push(row);
          } else {
            Object.assign(row, request.ref, { status: request.status, updatedAt: time });
            if (request.note !== undefined) row.note = request.note;
          }
          if (request.status === 'resolved')
            for (const reminder of records.reminders)
              if (reminder.conversationId === id && reminder.accountId === request.ref.accountId) {
                reminder.state = 'dismissed';
                reminder.updatedAt = time;
              }
          break;
        }
        case 'untrack':
          requireConversation(records, request.accountId, request.id);
          records.conversations = records.conversations.filter((c) => c.id !== request.id);
          records.reminders = records.reminders.filter((r) => r.conversationId !== request.id);
          break;
        case 'remind': {
          const conversation = requireConversation(
            records,
            request.accountId,
            request.conversationId,
          );
          if (conversation.status === 'resolved')
            throw new Error('Reopen this conversation before setting a reminder.');
          if (request.dueAt <= time) throw new Error('Choose a future date.');
          const id = reminderId(request.conversationId);
          const existing = records.reminders.find((r) => r.id === id);
          const row = {
            id,
            accountId: request.accountId,
            conversationId: request.conversationId,
            dueAt: request.dueAt,
            state: 'pending' as const,
            snoozeCount: existing?.snoozeCount ?? 0,
            createdAt: existing?.createdAt ?? time,
            updatedAt: time,
          };
          records.reminders = [...records.reminders.filter((r) => r.id !== id), row];
          break;
        }
        case 'reminder-action': {
          const row = records.reminders.find(
            (r) => r.id === request.id && r.accountId === request.accountId,
          );
          if (!row) throw new Error('Reminder unavailable.');
          if (request.action === 'dismiss') row.state = 'dismissed';
          else {
            if (!request.dueAt || request.dueAt <= time) throw new Error('Choose a future date.');
            if (
              requireConversation(records, row.accountId, row.conversationId).status === 'resolved'
            )
              throw new Error('Reopen this conversation first.');
            row.state = 'pending';
            row.dueAt = request.dueAt;
            row.snoozeCount += 1;
            delete row.notifiedAt;
          }
          row.updatedAt = time;
          break;
        }
        case 'save-contact': {
          ensureAccount(request.contact.accountId);
          const id = contactId(request.contact.accountId, request.contact.email);
          const existing = records.contacts.find((c) => c.id === id);
          records.contacts = [
            ...records.contacts.filter((c) => c.id !== id),
            { ...request.contact, id, createdAt: existing?.createdAt ?? time, updatedAt: time },
          ];
          break;
        }
        case 'delete-contact':
          records.contacts = records.contacts.filter(
            (c) => !(c.id === request.id && c.accountId === request.accountId),
          );
          break;
        case 'save-snippet': {
          const existing = records.snippets.find((s) => s.id === request.snippet.id);
          if (request.snippet.id && !existing) throw new Error('Snippet unavailable.');
          const row = {
            ...request.snippet,
            id: existing?.id ?? crypto.randomUUID(),
            createdAt: existing?.createdAt ?? time,
            updatedAt: time,
          };
          records.snippets = [...records.snippets.filter((s) => s.id !== row.id), row];
          break;
        }
        case 'delete-snippet':
          records.snippets = records.snippets.filter((s) => s.id !== request.id);
          break;
      }
    });
  };
  const reconcile = () => serialize(reconcileInternal);
  const handle = (message: unknown, sender: MessageSender): Promise<Response> =>
    serialize(async () => {
      const kind = senderKind(sender, platform.extensionId);
      if (!kind || !validRequest(message))
        return { ok: false, error: 'This request could not be verified.' };
      if (kind === 'gmail' && ['export', 'import', 'clear', 'settings'].includes(message.type))
        return { ok: false, error: 'Open Vynlo settings to manage all local data.' };
      try {
        if (message.type !== 'clear') await settings();
        if (message.type === 'snapshot')
          return {
            ok: true,
            data: await snapshot(kind === 'gmail' && !message.accountId ? null : message.accountId),
          };
        if (message.type === 'export')
          return { ok: true, data: { ...(await snapshot()), schemaVersion: 1, exportedAt: now() } };
        if (message.type === 'settings') await platform.setSettings(message.settings);
        else if (message.type === 'import') {
          if (!validBackup(message.backup)) throw new Error('Invalid backup.');
          const backup: Backup = message.backup;
          await database.update((records) => {
            const categoryAliases = new Map<string, string>();
            for (const category of backup.categories ?? []) {
              const sameId = records.categories.find((local) => local.id === category.id);
              if (sameId) {
                if (sameId.accountId !== category.accountId)
                  throw new Error('Category account conflict.');
                categoryAliases.set(category.id, sameId.id);
                continue;
              }
              const sameName = records.categories.find(
                (local) =>
                  local.accountId === category.accountId &&
                  local.name.toLowerCase() === category.name.toLowerCase(),
              );
              if (sameName) categoryAliases.set(category.id, sameName.id);
              else {
                records.categories.push(category);
                categoryAliases.set(category.id, category.id);
              }
            }
            const importedTags = (backup.emailTags ?? []).map((tag) => {
              if (!isCustomCategoryId(tag.category)) return tag;
              const category = categoryAliases.get(tag.category);
              if (!isCustomCategoryId(category)) throw new Error('Category unavailable.');
              return { ...tag, category };
            });
            for (const key of [
              'accounts',
              'conversations',
              'reminders',
              'contacts',
              'snippets',
              'emailTags',
            ] as const) {
              // Merge without replacing local records. Re-importing a backup is idempotent.
              const ids = new Set(records[key].map((row) => row.id));
              const merged = [
                ...records[key],
                ...(key === 'emailTags' ? importedTags : (backup[key] ?? [])).filter(
                  (row) => !ids.has(row.id),
                ),
              ];
              Object.assign(records, { [key]: merged });
            }
            for (const r of records.reminders)
              if (
                records.conversations.find((c) => c.id === r.conversationId)?.status === 'resolved'
              )
                r.state = 'dismissed';
          }, backup.settings);
          await settings();
        } else if (message.type === 'clear') {
          const prior = await database.read().catch(() => undefined);
          await database.clear(DEFAULT_SETTINGS);
          snippetsReady = false;
          await settings();
          for (const r of prior?.reminders ?? [])
            await platform.clearNotification(r.id).catch(() => undefined);
        } else if (message.type === 'open') {
          const records = await database.read();
          const row = requireConversation(records, message.accountId, message.conversationId);
          if (!safeConversationUrl(row.url, row.accountId, row.threadId))
            throw new Error('Invalid conversation link.');
          await platform.openTab(row.url);
        } else if (message.type === 'options') await platform.openOptions();
        else if (message.type === 'complete-onboarding') {
          const current = await settings();
          if (!current.onboarded) await platform.setSettings({ ...current, onboarded: true });
        } else await apply(message);
        const records = await database.read();
        for (const r of records.reminders)
          if (r.state !== 'due') await platform.clearNotification(r.id).catch(() => undefined);
        if (message.type === 'clear' || message.type === 'untrack') {
          // Clearing browser notifications never affects persisted scheduling correctness.
          if (message.type === 'untrack')
            await platform.clearNotification(reminderId(message.id)).catch(() => undefined);
        }
        await reconcileInternal();
        if (!['open', 'options', 'export'].includes(message.type))
          await platform.publishRevision?.();
        // Mutations return no mailbox records; callers explicitly request their scoped snapshot.
        return { ok: true, data: null };
      } catch {
        return {
          ok: false,
          error:
            'Vynlo could not complete this action. Check the date and selected conversation, then try again.',
        };
      }
    });
  const openReminder = (id: string) =>
    serialize(async () => {
      const records = await database.read();
      const reminder = records.reminders.find((r) => r.id === id && r.state === 'due');
      if (!reminder) return;
      const conversation = requireConversation(
        records,
        reminder.accountId,
        reminder.conversationId,
      );
      if (!safeConversationUrl(conversation.url, conversation.accountId, conversation.threadId))
        return;
      await platform.openTab(conversation.url);
    });
  return { handle, reconcile, openReminder };
}
