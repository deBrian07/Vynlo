import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Backup } from '../../src/types/model';
import { emptyRecords } from '../../src/services/storage/database';
import {
  isAccountId,
  safeConversationUrl,
  validBackup,
  validRequest,
  validSettings,
} from '../../src/services/validation';
const backup = (): Backup => ({
  ...emptyRecords(),
  settings: structuredClone(DEFAULT_SETTINGS),
  schemaVersion: 1,
  exportedAt: 1,
});

describe('untrusted inputs', () => {
  it('requires canonical account emails', () => {
    expect(isAccountId('a@example.com')).toBe(true);
    for (const v of ['A@example.com', '0', '', 'a@example.com\n'])
      expect(isAccountId(v)).toBe(false);
  });
  it('only opens canonical account-specific Gmail links', () => {
    const thread = 'abcdef1234567890';
    const url = `https://mail.google.com/mail/?authuser=a%40example.com#all/${thread}`;
    expect(safeConversationUrl(url, 'a@example.com', thread)).toBe(true);
    expect(safeConversationUrl(url, 'b@example.com', thread)).toBe(false);
    expect(
      safeConversationUrl(url.replace('mail.google.com', 'evil.test'), 'a@example.com', thread),
    ).toBe(false);
    expect(safeConversationUrl('javascript:alert(1)', 'a@example.com', thread)).toBe(false);
  });
  it('rejects malformed messages and duplicate shortcuts', () => {
    for (const input of [
      null,
      {},
      { type: 'other' },
      { type: 'remind', accountId: 'a@example.com', conversationId: 'id', dueAt: Infinity },
    ])
      expect(validRequest(input)).toBe(false);
    expect(
      validSettings({
        ...DEFAULT_SETTINGS,
        shortcuts: { ...DEFAULT_SETTINGS.shortcuts, waiting: 'Mod+K' },
      }),
    ).toBe(false);
    expect(validSettings(DEFAULT_SETTINGS)).toBe(true);
  });
  it('rejects unknown versions, duplicate IDs, dangling reminders, and hostile links', () => {
    expect(validBackup(backup())).toBe(true);
    expect(validBackup({ ...backup(), schemaVersion: 2 })).toBe(false);
    const b = backup();
    b.accounts = [
      { id: 'a@example.com', email: 'a@example.com', createdAt: 1 },
      { id: 'a@example.com', email: 'a@example.com', createdAt: 1 },
    ];
    expect(validBackup(b)).toBe(false);
    b.accounts.pop();
    b.reminders = [
      {
        id: 'reminder:missing',
        accountId: 'a@example.com',
        conversationId: 'missing',
        dueAt: 2,
        state: 'pending',
        snoozeCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    expect(validBackup(b)).toBe(false);
  });
});
