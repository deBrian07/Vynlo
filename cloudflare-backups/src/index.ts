/** A deliberately opaque encrypted-object store. Never receives workspace plaintext or keys. */
export interface BackupObject {
  size: number;
  httpEtag: string;
  customMetadata?: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}
export interface BackupBucket {
  get(key: string): Promise<BackupObject | null>;
  put(
    key: string,
    value: string,
    options: {
      onlyIf: Headers;
      customMetadata: Record<string, string>;
      httpMetadata: { contentType: string; cacheControl: string };
    },
  ): Promise<{ httpEtag: string } | null>;
}
export interface BackupEnv {
  BACKUPS: BackupBucket;
  ADMIN_SECRET: string;
  API_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const ETAG = /^"[a-zA-Z0-9_-]{1,128}"$/;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function canonicalBase64(value: string): boolean {
  // Avoid repeated regex groups on multi-megabyte ciphertext (some runtimes exhaust the stack).
  if (value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const firstPadding = value.indexOf('=');
  if (firstPadding !== -1 && firstPadding !== value.length - padding) return false;
  if (padding === 2 && (alphabet.indexOf(value.at(-3) ?? '') & 15) !== 0) return false;
  if (padding === 1 && (alphabet.indexOf(value.at(-2) ?? '') & 3) !== 0) return false;
  return true;
}

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function readEnvelope(request: Request): Promise<string | Response> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json')
    return json({ error: 'Expected JSON encrypted backup.' }, 415);
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BACKUP_BYTES))
    return json({ error: 'Backup too large.' }, 413);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'Missing encrypted backup.' }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BACKUP_BYTES) {
      await reader.cancel();
      return json({ error: 'Backup too large.' }, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const envelope: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error();
    const record = envelope as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(',') !== 'algorithm,ciphertext,format,iv,version' ||
      record.format !== 'vynlo-encrypted-backup' ||
      record.version !== 1 ||
      record.algorithm !== 'AES-GCM' ||
      typeof record.iv !== 'string' ||
      record.iv.length !== 16 ||
      !canonicalBase64(record.iv) ||
      typeof record.ciphertext !== 'string' ||
      record.ciphertext.length < 24 ||
      !canonicalBase64(record.ciphertext)
    )
      throw new Error();
    return JSON.stringify(record);
  } catch {
    return json({ error: 'Invalid encrypted backup.' }, 400);
  }
}

export async function handleBackupRequest(request: Request, env: BackupEnv): Promise<Response> {
  try {
    if (!(await env.API_LIMITER.limit({ key: 'backup-api' })).success)
      return json({ error: 'Try again shortly.' }, 429, { 'Retry-After': '60' });
    const { pathname, search } = new URL(request.url);
    if (search) return json({ error: 'Query parameters are not supported.' }, 400);
    if (pathname === '/health' && request.method === 'GET')
      return json({ service: 'vynlo-backups', version: 1 });
    // Fail closed if the deployment has no strong provisioning credential.
    if (!HEX.test(env.ADMIN_SECRET ?? '')) return json({ error: 'Service unavailable.' }, 503);
    if (pathname === '/v1/check' && request.method === 'GET')
      return same(request.headers.get('Authorization') ?? '', `Bearer ${env.ADMIN_SECRET}`)
        ? json({ ok: true })
        : json({ error: 'Not authorized.' }, 403);
    const route = /^\/v1\/vaults\/([a-f0-9]{64})$/.exec(pathname);
    if (!route) return json({ error: 'Not found.' }, 404);
    if (request.method !== 'GET' && request.method !== 'PUT')
      return json({ error: 'Method not supported.' }, 405, { Allow: 'GET, PUT' });
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token) return json({ error: 'Not authorized.' }, 403);
    const tokenHash = await hash(token);
    const key = `vaults/${route[1]}`;
    const current = await env.BACKUPS.get(key);
    if (current && !same(current.customMetadata?.authHash ?? '', tokenHash)) {
      await current.body.cancel();
      return json({ error: 'Not authorized.' }, 403);
    }
    if (request.method === 'GET') {
      if (!current) return json({ error: 'Backup not found.' }, 404);
      if (
        !Number.isSafeInteger(current.size) ||
        current.size > MAX_BACKUP_BYTES ||
        current.size < 0
      ) {
        await current.body.cancel();
        return json({ error: 'Stored backup exceeds the supported limit.' }, 503);
      }
      return new Response(current.body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ETag: current.httpEtag,
        },
      });
    }
    // Release the unused GET stream before parsing the upload.
    if (current) await current.body.cancel();
    const condition = new Headers();
    if (current) {
      const match = request.headers.get('If-Match');
      if (!match || !ETAG.test(match)) return json({ error: 'Exact If-Match required.' }, 428);
      if (match !== current.httpEtag)
        return json({ error: 'Backup changed. Restore it before continuing.' }, 409);
      condition.set('If-Match', match);
    } else {
      if (!same(request.headers.get('X-Vynlo-Provision') ?? '', env.ADMIN_SECRET))
        return json({ error: 'Not authorized.' }, 403);
      if (request.headers.get('If-None-Match') !== '*')
        return json({ error: 'Initial If-None-Match required.' }, 428);
      condition.set('If-None-Match', '*');
    }
    const body = await readEnvelope(request);
    if (body instanceof Response) return body;
    const result = await env.BACKUPS.put(key, body, {
      onlyIf: condition,
      customMetadata: { authHash: tokenHash },
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
    });
    if (!result) return json({ error: 'Backup changed. Restore it before continuing.' }, 409);
    return json({ etag: result.httpEtag }, current ? 200 : 201, { ETag: result.httpEtag });
  } catch {
    // No request contents, credentials or provider exceptions enter logs or responses.
    return json({ error: 'Backup service unavailable. Your local data is unchanged.' }, 503);
  }
}
export default { fetch: handleBackupRequest };
