import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../../src/features/settings/SettingsView';
import { DEFAULT_SETTINGS, type Snapshot } from '../../src/types/model';
vi.mock('../../src/features/open-tracking/client', () => ({
  trackingClient: { snapshot: async () => ({ connected: false, records: [] }) },
}));

function snapshot(): Snapshot {
  return {
    accounts: [],
    conversations: [],
    reminders: [],
    contacts: [],
    snippets: [],
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}
const onSave = vi.fn(async () => {});
const onRefresh = vi.fn(async () => {});
const onSnippets = vi.fn();
const props = { onSave, onRefresh, onSnippets };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '0.1.0' }) } });
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('settings drafts', () => {
  it('updates clean preferences when settings change in another view', () => {
    const data = snapshot();
    const view = render(<SettingsView {...props} snapshot={data} />);
    view.rerender(
      <SettingsView
        {...props}
        snapshot={{ ...data, settings: { ...data.settings, theme: 'dark' } }}
      />,
    );
    expect(screen.getByLabelText('Theme')).toHaveValue('dark');
  });

  it('preserves edits and merges untouched external changes on save', async () => {
    const data = snapshot();
    const onDirtyChange = vi.fn();
    const view = render(<SettingsView {...props} snapshot={data} onDirtyChange={onDirtyChange} />);
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    view.rerender(
      <SettingsView
        {...props}
        snapshot={{ ...data, settings: { ...data.settings, notifications: false } }}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByLabelText('Theme')).toHaveValue('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        type: 'settings',
        settings: expect.objectContaining({ theme: 'dark', notifications: false, onboarded: true }),
      }),
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByLabelText('Theme')).toHaveValue('dark');
  });

  it('canonicalizes accepted shortcut syntax before sending it to storage', async () => {
    render(<SettingsView {...props} snapshot={snapshot()} />);
    fireEvent.change(screen.getByLabelText('Command palette shortcut'), {
      target: { value: 'shift + ctrl + q' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        type: 'settings',
        settings: expect.objectContaining({
          shortcuts: expect.objectContaining({ palette: 'Ctrl+Shift+Q' }),
        }),
      }),
    );
  });

  it('keeps a failed save editable and marks invalid shortcuts accessibly', async () => {
    onSave.mockRejectedValueOnce(new Error('Storage unavailable'));
    render(<SettingsView {...props} snapshot={snapshot()} />);
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
    expect(screen.getByLabelText('Theme')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Command palette shortcut'), {
      target: { value: 'Mod+L' },
    });
    expect(screen.getByLabelText('Command palette shortcut')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
  });

  it('keeps a failed destructive operation open with retry feedback', async () => {
    onSave.mockRejectedValueOnce(new Error('Storage unavailable'));
    render(<SettingsView {...props} snapshot={snapshot()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear local data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all data' }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .some((alert) => alert.textContent?.includes('Your dialog is still open')),
      ).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Clear all data' })).toBeEnabled();
  });

  it('rejects malformed imports without changing any records', async () => {
    const view = render(<SettingsView {...props} snapshot={snapshot()} />);
    const input = view.container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [{ size: 8, text: async () => '{broken' }] } });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Import backup' })).not.toBeInTheDocument();
  });
});
