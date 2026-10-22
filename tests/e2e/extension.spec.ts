import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, readFileSync, mkdtempSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { Request, Response } from '../../src/types/messages';
import type { Snapshot } from '../../src/types/model';

const build = resolve('.output/chrome-mv3');
const fixture = readFileSync(resolve('tests/fixtures/gmail-browser.html'), 'utf8');
const thread = '18b123456789abcd';
const url = `https://mail.google.com/mail/u/0/#all/${thread}`;
const legacyBrowsers = '/private/tmp/vynlo-playwright';
if (
  !process.env.PLAYWRIGHT_BROWSERS_PATH &&
  existsSync(legacyBrowsers) &&
  readdirSync(legacyBrowsers).some((name) => name.startsWith('chromium-'))
) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = legacyBrowsers;
}

let context: BrowserContext;
let page: Page;
let options: Page;
let profile: string;
let extensionId: string;

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
    viewport: { width: 1440, height: 1000 },
  });
  await context.route('https://mail.google.com/**', async (route) => {
    const account =
      new URL(route.request().url()).searchParams.get('fixtureAccount') === 'b'
        ? 'other@example.com'
        : 'person@example.com';
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: fixture.replaceAll('__ACCOUNT__', account),
    });
  });
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  page = await context.newPage();
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Open Vynlo', exact: true })).toBeVisible();
}

async function request(request: Request): Promise<Snapshot> {
  const response = await options.evaluate(
    async (message) => (await chrome.runtime.sendMessage(message)) as Response,
    request,
  );
  if (!response.ok) throw new Error(response.error);
  return response.data as Snapshot;
}
async function dashboard() {
  if (!(await page.getByRole('heading', { name: 'Keep things moving.' }).isVisible())) {
    await page.getByRole('button', { name: 'Open Vynlo', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Keep things moving.' })).toBeVisible();
}
async function track() {
  await page.getByRole('button', { name: 'Track conversation', exact: true }).click();
  await page.getByLabel('Tracking status').selectOption('waiting');
  await page.getByRole('button', { name: 'Save conversation', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await request({ type: 'snapshot', accountId: 'person@example.com' })).conversations.length,
    )
    .toBe(1);
}

test.beforeEach(async () => {
  expect(
    existsSync(join(build, 'manifest.json')),
    'Build the extension before running browser tests',
  ).toBe(true);
  profile = mkdtempSync(join(tmpdir(), 'vynlo-e2e-'));
  await launch();
});
test.afterEach(async () => {
  await context?.close();
  if (profile) rmSync(profile, { recursive: true, force: true });
});

test('shows tracking beside the toolbar and includes starter snippets', async () => {
  await expect(
    page.getByRole('button', { name: 'Track this conversation', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open Vynlo', exact: true }).click();
  await page.getByRole('button', { name: 'Snippets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Internship follow-up' })).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open Vynlo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Got it', exact: true })).toHaveCount(0);
});

test('tracks a conversation through the UI and persists across Gmail reload', async () => {
  await track();
  await page.reload();
  await dashboard();
  await expect(page.locator('.conversation-row')).toContainText('Project check-in');
  expect(
    (await request({ type: 'snapshot', accountId: 'person@example.com' })).conversations[0]?.status,
  ).toBe('waiting');
  mkdirSync(resolve('artifacts'), { recursive: true });
  await page.screenshot({ path: resolve('artifacts/fixture-dashboard.png'), fullPage: true });
});

test('command palette opens with keyboard and executes Gmail navigation', async () => {
  await page.locator('body').click({ position: { x: 10, y: 100 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await search.fill('Gmail Sent');
  await search.press('Enter');
  await expect(page).toHaveURL(/#sent$/);
  await expect(search).not.toBeVisible();
});

test('unknown conversation route disables tracking without breaking Gmail', async () => {
  await page.goto('https://mail.google.com/mail/u/0/#inbox/FMfcgzQXymQ');
  await expect(page.getByRole('button', { name: 'Open Vynlo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Track conversation', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('textbox', { name: 'Message body' }).fill('Gmail remains editable.');
  await expect(page.getByRole('textbox', { name: 'Message body' })).toHaveText(
    'Gmail remains editable.',
  );
  expect(
    (await request({ type: 'snapshot', accountId: 'person@example.com' })).conversations,
  ).toHaveLength(0);
});

test('account switching does not display another account records', async () => {
  await track();
  await page.goto(`https://mail.google.com/mail/u/1/?fixtureAccount=b#all/${thread}`);
  await dashboard();
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  expect(
    (await request({ type: 'snapshot', accountId: 'other@example.com' })).conversations,
  ).toHaveLength(0);
  await page.goto(url);
  await dashboard();
  await expect(page.locator('.conversation-row')).toContainText('Project check-in');
});

test('pending reminders are reconstructed after the entire browser restarts', async () => {
  await track();
  await request({
    type: 'remind',
    accountId: 'person@example.com',
    conversationId: `person@example.com:${thread}`,
    dueAt: Date.now() + 120_000,
  });
  await context.close();
  await launch();
  const result = await request({ type: 'snapshot', accountId: 'person@example.com' });
  expect(result.reminders).toHaveLength(1);
  expect(result.reminders[0]?.state).toBe('pending');
  const alarms = await options.evaluate(() => chrome.alarms.getAll());
  expect(alarms.some((alarm) => alarm.name === 'vynlo-next-reminder')).toBe(true);
  await request({ type: 'track', ref: result.conversations[0]!, status: 'resolved' });
  expect(
    (await request({ type: 'snapshot', accountId: 'person@example.com' })).reminders[0]?.state,
  ).toBe('dismissed');
});

test('settings survive a new browser session', async () => {
  const result = await request({ type: 'snapshot' });
  await request({
    type: 'settings',
    settings: { ...result.settings, theme: 'dark', notifications: false },
  });
  await context.close();
  await launch();
  const restored = await request({ type: 'snapshot' });
  expect(restored.settings.theme).toBe('dark');
  expect(restored.settings.notifications).toBe(false);
});

test('overdue reminders recover after shutdown and can be snoozed from the dashboard', async () => {
  await track();
  const preferences = (await request({ type: 'snapshot' })).settings;
  await request({ type: 'settings', settings: { ...preferences, notifications: false } });
  const dueAt = Date.now() + 1_000;
  await request({
    type: 'remind',
    accountId: 'person@example.com',
    conversationId: `person@example.com:${thread}`,
    dueAt,
  });
  await context.close();
  // Actual wall time passes while Chrome is closed; startup must discover the missed reminder.
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, dueAt - Date.now()) + 50));
  await launch();
  await dashboard();
  await expect(page.getByRole('button', { name: 'Snooze 1 day', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Snooze 1 day', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await request({ type: 'snapshot', accountId: 'person@example.com' })).reminders[0]?.state,
    )
    .toBe('pending');
  expect(
    (await request({ type: 'snapshot', accountId: 'person@example.com' })).reminders[0]
      ?.snoozeCount,
  ).toBe(1);
});
