import { defineBackground } from 'wxt/utils/define-background';
import { createBackgroundHandler, REMINDER_ALARM, senderKind } from '../src/services/background';
import { starterSnippets } from '../src/features/snippets/starters';
import { BACKUP_ALARM, createBackupService } from '../src/features/backups/service';
import { readTrackingAddon, restoreTrackingAddon } from '../src/features/backups/addons';
import type { Backup } from '../src/types/model';

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
  const trusted = { id: chrome.runtime.id, url: chrome.runtime.getURL('/options.html') };
  const backups = createBackupService({
    extensionId: chrome.runtime.id,
    readWorkspace: async () => {
      const response = await service.handle({ type: 'export' }, trusted);
      if (!response.ok || !response.data || !('schemaVersion' in response.data))
        throw new Error('Your workspace could not be read.');
      return response.data as Backup;
    },
    restoreWorkspace: async (backup) => {
      const response = await service.handle({ type: 'import', backup }, trusted);
      if (!response.ok) throw new Error('Your workspace could not be restored.');
    },
    readAddons: readTrackingAddon,
    restoreAddons: restoreTrackingAddon,
    hasPermission: async (origin) => chrome.permissions.contains({ origins: [origin] }),
    setAlarm: async (when) => {
      await chrome.alarms.create(BACKUP_ALARM, { when });
    },
    clearAlarm: async () => {
      await chrome.alarms.clear(BACKUP_ALARM);
    },
  });
  // Secrets and whole-workspace recovery stay inside trusted extension contexts.
  const protectedStorage = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const ready = protectedStorage.then(() => backups.initialize());
  void ready.catch(() => undefined); // Pending recovery remains journaled and visible in settings.
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    void protectedStorage
      .then(async () => {
        await ready.catch(() => undefined);
        const type =
          message && typeof message === 'object' && 'type' in message ? message.type : undefined;
        if (typeof type === 'string' && type.startsWith('backup-'))
          return backups.handle(message, sender);
        if (type === 'clear') {
          // Core handler still checks the sender before any sensitive reset is permitted.
          const allowed = senderKind(sender, chrome.runtime.id) === 'extension';
          if (allowed) await backups.beforeClear();
        }
        const response = await service.handle(message, sender);
        if (
          response.ok &&
          typeof type === 'string' &&
          !['snapshot', 'export', 'open', 'options', 'clear'].includes(type)
        )
          await backups.changed().catch(() => undefined);
        return response;
      })
      .then(respond)
      .catch(() =>
        respond({
          ok: false,
          error: 'Vynlo could not access protected local data. Reload the extension and try again.',
        }),
      );
    return true;
  });
  const recover = () => {
    void ready
      .catch(() => undefined)
      .then(() => service.reconcile())
      .then(() => backups.changed())
      .catch(() => undefined);
  };
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REMINDER_ALARM) recover();
    if (alarm.name === BACKUP_ALARM)
      void ready.then(() => backups.process()).catch(() => undefined);
  });
  chrome.runtime.onStartup.addListener(recover);
  chrome.runtime.onInstalled.addListener(recover);
  chrome.notifications.onClicked.addListener((id) => {
    void service.openReminder(id).catch(() => undefined);
  });
  recover();
});
