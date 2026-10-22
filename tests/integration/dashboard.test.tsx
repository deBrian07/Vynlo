import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../src/features/conversations/Dashboard';
import { DEFAULT_SETTINGS, type Conversation, type Reminder } from '../../src/types/model';

const conversation = (id: string, status: Conversation['status'] = 'waiting'): Conversation => ({
  id,
  accountId: 'account',
  threadId: id,
  title: `Conversation ${id}`,
  url: '',
  status,
  note: '',
  createdAt: 1,
  updatedAt: 2,
});
const reminder = (id: string, dueAt: number): Reminder => ({
  id: `reminder-${id}`,
  accountId: 'account',
  conversationId: id,
  dueAt,
  state: 'pending',
  snoozeCount: 0,
  createdAt: 1,
  updatedAt: 2,
});
function setup(conversations = [conversation('a')], reminders: Reminder[] = []) {
  const actions = {
    onEdit: vi.fn(),
    onOpen: vi.fn(),
    onResolve: vi.fn(),
    onReminder: vi.fn(),
    onReminderAction: vi.fn(),
    onStatusChange: vi.fn(),
  };
  render(
    <Dashboard
      conversations={conversations}
      reminders={reminders}
      settings={DEFAULT_SETTINGS}
      {...actions}
    />,
  );
  return actions;
}
afterEach(() => vi.useRealTimers());

describe('conversation dashboard', () => {
  it('can schedule a reminder directly from a conversation without a reminder', () => {
    const actions = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder for Conversation a' }));
    expect(actions.onReminder).toHaveBeenCalledWith(conversation('a'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Status for Conversation a' }), {
      target: { value: 'needs-reply' },
    });
    expect(actions.onStatusChange).toHaveBeenCalledWith(conversation('a'), 'needs-reply');
  });

  it('filters due conversations independently of status and excludes dismissed reminders', () => {
    const now = Date.now();
    setup(
      [conversation('a'), conversation('b', 'needs-reply'), conversation('c'), conversation('d')],
      [
        reminder('a', now - 1000),
        reminder('b', now - 1000),
        reminder('c', now + 100000),
        { ...reminder('d', now - 1000), state: 'dismissed' },
      ],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Due 2' }));
    expect(screen.getByRole('button', { name: 'Conversation a' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conversation b' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conversation c' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conversation d' })).not.toBeInTheDocument();
  });

  it('updates due reminders as time passes without a navigation or storage event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    setup([conversation('a')], [reminder('a', Date.now() + 30000)]);
    fireEvent.click(screen.getByRole('button', { name: 'Due 0' }));
    expect(screen.getByText('You’re all caught up.')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByRole('button', { name: 'Conversation a' })).toBeInTheDocument();
  });

  it('explains an empty status instead of showing first-use instructions', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Resolved 0' }));
    expect(screen.getByText('No resolved conversations')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 conversations');
  });
});
