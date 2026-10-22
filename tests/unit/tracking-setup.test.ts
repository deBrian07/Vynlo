// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('../../scripts/tracking-setup.mjs', import.meta.url);
const { validWorkerName, normalizeEndpoint, createConfig, connectionFileCommand } = await import(
  moduleUrl.href
);
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
