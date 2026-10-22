export const STATUSES = ['needs-reply', 'waiting', 'follow-up', 'resolved'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<Status, string> = {
  'needs-reply': 'Needs Reply',
  waiting: 'Waiting',
  'follow-up': 'Follow Up',
  resolved: 'Resolved',
};
export interface Account {
  id: string;
  email: string;
  createdAt: number;
}
export interface ConversationRef {
  accountId: string;
  threadId: string;
  title: string;
  url: string;
}
export interface Conversation extends ConversationRef {
  id: string;
  status: Status;
  note: string;
  createdAt: number;
  updatedAt: number;
}
export interface Reminder {
  id: string;
  accountId: string;
  conversationId: string;
  dueAt: number;
  state: 'pending' | 'due' | 'dismissed';
  snoozeCount: number;
  createdAt: number;
  updatedAt: number;
  notifiedAt?: number;
}
export interface Contact {
  id: string;
  accountId: string;
  email: string;
  name: string;
  note: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
export interface Snippet {
  id: string;
  title: string;
  content: string;
  category: string;
  createdAt: number;
  updatedAt: number;
}
export type ShortcutAction = 'palette' | 'dashboard' | 'waiting' | 'resolved' | 'snippets';
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  enabled: boolean;
  landingView: 'dashboard' | 'snippets' | 'contacts';
  openOnStartup: boolean;
  notifications: boolean;
  reminderHours: number;
  dateFormat: 'relative' | 'absolute';
  shortcuts: Record<ShortcutAction, string>;
  onboarded: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  enabled: true,
  landingView: 'dashboard',
  openOnStartup: false,
  notifications: true,
  reminderHours: 72,
  dateFormat: 'relative',
  shortcuts: {
    palette: 'Mod+K',
    dashboard: 'Mod+Shift+Y',
    waiting: '',
    resolved: '',
    snippets: 'Mod+Shift+Period',
  },
  onboarded: false,
};
export interface Snapshot {
  accounts: Account[];
  conversations: Conversation[];
  reminders: Reminder[];
  contacts: Contact[];
  snippets: Snippet[];
  settings: Settings;
}
export interface Backup extends Snapshot {
  schemaVersion: 1;
  exportedAt: number;
}
export interface GmailContext {
  account: { id: string; email: string } | null;
  conversation: ConversationRef | null;
  hasComposer: boolean;
  theme: 'light' | 'dark';
  reason?: string;
}
