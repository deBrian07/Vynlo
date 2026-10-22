import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { createBackgroundHandler, type BackgroundPlatform } from '../../src/services/background';
import { VynloDatabase } from '../../src/services/storage/database';
import { DEFAULT_SETTINGS, type Backup, type Snapshot } from '../../src/types/model';
import { createClassificationService } from '../../src/features/classification/service';
import { DEFAULT_CLASSIFICATION } from '../../src/features/classification/model';
const extension = { id: 'test', url: 'chrome-extension://test/options.html' };
const gmail = { id: 'test', url: 'https://mail.google.com/mail/u/0/', frameId: 0, tab: { id: 1 } };
const ref = {
  accountId: 'a@example.com',
  threadId: '1234567890abcdef',
  title: 'Project review',
  url: 'https://mail.google.com/mail/?authuser=a@example.com#all/1234567890abcdef',
};
function setup() {
  const database = new VynloDatabase('tags', new IDBFactory());
  let settings = structuredClone(DEFAULT_SETTINGS);
  const platform: BackgroundPlatform = {
    extensionId: 'test',
    getSettings: async () => settings,
    setSettings: async (v) => {
      settings = v;
    },
    setAlarm: async () => {},
    clearAlarm: async () => {},
    notify: async () => {},
    clearNotification: async () => {},
    openTab: async () => {},
    openOptions: async () => {},
  };
  const core = createBackgroundHandler({ database, platform });
  const classifier = createClassificationService({
    database,
    platform: {
      extensionId: 'test',
      getPreferences: async () => DEFAULT_CLASSIFICATION,
      setPreferences: async () => {},
      hasPermission: async () => false,
      isEnhancementEnabled: async () => true,
      publishRevision: async () => {},
      openTab: async () => {},
    },
  });
  return { database, core, classifier };
}
it('exports and restores standalone tags idempotently without enabling AI', async () => {
  const from = setup(),
    to = setup();
  expect(
    await from.classifier.handle({ type: 'classify-set', ref, category: 'work' }, gmail),
  ).toMatchObject({ ok: true });
  const exported = await from.core.handle({ type: 'export' }, extension);
  if (!exported.ok) throw new Error('Export failed');
  const backup = exported.data as Backup;
  expect(backup.conversations).toEqual([]);
  expect(backup.emailTags).toHaveLength(1);
  for (let i = 0; i < 2; i++)
    expect(await to.core.handle({ type: 'import', backup }, extension)).toMatchObject({ ok: true });
  expect((await to.database.read()).emailTags).toEqual(backup.emailTags);
  expect(await to.classifier.handle({ type: 'classify-status' }, extension)).toMatchObject({
    ok: true,
    data: { enabled: false, automatic: false },
  });
  const unknown = await to.core.handle({ type: 'snapshot' }, gmail);
  expect(unknown.ok && (unknown.data as Snapshot).emailTags).toEqual([]);
  const other = await to.core.handle({ type: 'snapshot', accountId: 'b@example.com' }, gmail);
  expect(other.ok && (other.data as Snapshot).emailTags).toEqual([]);
  const legacy = { ...backup };
  delete legacy.emailTags;
  expect(await to.core.handle({ type: 'import', backup: legacy }, extension)).toMatchObject({
    ok: true,
  });
  expect((await to.database.read()).emailTags).toHaveLength(1);
  await to.core.handle({ type: 'clear' }, extension);
  expect((await to.database.read()).emailTags).toEqual([]);
  await from.database.close();
  await to.database.close();
});
