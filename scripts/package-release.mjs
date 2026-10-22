import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, '.output/chrome-mv3');
const release = path.join(root, 'release');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
if (manifest.name !== 'Vynlo' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error('Expected a production Vynlo build. Run pnpm release again.');
}
const archive = `vynlo-${manifest.version}-chrome.zip`;
// Read all inputs before replacing the generated unpacked folder.
const template = await readFile(path.join(root, 'scripts/setup.html'), 'utf8');
await readFile(path.join(root, '.output', archive));
await mkdir(release, { recursive: true });
await rm(path.join(release, 'Vynlo'), { recursive: true, force: true });
await cp(source, path.join(release, 'Vynlo'), { recursive: true });
await cp(path.join(root, '.output', archive), path.join(release, archive));
await writeFile(path.join(release, 'START-HERE.html'), template);
process.stdout.write(
  `Ready to load: ${path.join(release, 'Vynlo')}\nSetup guide: ${path.join(release, 'START-HERE.html')}\n`,
);
