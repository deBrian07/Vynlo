import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Confirm, Modal } from '../../src/components/ui';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});
describe('confirmations', () => {
  it('focuses the first editable field when opening a form dialog', () => {
    render(
      <Modal title="Snippet variables" onClose={vi.fn()}>
        <label>
          Name
          <input aria-label="Name" />
        </label>
      </Modal>,
    );
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });
  it('blocks repeated operations and cancellation during a pending save', async () => {
    let finish: () => void = () => {};
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const close = vi.fn();
    render(
      <Confirm title="Delete note?" onConfirm={save} onClose={close}>
        Remove the note.
      </Confirm>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Working…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(save).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled());
  });
  it('keeps a failed operation open and permits a retry without leaking private errors', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('private note'))
      .mockResolvedValueOnce(undefined);
    render(
      <Confirm title="Delete note?" onConfirm={save} onClose={vi.fn()}>
        Remove.
      </Confirm>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be completed');
    expect(screen.queryByText('private note')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });
});
