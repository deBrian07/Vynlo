// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
// @ts-expect-error Setup is a standalone Node script, outside the extension TypeScript graph.
import * as setup from '../../scripts/backups-setup.mjs';
const { createConfig, normalizeEndpoint, prepareSetup, readPrivate, savePrivate, verify } = setup;

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function temporary() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vynlo-backup-setup-'));
  directories.push(directory);
  return directory;
}

describe('backup operator setup', () => {
  it('accepts only a root HTTPS workers.dev endpoint', () => {
    expect(normalizeEndpoint(' https://vynlo-backups.owner.workers.dev/ ')).toBe(
      'https://vynlo-backups.owner.workers.dev',
    );
    for (const value of [
      'http://vynlo-backups.owner.workers.dev',
      'https://evil.example',
      'https://name.owner.workers.dev/path',
      'https://name.owner.workers.dev?token=secret',
      'https://name.owner.workers.dev#secret',
      'https://secret@name.owner.workers.dev',
      'https://name.owner.workers.dev:8443',
      'https://name.owner.workers.dev.evil.example',
    ])
      expect(() => normalizeEndpoint(value)).toThrow();
  });

  it('does not adopt a bucket until creation has succeeded', () => {
    const fresh = createConfig('vynlo-backups', '/checkout');
    expect(fresh.r2_buckets).toEqual([]);
    const saved = createConfig('vynlo-backups', '/moved-checkout', true);
    expect(saved.r2_buckets).toEqual([{ binding: 'BACKUPS', bucket_name: 'vynlo-backups' }]);
    expect(saved.main).toBe('/moved-checkout/cloudflare-backups/src/index.ts');
    expect(saved.observability.enabled).toBe(false);
    expect(saved.ratelimits[0].name).toBe('API_LIMITER');
    expect(JSON.stringify(saved)).not.toContain('ADMIN_SECRET');
    expect(() => createConfig('../elsewhere', '/checkout')).toThrow();
  });

  it('protects saved secrets and refuses file or directory links', async () => {
    const root = await temporary();
    await mkdir(path.join(root, 'cloudflare-backups'));
    const setup = await prepareSetup(root);
    const file = path.join(setup, 'secrets.json');
    await savePrivate(file, { ADMIN_SECRET: 'private' });
    expect(await readPrivate(file)).toEqual({ ADMIN_SECRET: 'private' });
    if (process.platform !== 'win32') {
      expect((await stat(setup)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
    const linked = path.join(setup, 'linked.json');
    await symlink(file, linked);
    await expect(readPrivate(linked)).rejects.toThrow();
    await expect(savePrivate(linked, { ADMIN_SECRET: 'overwritten' })).rejects.toThrow();
    expect(JSON.parse(await readFile(file, 'utf8')).ADMIN_SECRET).toBe('private');
    const other = await temporary();
    await symlink(path.join(root, 'cloudflare-backups'), path.join(other, 'cloudflare-backups'));
    await expect(prepareSetup(other)).rejects.toThrow();
    const third = await temporary();
    await mkdir(path.join(third, 'cloudflare-backups'));
    await symlink(setup, path.join(third, 'cloudflare-backups/.setup'));
    await expect(prepareSetup(third)).rejects.toThrow();
  });

  it('does not overwrite malformed saved state', async () => {
    const root = await temporary();
    const file = path.join(root, 'broken.json');
    await writeFile(file, '{broken');
    await expect(savePrivate(file, {})).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('{broken');
  });

  it('checks the service and credentials without uploading workspace data', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ service: 'vynlo-backups', version: 1 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await verify('https://name.owner.workers.dev', 'private-key', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({});
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer private-key' },
      redirect: 'error',
    });
    for (const call of fetcher.mock.calls) expect(call[1]).not.toHaveProperty('body');
    const wrongService = vi
      .fn()
      .mockResolvedValue(Response.json({ service: 'unrelated', version: 1 }));
    await expect(verify('https://name.owner.workers.dev', 'key', wrongService)).rejects.toThrow();
    const denied = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    await expect(verify('https://name.owner.workers.dev', 'key', denied)).rejects.toThrow();
  });

  it('shows offline help and refuses noninteractive deployment', () => {
    const script = path.resolve('scripts/backups-setup.mjs');
    const help = spawnSync(process.execPath, [script, '--help'], {
      encoding: 'utf8',
      env: { PATH: '', HOME: os.tmpdir() },
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Nothing is deployed until you type yes');
    const blocked = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      input: 'yes\n',
      env: { PATH: '', HOME: os.tmpdir() },
    });
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain('interactive terminal');
    expect(blocked.stdout).not.toContain('Sign in');
  });
});
