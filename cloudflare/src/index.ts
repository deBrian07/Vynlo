/** Optional Vynlo image-load service. Never receives subjects, addresses or message bodies. */
export interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface Env {
  DB: { prepare(query: string): Statement };
  ADMIN_SECRET: string;
  PIXEL_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  API_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
interface Tracking {
  id: string;
  read_hash: string;
  delete_hash: string;
  first_opened_at: number | null;
  last_opened_at: number | null;
  open_count: number;
  armed_at: number | null;
  expires_at: number;
}
const HEX = /^[a-f0-9]{64}$/;
const TTL = 30 * 24 * 60 * 60 * 1000;
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) =>
  c.charCodeAt(0),
);
const headers = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
function pixel(head = false) {
  return new Response(head ? null : GIF, {
    headers: { ...headers, 'Content-Type': 'image/gif', Pragma: 'no-cache', Expires: '0' },
  });
}
async function hash(value: string) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), (v) => v.toString(16).padStart(2, '0')).join('');
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function bearer(request: Request) {
  return (
    /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('Authorization') ?? '')?.[1] ?? ''
  );
}
async function admin(token: string, env: Env) {
  return (
    typeof env.ADMIN_SECRET === 'string' &&
    /^[A-Za-z0-9_-]{32,256}$/.test(env.ADMIN_SECRET) &&
    equal(await hash(token), await hash(env.ADMIN_SECRET))
  );
}
async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json')
    return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
async function fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pixelId = /^\/p\/([a-f0-9]{64})\.gif$/.exec(url.pathname)?.[1];
  if (pixelId && (request.method === 'GET' || request.method === 'HEAD')) {
    // Explicit prefetch hints and HEAD are excluded, but silent proxy preloads cannot be detected.
    const hinted = /prefetch|prerender/i.test(
      `${request.headers.get('Purpose') ?? ''} ${request.headers.get('Sec-Purpose') ?? ''}`,
    );
    if (request.method === 'GET' && !hinted) {
      try {
        if ((await env.PIXEL_LIMITER.limit({ key: pixelId })).success) {
          const now = Date.now();
          await env.DB.prepare(
            `UPDATE trackings SET first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ?, open_count = open_count + 1
            WHERE id = ? AND expires_at > ? AND armed_at IS NOT NULL AND open_count < 1000 AND (last_opened_at IS NULL OR last_opened_at <= ?)`,
          )
            .bind(now, now, pixelId, now, now - 60_000)
            .run();
        }
      } catch {
        /* A failed tracker must never break an email's image request. */
      }
    }
    return pixel(request.method === 'HEAD');
  }
  if (url.pathname === '/health' && request.method === 'GET')
    return json({ service: 'vynlo-tracking', version: 1 });
  if (!url.pathname.startsWith('/v1/')) return json({ error: 'Not found' }, 404);
  try {
    // Aggregate limit avoids retaining recipient network identifiers. Limits are per Cloudflare location.
    if (!(await env.API_LIMITER.limit({ key: 'private-api' })).success)
      return json({ error: 'Try again shortly' }, 429);
    const token = bearer(request);
    if (!token) return json({ error: 'Unauthorized' }, 401);
    if (url.pathname === '/v1/check' && request.method === 'GET') {
      return (await admin(token, env)) ? json({ ok: true }) : json({ error: 'Unauthorized' }, 401);
    }
    if (url.pathname === '/v1/trackings' && request.method === 'POST') {
      if (!(await admin(token, env))) return json({ error: 'Unauthorized' }, 401);
      const value = await body(request);
      if (
        !value ||
        Object.keys(value).sort().join(',') !== 'deleteToken,id,readToken' ||
        ![value.id, value.readToken, value.deleteToken].every(
          (v) => typeof v === 'string' && HEX.test(v),
        )
      )
        return json({ error: 'Invalid tracking request' }, 400);
      if (new Set([value.id, value.readToken, value.deleteToken]).size !== 3)
        return json({ error: 'Use independent random credentials' }, 400);
      const id = value.id as string;
      const readHash = await hash(value.readToken as string);
      const deleteHash = await hash(value.deleteToken as string);
      const now = Date.now();
      await env.DB.prepare(
        'INSERT OR IGNORE INTO trackings (id, read_hash, delete_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(id, readHash, deleteHash, now, now + TTL)
        .run();
      const row = await env.DB.prepare('SELECT * FROM trackings WHERE id = ?')
        .bind(id)
        .first<Tracking>();
      if (
        !row ||
        row.expires_at <= now ||
        !equal(row.read_hash, readHash) ||
        !equal(row.delete_hash, deleteHash)
      )
        return json({ error: 'Tracking ID unavailable' }, 409);
      return json({ pixelUrl: `${url.origin}/p/${id}.gif`, expiresAt: row.expires_at });
    }
    const match = /^\/v1\/trackings\/([a-f0-9]{64})(\/activate)?$/.exec(url.pathname);
    const id = match?.[1];
    const activation = match?.[2] === '/activate';
    if (
      !id ||
      (activation ? request.method !== 'POST' : !['GET', 'DELETE'].includes(request.method))
    )
      return json({ error: 'Not found' }, 404);
    const row = await env.DB.prepare('SELECT * FROM trackings WHERE id = ? AND expires_at > ?')
      .bind(id, Date.now())
      .first<Tracking>();
    if (!row) return json({ error: 'Not found' }, 404);
    const tokenHash = await hash(token);
    if (activation) {
      if (!equal(tokenHash, row.delete_hash)) return json({ error: 'Unauthorized' }, 401);
      const armedAt = row.armed_at ?? Date.now();
      await env.DB.prepare(
        'UPDATE trackings SET armed_at = COALESCE(armed_at, ?) WHERE id = ? AND expires_at > ?',
      )
        .bind(armedAt, id, Date.now())
        .run();
      return json({ ok: true, armedAt });
    }
    if (request.method === 'DELETE') {
      if (!equal(tokenHash, row.delete_hash) && !(await admin(token, env)))
        return json({ error: 'Unauthorized' }, 401);
      await env.DB.prepare('DELETE FROM trackings WHERE id = ?').bind(id).run();
      return json({ deleted: true });
    }
    if (!equal(tokenHash, row.read_hash)) return json({ error: 'Unauthorized' }, 401);
    return json({
      id,
      firstOpenedAt: row.first_opened_at,
      lastOpenedAt: row.last_opened_at,
      openCount: row.open_count,
      armedAt: row.armed_at,
      expiresAt: row.expires_at,
    });
  } catch {
    return json({ error: 'Tracking service temporarily unavailable' }, 503);
  }
}
export default {
  fetch,
  async scheduled(_event: unknown, env: Env) {
    await env.DB.prepare('DELETE FROM trackings WHERE expires_at <= ?').bind(Date.now()).run();
  },
};
