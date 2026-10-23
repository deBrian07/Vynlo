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
  if (!(await page.getByRole('heading', { name: 'Conversations' }).isVisible())) {
    await page.getByRole('button', { name: 'Open Vynlo', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Conversations' })).toBeVisible();
}
async function track() {
  await page.getByRole('button', { name: 'Track conversation', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Track conversation', exact: true });
  await editor.getByLabel('Tracking status').selectOption('waiting');
  await editor.getByRole('button', { name: 'Track conversation', exact: true }).click();
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

test('typing in Vynlo stays isolated from Gmail keyboard shortcuts', async () => {
  await dashboard();
  await page.evaluate(() => {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'j') document.body.dataset.gmailShortcut = 'triggered';
    });
  });
  await page.getByLabel('Search conversations').fill('');
  await page.getByLabel('Search conversations').press('j');
  await expect(page.getByLabel('Search conversations')).toHaveValue('j');
  expect(await page.locator('body').getAttribute('data-gmail-shortcut')).toBeNull();
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

test('inserts a resolved snippet at the captured cursor without replacing or sending a draft', async () => {
  await request({
    type: 'save-snippet',
    snippet: {
      title: 'Fixture greeting',
      category: 'Fixture',
      content: 'Hello {{first_name}} at {{company}}.',
    },
  });
  const composer = page.getByRole('textbox', { name: 'Message body' });
  await composer.fill('Existing draft. ');
  await composer.press('End');
  await page.evaluate(() => {
    document.getElementById('fixture-send')?.addEventListener('click', () => {
      document.body.dataset.sent = 'true';
    });
  });
  await dashboard();
  await page.getByRole('button', { name: 'Snippets', exact: true }).click();
  const card = page
    .locator('.snippet-card')
    .filter({ has: page.getByRole('heading', { name: 'Fixture greeting' }) });
  await card.getByRole('button', { name: 'Insert snippet' }).click();
  await page.getByLabel('first_name', { exact: true }).fill('Alex');
  await page.getByLabel('company', { exact: true }).fill('<Example>');
  await page.getByRole('button', { name: 'Insert into draft', exact: true }).click();
  await expect(composer).toHaveText('Existing draft. Hello Alex at <Example>.');
  await expect(composer).toBeFocused();
  await expect(composer.locator('example')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-sent');
});

test('creates, edits, searches and deletes an account-scoped contact note', async () => {
  await dashboard();
  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  await page.getByRole('button', { name: 'Add contact', exact: true }).click();
  await page.getByLabel('Contact email').fill('alex@example.com');
  await page.getByLabel('Display name').fill('Alex Example');
  await page.getByLabel('Contact notes').fill('Meet about the launch.');
  await page.getByLabel('Contact tags').fill('Design, Coffee');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alex Example' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit alex@example.com', exact: true }).click();
  await page.getByLabel('Contact notes').fill('Meet next week about the launch.');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await page.getByLabel('Search contacts').fill('next week');
  await expect(page.locator('.contact-card')).toContainText('Meet next week about the launch.');
  await page.reload();
  await dashboard();
  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  await expect(page.locator('.contact-card')).toContainText('Meet next week about the launch.');
  await page.getByRole('button', { name: 'Delete alex@example.com', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.contact-card')).toHaveCount(0);
  expect(
    (await request({ type: 'snapshot', accountId: 'person@example.com' })).contacts,
  ).toHaveLength(0);
});

test('schedules and dismisses a reminder using the visible conversation controls', async () => {
  await page.getByRole('button', { name: 'Track conversation', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Track conversation', exact: true });
  await editor.getByLabel('Tracking status').selectOption('follow-up');
  await editor.getByLabel('Set a reminder after saving').check();
  await editor.getByRole('button', { name: 'Save & set reminder', exact: true }).click();
  await page.getByRole('button', { name: /^Tomorrow\b/ }).click();
  await dashboard();
  await expect(page.locator('.due-chip')).toBeVisible();
  await page.locator('.due-chip').click();
  await expect(page.getByRole('heading', { name: 'Edit reminder' })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss reminder', exact: true }).click();
  await expect(page.locator('.due-chip')).toHaveCount(0);
  expect(
    (await request({ type: 'snapshot', accountId: 'person@example.com' })).reminders[0]?.state,
  ).toBe('dismissed');
});

test('renders representative fixture views in light, dark and narrow layouts', async () => {
  const records = [
    {
      threadId: thread,
      title: 'Project check-in',
      status: 'waiting' as const,
      note: 'Send the revised proposal after the review.',
    },
    {
      threadId: '18b123456789abce',
      title: 'Design review · Thursday',
      status: 'needs-reply' as const,
      note: 'Confirm the agenda and share feedback.',
    },
    {
      threadId: '18b123456789abcf',
      title: 'A quick introduction',
      status: 'follow-up' as const,
      note: 'Reconnect next week with a short update.',
    },
    {
      threadId: '18b123456789abd0',
      title: 'Launch checklist approved',
      status: 'resolved' as const,
      note: '',
    },
  ];
  const settings = (await request({ type: 'snapshot' })).settings;
  await request({ type: 'settings', settings: { ...settings, onboarded: true, theme: 'light' } });
  for (const record of records) {
    await request({
      type: 'track',
      ref: {
        accountId: 'person@example.com',
        threadId: record.threadId,
        title: record.title,
        url: `https://mail.google.com/mail/u/0/?authuser=person%40example.com#all/${record.threadId}`,
      },
      status: record.status,
      note: record.note,
    });
  }
  await request({
    type: 'remind',
    accountId: 'person@example.com',
    conversationId: `person@example.com:${thread}`,
    dueAt: Date.now() + 3_600_000,
  });
  await page.reload();
  await dashboard();
  await expect(page.locator('.conversation-row')).toHaveCount(4);
  mkdirSync(resolve('artifacts'), { recursive: true });
  await page.screenshot({ path: resolve('artifacts/fixture-dashboard-light.png'), fullPage: true });
  await options.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(options.getByRole('heading', { name: 'Your preferences.' })).toBeVisible();
  await options.screenshot({ path: resolve('artifacts/fixture-settings.png'), fullPage: true });
  await request({ type: 'settings', settings: { ...settings, onboarded: true, theme: 'dark' } });
  await page.reload();
  await dashboard();
  await page.screenshot({ path: resolve('artifacts/fixture-dashboard-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 600, height: 900 });
  const panel = await page.locator('.workspace-panel').boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(600);
  await page.screenshot({
    path: resolve('artifacts/fixture-dashboard-narrow.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('body').click({ position: { x: 10, y: 100 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeVisible();
  await page.screenshot({ path: resolve('artifacts/fixture-palette.png'), fullPage: true });
});

test('manual email tags persist without AI, download nothing and remain account isolated', async () => {
  const modelRequests: string[] = [];
  context.on('request', (request) => {
    if (/https:\/\/[^/]*(?:huggingface\.co|hf\.co)\//.test(request.url()))
      modelRequests.push(request.url());
  });
  await dashboard();
  await page
    .getByRole('region', { name: 'Current conversation tag' })
    .getByLabel('Category', { exact: true })
    .selectOption('work');
  await expect
    .poll(
      async () =>
        (await request({ type: 'snapshot', accountId: 'person@example.com' })).emailTags?.[0]
          ?.source,
    )
    .toBe('manual');
  await page.reload();
  await dashboard();
  await expect(
    page
      .getByRole('region', { name: 'Current conversation tag' })
      .getByLabel('Category', { exact: true }),
  ).toHaveValue('work');
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page.locator('.email-tags .contact-card')).toContainText('Project check-in');
  await expect(page.locator('.email-tags .contact-card')).toContainText('Reviewed');
  await page.goto(`https://mail.google.com/mail/u/1/?fixtureAccount=b#all/${thread}`);
  await dashboard();
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page.locator('.email-tags .contact-card')).toHaveCount(0);
  expect(
    (await request({ type: 'snapshot', accountId: 'person@example.com' })).emailTags,
  ).toHaveLength(1);
  expect(modelRequests).toEqual([]);
});
