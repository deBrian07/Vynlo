import { useEffect, useMemo, useState } from 'react';
import { Search, ArrowUpRight, Clock3, Check, MoreHorizontal } from 'lucide-react';
import {
  STATUS_LABELS,
  STATUSES,
  type Conversation,
  type Reminder,
  type Settings,
  type Status,
} from '../../types/model';
import { Empty } from '../../components/ui';

export function dateLabel(
  time: number,
  format: Settings['dateFormat'] = 'absolute',
  now = Date.now(),
) {
  if (format === 'relative') {
    const delta = time - now;
    const minutes = Math.round(delta / 60000);
    if (Math.abs(minutes) < 60)
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(minutes, 'minute');
    if (Math.abs(minutes) < 1440)
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
        Math.round(minutes / 60),
        'hour',
      );
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
      Math.round(minutes / 1440),
      'day',
    );
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(time);
}
interface Props {
  conversations: Conversation[];
  reminders: Reminder[];
  settings: Settings;
  onEdit: (c: Conversation) => void;
  onOpen: (c: Conversation) => void;
  onResolve: (c: Conversation) => void;
  onStatusChange?: (c: Conversation, status: Status) => void;
  onReminder: (c: Conversation) => void;
  onReminderAction: (r: Reminder, action: 'snooze' | 'dismiss') => void;
}
export function Dashboard({
  conversations,
  reminders,
  settings,
  onEdit,
  onOpen,
  onResolve,
  onStatusChange,
  onReminder,
  onReminderAction,
}: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Status | 'all' | 'due'>('all');
  const [sort, setSort] = useState('due');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    const refresh = () => setNow(Date.now());
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const activeReminders = useMemo(
    () =>
      new Map(reminders.filter((r) => r.state !== 'dismissed').map((r) => [r.conversationId, r])),
    [reminders],
  );
  const filtered = conversations
    .filter(
      (c) =>
        (filter === 'all' ||
          c.status === filter ||
          (filter === 'due' && (activeReminders.get(c.id)?.dueAt ?? Infinity) <= now)) &&
        `${c.title} ${c.note}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'due'
        ? (activeReminders.get(a.id)?.dueAt ?? Infinity) -
            (activeReminders.get(b.id)?.dueAt ?? Infinity) || b.updatedAt - a.updatedAt
        : b.updatedAt - a.updatedAt,
    );
  const overdue = conversations.filter(
    (c) => (activeReminders.get(c.id)?.dueAt ?? Infinity) <= now,
  ).length;
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>Keep things moving.</h1>
          <p className="muted">A little clarity for every conversation.</p>
        </div>
      </div>
      <div className="stats-grid">
        <div>
          <strong>{conversations.filter((c) => c.status !== 'resolved').length}</strong>
          <span>Active conversations</span>
        </div>
        <div className={overdue ? 'accent-stat' : ''}>
          <strong>{overdue}</strong>
          <span>Reminders due</span>
        </div>
        <div>
          <strong>{conversations.filter((c) => c.status === 'resolved').length}</strong>
          <span>Resolved</span>
        </div>
      </div>
      <div className="filter-bar">
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="Search conversations"
            placeholder="Find a conversation…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Sort conversations"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="due">Due date</option>
          <option value="updated">Recently updated</option>
        </select>
      </div>
      <div className="filter-tabs" aria-label="Filter conversations">
        {(['all', 'due', ...STATUSES] as const).map((s) => (
          <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)}>
            {s === 'all' ? 'All' : s === 'due' ? 'Due' : STATUS_LABELS[s]}{' '}
            <span>
              {s === 'due'
                ? overdue
                : conversations.filter((c) => s === 'all' || c.status === s).length}
            </span>
          </button>
        ))}
      </div>
      <p className="results-summary" role="status">
        {filtered.length} {filtered.length === 1 ? 'conversation' : 'conversations'}
        {query.trim() ? ` matching “${query.trim()}”` : ''}
      </p>
      {!filtered.length ? (
        <Empty
          title={
            query
              ? 'No matching conversations'
              : filter === 'due'
                ? 'You’re all caught up.'
                : filter !== 'all'
                  ? `No ${STATUS_LABELS[filter].toLowerCase()} conversations`
                  : 'Make room for what matters.'
          }
        >
          {query
            ? 'Try a different search or status.'
            : filter === 'due'
              ? 'No reminders are due. Scheduled reminders will appear here when it’s time.'
              : filter !== 'all'
                ? 'Choose another status to see your other conversations.'
                : 'Open a conversation in Gmail and give it a status. Your next steps will be right here.'}
        </Empty>
      ) : (
        STATUSES.filter((s) => filter === 'all' || filter === 'due' || filter === s).map(
          (status) => {
            const group = filtered.filter((c) => c.status === status);
            if (!group.length) return null;
            return (
              <div className="conversation-group" key={status}>
                <h2>
                  <span className={`status-dot ${status}`} />
                  {STATUS_LABELS[status]}
                  <span className="count">{group.length}</span>
                </h2>
                {group.map((c) => {
                  const r = activeReminders.get(c.id);
                  const due = r && r.dueAt <= now;
                  return (
                    <article className="conversation-row" key={c.id}>
                      <div className="conversation-main">
                        <button className="conversation-title" onClick={() => onOpen(c)}>
                          {c.title || 'Tracked conversation'}
                          <ArrowUpRight size={14} />
                        </button>
                        {c.note && <p className="note-preview">{c.note}</p>}
                        <div className="row-meta">
                          {r && (
                            <button
                              className={`due-chip ${due ? 'overdue' : ''}`}
                              onClick={() => onReminder(c)}
                            >
                              <Clock3 size={12} />
                              {due ? 'Due · ' : ''}
                              {dateLabel(r.dueAt, settings.dateFormat, now)}
                            </button>
                          )}
                          <span title={new Date(c.updatedAt).toLocaleString()}>
                            Updated {dateLabel(c.updatedAt, settings.dateFormat, now)}
                          </span>
                        </div>
                        {due && r && (
                          <div className="due-actions">
                            <button onClick={() => onReminderAction(r, 'snooze')}>
                              Snooze 1 day
                            </button>
                            <button onClick={() => onReminderAction(r, 'dismiss')}>
                              Dismiss reminder
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="row-actions">
                        {onStatusChange && (
                          <select
                            className="row-status"
                            aria-label={`Status for ${c.title}`}
                            value={c.status}
                            onChange={(event) => onStatusChange(c, event.target.value as Status)}
                          >
                            {STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {STATUS_LABELS[status]}
                              </option>
                            ))}
                          </select>
                        )}
                        {c.status !== 'resolved' && (
                          <button
                            className="icon-button"
                            title={r ? 'Edit reminder' : 'Set reminder'}
                            aria-label={`${r ? 'Edit' : 'Set'} reminder for ${c.title}`}
                            onClick={() => onReminder(c)}
                          >
                            <Clock3 size={17} />
                          </button>
                        )}
                        {c.status !== 'resolved' && (
                          <button
                            className="icon-button"
                            title="Mark resolved"
                            aria-label={`Resolve ${c.title}`}
                            onClick={() => onResolve(c)}
                          >
                            <Check size={17} />
                          </button>
                        )}
                        <button
                          className="icon-button"
                          title="Edit conversation"
                          aria-label={`Edit ${c.title}`}
                          onClick={() => onEdit(c)}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            );
          },
        )
      )}
    </section>
  );
}
