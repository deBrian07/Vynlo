import { cp, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import process from 'node:process';

async function directory(folder, optional = false) {
  try {
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Build folders must be regular directories, not links.');
    return true;
  } catch (error) {
    if (optional && error.code === 'ENOENT') return false;
    throw error;
  }
}
async function validate(folder) {
  const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
  if (manifest.name !== 'Vynlo' || manifest.manifest_version !== 3)
    throw new Error('Expected a Vynlo Manifest V3 build. Existing files were kept.');
}
/** Refresh the visible install path while leaving extension identity and browser data alone. */
export async function syncBuild(root) {
  const source = path.join(root, '.output/chrome-mv3');
  const release = path.join(root, 'release');
  const target = path.join(release, 'Vynlo');
  await directory(path.join(root, '.output'));
  await directory(source);
  await validate(source);
  if (!(await directory(release, true))) await mkdir(release);
  const exists = await directory(target, true);
  if (exists) await validate(target);
  const id = randomUUID();
  const stage = path.join(release, `.vynlo-stage-${id}`);
  const previous = path.join(release, `.vynlo-previous-${id}`);
  let moved = false;
  try {
    await cp(source, stage, {
      recursive: true,
      filter: async (file) => {
        if ((await lstat(file)).isSymbolicLink())
          throw new Error('Build output must not contain symbolic links.');
        return true;
      },
    });
    await validate(stage);
    if (exists) {
      await rename(target, previous);
      moved = true;
    }
    try {
      await rename(stage, target);
    } catch (error) {
      if (moved) {
        await rename(previous, target);
        moved = false;
      }
      throw error;
    }
    if (moved) await rm(previous, { recursive: true });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const target = await syncBuild(root);
  process.stdout.write(
    `Updated unpacked extension: ${target}\nAlready installed? Click Reload in chrome://extensions, then reload Gmail. Keep the same installation folder.\n`,
  );
}
