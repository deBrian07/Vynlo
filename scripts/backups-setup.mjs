import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const wranglerVersion = '4.151.3';
class SetupError extends Error {}

export function validServiceName(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(value);
}

export function normalizeEndpoint(value) {
  const url = new URL(value.trim());
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)
  ) {
    throw new SetupError(
      'Use the root https://name.account.workers.dev address printed by Wrangler.',
    );
  }
  return url.origin;
}

export function createConfig(name, projectRoot, bucketCreated = false) {
  if (!validServiceName(name)) throw new SetupError('Use a lowercase name such as vynlo-backups.');
  return {
    name,
    main: path.join(projectRoot, 'cloudflare-backups/src/index.ts'),
    compatibility_date: '2026-10-22',
    workers_dev: true,
    observability: { enabled: false },
    ratelimits: [{ name: 'API_LIMITER', namespace_id: '2001', simple: { limit: 120, period: 60 } }],
    r2_buckets: bucketCreated ? [{ binding: 'BACKUPS', bucket_name: name }] : [],
  };
}

export async function prepareSetup(projectRoot) {
  const base = path.join(projectRoot, 'cloudflare-backups');
  const baseInfo = await lstat(base);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink())
    throw new SetupError('The backup service must be a regular local directory.');
  const directory = path.join(base, '.setup');
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new SetupError('The setup directory must be a regular local directory.');
  await chmod(directory, 0o700);
  return directory;
}

export async function readPrivate(file) {
  let handle;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new SetupError('Setup files must be regular files, not links.');
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    await handle.chmod(0o600);
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function savePrivate(file, value) {
  await readPrivate(file);
  const handle = await open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
  } finally {
    await handle.close();
  }
}

async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(question)).trim();
  } finally {
    prompt.close();
  }
}

async function wrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.npm_execpath ? process.execPath : 'pnpm',
      [
        ...(process.env.npm_execpath ? [process.env.npm_execpath] : []),
        'dlx',
        `wrangler@${wranglerVersion}`,
        ...args,
      ],
      {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        shell: false,
      },
    );
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new SetupError(`Cloudflare command stopped (${code ?? 'interrupted'}).`));
    });
  });
}

export async function verify(endpoint, secret, fetcher = globalThis.fetch) {
  endpoint = normalizeEndpoint(endpoint);
  for (const route of ['/health', '/v1/check']) {
    const response = await fetcher(`${endpoint}${route}`, {
      headers: route === '/v1/check' ? { Authorization: `Bearer ${secret}` } : {},
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new SetupError('The service check failed. Rerun setup to retry.');
    const body = await response.json();
    if (
      route === '/health'
        ? body?.service !== 'vynlo-backups' || body?.version !== 1
        : body?.ok !== true
    )
      throw new SetupError('The endpoint did not pass the Vynlo backup service check.');
  }
}

export function connectionFileCommand(platform, file) {
  if (platform === 'darwin') return { command: 'open', args: ['-R', file] };
  if (platform === 'win32') return { command: 'explorer.exe', args: ['/select,', file] };
  return { command: 'xdg-open', args: [path.dirname(file)] };
}

async function revealConnection(file) {
  const { command, args } = connectionFileCommand(process.platform, file);
  await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: false });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

export async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'Vynlo · optional encrypted cloud backups\n\npnpm backups:setup\n\n' +
        'Interactive: signs into Cloudflare, creates one private R2 bucket and deploys one Worker.\n' +
        'Requires Node 22.13+, pnpm, internet and a Cloudflare account with R2 enabled.\n' +
        'Nothing is deployed until you type yes. See docs/BACKUPS.md.\n',
    );
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new SetupError(
      'Run pnpm backups:setup in an interactive terminal. No cloud changes were made.',
    );
  process.stdout.write(
    '\nVynlo · optional encrypted cloud backups\n\n' +
      'Your extension encrypts your workspace before uploading it to your private Cloudflare R2 bucket.\n' +
      'Cloudflare receives encrypted files and request metadata. Your recovery key stays with you.\n' +
      'R2 may require billing details even within its free allowance. Usage beyond limits can cost money.\n' +
      'This helper will not purchase plans or accept terms. Enable R2 yourself in the Cloudflare dashboard first.\n' +
      'Local backup downloads work without Cloudflare or this setup.\n\n',
  );
  if (
    (await ask('Create/update your Cloudflare backup service? Type yes to continue: ')) !== 'yes'
  ) {
    process.stdout.write('Cancelled. No cloud changes were made.\n');
    return;
  }
  const setup = await prepareSetup(root);
  const configPath = path.join(setup, 'wrangler.json');
  const secretsPath = path.join(setup, 'secrets.json');
  let config = await readPrivate(configPath);
  if (!config) {
    const name = (await ask('Service name [vynlo-backups]: ')) || 'vynlo-backups';
    config = createConfig(name, root);
    await savePrivate(configPath, config);
  }
  const existingBinding = config.r2_buckets?.find((bucket) => bucket.binding === 'BACKUPS');
  if (existingBinding && existingBinding.bucket_name !== config.name)
    throw new SetupError(
      'The saved backup bucket does not match this service. No changes were made.',
    );
  config = createConfig(config.name, root, Boolean(existingBinding));
  await savePrivate(configPath, config);
  let secrets = await readPrivate(secretsPath);
  if (!secrets) {
    secrets = { ADMIN_SECRET: randomBytes(32).toString('hex') };
    await savePrivate(secretsPath, secrets);
  }
  if (!/^[a-f0-9]{64}$/.test(secrets.ADMIN_SECRET ?? ''))
    throw new SetupError('Invalid saved connection key. No secret was uploaded.');
  process.stdout.write('\n1/3 · Sign in to Cloudflare in your browser.\n');
  await wrangler(['login']);
  if (!existingBinding) {
    process.stdout.write('\n2/3 · Create your private backup bucket.\n');
    await wrangler(['r2', 'bucket', 'create', config.name, '--config', configPath]);
    config = createConfig(config.name, root, true);
    await savePrivate(configPath, config);
  } else {
    process.stdout.write('\n2/3 · Reuse the bucket recorded by this setup.\n');
  }
  process.stdout.write('\n3/3 · Publish your backup service.\n');
  await wrangler(['deploy', '--config', configPath, '--secrets-file', secretsPath]);
  let endpoint;
  while (!endpoint) {
    try {
      endpoint = normalizeEndpoint(await ask('Paste the https://…workers.dev URL printed above: '));
    } catch {
      process.stdout.write('Enter the root workers.dev address without a path or query.\n');
    }
  }
  process.stdout.write('\nChecking the service and your connection key…\n');
  await verify(endpoint, secrets.ADMIN_SECRET);
  const connectionPath = path.join(setup, 'connection.json');
  await savePrivate(connectionPath, { endpoint, secret: secrets.ADMIN_SECRET });
  process.stdout.write(
    `\nReady. In Vynlo Settings → Data protection, select "Choose connection file" and choose:\n${connectionPath}\n\n` +
      'Keep it private. Select "Prepare cloud backup", then "Save recovery file".\n' +
      'Save that file outside Chrome, confirm it is saved, then select "Enable automatic backups".\n' +
      'Cloud backups remain off until you enable them in Vynlo. No workspace was uploaded by this helper.\n',
  );
  if ((await ask('Show your connection file in the file manager? [Y/n]: ')).toLowerCase() !== 'n')
    await revealConnection(connectionPath);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    if (error instanceof SetupError) process.stderr.write(`\n${error.message}\n`);
    process.stderr.write(
      '\nSetup stopped. Progress is saved in cloudflare-backups/.setup.\n' +
        'Check the preceding Cloudflare error and rerun pnpm backups:setup.\n' +
        'If the bucket already exists without saved setup, choose a different service name; it is not adopted automatically.\n' +
        'Do not share connection files, secret files or authentication logs.\n',
    );
    process.exitCode = 1;
  });
}
