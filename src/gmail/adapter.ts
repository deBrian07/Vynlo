import type { GmailContext } from '../types/model';
import { selectors } from './selectors';

const HEX_THREAD = /^[0-9a-f]{16}$/i;
const EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}/gi;

/** No network interception, page globals, message bodies or mailbox enumeration. */
export class GmailAdapter {
  private listeners = new Set<(context: GmailContext) => void>();
  private observer?: MutationObserver;
  private timer?: number;
  private lastContext = '';
  private composer?: HTMLElement;
  private caret?: Range;
  private composerAccount?: string;
  private bindings = new WeakMap<HTMLElement, { account: string; thread: string }>();
  private previousAccount?: string;
  private previousPath?: string;
  private pendingPath?: string;

  constructor(
    private doc: Document = document,
    private win: Window = window,
  ) {}

  private visible(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      const style = this.win.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  getCurrentAccount(): GmailContext['account'] {
    const candidates = Array.from(this.doc.querySelectorAll<HTMLElement>(selectors.account))
      .filter((el) => this.visible(el) && !el.closest(selectors.main))
      .map((el) => el.getAttribute('aria-label')?.match(EMAIL) ?? [])
      .flat()
      .map((email) => email.toLowerCase());
    const unique = [...new Set(candidates)];
    if (unique.length !== 1) return null;
    const email = unique[0]!;
    const path = this.win.location.pathname;
    if (this.previousPath && path !== this.previousPath && email === this.previousAccount) {
      this.pendingPath = path;
      return null;
    }
    if (this.pendingPath === path && email === this.previousAccount) return null;
    this.previousPath = path;
    this.previousAccount = email;
    this.pendingPath = undefined;
    return { id: email, email };
  }

  getGmailTheme(): GmailContext['theme'] {
    const main = this.doc.querySelector<HTMLElement>(selectors.main);
    for (let el = main ?? this.doc.body; el; el = el.parentElement!) {
      const color = this.win.getComputedStyle(el).backgroundColor;
      const channels = color.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3 || (channels.length === 4 && channels[3] === 0))
        continue;
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722 < 128
        ? 'dark'
        : 'light';
    }
    return this.win.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  getContext(): GmailContext {
    const account = this.getCurrentAccount();
    const base: GmailContext = {
      account,
      conversation: null,
      hasComposer: !!this.findActiveComposer(),
      theme: this.getGmailTheme(),
    };
    if (!account)
      return {
        ...base,
        reason: 'Vynlo cannot safely identify this Gmail account. Account data is unavailable.',
      };
    const headings = Array.from(
      this.doc.querySelectorAll<HTMLElement>(`${selectors.main} ${selectors.thread}`),
    ).filter((el) => this.visible(el));
    if (headings.length !== 1)
      return { ...base, reason: 'Open a single supported Gmail conversation to track it.' };
    const heading = headings[0]!;
    const thread = (heading.getAttribute('data-legacy-thread-id') ?? '').toLowerCase();
    const permanent = heading.getAttribute('data-thread-perm-id') ?? '';
    if (!HEX_THREAD.test(thread) || !/^#?thread-[fa]:\d+$/.test(permanent))
      return {
        ...base,
        reason: 'This conversation does not expose a supported stable identifier.',
      };
    const binding = this.bindings.get(heading);
    if (binding && binding.account !== account.id && binding.thread === thread)
      return {
        ...base,
        reason:
          'Gmail is switching accounts. Reopen the conversation after the account finishes loading.',
      };
    this.bindings.set(heading, { account: account.id, thread });
    // Corroborate the active DOM against the route. Never bind an old SPA heading to a new route.
    const route = this.win.location.hash.slice(1).split('/');
    const token = route.at(-1) ?? '';
    const supportedRoute =
      /^(all|inbox|sent|drafts|starred|important|spam|trash|snoozed|search|label|category)$/.test(
        route[0] ?? '',
      );
    if (
      !supportedRoute ||
      route.length < 2 ||
      !HEX_THREAD.test(token) ||
      token.toLowerCase() !== thread
    )
      return {
        ...base,
        reason:
          'This Gmail link cannot be safely matched to the open conversation. Use a #all/<16-character thread ID> link; opaque links and reading panes are not supported yet.',
      };
    return {
      ...base,
      conversation: {
        accountId: account.id,
        threadId: thread,
        title: (heading.textContent ?? '').trim().slice(0, 300) || 'Untitled conversation',
        url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email)}#all/${thread}`,
      },
    };
  }

  findConversationToolbar(): HTMLElement | null {
    if (!this.getContext().conversation) return null;
    const bars = Array.from(
      this.doc.querySelectorAll<HTMLElement>(`${selectors.main} ${selectors.toolbar}`),
    ).filter((el) => this.visible(el));
    return bars.length === 1 ? bars[0]! : null;
  }

  findActiveComposer(): HTMLElement | null {
    const active = this.doc.activeElement;
    const focused = active?.closest<HTMLElement>(selectors.composer);
    if (focused && this.visible(focused)) return focused;
    if (this.composer && this.visible(this.composer)) return this.composer;
    const editors = Array.from(this.doc.querySelectorAll<HTMLElement>(selectors.composer)).filter(
      (el) => this.visible(el),
    );
    return editors.length === 1 ? editors[0]! : null;
  }

  captureComposer(): void {
    const composer = this.findActiveComposer();
    if (!composer) {
      this.composer = undefined;
      this.caret = undefined;
      return;
    }
    const previousComposer = this.composer;
    this.composer = composer;
    this.composerAccount = this.getCurrentAccount()?.id;
    const selection = this.doc.getSelection();
    if (
      selection?.rangeCount &&
      composer.contains(selection.anchorNode) &&
      composer.contains(selection.focusNode)
    ) {
      this.caret = selection.getRangeAt(0).cloneRange();
    } else if (previousComposer !== composer || !this.caret) {
      this.caret = this.doc.createRange();
      this.caret.selectNodeContents(composer);
      this.caret.collapse(false);
    }
  }

  insertIntoComposer(text: string): void {
    if (text.length > 100_000) throw new Error('This snippet is too large to insert.');
    const editor = this.composer;
    if (!editor || !this.visible(editor) || this.getCurrentAccount()?.id !== this.composerAccount)
      throw new Error('The draft changed. Focus the intended Gmail draft and open snippets again.');
    const range = this.caret?.cloneRange();
    if (!range || !editor.contains(range.startContainer) || !editor.contains(range.endContainer))
      throw new Error('The draft cursor changed. Focus the draft and open snippets again.');
    // Preserve selected draft content. Insert after the selection instead of replacing it.
    range.collapse(false);
    editor.focus();
    const selection = this.doc.getSelection();
    if (!selection) throw new Error('The draft cursor is unavailable.');
    selection.removeAllRanges();
    selection.addRange(range);
    // Chromium's editing command preserves Gmail's native undo/input pipeline. No HTML parsing.
    if (
      typeof this.doc.execCommand !== 'function' ||
      !this.doc.execCommand('insertText', false, text)
    ) {
      throw new Error(
        'Gmail text insertion is unavailable in this browser. Your draft was not replaced.',
      );
    }
    this.captureComposer();
  }

  navigateToGmailView(view: 'inbox' | 'sent' | 'drafts' | 'starred'): void {
    this.win.location.hash = view;
  }

  private onFocus = (): void => {
    if (this.doc.activeElement?.matches(selectors.composer)) this.captureComposer();
    this.schedule();
  };
  private schedule = (): void => {
    if (this.timer !== undefined) return;
    this.timer = this.win.setTimeout(() => {
      this.timer = undefined;
      const context = this.getContext();
      const serialized = JSON.stringify(context);
      if (serialized === this.lastContext) return;
      this.lastContext = serialized;
      this.listeners.forEach((listener) => listener(context));
    }, 80);
  };

  subscribe(listener: (context: GmailContext) => void): () => void {
    this.listeners.add(listener);
    const context = this.getContext();
    this.lastContext = JSON.stringify(context);
    listener(context);
    if (!this.observer) {
      this.observer = new MutationObserver(this.schedule);
      this.observer.observe(this.doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'data-legacy-thread-id',
          'data-thread-perm-id',
          'aria-label',
          'aria-hidden',
          'hidden',
          'style',
          'class',
        ],
      });
      this.win.addEventListener('hashchange', this.schedule);
      this.win.addEventListener('popstate', this.schedule);
      this.doc.addEventListener('focusin', this.onFocus);
      this.doc.addEventListener('selectionchange', this.onSelection);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  }

  private onSelection = (): void => {
    if (this.doc.activeElement?.matches(selectors.composer)) this.captureComposer();
  };
  private stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.timer !== undefined) this.win.clearTimeout(this.timer);
    this.timer = undefined;
    this.win.removeEventListener('hashchange', this.schedule);
    this.win.removeEventListener('popstate', this.schedule);
    this.doc.removeEventListener('focusin', this.onFocus);
    this.doc.removeEventListener('selectionchange', this.onSelection);
  }
  dispose(): void {
    this.stop();
    this.listeners.clear();
    this.composer = undefined;
    this.caret = undefined;
  }
}
