import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette, type Command } from '../../src/features/command-palette/CommandPalette';

function command(id: string, title: string, run = vi.fn()): Command {
  return { id, title, run };
}

describe('command palette', () => {
  it('focuses search, filters and executes the selected result with the keyboard', async () => {
    const inbox = command('inbox', 'Open Gmail Inbox');
    const reminder = command('reminder', 'Set a reminder');
    const onClose = vi.fn();
    render(<CommandPalette commands={[inbox, reminder]} onClose={onClose} />);
    const input = screen.getByRole('combobox', { name: 'Search commands' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: 'Set a reminder' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.change(input, { target: { value: 'inbx' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(inbox.run).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    expect(reminder.run).not.toHaveBeenCalled();
  });

  it('explains context requirements and never invokes disabled actions', () => {
    const waiting = {
      ...command('waiting', 'Mark Waiting'),
      disabledReason: 'Open a supported conversation first.',
    };
    const onClose = vi.fn();
    render(<CommandPalette commands={[waiting]} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    expect(screen.getByRole('option')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Open a supported conversation first.');
    expect(waiting.run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps errors readable without showing private exception text', async () => {
    const failing = command(
      'fail',
      'Open dashboard',
      vi.fn().mockRejectedValue(new Error('Private note text')),
    );
    render(<CommandPalette commands={[failing]} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('This action could not finish.');
    expect(screen.queryByText('Private note text')).not.toBeInTheDocument();
  });

  it('shows an empty state and traps focus until Escape closes', () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={[command('inbox', 'Inbox')]} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getByRole('status')).toHaveTextContent('No commands match');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Tab' });
    const close = screen.getByRole('button', { name: 'Close command palette' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('restores focus inside a shadow root after unmount', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.textContent = 'Original action';
    shadow.append(button);
    button.focus();
    const view = render(<CommandPalette commands={[]} onClose={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveFocus();
    view.unmount();
    expect(shadow.activeElement).toBe(button);
    host.remove();
  });

  it('does not execute a second action while the first is pending', async () => {
    let finish: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<CommandPalette commands={[{ id: 'save', title: 'Save', run }]} onClose={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).toHaveBeenCalledOnce();
    finish?.();
    await waitFor(() => expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false'));
  });
});
