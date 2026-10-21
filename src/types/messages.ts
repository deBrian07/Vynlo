import type { Contact, ConversationRef, Settings, Snapshot, Snippet, Status, Backup } from './model';
export type Request =
 | { type: 'snapshot'; accountId?: string }
 | { type: 'track'; ref: ConversationRef; status: Status; note?: string }
 | { type: 'untrack'; accountId: string; id: string }
 | { type: 'remind'; accountId: string; conversationId: string; dueAt: number }
 | { type: 'reminder-action'; accountId: string; id: string; action: 'dismiss' | 'snooze'; dueAt?: number }
 | { type: 'save-contact'; contact: Pick<Contact, 'accountId' | 'email' | 'name' | 'note' | 'tags'> }
 | { type: 'delete-contact'; accountId: string; id: string }
 | { type: 'save-snippet'; snippet: Pick<Snippet, 'title' | 'content' | 'category'> & { id?: string } }
 | { type: 'delete-snippet'; id: string }
 | { type: 'settings'; settings: Settings }
 | { type: 'export' }
 | { type: 'import'; backup: unknown }
 | { type: 'clear' }
 | { type: 'open'; accountId: string; conversationId: string }
 | { type: 'options' };
export type Response = { ok: true; data: Snapshot | Backup | null } | { ok: false; error: string };
