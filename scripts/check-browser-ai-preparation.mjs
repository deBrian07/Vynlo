/** Rebuild runtime in an empty directory using verified archives, with network disabled. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'vynlo-runtime-preparation-'));
const dependencies = path.join(temporary, 'artifacts/browser-ai-deps');
const scripts = path.join(temporary, 'scripts');
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: temporary,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`Isolated runtime preparation failed (${signal ?? code}).`)),
    );
  });
}
try {
  await mkdir(dependencies, { recursive: true });
  await mkdir(scripts);
  await symlink(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'junction');
  await copyFile(
    path.join(root, 'scripts/prepare-browser-ai.mjs'),
    path.join(scripts, 'prepare-browser-ai.mjs'),
  );
  // No existing extracted package or runtime is copied. Exactly these pinned
  // downloaded artifacts must suffice for a fresh browser-only extraction.
  for (const name of [
    'transformers-4.3.1.tgz',
    'onnxruntime-web.tgz',
    'onnxruntime-common.tgz',
    'LICENSE-onnxruntime.txt',
  ])
    await copyFile(
      path.join(root, 'artifacts/browser-ai-deps', name),
      path.join(dependencies, name),
    );
  const preload = path.join(temporary, 'deny-network.mjs');
  await writeFile(
    preload,
    "globalThis.fetch = () => { throw new Error('Unexpected network access during isolated runtime preparation.'); };\n",
  );
  const entry = path.join(scripts, 'prepare-browser-ai.mjs');
  await run(['--import', preload, entry]);
  await run([entry, '--check']);
  const names = (await readdir(path.join(dependencies, 'node_modules'))).sort();
  assert.deepEqual(names, ['@huggingface', 'onnxruntime-common', 'onnxruntime-web']);
  const manifest = JSON.parse(
    await readFile(path.join(temporary, 'public/inference-runtime/manifest.json'), 'utf8'),
  );
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.files.length, 5);
  console.log(
    'Clean browser-runtime preparation passed from pinned archives with network disabled.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
