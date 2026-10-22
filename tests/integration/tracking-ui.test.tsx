import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackingSettings } from '../../src/features/open-tracking/TrackingSettings';
import { TrackingActivity } from '../../src/features/open-tracking/TrackingActivity';
import { trackingClient } from '../../src/features/open-tracking/client';
import type { PublicTracking, TrackingSnapshot } from '../../src/features/open-tracking/types';

vi.mock('../../src/features/open-tracking/client', () => ({
  trackingClient: {
    snapshot: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    remove: vi.fn(),
    activate: vi.fn(),
  },
}));
const account = 'a@example.com';
function record(accountId = account): PublicTracking {
  return {
    id: accountId,
    accountId,
    label: `Draft for ${accountId}`,
    createdAt: 1_800_000_000_000,
    expiresAt: 1_802_592_000_000,
    firstOpenedAt: null,
    lastOpenedAt: null,
    openCount: 0,
    armedAt: 1_800_000_000_000,
  };
}
function snapshot(records: PublicTracking[] = []): TrackingSnapshot {
  return { connected: true, endpoint: 'https://vynlo.example.workers.dev', records };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(trackingClient.snapshot).mockResolvedValue({ connected: false, records: [] });
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
describe('optional tracking connection', () => {
  it('loads local settings without refreshing the service and requires disclosure before connecting', async () => {
    render(<TrackingSettings />);
    const connect = await screen.findByRole('button', { name: 'Connect tracking' });
    expect(trackingClient.refresh).not.toHaveBeenCalled();
    expect(trackingClient.connect).not.toHaveBeenCalled();
    expect(connect).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Worker URL'), {
      target: { value: 'https://vynlo.example.workers.dev' },
    });
    fireEvent.change(screen.getByLabelText('Connection key'), {
      target: { value: 'private-key-012345678901234567890123456789' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    vi.mocked(trackingClient.snapshot).mockResolvedValue(snapshot());
    fireEvent.click(connect);
    await screen.findByText('Connected');
    expect(trackingClient.connect).toHaveBeenCalledWith(
      'https://vynlo.example.workers.dev',
      'private-key-012345678901234567890123456789',
    );
    expect(
      screen.queryByDisplayValue('private-key-012345678901234567890123456789'),
    ).not.toBeInTheDocument();
  });
  it('imports connection details without connecting or granting consent', async () => {
    render(<TrackingSettings />);
    const input = await screen.findByLabelText('Import connection file');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(input, {
      target: {
        files: [
          {
            size: 100,
            text: async () =>
              JSON.stringify({
                endpoint: 'https://vynlo.example.workers.dev',
                secret: '0123456789abcdef0123456789abcdef',
              }),
          },
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Worker URL')).toHaveValue('https://vynlo.example.workers.dev'),
    );
    expect(screen.getByLabelText('Connection key')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Connect tracking' })).toBeDisabled();
    expect(trackingClient.connect).not.toHaveBeenCalled();
  });
  it('rejects oversized or invalid connection files without exposing their contents', async () => {
    render(<TrackingSettings />);
    const input = await screen.findByLabelText('Import connection file');
    fireEvent.change(input, { target: { files: [{ size: 5000, text: vi.fn() }] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 4 KB');
    fireEvent.change(input, {
      target: {
        files: [
          {
            size: 100,
            text: async () =>
              JSON.stringify({
                endpoint: 'https://unexpected.example',
                secret: 'private-file-contents',
              }),
          },
        ],
      },
    });
    await waitFor(() => expect(screen.getByLabelText('Worker URL')).toHaveValue(''));
    expect(screen.getByLabelText('Connection key')).toHaveValue('');
    expect(trackingClient.connect).not.toHaveBeenCalled();
  });
  it('keeps failed connection editable and never renders server error content', async () => {
    vi.mocked(trackingClient.connect).mockRejectedValue(new Error('secret-request-content'));
    render(<TrackingSettings />);
    await screen.findByLabelText('Worker URL');
    fireEvent.change(screen.getByLabelText('Worker URL'), {
      target: { value: 'https://vynlo.example.workers.dev' },
    });
    fireEvent.change(screen.getByLabelText('Connection key'), {
      target: { value: 'private-key-012345678901234567890123456789' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect tracking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the Worker URL');
    expect(screen.queryByText('secret-request-content')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Worker URL')).toBeEnabled();
  });
  it('requires confirmation before disconnecting and explains outstanding pixels', async () => {
    vi.mocked(trackingClient.snapshot).mockResolvedValue(snapshot());
    render(<TrackingSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(trackingClient.disconnect).not.toHaveBeenCalled();
    expect(screen.getByText(/Existing tracking images keep working/)).toHaveTextContent(
      '30-day expiry',
    );
    vi.mocked(trackingClient.snapshot).mockResolvedValue({ connected: false, records: [] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' })[1]!);
    await screen.findByRole('button', { name: 'Connect tracking' });
    expect(trackingClient.disconnect).toHaveBeenCalledTimes(1);
  });
});
describe('tracking activity', () => {
  it('fails closed without an account and does not query storage or network', () => {
    render(<TrackingActivity />);
    expect(trackingClient.snapshot).not.toHaveBeenCalled();
    expect(trackingClient.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
  it('filters account records and refreshes only on explicit request', async () => {
    const own = record();
    vi.mocked(trackingClient.snapshot).mockResolvedValue(snapshot([own, record('b@example.com')]));
    render(<TrackingActivity accountId={account} />);
    await screen.findByText(own.label);
    expect(screen.queryByText('Draft for b@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('No open detected')).toBeInTheDocument();
    expect(trackingClient.refresh).not.toHaveBeenCalled();
    vi.mocked(trackingClient.refresh).mockResolvedValue(
      snapshot([
        {
          ...own,
          firstOpenedAt: own.createdAt + 100,
          lastOpenedAt: own.createdAt + 100,
          openCount: 1,
        },
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Open detected');
    expect(trackingClient.refresh).toHaveBeenCalledWith(account);
    expect(screen.getByText(/Sending not verified/)).toBeInTheDocument();
  });
  it('requires explicit activation before showing any open signals', async () => {
    const draft = { ...record(), armedAt: null, firstOpenedAt: 1_800_000_001_000 };
    vi.mocked(trackingClient.snapshot).mockResolvedValue(snapshot([draft]));
    render(<TrackingActivity accountId={account} />);
    await screen.findByText('Draft · not activated');
    expect(screen.queryByText('Open detected')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I’ve sent this' }));
    expect(trackingClient.activate).not.toHaveBeenCalled();
    expect(screen.getByText(/This only starts recording future image loads/)).toHaveTextContent(
      'never sends email',
    );
    vi.mocked(trackingClient.snapshot).mockResolvedValue(
      snapshot([{ ...record(), armedAt: Date.now() }]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Activate tracking' }));
    await screen.findByText('No open detected');
    expect(trackingClient.activate).toHaveBeenCalledWith(account, draft.id);
  });
  it('keeps disconnected history visible and permits confirmed deletion', async () => {
    vi.mocked(trackingClient.snapshot).mockResolvedValue({
      ...snapshot([record()]),
      connected: false,
    });
    render(<TrackingActivity accountId={account} />);
    await screen.findByText(record().label);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: `Delete tracking for ${record().label}` }));
    vi.mocked(trackingClient.snapshot).mockResolvedValue({ connected: false, records: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete tracking' }));
    await screen.findByText('No tracked drafts yet');
    expect(trackingClient.remove).toHaveBeenCalledWith(account, record().id);
  });
  it('hides prior account activity immediately during an account switch', async () => {
    vi.mocked(trackingClient.snapshot).mockResolvedValue(snapshot([record()]));
    const view = render(<TrackingActivity accountId={account} />);
    await screen.findByText(record().label);
    vi.mocked(trackingClient.snapshot).mockReturnValue(new Promise(() => {}));
    view.rerender(<TrackingActivity accountId="b@example.com" />);
    expect(screen.queryByText(record().label)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading activity');
  });
  it('confirms remote deletion and keeps a failed delete retryable', async () => {
    vi.mocked(trackingClient.snapshot).mockResolvedValue(snapshot([record()]));
    vi.mocked(trackingClient.remove).mockRejectedValueOnce(new Error('offline'));
    render(<TrackingActivity accountId={account} />);
    fireEvent.click(
      await screen.findByRole('button', { name: `Delete tracking for ${record().label}` }),
    );
    expect(trackingClient.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete tracking' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Your dialog is still open'),
    );
    expect(screen.getByRole('button', { name: 'Delete tracking' })).toBeEnabled();
    vi.mocked(trackingClient.snapshot).mockResolvedValue(snapshot([]));
    fireEvent.click(screen.getByRole('button', { name: 'Delete tracking' }));
    await screen.findByText('No tracked drafts yet');
    expect(trackingClient.remove).toHaveBeenCalledWith(account, record().id);
  });
});

it('keeps technical fields behind manual setup and confirms a chosen connection file', async () => {
  render(<TrackingSettings />);
  const file = await screen.findByLabelText('Import connection file');
  expect(screen.getByLabelText('Worker URL')).not.toBeVisible();
  expect(screen.getByLabelText('Connection key')).not.toBeVisible();
  fireEvent.change(file, {
    target: {
      files: [
        {
          size: 100,
          text: async () =>
            JSON.stringify({
              endpoint: 'https://vynlo.example.workers.dev',
              secret: 'a'.repeat(64),
            }),
        },
      ],
    },
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Connection file ready');
  expect(screen.getByRole('button', { name: 'Connect tracking' })).toBeDisabled();
  expect(trackingClient.connect).not.toHaveBeenCalled();
});

it('gives disconnected users a direct route to settings', async () => {
  const onSettings = vi.fn();
  render(<TrackingActivity accountId={account} onSettings={onSettings} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Connect in Settings' }));
  expect(onSettings).toHaveBeenCalledOnce();
});

it('explains the next step beside paused drafts and distinguishes expired tracking', async () => {
  vi.mocked(trackingClient.snapshot).mockResolvedValue(snapshot([{ ...record(), armedAt: null }]));
  const view = render(<TrackingActivity accountId={account} />);
  await screen.findByText('Next: send this draft in Gmail, then confirm below.');
  expect(screen.getByRole('button', { name: 'I’ve sent this' })).toBeVisible();
  expect(screen.getByText(/Sending not verified/)).not.toBeVisible();
  view.unmount();
  vi.mocked(trackingClient.snapshot).mockResolvedValue(
    snapshot([{ ...record(), armedAt: null, expiresAt: Date.now() - 1 }]),
  );
  render(<TrackingActivity accountId={account} />);
  expect(await screen.findByText('Tracking expired')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'I’ve sent this' })).not.toBeInTheDocument();
});
