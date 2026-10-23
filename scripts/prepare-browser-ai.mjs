/** Prepare packaged JavaScript/WASM. This script never downloads model weights. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VERSION = '4.3.1';
const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0';
const DESTINATION = path.join(ROOT, 'public/inference-runtime');
const DEPENDENCIES = path.join(ROOT, 'artifacts/browser-ai-deps');
const PACKAGE = path.join(DEPENDENCIES, 'node_modules/@huggingface/transformers');
const ORT = path.join(DEPENDENCIES, 'node_modules/onnxruntime-web');
const sha256 = (content) => createHash('sha256').update(content).digest('hex');

async function packageVersion(directory) {
  try {
    return JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

async function verify(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (
    manifest.schemaVersion !== 2 ||
    manifest.transformersVersion !== VERSION ||
    manifest.onnxRuntimeVersion !== ORT_VERSION ||
    !Array.isArray(manifest.files) ||
    !manifest.files.some((file) => file.name === 'runtime.js') ||
    !manifest.files.some((file) => file.name === 'ort-wasm-simd-threaded.asyncify.mjs') ||
    !manifest.files.some((file) => file.name === 'ort-wasm-simd-threaded.asyncify.wasm')
  )
    throw new Error('The packaged browser runtime manifest is incomplete or uses another version.');
  const names = new Set();
  for (const file of manifest.files) {
    if (
      typeof file.name !== 'string' ||
      path.basename(file.name) !== file.name ||
      names.has(file.name) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error('The packaged browser runtime manifest contains an invalid file.');
    names.add(file.name);
    const content = await readFile(path.join(directory, file.name));
    if (content.byteLength !== file.bytes || sha256(content) !== file.sha256) {
      throw new Error(`The packaged browser runtime file failed verification: ${file.name}`);
    }
  }
  const unexpected = (await readdir(directory)).filter(
    (name) => name !== 'manifest.json' && !names.has(name),
  );
  if (unexpected.length) throw new Error('The packaged browser runtime contains unlisted files.');
  return manifest;
}

const ARCHIVES = [
  {
    name: '@huggingface/transformers',
    version: VERSION,
    archive: 'transformers-4.3.1.tgz',
    integrity:
      'sha512-5+voSeUCFK6PCKlY15dPhNOKq3/zOTxDN7oC+Wy9dFb1QZ0TSQomZRRy7URRK8YRuUoE9fGMQTTPC5d/pWBJhA==',
    url: 'https://registry.npmjs.org/@huggingface/transformers/-/transformers-4.3.1.tgz',
    files: ['package/package.json', 'package/LICENSE', 'package/dist/transformers.web.js'],
  },
  {
    name: 'onnxruntime-web',
    version: ORT_VERSION,
    archive: 'onnxruntime-web.tgz',
    integrity:
      'sha512-Iy7rtadoBgxS/LLvDr3QW38DB1PNXRnr0GJMcL0TAt7c9qjgVQl83UlGCVyeAnK2InpmW8Uc3PL8XIuqtDeF6g==',
    url: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.31.0-dev.20260914-8d85527a0.tgz',
    files: [
      'package/package.json',
      'package/dist/ort.webgpu.min.mjs',
      'package/dist/ort-wasm-simd-threaded.asyncify.mjs',
      'package/dist/ort-wasm-simd-threaded.asyncify.wasm',
    ],
  },
  {
    name: 'onnxruntime-common',
    version: '1.31.0-dev.20260911-2a43ec07e',
    archive: 'onnxruntime-common.tgz',
    integrity:
      'sha512-gBuF6U32YErKIAt+yD7DeGBpjRxhJ1uJwako6ygjokSZULDU6Pd+KWComX8Tumk1hYVHRxjPj7mdMnD0ryAPOw==',
    url: 'https://registry.npmjs.org/onnxruntime-common/-/onnxruntime-common-1.31.0-dev.20260911-2a43ec07e.tgz',
    files: ['package/package.json', 'package/dist/esm'],
  },
];

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Runtime preparation command failed (${command}, ${signal ?? `exit ${code}`}).`,
          ),
        );
    });
  });
}

async function download(url, destination, maximumBytes = 40_000_000) {
  // A failed transfer never leaves a truncated file that poisons the next build.
  const temporary = `${destination}.partial`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(60_000),
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok || !response.body)
      throw new Error(`Cannot download a required runtime artifact (HTTP ${response.status}).`);
    let bytes = 0;
    async function* bounded(body) {
      for await (const chunk of body) {
        bytes += chunk.byteLength;
        if (bytes > maximumBytes) throw new Error('A runtime artifact exceeded its size limit.');
        yield chunk;
      }
    }
    await pipeline(bounded(Readable.fromWeb(response.body)), createWriteStream(temporary));
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function archiveVerified(file, integrity) {
  try {
    const content = await readFile(file);
    return `sha512-${createHash('sha512').update(content).digest('base64')}` === integrity;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
async function install() {
  await mkdir(DEPENDENCIES, { recursive: true });
  console.log(`Preparing the pinned browser runtime (${VERSION}). Model weights are excluded.`);
  // These prebundled browser artifacts need only three exact archives. Installing
  // Transformers through npm also resolves native ONNX and image dependencies
  // that the extension cannot use, outside the root frozen lockfile.
  for (const item of ARCHIVES) {
    const archive = path.join(DEPENDENCIES, item.archive);
    if (!(await archiveVerified(archive, item.integrity))) {
      await download(item.url, archive);
      if (!(await archiveVerified(archive, item.integrity))) {
        await rm(archive, { force: true });
        throw new Error(`The ${item.name} archive failed its pinned integrity check.`);
      }
    }
    const destination = path.join(DEPENDENCIES, 'node_modules', item.name);
    // Always extract reviewed files from verified archives before building. A
    // package.json version alone cannot establish the integrity of existing code.
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    await run('tar', ['-xzf', archive, '--strip-components=1', '-C', destination, ...item.files]);
    if ((await packageVersion(destination)) !== item.version)
      throw new Error(`Unexpected archived version: ${item.name}`);
  }
}

async function prepare() {
  if (process.argv.includes('--check')) {
    const manifest = await verify(DESTINATION);
    console.log(`Verified packaged browser runtime ${VERSION}: ${manifest.files.length} files.`);
    return;
  }
  // Keep everyday builds fast while still catching edited or incomplete assets.
  try {
    const manifest = await verify(DESTINATION);
    console.log(
      `Using verified packaged browser runtime ${VERSION}: ${manifest.files.length} files.`,
    );
    return;
  } catch {
    // Rebuild from the pinned package archives below. The existing destination is
    // replaced only after the complete new runtime has passed verification.
  }
  await install();
  const publicDirectory = path.dirname(DESTINATION);
  await mkdir(publicDirectory, { recursive: true });
  const temporary = await mkdtemp(path.join(publicDirectory, '.inference-runtime-'));
  let previous = null;
  try {
    const source = path.join(PACKAGE, 'dist/transformers.web.js');
    await access(source);
    const entry = path.join(DEPENDENCIES, 'runtime-entry.mjs');
    await writeFile(
      entry,
      `export { AutoTokenizer, Qwen3_5ForCausalLM, Tensor, env } from ${JSON.stringify(source)};\nexport { InferenceSession } from "onnxruntime-web/webgpu";\nexport const runtimeVersion = ${JSON.stringify(VERSION)};\n`,
    );
    await build({
      configFile: false,
      root: DEPENDENCIES,
      publicDir: false,
      logLevel: 'warn',
      resolve: { conditions: ['browser', 'module', 'onnxruntime-web-use-extern-wasm'] },
      build: {
        outDir: temporary,
        emptyOutDir: true,
        sourcemap: false,
        minify: true,
        target: 'es2022',
        lib: { entry, formats: ['es'], fileName: () => 'runtime.js' },
      },
    });
    const ortDirectory = path.join(ORT, 'dist');
    const runtimeAssets = (await readdir(ortDirectory)).filter((name) =>
      /^ort-wasm-simd-threaded\.asyncify\.(?:wasm|mjs)$/.test(name),
    );
    for (const name of runtimeAssets)
      await copyFile(path.join(ortDirectory, name), path.join(temporary, name));
    await copyFile(path.join(PACKAGE, 'LICENSE'), path.join(temporary, 'LICENSE-transformers.txt'));
    // The published ONNX Runtime Web tarball omits LICENSE. Use the reviewed source license.
    const license = path.join(DEPENDENCIES, 'LICENSE-onnxruntime.txt');
    try {
      await access(license);
    } catch {
      await download(
        'https://raw.githubusercontent.com/microsoft/onnxruntime/8d85527a010e294a26b274749f74294b2a32cec5/LICENSE',
        license,
        100_000,
      );
    }
    const licenseContent = await readFile(license);
    if (
      sha256(licenseContent) !== '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c'
    )
      throw new Error('The ONNX Runtime license failed verification.');
    await copyFile(license, path.join(temporary, 'LICENSE-onnxruntime.txt'));
    const files = [];
    for (const name of (await readdir(temporary)).sort()) {
      const file = path.join(temporary, name);
      if (!(await stat(file)).isFile())
        throw new Error('The runtime build unexpectedly emitted a directory.');
      const content = await readFile(file);
      if (/\.(?:js|mjs)$/.test(name)) {
        const javascript = content.toString('utf8');
        if (/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](?:https?:)?\/\//.test(javascript)) {
          throw new Error(`Remote executable imports are not allowed: ${name}`);
        }
      }
      files.push({ name, bytes: content.byteLength, sha256: sha256(content) });
    }
    await writeFile(
      path.join(temporary, 'manifest.json'),
      `${JSON.stringify({ schemaVersion: 2, transformersVersion: VERSION, onnxRuntimeVersion: ORT_VERSION, files }, null, 2)}\n`,
    );
    await verify(temporary);
    try {
      await access(DESTINATION);
      previous = await mkdtemp(path.join(publicDirectory, '.inference-runtime-previous-'));
      await rm(previous, { recursive: true });
      await rename(DESTINATION, previous);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(temporary, DESTINATION);
    } catch (error) {
      if (previous) {
        await rename(previous, DESTINATION);
        previous = null;
      }
      throw error;
    }
    if (previous) await rm(previous, { recursive: true });
    console.log(
      `Prepared ${files.length} runtime files in public/inference-runtime. Run the production build next.`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

try {
  await prepare();
} catch (error) {
  console.error(
    `Browser AI preparation blocked: ${error instanceof Error ? error.message : 'Unknown error'}`,
  );
  console.error(
    'Existing packaged runtime files were preserved. No model or substitute classifier was created.',
  );
  process.exitCode = 2;
}
