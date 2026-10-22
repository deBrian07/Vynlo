import { describe, expect, it } from 'vitest';
import { isOverdue, reminderDate, snoozeDueAt } from '../../src/services/reminders/dates';

describe('reminder dates', () => {
  const now = new Date(2026, 9, 21, 10).getTime();
  it('calculates presets in local calendar time', () => {
    const later = new Date(reminderDate('later', now));
    expect(later.getFullYear()).toBe(2026);
    expect(later.getMonth()).toBe(9);
    expect(later.getDate()).toBe(21);
    expect(later.getHours()).toBe(18);
    expect(later.getMinutes()).toBe(0);
    const evening = new Date(2026, 9, 21, 17, 30).getTime();
    const nextMorning = new Date(reminderDate('later', evening));
    expect(nextMorning.getDate()).toBe(22);
    expect(nextMorning.getHours()).toBe(9);
    expect(nextMorning.getMinutes()).toBe(0);
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
