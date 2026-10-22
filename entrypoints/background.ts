import { defineBackground } from 'wxt/utils/define-background';
import { createBackgroundHandler, REMINDER_ALARM } from '../src/services/background';
import { starterSnippets } from '../src/features/snippets/starters';

export default defineBackground(() => {
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
    void service.handle(message, sender).then(respond);
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
