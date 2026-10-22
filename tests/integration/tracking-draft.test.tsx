import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailAdapter } from '../../src/gmail/adapter';
import { DraftTracking } from '../../src/features/open-tracking/DraftTracking';
import { trackingClient } from '../../src/features/open-tracking/client';
import { gmailFixture, THREAD_A } from '../fixtures/gmail';

vi.mock('../../src/features/open-tracking/client', () => ({ trackingClient: { create: vi.fn() } }));
const accountId = 'person@example.com';
const pixelUrl = `https://vynlo.example.workers.dev/p/${'a'.repeat(64)}.gif`;
let adapter: GmailAdapter;
const composer = () => document.querySelector<HTMLElement>('[contenteditable]')!;
function capture(offset = 3) {
  const editor = composer();
  editor.focus();
  const range = document.createRange();
  range.setStart(editor.firstChild!, offset);
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  adapter.captureComposer();
}
/** jsdom has no native editing. This models insertImage targeting, not Chromium undo/autosave. */
function nativeImage() {
  const command = vi.fn((name: string, _ui: boolean, value: string) => {
    expect(name).toBe('insertImage');
    const image = document.createElement('img');
    image.src = value;
    document.getSelection()!.getRangeAt(0).insertNode(image);
    return true;
  });
  Object.defineProperty(document, 'execCommand', { value: command, configurable: true });
  return command;
}
beforeEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = gmailFixture();
  history.replaceState({}, '', `/#all/${THREAD_A}`);
  adapter = new GmailAdapter();
  capture();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
afterEach(() => adapter.dispose());

describe('tracking image insertion boundary', () => {
  it.each([
    'javascript:alert(1)',
    'https://evil.example/p/' + 'a'.repeat(64) + '.gif',
    pixelUrl + '?token=secret',
    pixelUrl.replace('https:', 'http:'),
    pixelUrl.replace('/p/', '/p/../p/'),
    pixelUrl.replace('.gif', '.gif#fragment'),
  ])('rejects unapproved image addresses before touching the draft: %s', (value) => {
    const command = nativeImage();
    expect(() => adapter.insertTrackingPixel(value)).toThrow('address is invalid');
    expect(command).not.toHaveBeenCalled();
    expect(composer().textContent).toBe('Existing draft');
    expect(composer().querySelector('img')).toBeNull();
  });
  it('appends a tiny inert image, preserves text and selection, and notifies Gmail', () => {
    const editor = composer();
    const originalText = editor.firstChild;
    const input = vi.fn();
    editor.addEventListener('input', input);
    const command = nativeImage();
    adapter.insertTrackingPixel(pixelUrl);
    expect(command).toHaveBeenCalledWith('insertImage', false, pixelUrl);
    expect(editor.textContent).toBe('Existing draft');
    const image = editor.querySelector('img')!;
    expect(image).toHaveAttribute('src', pixelUrl);
    expect(image).toHaveAttribute('width', '1');
    expect(image).toHaveAttribute('height', '1');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('data-vynlo-tracking', 'true');
    expect(input).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editor);
    expect(document.getSelection()!.anchorNode).toBe(originalText);
    expect(document.getSelection()!.anchorOffset).toBe(3);
  });
  it('prevents duplicate tracking images including images without the local marker', () => {
    const command = nativeImage();
    adapter.insertTrackingPixel(pixelUrl);
    composer().querySelector('img')!.removeAttribute('data-vynlo-tracking');
    expect(() =>
      adapter.insertTrackingPixel(pixelUrl.replace('a'.repeat(64), 'b'.repeat(64))),
    ).toThrow('already contains');
    expect(command).toHaveBeenCalledTimes(1);
    expect(composer().querySelectorAll('img')).toHaveLength(1);
  });
  it('fails safely when account identity changes or the original composer disappears', () => {
    const command = nativeImage();
    document
      .querySelector('a')!
      .setAttribute('aria-label', 'Google Account: Other (other@example.com)');
    expect(() => adapter.insertTrackingPixel(pixelUrl)).toThrow('draft changed');
    expect(command).not.toHaveBeenCalled();
    composer().remove();
    expect(() => adapter.insertTrackingPixel(pixelUrl)).toThrow('draft changed');
  });
  it('does not edit another focused field when composer focus is blocked', () => {
    const command = nativeImage();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    vi.spyOn(composer(), 'focus').mockImplementation(() => undefined);
    expect(() => adapter.insertTrackingPixel(pixelUrl)).toThrow('focus');
    expect(command).not.toHaveBeenCalled();
    expect(field.value).toBe('');
  });
  it('preserves content when the native insertion command is unavailable', () => {
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true });
    expect(() => adapter.insertTrackingPixel(pixelUrl)).toThrow('could not add');
    expect(composer().textContent).toBe('Existing draft');
    expect(composer().querySelector('img')).toBeNull();
  });
});

describe('draft tracking preparation', () => {
  it('unmounts the modal before inserting into Gmail and never sends or arms', async () => {
    vi.mocked(trackingClient.create).mockResolvedValue({ id: 'a'.repeat(64), pixelUrl });
    const command = nativeImage();
    const insert = vi.spyOn(adapter, 'insertTrackingPixel').mockImplementation((url) => {
      expect(document.querySelector('dialog')).toBeNull();
      GmailAdapter.prototype.insertTrackingPixel.call(adapter, url);
    });
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(
      <DraftTracking adapter={adapter} accountId={accountId} onDone={onDone} onClose={onClose} />,
    );
    fireEvent.change(screen.getByLabelText('Local name'), { target: { value: 'Local follow-up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tracking image' }));
    await waitFor(() => expect(insert).toHaveBeenCalledOnce());
    expect(trackingClient.create).toHaveBeenCalledWith(accountId, 'Local follow-up');
    expect(command).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining('I’ve sent this'));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('prevents duplicate submissions while preparation is pending', async () => {
    let resolve!: (value: { id: string; pixelUrl: string }) => void;
    vi.mocked(trackingClient.create).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    nativeImage();
    render(
      <DraftTracking adapter={adapter} accountId={accountId} onDone={vi.fn()} onClose={vi.fn()} />,
    );
    const submit = screen.getByRole('button', { name: 'Add tracking image' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(trackingClient.create).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();
    await act(async () => resolve({ id: 'a'.repeat(64), pixelUrl }));
  });
  it('leaves the draft untouched and allows retry after preparation fails', async () => {
    vi.mocked(trackingClient.create).mockRejectedValue(
      new Error('Tracking Worker is unavailable.'),
    );
    const command = nativeImage();
    render(
      <DraftTracking adapter={adapter} accountId={accountId} onDone={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add tracking image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tracking Worker is unavailable');
    expect(screen.getByRole('button', { name: 'Add tracking image' })).toBeEnabled();
    expect(command).not.toHaveBeenCalled();
    expect(composer().textContent).toBe('Existing draft');
  });
  it('keeps failed image insertion recoverable without claiming success', async () => {
    vi.mocked(trackingClient.create).mockResolvedValue({ id: 'a'.repeat(64), pixelUrl });
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true });
    const done = vi.fn();
    const close = vi.fn();
    render(<DraftTracking adapter={adapter} accountId={accountId} onDone={done} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add tracking image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not add');
    expect(done).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add tracking image' })).toBeEnabled();
  });
  it('rejects account switching even if the adapter captures a new composer during preparation', async () => {
    let resolve!: (value: { id: string; pixelUrl: string }) => void;
    vi.mocked(trackingClient.create).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const command = nativeImage();
    const done = vi.fn();
    render(
      <DraftTracking adapter={adapter} accountId={accountId} onDone={done} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add tracking image' }));
    document
      .querySelector('a')!
      .setAttribute('aria-label', 'Google Account: Other (other@example.com)');
    capture();
    await act(async () => resolve({ id: 'a'.repeat(64), pixelUrl }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/account|draft changed/i);
    expect(command).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    expect(composer().querySelector('img')).toBeNull();
  });
  it('does not retarget another draft in the same account while preparation is pending', async () => {
    let resolve!: (value: { id: string; pixelUrl: string }) => void;
    vi.mocked(trackingClient.create).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const original = composer();
    const command = nativeImage();
    render(
      <DraftTracking adapter={adapter} accountId={accountId} onDone={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add tracking image' }));
    const second = original.cloneNode(true) as HTMLElement;
    second.textContent = 'Another draft';
    original.after(second);
    second.focus();
    adapter.captureComposer();
    await act(async () => resolve({ id: 'a'.repeat(64), pixelUrl }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/draft|account/i);
    expect(command).not.toHaveBeenCalled();
    expect(original.querySelector('img')).toBeNull();
    expect(second.querySelector('img')).toBeNull();
  });
  it('does not insert if the tracking component unmounts before preparation completes', async () => {
    let resolve!: (value: { id: string; pixelUrl: string }) => void;
    vi.mocked(trackingClient.create).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const command = nativeImage();
    const view = render(
      <DraftTracking adapter={adapter} accountId={accountId} onDone={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add tracking image' }));
    view.unmount();
    await act(async () => resolve({ id: 'a'.repeat(64), pixelUrl }));
    expect(command).not.toHaveBeenCalled();
    expect(composer().querySelector('img')).toBeNull();
  });
});
