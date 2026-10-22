// @vitest-environment node
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import worker, { type Env, type Statement } from '../../cloudflare/src/index';
import { createTrackingService } from '../../src/features/open-tracking/service';
import { TrackingDatabase } from '../../src/features/open-tracking/database';
import type {
  CreatedTracking,
  TrackingSnapshot,
  TrackingRecord,
} from '../../src/features/open-tracking/types';

const endpoint = 'https://vynlo.test.workers.dev';
const secret = 'a'.repeat(64);
const sender = { id: 'extension', url: 'chrome-extension://extension/options.html' };
const gmail = {
  id: 'extension',
  url: 'https://mail.google.com/mail/u/0/',
  frameId: 0,
  tab: { id: 1 },
};
let sqlite: DatabaseSync;
let env: Env;
let stored: unknown;
let allowed: boolean;
let database: TrackingDatabase;
const calls: string[] = [];
function service() {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    calls.push(String(input));
    return worker.fetch(new Request(input, init), env);
  });
  return {
    fetcher,
    ...createTrackingService(
      {
        extensionId: 'extension',
        getConfig: async () => stored,
        setConfig: async (value) => {
          stored = value;
        },
        hasPermission: async () => allowed,
      },
      database,
      fetcher,
    ),
  };
}
beforeEach(() => {
  calls.length = 0;
  stored = undefined;
  allowed = true;
  database = new TrackingDatabase(`test-tracking-${crypto.randomUUID()}`);
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    readFileSync(new URL('../../cloudflare/migrations/0001_tracking.sql', import.meta.url), 'utf8'),
  );
  env = {
    ADMIN_SECRET: secret,
    API_LIMITER: { limit: async () => ({ success: true }) },
    PIXEL_LIMITER: { limit: async () => ({ success: true }) },
    DB: {
      prepare(query) {
        let args: (string | number | null)[] = [];
        const stmt: Statement = {
          bind(...values) {
            args = values;
            return stmt;
          },
          async first<T>() {
            return (sqlite.prepare(query).get(...args) ?? null) as T | null;
          },
          async run() {
            return sqlite.prepare(query).run(...args);
          },
        };
        return stmt;
      },
    },
  };
});
afterEach(() => sqlite.close());
async function connect(s: ReturnType<typeof service>) {
  expect(await s.handle({ type: 'tracking-connect', endpoint, secret }, sender)).toEqual({
    ok: true,
    data: null,
  });
}
async function create(s: ReturnType<typeof service>, accountId = 'a@example.com') {
  const response = await s.handle(
    { type: 'tracking-create', accountId, label: 'Private local label' },
    gmail,
  );
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(response.error);
  return response.data as CreatedTracking;
}
it('connects, survives service recreation, prepares paused pixels, activates, refreshes and revokes', async () => {
  let s = service();
  await connect(s);
  const created = await create(s);
  await worker.fetch(new Request(created.pixelUrl), env);
  expect((await database.read())[0]?.armedAt).toBeNull();
  s = service();
  expect(
    (
      await s.handle(
        { type: 'tracking-activate', accountId: 'a@example.com', id: created.id },
        gmail,
      )
    ).ok,
  ).toBe(true);
  await worker.fetch(new Request(created.pixelUrl), env);
  const result = await s.handle({ type: 'tracking-refresh', accountId: 'a@example.com' }, gmail);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  const snapshot = result.data as TrackingSnapshot;
  expect(snapshot.records[0]?.openCount).toBe(1);
  expect(snapshot.records[0]?.label).toBe('Private local label');
  expect(JSON.stringify(snapshot)).not.toMatch(/readToken|deleteToken|secret/);
  expect(sqlite.prepare('SELECT * FROM trackings').get()).not.toHaveProperty('label');
  expect(
    (await s.handle({ type: 'tracking-remove', accountId: 'a@example.com', id: created.id }, gmail))
      .ok,
  ).toBe(true);
  expect(await database.read()).toEqual([]);
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM trackings').get()?.count).toBe(0);
});
it('rejects untrusted messages and Gmail credential management before networking', async () => {
  const s = service();
  for (const senderValue of [{ ...sender, id: 'foreign' }, gmail])
    expect((await s.handle({ type: 'tracking-connect', endpoint, secret }, senderValue)).ok).toBe(
      false,
    );
  expect(s.fetcher).not.toHaveBeenCalled();
  await connect(s);
  expect((await s.handle({ type: 'tracking-disconnect' }, gmail)).ok).toBe(false);
  expect(stored).toBeTruthy();
});
it('rejects arbitrary endpoints, redirects, denied permission and wrong keys without saving credentials', async () => {
  const s = service();
  for (const url of [
    'https://evil.test',
    'http://vynlo.test.workers.dev',
    'https://vynlo.test.workers.dev/path',
    'https://user@vynlo.test.workers.dev',
  ])
    expect((await s.handle({ type: 'tracking-connect', endpoint: url, secret }, sender)).ok).toBe(
      false,
    );
  expect(s.fetcher).not.toHaveBeenCalled();
  allowed = false;
  expect((await s.handle({ type: 'tracking-connect', endpoint, secret }, sender)).ok).toBe(false);
  allowed = true;
  expect(
    (await s.handle({ type: 'tracking-connect', endpoint, secret: 'b'.repeat(64) }, sender)).ok,
  ).toBe(false);
  expect(stored).toBeUndefined();
  expect(s.fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: 'error',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
});
it('isolates accounts and refuses cross-account activation/deletion', async () => {
  const s = service();
  await connect(s);
  const a = await create(s);
  await create(s, 'b@example.com');
  const result = await s.handle({ type: 'tracking-snapshot', accountId: 'b@example.com' }, gmail);
  expect(result.ok && (result.data as TrackingSnapshot).records).toHaveLength(1);
  for (const type of ['tracking-remove', 'tracking-activate'])
    expect((await s.handle({ type, accountId: 'b@example.com', id: a.id }, gmail)).ok).toBe(false);
  const empty = await s.handle({ type: 'tracking-snapshot' }, gmail);
  expect(empty.ok && (empty.data as TrackingSnapshot).records).toEqual([]);
});
it('disconnects without losing revocation capabilities and clear removes local connection/history', async () => {
  const s = service();
  await connect(s);
  const row = await create(s);
  await s.handle({ type: 'tracking-disconnect' }, sender);
  expect(stored).toBeNull();
  expect(await database.read()).toHaveLength(1);
  expect(
    (await s.handle({ type: 'tracking-remove', accountId: 'a@example.com', id: row.id }, gmail)).ok,
  ).toBe(true);
  await connect(s);
  await create(s);
  await s.clearLocal();
  expect(await database.read()).toEqual([]);
  expect(stored).toBeNull();
});
it('preserves last valid events when the remote response is malformed', async () => {
  const s = service();
  await connect(s);
  const row = await create(s);
  await s.handle({ type: 'tracking-activate', accountId: 'a@example.com', id: row.id }, gmail);
  const old = (await database.read())[0] as TrackingRecord;
  s.fetcher.mockImplementationOnce(async () =>
    Response.json({ id: row.id, firstOpenedAt: null, lastOpenedAt: null, openCount: 999 }),
  );
  expect((await s.handle({ type: 'tracking-refresh', accountId: 'a@example.com' }, gmail)).ok).toBe(
    false,
  );
  expect(await database.read()).toEqual([old]);
});

it('waits for an in-flight creation before clearing local capabilities', async () => {
  const s = service();
  await connect(s);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  s.fetcher.mockImplementationOnce(async (input, init) => {
    await blocked;
    return worker.fetch(new Request(input, init), env);
  });
  const creating = s.handle(
    { type: 'tracking-create', accountId: 'a@example.com', label: 'Draft' },
    gmail,
  );
  await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledTimes(3));
  const clearing = s.clearLocal();
  release();
  expect((await creating).ok).toBe(true);
  await clearing;
  expect(await database.read()).toEqual([]);
  expect(stored).toBeNull();
});

it('does not claim activation when the Worker returns an invalid acknowledgment', async () => {
  const s = service();
  await connect(s);
  const row = await create(s);
  s.fetcher.mockImplementationOnce(async () => Response.json({ ok: true, armedAt: 'yesterday' }));
  expect(
    (await s.handle({ type: 'tracking-activate', accountId: 'a@example.com', id: row.id }, gmail))
      .ok,
  ).toBe(false);
  expect((await database.read())[0]?.armedAt).toBeNull();
});
