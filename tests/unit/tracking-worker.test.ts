// @vitest-environment node
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env, type Statement } from '../../cloudflare/src/index';

const id = 'a'.repeat(64);
const readToken = 'b'.repeat(64);
const deleteToken = 'c'.repeat(64);
const secret = 'd'.repeat(64);
const origin = 'https://vynlo.example.workers.dev';
let db: DatabaseSync;
let env: Env;
function request(path: string, method = 'GET', token?: string, body?: unknown) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function create() {
  const response = await worker.fetch(
    request('/v1/trackings', 'POST', secret, { id, readToken, deleteToken }),
    env,
  );
  expect(response.status).toBe(200);
  return response.json();
}
async function read() {
  return (await worker.fetch(request(`/v1/trackings/${id}`, 'GET', readToken), env)).json();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
  db = new DatabaseSync(':memory:');
  db.exec(
    readFileSync(new URL('../../cloudflare/migrations/0001_tracking.sql', import.meta.url), 'utf8'),
  );
  env = {
    ADMIN_SECRET: secret,
    API_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    PIXEL_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    DB: {
      prepare(query) {
        let params: (string | number | null)[] = [];
        const statement: Statement = {
          bind(...values) {
            params = values;
            return statement;
          },
          async first<T>() {
            return (db.prepare(query).get(...params) ?? null) as T | null;
          },
          async run() {
            return db.prepare(query).run(...params);
          },
        };
        return statement;
      },
    },
  };
});
afterEach(() => {
  vi.useRealTimers();
  db.close();
});

describe('optional tracking Worker with real SQLite migration and statements', () => {
  it('checks service compatibility and credentials without creating records', async () => {
    expect(await (await worker.fetch(request('/health'), env)).json()).toEqual({
      service: 'vynlo-tracking',
      version: 1,
    });
    expect((await worker.fetch(request('/v1/check', 'GET', 'x'.repeat(64)), env)).status).toBe(401);
    expect(await (await worker.fetch(request('/v1/check', 'GET', secret), env)).json()).toEqual({
      ok: true,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM trackings').get()?.count).toBe(0);
  });
  it('creates an opaque record, hashes credentials and does not reset expiration on retry', async () => {
    const created = await create();
    expect(created.pixelUrl).toBe(`${origin}/p/${id}.gif`);
    const row = db.prepare('SELECT * FROM trackings').get();
    expect(row?.read_hash).not.toBe(readToken);
    expect(row?.delete_hash).not.toBe(deleteToken);
    expect(Object.keys(row ?? {})).toEqual([
      'id',
      'read_hash',
      'delete_hash',
      'created_at',
      'expires_at',
      'armed_at',
      'first_opened_at',
      'last_opened_at',
      'open_count',
    ]);
    vi.advanceTimersByTime(1000);
    expect(await create()).toEqual(created);
  });
  it('never permits another credential to overwrite an existing record', async () => {
    await create();
    const response = await worker.fetch(
      request('/v1/trackings', 'POST', secret, { id, readToken: 'e'.repeat(64), deleteToken }),
      env,
    );
    expect(response.status).toBe(409);
    expect((await read()).openCount).toBe(0);
  });
  it('requires admin creation and per-record read credentials', async () => {
    expect(
      (
        await worker.fetch(
          request('/v1/trackings', 'POST', readToken, { id, readToken, deleteToken }),
          env,
        )
      ).status,
    ).toBe(401);
    await create();
    for (const token of [undefined, secret, deleteToken])
      expect((await worker.fetch(request(`/v1/trackings/${id}`, 'GET', token), env)).status).toBe(
        401,
      );
    const response = await worker.fetch(request(`/v1/trackings/${id}`, 'GET', readToken), env);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect((await response.json()).openCount).toBe(0);
  });
  it.each([
    { id, readToken, deleteToken, subject: 'private' },
    { id, readToken: id, deleteToken },
    { id: '../bad', readToken, deleteToken },
    { id, readToken },
  ])('rejects malformed and excess fields: %j', async (value) => {
    expect((await worker.fetch(request('/v1/trackings', 'POST', secret, value), env)).status).toBe(
      400,
    );
  });
  it('bounds request body bytes and accepts only JSON', async () => {
    const large = request('/v1/trackings', 'POST', secret, {
      id,
      readToken,
      deleteToken,
      extra: 'x'.repeat(2000),
    });
    expect((await worker.fetch(large, env)).status).toBe(400);
    const plain = new Request(`${origin}/v1/trackings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ id, readToken, deleteToken }),
    });
    expect((await worker.fetch(plain, env)).status).toBe(400);
  });
  it('records first/last image loads at most once a minute with a hard count cap', async () => {
    await create();
    await worker.fetch(request(`/v1/trackings/${id}/activate`, 'POST', deleteToken), env);
    const first = Date.now();
    const response = await worker.fetch(request(`/p/${id}.gif`), env);
    expect(response.headers.get('Content-Type')).toBe('image/gif');
    expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 6))).toBe('GIF89a');
    await worker.fetch(request(`/p/${id}.gif`), env);
    expect(await read()).toMatchObject({ firstOpenedAt: first, lastOpenedAt: first, openCount: 1 });
    vi.advanceTimersByTime(60_000);
    await worker.fetch(request(`/p/${id}.gif`), env);
    expect(await read()).toMatchObject({
      firstOpenedAt: first,
      lastOpenedAt: first + 60_000,
      openCount: 2,
    });
    db.prepare('UPDATE trackings SET open_count = 1000').run();
    vi.advanceTimersByTime(60_000);
    await worker.fetch(request(`/p/${id}.gif`), env);
    expect((await read()).openCount).toBe(1000);
  });
  it('records nothing until explicitly armed and preserves activation on retries', async () => {
    await create();
    await worker.fetch(request(`/p/${id}.gif`), env);
    expect(await read()).toMatchObject({ openCount: 0, armedAt: null });
    for (const token of [readToken, secret])
      expect(
        (await worker.fetch(request(`/v1/trackings/${id}/activate`, 'POST', token), env)).status,
      ).toBe(401);
    const armed = await worker.fetch(
      request(`/v1/trackings/${id}/activate`, 'POST', deleteToken),
      env,
    );
    const now = Date.now();
    expect(await armed.json()).toEqual({ ok: true, armedAt: now });
    vi.advanceTimersByTime(1000);
    await worker.fetch(request(`/v1/trackings/${id}/activate`, 'POST', deleteToken), env);
    expect((await read()).armedAt).toBe(now);
    await worker.fetch(request(`/p/${id}.gif`), env);
    expect((await read()).openCount).toBe(1);
  });
  it('ignores HEAD and explicit prefetch requests', async () => {
    await create();
    await worker.fetch(request(`/v1/trackings/${id}/activate`, 'POST', deleteToken), env);
    const head = await worker.fetch(request(`/p/${id}.gif`, 'HEAD'), env);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    for (const header of ['Purpose', 'Sec-Purpose'])
      await worker.fetch(
        new Request(`${origin}/p/${id}.gif`, { headers: { [header]: 'prefetch' } }),
        env,
      );
    expect((await read()).openCount).toBe(0);
  });
  it('returns the same pixel for unknown, expired, unavailable and rate-limited IDs', async () => {
    const unknown = await worker.fetch(request(`/p/${id}.gif`), env);
    await create();
    vi.mocked(env.PIXEL_LIMITER.limit).mockResolvedValue({ success: false });
    const limited = await worker.fetch(request(`/p/${id}.gif`), env);
    expect(await limited.arrayBuffer()).toEqual(await unknown.arrayBuffer());
    expect((await read()).openCount).toBe(0);
    env.DB.prepare = () => {
      throw new Error('Unavailable');
    };
    vi.mocked(env.PIXEL_LIMITER.limit).mockResolvedValue({ success: true });
    expect((await worker.fetch(request(`/p/${id}.gif`), env)).status).toBe(200);
    expect((await worker.fetch(request(`/v1/trackings/${id}`, 'GET', readToken), env)).status).toBe(
      503,
    );
  });
  it('enforces expiry even before cron cleanup and cleans expired data', async () => {
    await create();
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
    await worker.fetch(request(`/p/${id}.gif`), env);
    expect((await worker.fetch(request(`/v1/trackings/${id}`, 'GET', readToken), env)).status).toBe(
      404,
    );
    expect(db.prepare('SELECT open_count FROM trackings').get()?.open_count).toBe(0);
    await worker.scheduled({}, env);
    expect(db.prepare('SELECT COUNT(*) AS count FROM trackings').get()?.count).toBe(0);
  });
  it.each([deleteToken, secret])(
    'deletes only with delete capability or operator secret',
    async (token) => {
      await create();
      expect(
        (await worker.fetch(request(`/v1/trackings/${id}`, 'DELETE', readToken), env)).status,
      ).toBe(401);
      expect(
        (await worker.fetch(request(`/v1/trackings/${id}`, 'DELETE', token), env)).status,
      ).toBe(200);
      expect(
        (await worker.fetch(request(`/v1/trackings/${id}`, 'GET', readToken), env)).status,
      ).toBe(404);
    },
  );
  it('rate limits private endpoints without exposing diagnostics', async () => {
    vi.mocked(env.API_LIMITER.limit).mockResolvedValue({ success: false });
    expect((await worker.fetch(request('/v1/check', 'GET', secret), env)).status).toBe(429);
    env.ADMIN_SECRET = 'weak';
    vi.mocked(env.API_LIMITER.limit).mockResolvedValue({ success: true });
    expect((await worker.fetch(request('/v1/check', 'GET', 'weak'), env)).status).toBe(401);
  });
});
