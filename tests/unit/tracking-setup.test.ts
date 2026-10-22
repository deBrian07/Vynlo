// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('../../scripts/tracking-setup.mjs', import.meta.url);
const { validWorkerName, normalizeEndpoint, createConfig, connectionFileCommand, verify } =
  await import(moduleUrl.href);
const script = fileURLToPath(moduleUrl);

describe('tracking setup safety', () => {
  it('accepts worker names without command or config injection', () => {
    expect(validWorkerName('vynlo-tracking')).toBe(true);
    for (const value of ['--help', '../worker', 'worker\nname', 'AName', 'a'.repeat(64)]) {
      expect(validWorkerName(value)).toBe(false);
      expect(() => createConfig(value, '/project')).toThrow();
    }
  });

  it('only accepts root HTTPS workers.dev endpoints', () => {
    expect(normalizeEndpoint(' https://vynlo.example.workers.dev/ ')).toBe(
      'https://vynlo.example.workers.dev',
    );
    for (const endpoint of [
      'http://vynlo.example.workers.dev',
      'https://vynlo.example.workers.dev/p/id.gif',
      'https://vynlo.example.workers.dev/?key=secret',
      'https://name:password@vynlo.example.workers.dev',
      'https://example.com',
      'https://vynlo.example.workers.dev.evil.com',
      'https://vynlo.example.workers.dev:8443',
    ]) {
      expect(() => normalizeEndpoint(endpoint)).toThrow();
    }
  });

  it('keeps observability off and gives resources explicit safe bindings', () => {
    const config = createConfig('vynlo-tracking', '/project');
    expect(config.main).toBe('/project/cloudflare/src/index.ts');
    expect(config.observability.enabled).toBe(false);
    expect(config.ratelimits.map((item: { name: string }) => item.name)).toEqual([
      'PIXEL_LIMITER',
      'API_LIMITER',
    ]);
    expect(JSON.stringify(config)).not.toContain('ADMIN_SECRET');
  });

  it('reveals only the file path without placing credentials in shell commands', () => {
    const file = '/project with spaces/cloudflare/.setup/connection.json';
    expect(connectionFileCommand('darwin', file)).toEqual({ command: 'open', args: ['-R', file] });
    expect(connectionFileCommand('win32', file)).toEqual({
      command: 'explorer.exe',
      args: ['/select,', file],
    });
    expect(connectionFileCommand('linux', file)).toEqual({
      command: 'xdg-open',
      args: ['/project with spaces/cloudflare/.setup'],
    });
  });

  it('shows help without invoking Cloudflare or requiring credentials', () => {
    const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Nothing is deployed until you explicitly confirm');
    expect(result.stderr).toBe('');
  });

  it('refuses unattended execution before any cloud operation', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', input: 'yes\n' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No cloud changes were made');
    expect(result.stdout).toBe('');
  });
});

describe('deployed tracking smoke check', () => {
  const endpoint = 'https://vynlo.example.workers.dev';
  const secret = 's'.repeat(64);
  function server(failure?: 'activation' | 'cleanup' | 'create-timeout') {
    let credentials: { id: string; readToken: string; deleteToken: string };
    let active = false;
    return vi.fn(async (url: string, init: RequestInit) => {
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status });
      const route = url.slice(endpoint.length);
      if (route === '/health') return json({ service: 'vynlo-tracking', version: 1 });
      if (route === '/v1/check') return json({ ok: true });
      if (route === '/v1/trackings') {
        credentials = JSON.parse(init.body as string);
        if (failure === 'create-timeout') throw new Error('request timed out');
        return json({
          pixelUrl: `${endpoint}/p/${credentials.id}.gif`,
          expiresAt: Date.now() + 100000,
        });
      }
      if (init.method === 'DELETE') {
        return failure === 'cleanup'
          ? json({ error: 'unavailable' }, 503)
          : json({ deleted: true });
      }
      if (route.endsWith('/activate')) {
        if (failure === 'activation') return json({ error: 'schema missing' }, 503);
        active = true;
        return json({ ok: true, armedAt: 123 });
      }
      return json({ id: credentials.id, armedAt: active ? 123 : null, openCount: 0 });
    });
  }

  it('checks D1 create, paused state, activation, persistence and deletion without loading a pixel', async () => {
    const fetcher = server();
    await verify(endpoint, secret, fetcher);
    const calls = fetcher.mock.calls;
    expect(
      calls.map(([url, init]) => `${init.method} ${url.replace(/\/[a-f0-9]{64}/g, '/ID')}`),
    ).toEqual([
      `GET ${endpoint}/health`,
      `GET ${endpoint}/v1/check`,
      `POST ${endpoint}/v1/trackings`,
      `GET ${endpoint}/v1/trackings/ID`,
      `POST ${endpoint}/v1/trackings/ID/activate`,
      `GET ${endpoint}/v1/trackings/ID`,
      `DELETE ${endpoint}/v1/trackings/ID`,
    ]);
    const credentials = JSON.parse(calls[2]![1].body as string);
    expect(new Set(Object.values(credentials)).size).toBe(3);
    for (const value of Object.values(credentials)) expect(value).toMatch(/^[a-f0-9]{64}$/);
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBeUndefined();
    expect((calls[2]![1].headers as Record<string, string>).Authorization).toBe(`Bearer ${secret}`);
    expect((calls[3]![1].headers as Record<string, string>).Authorization).toBe(
      `Bearer ${credentials.readToken}`,
    );
    expect((calls.at(-1)![1].headers as Record<string, string>).Authorization).toBe(
      `Bearer ${credentials.deleteToken}`,
    );
    expect(
      calls.every(
        ([url, init]) => !url.includes('/p/') && init.redirect === 'error' && init.signal,
      ),
    ).toBe(true);
  });

  it('deletes the temporary record after activation fails', async () => {
    const fetcher = server('activation');
    await expect(verify(endpoint, secret, fetcher)).rejects.toThrow('schema and bindings');
    expect(fetcher.mock.calls.at(-1)![1].method).toBe('DELETE');
  });

  it('attempts cleanup when create may have committed before a timeout', async () => {
    const fetcher = server('create-timeout');
    await expect(verify(endpoint, secret, fetcher)).rejects.toThrow('timed out');
    expect(fetcher.mock.calls.at(-1)![1].method).toBe('DELETE');
  });

  it('refuses success when cleanup fails', async () => {
    await expect(verify(endpoint, secret, server('cleanup'))).rejects.toThrow(
      'could not be deleted',
    );
  });

  it('never transmits credentials to a service with an unexpected identity', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ service: 'other', version: 1 })),
    );
    await expect(verify(endpoint, secret, fetcher)).rejects.toThrow('identify itself');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
