import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassificationSettings, EmailTags } from '../../src/features/classification/components';
import { classificationClient } from '../../src/features/classification/client';
import {
  MODEL,
  type ClassifierStatus,
  type TaggedConversation,
} from '../../src/features/classification/model';

vi.mock('../../src/features/classification/client', () => ({
  classificationClient: {
    status: vi.fn(),
    configure: vi.fn(),
    check: vi.fn(),
    suggest: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    open: vi.fn(),
  },
}));
const client = vi.mocked(classificationClient);
const requestPermission = vi.fn();
let status: ClassifierStatus;
const tag: TaggedConversation = {
  id: 'jordan@example.com:1234567890abcdef',
  accountId: 'jordan@example.com',
  threadId: '1234567890abcdef',
  title: 'Your interview on Friday',
  url: 'https://mail.google.com/mail/u/0/?authuser=jordan%40example.com#all/1234567890abcdef',
  category: 'recruiting',
  source: 'model',
  model: MODEL,
  reviewed: false,
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  status = { enabled: false, automatic: false, permission: false, model: MODEL };
  client.status.mockImplementation(async () => status);
  client.check.mockResolvedValue({ version: '0.35.0', model: MODEL });
  client.configure.mockImplementation(async (preferences) => {
    status = { ...status, ...preferences };
    return status;
  });
  client.set.mockResolvedValue({ ...tag, source: 'manual', reviewed: true });
  client.remove.mockResolvedValue(null);
  client.open.mockResolvedValue(null);
  requestPermission.mockImplementation(async () => {
    status.permission = true;
    return true;
  });
  vi.stubGlobal('chrome', {
    permissions: { request: requestPermission },
    runtime: { id: 'extension-fixture' },
  });
});

describe('local classification setup', () => {
  it('does not connect or send subjects on mount and requires a check before opt-in', async () => {
    render(<ClassificationSettings />);
    const enabled = screen.getByRole('checkbox', { name: /Enable local AI suggestions/ });
    const automatic = screen.getByRole('checkbox', { name: /Suggest tags automatically/ });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check local connection' })).toBeEnabled(),
    );
    expect(enabled).not.toBeChecked();
    expect(enabled).toBeDisabled();
    expect(automatic).not.toBeChecked();
    expect(automatic).toBeDisabled();
    expect(client.check).not.toHaveBeenCalled();
    expect(client.suggest).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check local connection' }));
    await waitFor(() => expect(enabled).toBeEnabled());
    expect(requestPermission).toHaveBeenCalledWith({ origins: ['http://127.0.0.1/*'] });
    expect(client.configure).not.toHaveBeenCalled();
    fireEvent.click(enabled);
    await waitFor(() =>
      expect(client.configure).toHaveBeenCalledWith({ enabled: true, automatic: false }),
    );
    await waitFor(() => expect(automatic).toBeEnabled());
    fireEvent.click(automatic);
    await waitFor(() =>
      expect(client.configure).toHaveBeenLastCalledWith({ enabled: true, automatic: true }),
    );
  });
  it('does not contact Ollama if the browser denies local access', async () => {
    requestPermission.mockResolvedValue(false);
    render(<ClassificationSettings />);
    const check = screen.getByRole('button', { name: 'Check local connection' });
    await waitFor(() => expect(check).toBeEnabled());
    fireEvent.click(check);
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow local connection access');
    expect(client.check).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /Enable local AI suggestions/ })).toBeDisabled();
  });
  it('keeps suggestions off after a failed model check and explains how to retry', async () => {
    client.check.mockRejectedValue(new Error('Install tev1:0.8b in Ollama first.'));
    render(<ClassificationSettings />);
    const check = screen.getByRole('button', { name: 'Check local connection' });
    await waitFor(() => expect(check).toBeEnabled());
    fireEvent.click(check);
    expect(await screen.findByRole('alert')).toHaveTextContent('Install tev1:0.8b');
    expect(screen.getByRole('checkbox', { name: /Enable local AI suggestions/ })).toBeDisabled();
    expect(client.configure).not.toHaveBeenCalled();
    expect(screen.getByText(/OLLAMA_NO_CLOUD=1/)).toHaveTextContent(
      'OLLAMA_ORIGINS=chrome-extension://extension-fixture',
    );
  });
  it('can turn off existing automatic classification without connecting again', async () => {
    status = { ...status, enabled: true, automatic: true, permission: true };
    render(<ClassificationSettings />);
    const enabled = screen.getByRole('checkbox', { name: /Enable local AI suggestions/ });
    await waitFor(() => expect(enabled).toBeChecked());
    fireEvent.click(enabled);
    await waitFor(() =>
      expect(client.configure).toHaveBeenCalledWith({ enabled: false, automatic: false }),
    );
    expect(client.check).not.toHaveBeenCalled();
  });
});

describe('email tags', () => {
  it('keeps manual editing available with AI off and makes suggestions reviewable', async () => {
    const onUpdated = vi.fn();
    render(<EmailTags tags={[tag]} current={tag} onUpdated={onUpdated} />);
    const current = screen.getByRole('region', { name: 'Current conversation tag' });
    expect(within(current).getByRole('button', { name: 'Suggest tag' })).toBeDisabled();
    expect(within(current).getByRole('combobox', { name: 'Category' })).toBeEnabled();
    fireEvent.click(within(current).getByRole('button', { name: 'Keep Recruiting' }));
    await waitFor(() => expect(client.set).toHaveBeenCalledWith(tag, 'recruiting'));
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(client.suggest).not.toHaveBeenCalled();
  });
  it('filters categories and review status without hiding manual edits', () => {
    const reviewed: TaggedConversation = {
      ...tag,
      id: 'second',
      threadId: 'abcdef1234567890',
      title: 'Your payment receipt',
      category: 'finance',
      source: 'manual',
      reviewed: true,
    };
    render(<EmailTags tags={[tag, reviewed]} onUpdated={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter email tags' }), {
      target: { value: 'suggested' },
    });
    expect(screen.getByRole('button', { name: 'Your interview on Friday' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Your payment receipt' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter email tags' }), {
      target: { value: 'finance' },
    });
    expect(screen.getByRole('button', { name: 'Your payment receipt' })).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search email tags' }), {
      target: { value: 'missing' },
    });
    expect(screen.getByText('No matching conversations')).toBeVisible();
  });
  it('keeps a failed tag removal visible and surfaces the error', async () => {
    client.remove.mockRejectedValue(new Error('Storage is unavailable. Try again.'));
    const onUpdated = vi.fn();
    render(<EmailTags tags={[tag]} onUpdated={onUpdated} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove tag from Your interview on Friday' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage is unavailable');
    expect(onUpdated).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Your interview on Friday' })).toBeVisible();
  });
});
