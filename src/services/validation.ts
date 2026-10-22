import { STATUSES, type Backup, type Settings } from '../types/model';
import type { Request } from '../types/messages';

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 10000): v is string => typeof v === 'string' && v.length <= max;
const number = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8640000000000000;
export const isAccountId = (v: unknown): v is string =>
  text(v, 254) &&
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(v) &&
  v === v.toLowerCase();
export const isThreadId = (v: unknown): v is string => text(v, 32) && /^[a-f0-9]{16,32}$/.test(v);
export const conversationId = (accountId: string, threadId: string) => `${accountId}:${threadId}`;
export const contactId = (accountId: string, email: string) => `${accountId}:${email}`;
export const reminderId = (id: string) => `reminder:${id}`;
export function safeConversationUrl(value: unknown, accountId: string, threadId: string): boolean {
  if (!text(value, 2048)) return false;
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://mail.google.com' &&
      /^\/mail\/(?:u\/\d+\/)?$/.test(url.pathname) &&
      url.searchParams.get('authuser') === accountId &&
      [...url.searchParams.keys()].length === 1 &&
      url.hash === `#all/${threadId}` &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
const ref = (v: unknown) =>
  object(v) &&
  isAccountId(v.accountId) &&
  isThreadId(v.threadId) &&
  text(v.title, 500) &&
  safeConversationUrl(v.url, v.accountId, v.threadId);
const status = (v: unknown) => STATUSES.includes(v as (typeof STATUSES)[number]);
const id = (v: unknown): v is string => text(v, 1024) && v.length > 0;
const tags = (v: unknown) => Array.isArray(v) && v.length <= 50 && v.every((tag) => text(tag, 100));
const times = (v: Record<string, unknown>) =>
  number(v.createdAt) && number(v.updatedAt) && v.createdAt <= v.updatedAt;
const snippet = (v: unknown) =>
  object(v) &&
  text(v.title, 200) &&
  v.title.trim().length > 0 &&
  text(v.content, 100000) &&
  text(v.category, 100);
const contact = (v: unknown) =>
  object(v) &&
  isAccountId(v.accountId) &&
  isAccountId(v.email) &&
  text(v.name, 200) &&
  text(v.note, 10000) &&
  tags(v.tags);
const SHORTCUTS = ['palette', 'dashboard', 'waiting', 'resolved', 'snippets'];
export function validSettings(v: unknown): v is Settings {
  if (
    !object(v) ||
    !['system', 'light', 'dark'].includes(String(v.theme)) ||
    typeof v.enabled !== 'boolean' ||
    !['dashboard', 'snippets', 'contacts'].includes(String(v.landingView)) ||
    typeof v.openOnStartup !== 'boolean' ||
    typeof v.notifications !== 'boolean' ||
    typeof v.onboarded !== 'boolean' ||
    !number(v.reminderHours) ||
    v.reminderHours < 1 ||
    v.reminderHours > 8760 ||
    !['relative', 'absolute'].includes(String(v.dateFormat)) ||
    !object(v.shortcuts)
  )
    return false;
  const shortcuts = v.shortcuts;
  const active: string[] = [];
  for (const name of SHORTCUTS) {
    const key = shortcuts[name];
    if (
      !text(key, 80) ||
      (key !== '' &&
        !/^(?:Mod|Ctrl|Meta)\+(?:Shift\+)?(?:Alt\+)?(?:[A-Z0-9]|Period|Comma|Slash|Space)$/.test(
          key,
        ))
    )
      return false;
    if (key && active.includes(key)) return false;
    if (key) active.push(key);
  }
  return true;
}
export function validRequest(v: unknown): v is Request {
  if (!object(v)) return false;
  switch (v.type) {
    case 'snapshot':
      return v.accountId === undefined || isAccountId(v.accountId);
    case 'track':
      return ref(v.ref) && status(v.status) && (v.note === undefined || text(v.note, 10000));
    case 'untrack':
    case 'delete-contact':
      return isAccountId(v.accountId) && id(v.id);
    case 'remind':
      return isAccountId(v.accountId) && id(v.conversationId) && number(v.dueAt);
    case 'reminder-action':
      return (
        isAccountId(v.accountId) &&
        id(v.id) &&
        (v.action === 'dismiss' || (v.action === 'snooze' && number(v.dueAt)))
      );
    case 'save-contact':
      return contact(v.contact);
    case 'save-snippet':
      return (
        snippet(v.snippet) && object(v.snippet) && (v.snippet.id === undefined || id(v.snippet.id))
      );
    case 'delete-snippet':
      return id(v.id);
    case 'settings':
      return validSettings(v.settings);
    case 'import':
      return validBackup(v.backup);
    case 'export':
    case 'clear':
    case 'options':
    case 'complete-onboarding':
      return true;
    case 'open':
      return isAccountId(v.accountId) && id(v.conversationId);
    default:
      return false;
  }
}
export function validBackup(v: unknown): v is Backup {
  if (!object(v) || v.schemaVersion !== 1 || !number(v.exportedAt) || !validSettings(v.settings))
    return false;
  for (const key of ['accounts', 'conversations', 'reminders', 'contacts', 'snippets']) {
    const rows = v[key];
    if (!Array.isArray(rows) || rows.length > 20000 || !rows.every(object)) return false;
    if (new Set(rows.map((row) => row.id)).size !== rows.length) return false;
  }
  const accounts = v.accounts as Record<string, unknown>[];
  const conversations = v.conversations as Record<string, unknown>[];
  const reminders = v.reminders as Record<string, unknown>[];
  const contacts = v.contacts as Record<string, unknown>[];
  const snippets = v.snippets as Record<string, unknown>[];
  if (!accounts.every((a) => isAccountId(a.id) && a.id === a.email && number(a.createdAt)))
    return false;
  const accountIds = new Set(accounts.map((a) => a.id));
  if (
    !conversations.every(
      (c) =>
        ref(c) &&
        accountIds.has(c.accountId) &&
        c.id === conversationId(String(c.accountId), String(c.threadId)) &&
        status(c.status) &&
        text(c.note) &&
        times(c),
    )
  )
    return false;
  const conversationMap = new Map(conversations.map((c) => [c.id, c]));
  if (
    !reminders.every(
      (r) =>
        id(r.conversationId) &&
        r.id === reminderId(r.conversationId) &&
        conversationMap.get(r.conversationId)?.accountId === r.accountId &&
        ['pending', 'due', 'dismissed'].includes(String(r.state)) &&
        number(r.dueAt) &&
        number(r.snoozeCount) &&
        Number.isInteger(r.snoozeCount) &&
        times(r) &&
        (r.notifiedAt === undefined || number(r.notifiedAt)) &&
        (conversationMap.get(r.conversationId)?.status !== 'resolved' || r.state === 'dismissed'),
    )
  )
    return false;
  if (
    !contacts.every(
      (c) =>
        contact(c) &&
        accountIds.has(c.accountId) &&
        c.id === contactId(String(c.accountId), String(c.email)) &&
        times(c),
    )
  )
    return false;
  return snippets.every((s) => snippet(s) && id(s.id) && times(s));
}
