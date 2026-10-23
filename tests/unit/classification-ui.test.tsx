import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassificationSettings, EmailTags } from '../../src/features/classification/components';
import type { BrowserRuntimeStatus } from '../../src/features/classification/browser/model';
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
    browserStatus: vi.fn(),
    prepare: vi.fn(),
    release: vi.fn(),
    removeModel: vi.fn(),
    suggest: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    open: vi.fn(),
  },
}));
const client = vi.mocked(classificationClient);
const requestPermission = vi.fn();
let status: ClassifierStatus;
let runtime: BrowserRuntimeStatus;
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
  status = { enabled: false, automatic: false, permission: false, model: MODEL };
  client.status.mockImplementation(async () => status);
  runtime = { state: 'not-downloaded', downloadedBytes: 0, totalBytes: 0 };
  client.browserStatus.mockImplementation(async () => runtime);
  client.check.mockResolvedValue({ version: 'browser-webgpu', model: MODEL });
  client.prepare.mockImplementation(async () => {
    runtime = { state: 'ready', downloadedBytes: 947_000_000, totalBytes: 947_000_000 };
    return runtime;
  });
  client.release.mockImplementation(async () => {
    runtime = { ...runtime, state: 'cached' };
    return null;
  });
  client.removeModel.mockResolvedValue(null);
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

describe('browser classification setup', () => {
  it('does not download or send subjects on mount and separates download from opt-in', async () => {
    render(<ClassificationSettings />);
    const enabled = screen.getByRole('checkbox', { name: /Enable local AI suggestions/ });
    const automatic = screen.getByRole('checkbox', { name: /Suggest tags automatically/ });
    const download = screen.getByRole('button', { name: 'Download model' });
    await waitFor(() => expect(download).toBeEnabled());
    expect(enabled).not.toBeChecked();
    expect(enabled).toBeDisabled();
    expect(automatic).not.toBeChecked();
    expect(automatic).toBeDisabled();
    expect(client.check).not.toHaveBeenCalled();
    expect(client.prepare).not.toHaveBeenCalled();
    expect(client.suggest).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(download);
    await waitFor(() => expect(enabled).toBeEnabled());
    expect(requestPermission).toHaveBeenCalledWith({
      origins: ['https://huggingface.co/*', 'https://*.xethub.hf.co/*', 'https://*.hf.co/*'],
    });
    expect(client.configure).not.toHaveBeenCalled();
    expect(enabled).not.toBeChecked();
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
  it('does not prepare a model when download permission is denied', async () => {
    requestPermission.mockResolvedValue(false);
    render(<ClassificationSettings />);
    const download = screen.getByRole('button', { name: 'Download model' });
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow model download access');
    expect(client.prepare).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /Enable local AI suggestions/ })).toBeDisabled();
  });
  it('explains unavailable WebGPU without starting a download or CPU inference', async () => {
    runtime = {
      ...runtime,
      state: 'unsupported',
      message: 'WebGPU is unavailable on this device.',
    };
    render(<ClassificationSettings />);
    expect(await screen.findByText('WebGPU is unavailable on this device.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download model' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Enable local AI suggestions/ })).toBeDisabled();
    expect(client.prepare).not.toHaveBeenCalled();
  });
  it('checks a cached model without requesting download access again', async () => {
    runtime = { ...runtime, state: 'cached' };
    render(<ClassificationSettings />);
    const check = await screen.findByRole('button', { name: 'Check GPU availability' });
    fireEvent.click(check);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Enable local AI suggestions/ })).toBeEnabled(),
    );
    expect(client.check).toHaveBeenCalledTimes(1);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(client.prepare).not.toHaveBeenCalled();
    expect(client.configure).not.toHaveBeenCalled();
  });
  it('keeps suggestions off when GPU checks fail', async () => {
    runtime = { ...runtime, state: 'cached' };
    client.check.mockRejectedValue(new Error('Not enough GPU memory. Manual tags still work.'));
    render(<ClassificationSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check GPU availability' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough GPU memory');
    expect(screen.getByRole('checkbox', { name: /Enable local AI suggestions/ })).toBeDisabled();
    expect(client.configure).not.toHaveBeenCalled();
  });
  it('polls progress only during download and stops after unmounting', async () => {
    let finish!: (value: BrowserRuntimeStatus) => void;
    client.prepare.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<ClassificationSettings />);
    const download = screen.getByRole('button', { name: 'Download model' });
    await waitFor(() => expect(download).toBeEnabled());
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(download);
      });
      runtime = { state: 'downloading', downloadedBytes: 100_000_000, totalBytes: 947_000_000 };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750);
      });
      expect(screen.getByRole('progressbar', { name: 'Model download progress' })).toHaveAttribute(
        'value',
        '100000000',
      );
      expect(screen.getByText('Downloading model · 100 MB of 947 MB')).toBeVisible();
      view.unmount();
      const count = client.browserStatus.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(client.browserStatus).toHaveBeenCalledTimes(count);
      finish({ ...runtime, state: 'ready' });
      await act(async () => {});
      expect(client.configure).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('cancels preparation and ignores its late completion', async () => {
    let finish!: (value: BrowserRuntimeStatus) => void;
    client.prepare.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<ClassificationSettings />);
    const download = screen.getByRole('button', { name: 'Download model' });
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel and release GPU' }));
    await waitFor(() => expect(client.release).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText('GPU memory released. Downloaded model files stay in this browser.'),
    ).toBeVisible();
    await act(async () => {
      finish({ ...runtime, state: 'ready' });
    });
    expect(
      screen.queryByText('Model ready. Enable suggestions below when you are ready.'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Enable local AI suggestions/ })).toBeDisabled();
  });
  it('keeps download failures recoverable without enabling AI', async () => {
    client.prepare.mockRejectedValue(new Error('Download interrupted. Try again when connected.'));
    render(<ClassificationSettings />);
    const download = screen.getByRole('button', { name: 'Download model' });
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);
    expect(await screen.findByRole('alert')).toHaveTextContent('Download interrupted');
    expect(screen.getByRole('button', { name: 'Download model' })).toBeEnabled();
    expect(client.configure).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /Enable local AI suggestions/ })).toBeDisabled();
  });
  it('requires confirmation to remove model files and preserves saved tags', async () => {
    runtime = { ...runtime, state: 'cached' };
    client.removeModel.mockImplementation(async () => {
      runtime = { state: 'not-downloaded', downloadedBytes: 0, totalBytes: 0 };
      return null;
    });
    render(<ClassificationSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove downloaded model' }));
    expect(client.removeModel).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('dialog', { name: 'Remove downloaded model?' });
    expect(confirmation).toHaveTextContent('Saved tags are kept.');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remove model' }));
    await waitFor(() => expect(client.removeModel).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Model removed. Your saved tags are unchanged.')).toBeVisible();
    expect(client.remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('can turn off existing automatic classification without loading the model', async () => {
    status = { ...status, enabled: true, automatic: true, permission: true };
    render(<ClassificationSettings />);
    const enabled = screen.getByRole('checkbox', { name: /Enable local AI suggestions/ });
    await waitFor(() => expect(enabled).toBeChecked());
    fireEvent.click(enabled);
    await waitFor(() =>
      expect(client.configure).toHaveBeenCalledWith({ enabled: false, automatic: false }),
    );
    expect(client.check).not.toHaveBeenCalled();
    expect(client.prepare).not.toHaveBeenCalled();
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
