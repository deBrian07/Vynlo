import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailAdapter } from '../../src/gmail/adapter';
import { gmailFixture, THREAD_A, THREAD_B } from '../fixtures/gmail';

let adapter: GmailAdapter;
const heading = () => document.querySelector('h2')!;
const accountControl = () => document.querySelector('a')!;
const composer = () => document.querySelector<HTMLElement>('[contenteditable]')!;

beforeEach(() => {
  document.body.innerHTML = gmailFixture();
  history.replaceState({}, '', `/#all/${THREAD_A}`);
  adapter = new GmailAdapter();
});
afterEach(() => {
  adapter.dispose();
  vi.useRealTimers();
});

describe('Gmail identity proof', () => {
  it('corroborates visible DOM identity with the route and constructs an account-specific URL', () => {
    const result = adapter.getContext();
    expect(result.account?.id).toBe('person@example.com');
    expect(result.conversation).toEqual({
      accountId: 'person@example.com',
      threadId: THREAD_A,
      title: 'Project check-in',
      url: `https://mail.google.com/mail/?authuser=person%40example.com#all/${THREAD_A}`,
    });
    expect(adapter.findConversationToolbar()?.getAttribute('gh')).toBe('mtb');
  });
  it('never treats matching subject lines or row attributes as a conversation identity', () => {
    heading().removeAttribute('data-legacy-thread-id');
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        `<span data-legacy-thread-id="${THREAD_A}">Project check-in</span>`,
      );
    expect(adapter.getContext().conversation).toBeNull();
  });
  it('fails closed for unsupported opaque URLs and inbox or stale SPA headings', () => {
    for (const hash of [
      '#inbox/FMfcgzQXymQ',
      '#inbox',
      `#settings/${THREAD_A}`,
      `#all/${THREAD_B}`,
    ]) {
      history.replaceState({}, '', `/${hash}`);
      expect(adapter.getContext().conversation).toBeNull();
    }
    heading().setAttribute('data-legacy-thread-id', THREAD_B);
    expect(adapter.getContext().conversation?.threadId).toBe(THREAD_B);
  });
  it('ignores hidden headings and rejects multiple visible threads', () => {
    const second = heading().cloneNode(true) as HTMLElement;
    heading().after(second);
    expect(adapter.getContext().conversation).toBeNull();
    second.hidden = true;
    expect(adapter.getContext().conversation?.threadId).toBe(THREAD_A);
  });
  it('does not use account slots, arbitrary email elements or ambiguous account labels', () => {
    accountControl().remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<span email="sender@example.com">sender@example.com</span>',
    );
    expect(adapter.getContext().account).toBeNull();
    document.body.innerHTML = gmailFixture();
    document
      .querySelector('header')!
      .insertAdjacentHTML(
        'beforeend',
        '<button aria-label="Google Account: Other (other@example.com)">Other</button>',
      );
    expect(adapter.getContext().account).toBeNull();
  });
  it('switches account namespaces and rejects stale headings during a switch', () => {
    expect(adapter.getContext().conversation?.accountId).toBe('person@example.com');
    accountControl().setAttribute('aria-label', 'Google Account: Other (other@example.com)');
    expect(adapter.getContext().account?.id).toBe('other@example.com');
    expect(adapter.getContext().conversation).toBeNull();
    heading().replaceWith(heading().cloneNode(true));
    expect(adapter.getContext().conversation?.accountId).toBe('other@example.com');
  });
  it('rejects a path change until the account control changes', () => {
    adapter.getContext();
    history.replaceState({}, '', `/mail/u/1/#all/${THREAD_A}`);
    expect(adapter.getContext().account).toBeNull();
    accountControl().setAttribute('aria-label', 'Google Account: Other (other@example.com)');
    heading().replaceWith(heading().cloneNode(true));
    expect(adapter.getContext().conversation?.accountId).toBe('other@example.com');
  });
  it('ignores forged account labels inside message content', () => {
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<div role="banner"><button aria-label="Google Account: Forged (forged@example.com)">Forged</button></div>',
      );
    expect(adapter.getContext().account?.id).toBe('person@example.com');
    accountControl().remove();
    expect(adapter.getContext().account).toBeNull();
  });
  it('normalizes account email casing', () => {
    accountControl().setAttribute('aria-label', 'Google Account: Example (Person@Example.com)');
    expect(adapter.getContext().account?.id).toBe('person@example.com');
  });
  it('detects light and dark computed themes', () => {
    expect(adapter.getContext().theme).toBe('light');
    document.querySelector<HTMLElement>('main')!.style.backgroundColor = 'rgb(25, 25, 25)';
    expect(adapter.getContext().theme).toBe('dark');
  });
});

describe('Gmail observation lifecycle', () => {
  it('shares one observer across subscribers and disposes after last unsubscribe', async () => {
    vi.useFakeTimers();
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const offA = adapter.subscribe(listenerA);
    const offB = adapter.subscribe(listenerB);
    expect(observe).toHaveBeenCalledTimes(1);
    history.replaceState({}, '', `/#all/${THREAD_B}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    heading().setAttribute('data-legacy-thread-id', THREAD_B);
    await vi.advanceTimersByTimeAsync(100);
    expect(listenerA.mock.lastCall?.[0].conversation.threadId).toBe(THREAD_B);
    offA();
    expect(disconnect).not.toHaveBeenCalled();
    offB();
    expect(disconnect).toHaveBeenCalledTimes(1);
    const count = listenerB.mock.calls.length;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await vi.advanceTimersByTimeAsync(100);
    expect(listenerB).toHaveBeenCalledTimes(count);
  });
  it('deduplicates context updates from unrelated DOM changes', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    adapter.subscribe(listener);
    document.body.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(100);
    const count = listener.mock.calls.length;
    document.body.append(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(100);
    expect(listener).toHaveBeenCalledTimes(count);
  });
});

describe('Gmail snippet insertion boundary', () => {
  // jsdom has no editing engine. This mock exercises adapter targeting and literal text;
  // Playwright must separately exercise Chromium's actual execCommand and input event.
  function editingCommand(): ReturnType<typeof vi.fn> {
    const command = vi.fn((_name: string, _ui: boolean, text: string) => {
      const range = document.getSelection()!.getRangeAt(0);
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: command, configurable: true });
    return command;
  }
  it('inserts literal text after the saved selection without removing draft content', () => {
    const editor = composer();
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    adapter.captureComposer();
    const command = editingCommand();
    adapter.insertIntoComposer('<img src=x onerror=alert(1)>\nNew line');
    expect(command).toHaveBeenCalledWith(
      'insertText',
      false,
      '<img src=x onerror=alert(1)>\nNew line',
    );
    expect(editor.textContent).toBe('Existing draft<img src=x onerror=alert(1)>\nNew line');
    expect(editor.querySelector('img')).toBeNull();
  });
  it('refuses to insert into a disappeared composer or changed account', () => {
    composer().focus();
    adapter.captureComposer();
    const command = editingCommand();
    accountControl().setAttribute('aria-label', 'Google Account: Other (other@example.com)');
    expect(() => adapter.insertIntoComposer('Hello')).toThrow('draft changed');
    expect(command).not.toHaveBeenCalled();
    composer().remove();
    expect(() => adapter.insertIntoComposer('Hello')).toThrow('draft changed');
  });
  it('requires focus when multiple composers exist', () => {
    const second = composer().cloneNode(true) as HTMLElement;
    composer().after(second);
    expect(adapter.getContext().hasComposer).toBe(false);
    second.focus();
    adapter.captureComposer();
    editingCommand();
    adapter.insertIntoComposer(' Hello');
    expect(second.textContent).toBe(' HelloExisting draft');
    expect(composer().textContent).toBe('Existing draft');
  });
  it('returns a clear error when native insertion is unavailable without altering the draft', () => {
    composer().focus();
    adapter.captureComposer();
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true });
    expect(() => adapter.insertIntoComposer('Hello')).toThrow('insertion is unavailable');
    expect(composer().textContent).toBe('Existing draft');
  });
});
