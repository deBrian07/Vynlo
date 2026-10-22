import { defineBackground } from 'wxt/utils/define-background';
import { createBackgroundHandler, REMINDER_ALARM, senderKind } from '../src/services/background';
import { createClassificationService } from '../src/features/classification/service';
import { DEFAULT_CLASSIFICATION } from '../src/features/classification/model';
import { VynloDatabase } from '../src/services/storage/database';
import { validRequest, validSettings } from '../src/services/validation';
import { starterSnippets } from '../src/features/snippets/starters';

export default defineBackground(() => {
  const database = new VynloDatabase();
  const publishRevision = async () => {
    await chrome.storage.local.set({ revision: crypto.randomUUID() });
  };
  const classifier = createClassificationService({
    database,
    platform: {
      extensionId: chrome.runtime.id,
      getPreferences: async () =>
        (await chrome.storage.local.get('classificationPreferences')).classificationPreferences,
      setPreferences: async (classificationPreferences) => {
        await chrome.storage.local.set({ classificationPreferences });
      },
      hasPermission: () => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }),
      isEnhancementEnabled: async () => {
        const { settings } = await chrome.storage.local.get('settings');
        return settings === undefined || (validSettings(settings) && settings.enabled);
      },
      publishRevision,
      openTab: async (url) => {
        await chrome.tabs.create({ url });
      },
    },
  });
  const service = createBackgroundHandler({
    database,
    seedSnippets: starterSnippets,
    platform: {
      extensionId: chrome.runtime.id,
      getSettings: async () => (await chrome.storage.local.get('settings')).settings,
      setSettings: async (settings) => {
        await chrome.storage.local.set({ settings });
      },
      setAlarm: async (when) => {
        await chrome.alarms.create(REMINDER_ALARM, { when });
      },
      clearAlarm: async () => {
        await chrome.alarms.clear(REMINDER_ALARM);
      },
      notify: async (id) => {
        await chrome.notifications.create(id, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('/icons/128.png'),
          title: 'Vynlo follow-up',
          message: 'A conversation is ready for your attention. Open Vynlo to review it.',
          priority: 0,
        });
      },
      clearNotification: async (id) => {
        await chrome.notifications.clear(id);
      },
      openTab: async (url) => {
        await chrome.tabs.create({ url });
      },
      openOptions: async () => {
        await chrome.runtime.openOptionsPage();
      },
      publishRevision,
    },
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    const handle = async () => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        typeof message.type === 'string' &&
        message.type.startsWith('classify-')
      ) {
        return classifier.handle(message, sender);
      }
      if (
        senderKind(sender, chrome.runtime.id) === 'extension' &&
        validRequest(message) &&
        (message.type === 'clear' ||
          message.type === 'import' ||
          (message.type === 'settings' && !message.settings.enabled))
      ) {
        classifier.invalidate();
        if (message.type === 'clear') {
          await chrome.storage.local.set({ classificationPreferences: DEFAULT_CLASSIFICATION });
        }
      }
      return service.handle(message, sender);
    };
    void handle().then(respond, () =>
      respond({ ok: false, error: 'Vynlo could not complete this action. Please try again.' }),
    );
    return true;
  });
  chrome.permissions.onRemoved.addListener(() => {
    classifier.invalidate();
  });
  const recover = () => {
    void service.reconcile().catch(() => undefined);
  };
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REMINDER_ALARM) recover();
  });
  chrome.runtime.onStartup.addListener(recover);
  chrome.runtime.onInstalled.addListener(recover);
  chrome.notifications.onClicked.addListener((id) => {
    void service.openReminder(id).catch(() => undefined);
  });
  recover();
});
