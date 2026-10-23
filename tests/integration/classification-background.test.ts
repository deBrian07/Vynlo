import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { BROWSER_PREFERENCES_KEY } from '../../src/features/classification/browser/model';
import { DEFAULT_SETTINGS } from '../../src/types/model';

const bridge = vi.hoisted(() => ({
  infer: vi.fn(),
  check: vi.fn(),
  status: vi.fn(),
  prepare: vi.fn(),
  release: vi.fn(async () => {}),
  removeModel: vi.fn(async () => {}),
}));
vi.mock('../../src/features/classification/browser/bridge', () => ({
  createBrowserInferenceBridge: () => bridge,
}));
vi.mock('wxt/utils/define-background', () => ({ defineBackground: (run: () => void) => run }));

it.each(['clear', 'import', 'disable'])(
  'blocks inference from another Gmail tab as soon as %s starts, before preferences finish writing',
  async (operation) => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('indexedDB', new IDBFactory());
    const values: Record<string, unknown> = {
      settings: { ...DEFAULT_SETTINGS, notifications: false },
      [BROWSER_PREFERENCES_KEY]: { enabled: true, automatic: true },
    };
    let finishPreferences!: () => void;
    const write = vi.fn(async (next: Record<string, unknown>) => {
      if (BROWSER_PREFERENCES_KEY in next)
        await new Promise<void>((resolve) => {
          finishPreferences = resolve;
        });
      Object.assign(values, next);
    });
    let listener!: (
      message: unknown,
      sender: unknown,
      respond: (value: unknown) => void,
    ) => boolean;
    const event = () => ({ addListener: vi.fn() });
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-extension',
        onMessage: {
          addListener: (receive: typeof listener) => {
            listener = receive;
          },
        },
        onInstalled: event(),
        onStartup: event(),
        openOptionsPage: vi.fn(),
      },
      permissions: { contains: async () => true, onRemoved: event() },
      storage: { local: { get: async (key: string) => ({ [key]: values[key] }), set: write } },
      alarms: { create: vi.fn(), clear: async () => true, onAlarm: event() },
      notifications: { create: vi.fn(), clear: vi.fn(), onClicked: event() },
      tabs: { create: vi.fn() },
    });
    const background = await import('../../entrypoints/background');
    (background.default as unknown as () => void)();
    const extension = {
      id: 'test-extension',
      url: 'chrome-extension://test-extension/options.html',
    };
    const gmail = {
      id: 'test-extension',
      url: 'https://mail.google.com/mail/u/0/',
      frameId: 0,
      tab: { id: 1 },
    };
    const request = (message: unknown, sender: unknown) =>
      new Promise((resolve) => listener(message, sender, resolve));
    try {
      const message =
        operation === 'clear'
          ? { type: 'clear' }
          : operation === 'disable'
            ? { type: 'settings', settings: { ...DEFAULT_SETTINGS, enabled: false } }
            : {
                type: 'import',
                backup: {
                  schemaVersion: 1,
                  exportedAt: Date.now(),
                  settings: DEFAULT_SETTINGS,
                  accounts: [],
                  conversations: [],
                  reminders: [],
                  contacts: [],
                  snippets: [],
                  emailTags: [],
                },
              };
      const action = request(message, extension);
      await vi.waitFor(() => expect(finishPreferences).toBeTypeOf('function'));
      expect(values[BROWSER_PREFERENCES_KEY]).toEqual({ enabled: true, automatic: true });
      expect(
        await request(
          {
            type: 'classify-automatic',
            ref: {
              accountId: 'person@example.com',
              threadId: '1234567890abcdef',
              title: 'Project',
              url: 'https://mail.google.com/mail/?authuser=person%40example.com#all/1234567890abcdef',
            },
          },
          gmail,
        ),
      ).toEqual({ ok: true, data: null });
      expect(bridge.infer).not.toHaveBeenCalled();
      finishPreferences();
      expect(await action).toMatchObject({ ok: true });
      expect(values[BROWSER_PREFERENCES_KEY]).toEqual({ enabled: false, automatic: false });
      if (operation === 'clear') expect(bridge.removeModel).toHaveBeenCalledOnce();
      else {
        expect(bridge.release).toHaveBeenCalledOnce();
        expect(bridge.removeModel).not.toHaveBeenCalled();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
