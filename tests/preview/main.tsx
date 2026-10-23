// Local visual QA only. This harness is never a production extension entrypoint.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import Workspace from '../../src/components/Workspace';
import { CommandPalette, type Command } from '../../src/features/command-palette/CommandPalette';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { DraftLab } from './DraftLab';
import { starterSnippets } from '../../src/features/snippets/starters';
import { createClassificationService } from '../../src/features/classification/service';
import {
  DEFAULT_CLASSIFICATION,
  type ClassificationPreferences,
} from '../../src/features/classification/model';
import { createBackgroundHandler, type BackgroundPlatform } from '../../src/services/background';
import { VynloDatabase } from '../../src/services/storage/database';
import { contactId, conversationId, reminderId } from '../../src/services/validation';
import { DEFAULT_SETTINGS, type Backup, type Settings, type Status } from '../../src/types/model';
import type { Request } from '../../src/types/messages';
import '../../src/styles/app.css';

const listeners = new Set<() => void>();
const announce = () => listeners.forEach((listener) => listener());
let settings: Settings = JSON.parse(localStorage.getItem('vynlo-preview-settings') ?? 'null') ?? {
  ...DEFAULT_SETTINGS,
  onboarded: true,
  notifications: false,
};
const sender = { id: 'preview', url: 'chrome-extension://preview/options.html' };
const database = new VynloDatabase('vynlo-design-preview');
const platform: BackgroundPlatform = {
  extensionId: 'preview',
  getSettings: async () => settings,
  setSettings: async (next) => {
    settings = next;
    localStorage.setItem('vynlo-preview-settings', JSON.stringify(next));
    announce();
  },
  setAlarm: async () => {},
  clearAlarm: async () => {},
  notify: async () => {},
  clearNotification: async () => {},
  openTab: async () => {
    window.alert('Design preview: this fictional conversation has no real Gmail destination.');
  },
  openOptions: async () => {},
  publishRevision: async () => announce(),
};
const service = createBackgroundHandler({ database, platform });
let classificationPreferences: ClassificationPreferences = { ...DEFAULT_CLASSIFICATION };
const classifier = createClassificationService({
  database,
  platform: {
    extensionId: 'preview',
    getPreferences: async () => classificationPreferences,
    setPreferences: async (value) => {
      classificationPreferences = value;
    },
    hasPermission: async () => false,
    browserStatus: async () => ({
      state: 'unsupported',
      downloadedBytes: 0,
      totalBytes: 0,
      modelCached: false,
      message:
        'AI setup is available in the installed Chrome extension. This design preview uses fictional data.',
    }),
    isEnhancementEnabled: async () => settings.enabled,
    publishRevision: async () => announce(),
    openTab: platform.openTab,
  },
});
Object.defineProperty(window, 'chrome', {
  configurable: true,
  value: {
    runtime: {
      sendMessage: (message: Request | { type: string }) =>
        message.type.startsWith('classify-')
          ? classifier.handle(message, sender)
          : service.handle(message, sender),
      getManifest: () => ({ version: '0.1.0' }),
    },
    permissions: { request: async () => false },
    storage: {
      local: { get: async () => ({ settings }) },
      onChanged: {
        addListener: (fn: () => void) => listeners.add(fn),
        removeListener: (fn: () => void) => listeners.delete(fn),
      },
    },
  },
});

function fixture(): Backup {
  const now = Date.now(),
    accountId = 'jordan@example.com';
  const descriptions: [string, Status, string][] = [
    ['Project check-in', 'waiting', 'Send the revised proposal after the review.'],
    ['Design review · Thursday', 'needs-reply', 'Confirm the agenda and share feedback.'],
    ['A quick introduction', 'follow-up', 'Reconnect next week with a short update.'],
    ['Launch checklist approved', 'resolved', 'Everything is ready for Monday.'],
  ];
  const conversations = descriptions.map(([title, status, note], index) => {
    const threadId = `18b123456789abc${index}`;
    return {
      id: conversationId(accountId, threadId),
      accountId,
      threadId,
      title,
      status,
      note,
      url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountId)}#all/${threadId}`,
      createdAt: now - 4 * 86400000,
      updatedAt: now - index * 3600000,
    };
  });
  return {
    schemaVersion: 1,
    exportedAt: now,
    settings,
    accounts: [{ id: accountId, email: accountId, createdAt: now - 4 * 86400000 }],
    conversations,
    reminders: conversations.slice(0, 2).map((conversation, index) => ({
      id: reminderId(conversation.id),
      accountId,
      conversationId: conversation.id,
      dueAt: now + (index ? 86400000 : -3600000),
      state: index ? 'pending' : 'due',
      snoozeCount: 0,
      createdAt: now - 86400000,
      updatedAt: now,
      notifiedAt: now,
    })),
    snippets: starterSnippets(now),
    contacts: [
      {
        email: 'alex@example.com',
        name: 'Alex Morgan',
        note: 'Working on the design system. Catch up after the launch.',
        tags: ['Design', 'Colleague'],
      },
      {
        email: 'sam@example.com',
        name: 'Sam Rivera',
        note: 'Met at the product meetup. Share the reading list.',
        tags: ['Community'],
      },
    ].map((contact) => ({
      ...contact,
      id: contactId(accountId, contact.email),
      accountId,
      createdAt: now,
      updatedAt: now,
    })),
  };
}

function Preview() {
  const [theme, setTheme] = useState(settings.theme);
  const [view, setView] = useState<Settings['landingView'] | 'settings'>('dashboard');
  const [palette, setPalette] = useState(false);
  const [draftLab, setDraftLab] = useState(false);
  useEffect(() => {
    const sync = () => setTheme(settings.theme);
    listeners.add(sync);
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(true);
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      listeners.delete(sync);
      document.removeEventListener('keydown', key);
    };
  }, []);
  const commands: Command[] = [
    ['dashboard', 'Open conversations'],
    ['snippets', 'Open snippets'],
    ['contacts', 'Open contact notes'],
    ['settings', 'Open settings'],
  ].map(([id, title]) => ({
    id: id!,
    title: title!,
    run: () => {
      setDraftLab(false);
      setView(id as typeof view);
    },
  }));
  return (
    <div className={`vynlo options-page theme-${theme === 'dark' ? 'dark' : 'light'}`}>
      <aside
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          padding: '12px 24px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--surface)',
        }}
      >
        <strong>Design preview · fictional data</strong>
        <span style={{ marginRight: 'auto', color: 'var(--muted)' }}>
          Email, without the friction.
        </span>
        {(['light', 'dark'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={theme === value}
            onClick={() =>
              void service.handle(
                { type: 'settings', settings: { ...settings, theme: value } },
                sender,
              )
            }
          >
            {value === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
        <button onClick={() => setPalette(true)}>Open commands</button>
        <button onClick={() => setDraftLab(!draftLab)}>
          {draftLab ? 'Workspace' : 'Draft lab'}
        </button>
      </aside>
      <ErrorBoundary>
        {draftLab ? (
          <DraftLab />
        ) : (
          <Workspace options initialView={view} onPalette={() => setPalette(true)} />
        )}
      </ErrorBoundary>
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
    </div>
  );
}

async function start() {
  if (!(await database.read()).accounts.length) {
    const imported = await service.handle({ type: 'import', backup: fixture() }, sender);
    if (!imported.ok) throw new Error(imported.error);
  }
  await service.reconcile();
  createRoot(document.getElementById('root')!).render(<Preview />);
}
void start().catch(() => {
  document.getElementById('root')!.textContent =
    'The fictional preview could not initialize. Clear this localhost site’s storage and reload.';
});
