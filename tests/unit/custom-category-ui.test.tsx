import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmailTags } from '../../src/features/classification/components';
import { classificationClient } from '../../src/features/classification/client';
import {
  MODEL,
  type UserCategory,
  type TaggedConversation,
} from '../../src/features/classification/model';

vi.mock('../../src/features/classification/client', () => ({
  classificationClient: {
    status: vi.fn(),
    set: vi.fn(),
    saveCategory: vi.fn(),
    deleteCategory: vi.fn(),
  },
}));
const client = vi.mocked(classificationClient);
const category: UserCategory = {
  id: 'custom:00000000-0000-4000-8000-000000000001',
  accountId: 'jordan@example.com',
  name: 'Research',
  description: 'Papers and experiments',
  createdAt: 1,
  updatedAt: 1,
};
const tag: TaggedConversation = {
  id: 'jordan@example.com:1234567890abcdef',
  accountId: category.accountId,
  threadId: '1234567890abcdef',
  title: 'Paper review',
  url: 'https://mail.google.com/mail/u/0/?authuser=jordan%40example.com#all/1234567890abcdef',
  category: category.id,
  source: 'manual',
  reviewed: true,
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { runtime: { id: 'fixture' } });
  client.status.mockResolvedValue({
    enabled: false,
    automatic: false,
    permission: false,
    model: MODEL,
  });
  client.saveCategory.mockResolvedValue(category);
  client.deleteCategory.mockResolvedValue(null);
  client.set.mockResolvedValue(tag);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    },
    close: {
      configurable: true,
      value() {
        this.removeAttribute('open');
      },
    },
  });
});
it('lets users manually choose a custom category with AI disabled', async () => {
  render(
    <EmailTags
      accountId={category.accountId}
      categories={[category]}
      tags={[]}
      current={tag}
      onUpdated={vi.fn()}
    />,
  );
  const current = screen.getByRole('region', { name: 'Current conversation tag' });
  expect(within(current).getByRole('button', { name: 'Suggest tag' })).toBeDisabled();
  fireEvent.change(within(current).getByLabelText('Category'), { target: { value: category.id } });
  await waitFor(() => expect(client.set).toHaveBeenCalledWith(tag, category.id));
});
it('creates a category through a short editor and rejects duplicate names', async () => {
  render(
    <EmailTags
      accountId={category.accountId}
      categories={[category]}
      tags={[]}
      onUpdated={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'New category' }));
  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: ' research ' } });
  fireEvent.change(screen.getByLabelText('What belongs here?'), { target: { value: 'My papers' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  expect(client.saveCategory).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Reading' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
  await waitFor(() =>
    expect(client.saveCategory).toHaveBeenCalledWith(
      category.accountId,
      'Reading',
      'My papers',
      undefined,
    ),
  );
});
it('counts only distinct confirmed manual examples in this account', () => {
  const tags = [
    tag,
    { ...tag, id: 'duplicate', title: ' PAPER   review ' },
    { ...tag, id: 'ai', title: 'Second paper', source: 'model' as const, reviewed: false },
    { ...tag, id: 'other', title: 'Third paper', accountId: 'other@example.com' },
  ];
  render(
    <EmailTags
      accountId={category.accountId}
      categories={[category]}
      tags={tags}
      onUpdated={vi.fn()}
    />,
  );
  expect(screen.getByText(/1 confirmed example ·/)).toBeVisible();
});
it('hides another account categories, records and an open editor on switching accounts', () => {
  const props = { categories: [category], tags: [tag], onUpdated: vi.fn() };
  const { rerender } = render(<EmailTags {...props} accountId={category.accountId} />);
  fireEvent.click(screen.getByRole('button', { name: 'New category' }));
  expect(screen.getByLabelText('Category name')).toBeVisible();
  rerender(<EmailTags {...props} accountId="other@example.com" />);
  expect(screen.queryByLabelText('Category name')).not.toBeInTheDocument();
  expect(screen.queryByText('Paper review')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit category Research' })).not.toBeInTheDocument();
});
it('requires confirmation before removing category examples', async () => {
  render(
    <EmailTags
      accountId={category.accountId}
      categories={[category]}
      tags={[tag]}
      onUpdated={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete category Research' }));
  expect(client.deleteCategory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete category' }));
  await waitFor(() =>
    expect(client.deleteCategory).toHaveBeenCalledWith(category.accountId, category.id),
  );
});
