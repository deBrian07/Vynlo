import { defineBackground } from 'wxt/utils/define-background';
import { createBackgroundHandler, REMINDER_ALARM } from '../src/services/background';
import { starterSnippets } from '../src/features/snippets/starters';
import { createTrackingService } from '../src/features/open-tracking/service';

export default defineBackground(() => {
  // Content scripts use validated messages, never direct access to stored capabilities.
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const tracking = createTrackingService({
    extensionId: chrome.runtime.id,
    getConfig: async () =>
      (await chrome.storage.local.get('trackingConnection')).trackingConnection,
    setConfig: async (value) => {
      if (value) await chrome.storage.local.set({ trackingConnection: value });
      else await chrome.storage.local.remove('trackingConnection');
    },
    hasPermission: async (origin) => chrome.permissions.contains({ origins: [origin] }),
  });
  const service = createBackgroundHandler({
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
      publishRevision: async () => {
        await chrome.storage.local.set({ revision: crypto.randomUUID() });
      },
    },
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      typeof message.type === 'string' &&
      message.type.startsWith('tracking-')
    ) {
      void tracking.handle(message, sender).then(respond);
    } else {
      void service
        .handle(message, sender)
        .then(async (result) => {
          if (
            result.ok &&
            message &&
            typeof message === 'object' &&
            'type' in message &&
            message.type === 'clear'
          )
            await tracking.clearLocal();
          respond(result);
        })
        .catch(() =>
          respond({ ok: false, error: 'Local tracking data could not be cleared. Try again.' }),
        );
    }
    return true;
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
