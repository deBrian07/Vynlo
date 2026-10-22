// @vitest-environment node
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { syncBuild } from '../../scripts/sync-build.mjs';

const roots: string[] = [];
const manifest = JSON.stringify({ name: 'Vynlo', manifest_version: 3, version: '0.1.0' });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'vynlo-build-sync-'));
  roots.push(root);
  const source = path.join(root, '.output/chrome-mv3');
  const target = path.join(root, 'release/Vynlo');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'manifest.json'), manifest);
  await writeFile(path.join(source, 'theme.css'), 'new brand theme');
  return { root, source, target };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('creates the visible extension folder from the actual build', async () => {
  const { root, target } = await fixture();
  expect(await syncBuild(root)).toBe(target);
  expect(await readFile(path.join(target, 'theme.css'), 'utf8')).toBe('new brand theme');
  expect(await readFile(path.join(target, 'manifest.json'), 'utf8')).toBe(manifest);
});
it('replaces stale assets at the same installation path and preserves sibling files', async () => {
  const { root, source, target } = await fixture();
  await syncBuild(root);
  await writeFile(path.join(target, 'old-purple.css'), 'old');
  await writeFile(path.join(root, 'release/START-HERE.html'), 'keep guide');
  await writeFile(path.join(source, 'theme.css'), 'mint and navy');
  await syncBuild(root);
  expect(await readFile(path.join(target, 'theme.css'), 'utf8')).toBe('mint and navy');
  expect(await readdir(target)).not.toContain('old-purple.css');
  expect(await readdir(path.join(root, 'release'))).toEqual(['START-HERE.html', 'Vynlo']);
});
it('keeps the installed build when the source is invalid', async () => {
  const { root, source, target } = await fixture();
  await syncBuild(root);
  await writeFile(path.join(source, 'manifest.json'), '{}');
  await expect(syncBuild(root)).rejects.toThrow('Expected a Vynlo');
  expect(await readFile(path.join(target, 'theme.css'), 'utf8')).toBe('new brand theme');
});
it('refuses unrelated targets and symbolic links without replacing them', async () => {
  const { root, source, target } = await fixture();
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'manifest.json'), JSON.stringify({ name: 'Another app' }));
  await expect(syncBuild(root)).rejects.toThrow('Expected a Vynlo');
  await rm(target, { recursive: true });
  await symlink(source, target, 'dir');
  await expect(syncBuild(root)).rejects.toThrow('regular directories');
  expect(await readFile(path.join(source, 'theme.css'), 'utf8')).toBe('new brand theme');
});
it('refuses linked assets while leaving the installed build intact', async () => {
  const { root, source, target } = await fixture();
  await syncBuild(root);
  await writeFile(path.join(root, 'private.txt'), 'never copy');
  await symlink(path.join(root, 'private.txt'), path.join(source, 'unsafe.txt'));
  await expect(syncBuild(root)).rejects.toThrow('symbolic links');
  expect(await readdir(target)).not.toContain('unsafe.txt');
  expect(await readFile(path.join(target, 'theme.css'), 'utf8')).toBe('new brand theme');
});
