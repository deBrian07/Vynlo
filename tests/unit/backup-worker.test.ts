// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  handleBackupRequest,
  MAX_BACKUP_BYTES,
  type BackupEnv,
  type BackupBucket,
} from '../../cloudflare-backups/src';

const vault = 'a'.repeat(64);
const token = 'b'.repeat(64);
const admin = 'c'.repeat(64);
const envelope = {
  format: 'vynlo-encrypted-backup',
  version: 1,
  algorithm: 'AES-GCM',
  iv: Buffer.alloc(12).toString('base64'),
  ciphertext: Buffer.alloc(32, 1).toString('base64'),
};
function fixture() {
  let revision = 0;
  let stored: { data: string; etag: string; metadata: Record<string, string> } | undefined;
  let beforePut: (() => void) | undefined;
  const bucket: BackupBucket = {
    get: vi.fn(async () =>
      stored
        ? {
            httpEtag: stored.etag,
            size: Buffer.byteLength(stored.data),
            customMetadata: stored.metadata,
            body: new Blob([stored.data]).stream(),
          }
        : null,
    ),
    put: vi.fn(async (_key, data, options) => {
      beforePut?.();
      beforePut = undefined;
      if (options.onlyIf.get('If-None-Match') === '*' && stored) return null;
      const match = options.onlyIf.get('If-Match');
      if (match && stored?.etag !== match) return null;
      stored = { data, etag: `"revision-${++revision}"`, metadata: options.customMetadata };
      return { httpEtag: stored.etag };
    }),
  };
  const env: BackupEnv = {
    BACKUPS: bucket,
    ADMIN_SECRET: admin,
    API_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
  };
  function request(
    method = 'GET',
    headers: Record<string, string> = {},
    value: unknown = envelope,
    path = `/v1/vaults/${vault}`,
  ) {
    return handleBackupRequest(
      new Request(`https://backup.example${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        ...(method === 'PUT' ? { body: JSON.stringify(value) } : {}),
      }),
      env,
    );
  }
  const create = () => request('PUT', { 'X-Vynlo-Provision': admin, 'If-None-Match': '*' });
  return {
    env,
    bucket,
    request,
    create,
    race() {
      beforePut = () => {
        stored = { data: 'newer', etag: '"newer"', metadata: stored?.metadata ?? {} };
      };
    },
    stored() {
      return stored;
    },
  };
}

describe('encrypted backup Worker', () => {
  it('exposes only non-sensitive health and checks provisioning credentials', async () => {
    const f = fixture();
    expect(await (await f.request('GET', {}, undefined, '/health')).json()).toEqual({
      service: 'vynlo-backups',
      version: 1,
    });
    expect((await f.request('GET', {}, undefined, '/v1/check')).status).toBe(403);
    expect(
      await (
        await f.request('GET', { Authorization: `Bearer ${admin}` }, undefined, '/v1/check')
      ).json(),
    ).toEqual({ ok: true });
    expect((await f.request('GET', {}, undefined, '/health?token=secret')).status).toBe(400);
  });
  it('requires provisioning and atomic create conditions', async () => {
    const f = fixture();
    expect((await f.request('PUT')).status).toBe(403);
    expect((await f.request('PUT', { 'X-Vynlo-Provision': admin })).status).toBe(428);
    expect((await f.create()).status).toBe(201);
    expect(f.stored()?.metadata.authHash).toMatch(/^[a-f0-9]{64}$/);
    expect(f.stored()?.metadata.authHash).not.toBe(token);
    expect((await f.create()).status).toBe(428);
  });
  it('returns the opaque envelope and ETag without private metadata or CORS', async () => {
    const f = fixture();
    await f.create();
    const response = await f.request();
    expect(response.headers.get('ETag')).toBe('"revision-1"');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(await response.json()).toEqual(envelope);
  });
  it('isolates vaults with independent bearer credentials', async () => {
    const f = fixture();
    await f.create();
    for (const method of ['GET', 'PUT']) {
      expect(
        (await f.request(method, { Authorization: `Bearer ${admin}`, 'If-Match': '"revision-1"' }))
          .status,
      ).toBe(403);
      expect((await f.request(method, { Authorization: '' })).status).toBe(403);
    }
    expect((await fixture().request()).status).toBe(404);
  });
  it('revokes the old provisioning secret without breaking existing recovery tokens', async () => {
    const f = fixture();
    await f.create();
    const replacement = 'd'.repeat(64);
    f.env.ADMIN_SECRET = replacement;
    expect(
      (await f.request('GET', { Authorization: `Bearer ${admin}` }, undefined, '/v1/check')).status,
    ).toBe(403);
    expect(
      (await f.request('GET', { Authorization: `Bearer ${replacement}` }, undefined, '/v1/check'))
        .status,
    ).toBe(200);
    expect((await f.request()).status).toBe(200);
    expect((await f.request('PUT', { 'If-Match': '"revision-1"' })).status).toBe(200);
    const empty = fixture();
    empty.env.ADMIN_SECRET = replacement;
    expect((await empty.create()).status).toBe(403);
  });
  it('requires the exact current ETag and atomically rejects concurrent updates', async () => {
    const f = fixture();
    await f.create();
    expect((await f.request('PUT')).status).toBe(428);
    expect((await f.request('PUT', { 'If-Match': '*' })).status).toBe(428);
    expect((await f.request('PUT', { 'If-Match': '"old"' })).status).toBe(409);
    expect((await f.request('PUT', { 'If-Match': '"revision-1"' })).status).toBe(200);
    f.race();
    expect((await f.request('PUT', { 'If-Match': '"revision-2"' })).status).toBe(409);
    expect(f.stored()?.data).toBe('newer');
  });
  it('does not overwrite a vault created during initial upload', async () => {
    const f = fixture();
    f.race();
    expect((await f.create()).status).toBe(409);
    expect(f.stored()?.data).toBe('newer');
  });
  it.each([
    { ...envelope, version: 2 },
    { ...envelope, notes: 'plaintext' },
    { ...envelope, iv: 'bad' },
    { ...envelope, ciphertext: '<script>bad</script>' },
    { ...envelope, ciphertext: '' },
    { ...envelope, ciphertext: 'AB=='.repeat(6) },
    { ...envelope, ciphertext: 'A'.repeat(21) + 'B==' },
    { ...envelope, kdf: { algorithm: 'PBKDF2', iterations: 600000, salt: 'A'.repeat(24) } },
    { ...envelope, secret: token },
    null,
    [],
  ])('rejects malformed or plaintext-bearing envelopes', async (value) => {
    const f = fixture();
    expect(
      (await f.request('PUT', { 'X-Vynlo-Provision': admin, 'If-None-Match': '*' }, value)).status,
    ).toBe(400);
    expect(f.stored()).toBeUndefined();
  });
  it('bounds requests regardless of declared length', async () => {
    const f = fixture();
    const headers = { 'X-Vynlo-Provision': admin, 'If-None-Match': '*' };
    expect(
      (await f.request('PUT', { ...headers, 'Content-Length': String(MAX_BACKUP_BYTES + 1) }))
        .status,
    ).toBe(413);
    expect(
      (await f.request('PUT', headers, { ...envelope, ciphertext: 'x'.repeat(MAX_BACKUP_BYTES) }))
        .status,
    ).toBe(413);
    expect((await f.request('PUT', { ...headers, 'Content-Type': 'text/plain' })).status).toBe(415);
  });
  it('accepts large valid ciphertext without regex stack exhaustion', async () => {
    const f = fixture();
    const value = { ...envelope, ciphertext: Buffer.alloc(2 * 1024 * 1024).toString('base64') };
    expect(
      (await f.request('PUT', { 'X-Vynlo-Provision': admin, 'If-None-Match': '*' }, value)).status,
    ).toBe(201);
  });
  it('rejects wrong provisioning credentials and limits stored responses', async () => {
    const f = fixture();
    expect(
      (await f.request('PUT', { 'X-Vynlo-Provision': token, 'If-None-Match': '*' })).status,
    ).toBe(403);
    await f.create();
    const original = await f.bucket.get(`vaults/${vault}`);
    expect(original).not.toBeNull();
    vi.mocked(f.bucket.get).mockResolvedValueOnce({ ...original!, size: MAX_BACKUP_BYTES + 1 });
    expect((await f.request()).status).toBe(503);
  });
  it('fails closed on weak deployment secrets, rate limits and storage failure', async () => {
    const f = fixture();
    f.env.ADMIN_SECRET = 'weak';
    expect((await f.request()).status).toBe(503);
    f.env.ADMIN_SECRET = admin;
    vi.mocked(f.env.API_LIMITER.limit).mockResolvedValueOnce({ success: false });
    expect((await f.request()).status).toBe(429);
    vi.mocked(f.bucket.get).mockRejectedValueOnce(new Error('private provider details'));
    const response = await f.request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private provider details');
  });
  it('does not offer unsafe deletion or wildcard vault routing', async () => {
    const f = fixture();
    expect((await f.request('DELETE')).status).toBe(405);
    expect((await f.request('OPTIONS')).status).toBe(405);
    expect((await f.request('GET', {}, undefined, '/v1/vaults/not-a-vault')).status).toBe(404);
  });
});
