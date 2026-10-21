import { describe, expect, it } from 'vitest';
import { isOverdue, reminderDate, snoozeDueAt } from '../../src/services/reminders/dates';

describe('reminder dates', () => {
  const now = new Date(2026, 9, 21, 10).getTime();
  it('calculates presets in local calendar time', () => {
    expect(reminderDate('later', now)).toBe(now + 10800000);
    expect(new Date(reminderDate('tomorrow', now)).getDate()).toBe(22);
    expect(new Date(reminderDate('three-days', now)).getDate()).toBe(24);
    expect(new Date(reminderDate('week', now)).getDate()).toBe(28);
  });
  it('handles due boundaries and dismissed reminders', () => {
    expect(isOverdue({ state: 'pending', dueAt: now }, now)).toBe(true);
    expect(isOverdue({ state: 'dismissed', dueAt: now }, now)).toBe(false);
    expect(isOverdue({ state: 'due', dueAt: now + 1 }, now)).toBe(false);
  });
  it('rejects invalid snooze values', () => {
    expect(snoozeDueAt(1, now)).toBe(now + 3600000);
    for (const hours of [0, -1, Infinity, NaN, 8761])
      expect(() => snoozeDueAt(hours, now)).toThrow();
  });
});
