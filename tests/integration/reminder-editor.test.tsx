import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderEditor } from '../../src/features/reminders/ReminderEditor';
import { ConversationEditor } from '../../src/features/conversations/ConversationEditor';

const conversation = { accountId: 'account', threadId: 'thread', title: 'A conversation', url: '' };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

describe('reminder editor', () => {
  it('shows the actual preset date and saves only on an explicit action', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <ReminderEditor
        conversation={conversation}
        defaultHours={72}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    expect(onSave).not.toHaveBeenCalled();
    const tomorrow = screen.getByRole('button', { name: /^Tomorrow/ });
    expect(tomorrow.querySelector('small')).not.toBeEmptyDOMElement();
    fireEvent.click(tomorrow);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0]).toBeGreaterThan(Date.now());
  });

  it('keeps an in-flight save open and prevents editing its target time', async () => {
    let finish: (() => void) | undefined;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();
    render(
      <ReminderEditor
        conversation={conversation}
        defaultHours={72}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Tomorrow/ }));
    expect(screen.getByLabelText('Custom date and time')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).not.toHaveBeenCalled();
    finish?.();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('rejects past custom dates without creating a reminder', () => {
    const onSave = vi.fn();
    render(
      <ReminderEditor
        conversation={conversation}
        defaultHours={72}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Custom date and time'), {
      target: { value: '2020-01-01T12:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a date and time in the future.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not open a reminder after switching the saved status away from Waiting', async () => {
    const onReminder = vi.fn();
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationEditor
        refValue={conversation}
        onSave={onSave}
        onRemove={vi.fn()}
        onClose={onClose}
        onReminder={onReminder}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set a reminder after saving' }));
    expect(screen.getByRole('button', { name: 'Save & set reminder' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tracking status' }), {
      target: { value: 'needs-reply' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Track conversation' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onReminder).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs-reply' }));
  });
});
