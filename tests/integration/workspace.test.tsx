vi.mock('../../src/features/backups/client', () => ({
  backupClient: {
    status: vi.fn(async () => ({
      automatic: false,
      configured: false,
      pending: false,
      conflict: false,
      recoveryPending: false,
    })),
  },
}));
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Workspace from '../../src/components/Workspace';
import { ContentApp } from '../../src/components/ContentApp';
import { GmailAdapter } from '../../src/gmail/adapter';
import { DEFAULT_SETTINGS, type Snapshot } from '../../src/types/model';
import { gmailFixture, THREAD_A } from '../fixtures/gmail';
import { getSnapshot, request } from '../../src/services/client';

vi.mock('../../src/services/client', () => ({ getSnapshot: vi.fn(), request: vi.fn() }));
let data: Snapshot;
let listeners: Set<() => void>;
beforeEach(() => {
  data = {
    accounts: [],
    conversations: [],
    contacts: [],
    reminders: [],
    snippets: [],
    settings: structuredClone(DEFAULT_SETTINGS),
  };
  listeners = new Set();
  vi.mocked(getSnapshot).mockImplementation(async () => structuredClone(data));
  vi.mocked(request).mockResolvedValue(null);
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: {
        addListener: (fn: () => void) => listeners.add(fn),
        removeListener: (fn: () => void) => listeners.delete(fn),
      },
    },
    runtime: { getManifest: () => ({ version: '0.1.0' }) },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
describe('workspace safety and keyboard workflow', () => {
  it('marks Waiting without forcing the dashboard open', async () => {
    const host = document.createElement('div');
    host.innerHTML = gmailFixture();
    document.body.append(host);
    window.location.hash = `all/${THREAD_A}`;
    const adapter = new GmailAdapter();
    const view = render(<ContentApp adapter={adapter} />);
    await screen.findByRole('button', { name: 'Open Vynlo' });
    fireEvent.keyDown(document.body, {
      key: 'U',
      code: 'KeyU',
      shiftKey: true,
      ctrlKey: !/Mac/i.test(navigator.platform),
      metaKey: /Mac/i.test(navigator.platform),
    });
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'track', status: 'waiting' }),
      ),
    );
    expect(screen.queryByRole('region', { name: 'Vynlo workspace' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Marked Waiting');
    view.unmount();
    adapter.dispose();
    host.remove();
  });
  it('protects unsaved preferences before changing views', async () => {
    render(<Workspace options initialView="settings" />);
    await screen.findByRole('heading', { name: 'Your preferences.' });
    fireEvent.change(screen.getByLabelText('Default reminder interval'), {
      target: { value: '48' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Snippets' }));
    expect(
      screen.getByRole('dialog', { name: 'Discard unsaved preferences?' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Default reminder interval')).toHaveValue(48);
    fireEvent.click(screen.getByRole('button', { name: 'Snippets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await screen.findByRole('heading', { name: 'Write it once.' });
    expect(request).not.toHaveBeenCalled();
  });
  it('does not reopen a closed workspace on storage events when startup opening is enabled', async () => {
    data.settings.openOnStartup = true;
    data.settings.onboarded = true;
    const host = document.createElement('div');
    host.innerHTML = gmailFixture();
    document.body.append(host);
    window.location.hash = `all/${THREAD_A}`;
    const adapter = new GmailAdapter();
    const view = render(<ContentApp adapter={adapter} />);
    await screen.findByRole('heading', { name: 'Conversations' });
    fireEvent.click(screen.getByRole('button', { name: 'Close Vynlo' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Conversations' })).not.toBeInTheDocument(),
    );
    await act(async () => {
      listeners.forEach((fn) => fn());
    });
    expect(screen.queryByRole('heading', { name: 'Conversations' })).not.toBeInTheDocument();
    view.unmount();
    adapter.dispose();
    host.remove();
  });
  it('opens the command palette from an already open workspace', async () => {
    data.settings.openOnStartup = true;
    const adapter = new GmailAdapter();
    const view = render(<ContentApp adapter={adapter} />);
    const panel = await screen.findByRole('region', { name: 'Vynlo workspace' });
    fireEvent.keyDown(panel, {
      key: 'k',
      code: 'KeyK',
      ctrlKey: !/Mac/i.test(navigator.platform),
      metaKey: /Mac/i.test(navigator.platform),
    });
    expect(screen.getByRole('combobox', { name: 'Search commands' })).toHaveFocus();
    view.unmount();
    adapter.dispose();
  });
});
