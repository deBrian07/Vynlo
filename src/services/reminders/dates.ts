export type ReminderPreset = 'later' | 'tomorrow' | 'three-days' | 'week';
/** Calendar-day presets retain local wall-clock time across DST boundaries. */
export function reminderDate(preset: ReminderPreset, now = Date.now()): number {
  if (preset === 'later') return now + 3 * 60 * 60 * 1000;
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
