export type ReminderPreset = 'later' | 'tomorrow' | 'three-days' | 'week';

/** 6:00pm local when that is at least an hour away; otherwise 9:00am the next morning. */
export function laterToday(now = Date.now()): number {
  const evening = new Date(now);
  evening.setHours(18, 0, 0, 0);
  if (evening.getTime() - now >= 60 * 60 * 1000) return evening.getTime();
  const morning = new Date(now);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(9, 0, 0, 0);
  return morning.getTime();
}

/** Calendar-day presets retain local wall-clock time across DST boundaries. */
export function reminderDate(preset: ReminderPreset, now = Date.now()): number {
  if (preset === 'later') return laterToday(now);
  const date = new Date(now);
  date.setDate(date.getDate() + { tomorrow: 1, 'three-days': 3, week: 7 }[preset]);
  return date.getTime();
}
export const isOverdue = (reminder: { state: string; dueAt: number }, now = Date.now()) =>
  reminder.state !== 'dismissed' && reminder.dueAt <= now;
export function snoozeDueAt(hours: number, now = Date.now()): number {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 8760)
    throw new Error('Choose a valid snooze interval.');
  return now + hours * 3600000;
}
