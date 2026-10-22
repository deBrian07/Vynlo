import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Contacts } from '../../src/features/contacts/Contacts';
import type { Contact } from '../../src/types/model';

beforeAll(() => {
  // jsdom does not implement the native dialog API; browser coverage exercises it.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

const contact: Contact = {
  id: 'person@example.com:alex@example.com',
  accountId: 'person@example.com',
  email: 'alex@example.com',
  name: 'Alex',
  note: 'Discussed design systems.',
  tags: ['Design'],
  createdAt: 1,
  updatedAt: 1,
};

describe('contact notes workflow', () => {
  it('does not overwrite an existing note when adding the same email again', async () => {
    const onSave = vi.fn();
    render(<Contacts contacts={[contact]} accountId={contact.accountId} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    fireEvent.change(screen.getByLabelText('Contact email'), {
      target: { value: 'ALEX@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already have a note');
    expect(onSave).not.toHaveBeenCalled();
  });
  it('requires a verified account before adding a contact', () => {
    render(<Contacts contacts={[]} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add contact' })).toBeDisabled();
  });

  it('edits notes without changing the contact identity and normalizes tags', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Contacts contacts={[contact]} accountId={contact.accountId} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit alex@example.com' }));
    expect(screen.getByLabelText('Contact email')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Contact notes'), {
      target: { value: 'Meet next week.' },
    });
    fireEvent.change(screen.getByLabelText('Contact tags'), {
      target: { value: 'Design, Design, Coffee' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onSave).toHaveBeenCalledWith({
      type: 'save-contact',
      contact: {
        accountId: contact.accountId,
        email: contact.email,
        name: 'Alex',
        note: 'Meet next week.',
        tags: ['Design', 'Coffee'],
      },
    });
  });

  it('requires confirmation before deleting an account-scoped note', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Contacts contacts={[contact]} accountId={contact.accountId} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete alex@example.com' }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        type: 'delete-contact',
        accountId: contact.accountId,
        id: contact.id,
      }),
    );
  });

  it('searches note content and tags with a useful empty state', () => {
    render(<Contacts contacts={[contact]} accountId={contact.accountId} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'design' } });
    expect(screen.getByRole('heading', { name: 'Alex' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'missing' } });
    expect(screen.getByText('No matching contacts')).toBeInTheDocument();
  });
});
