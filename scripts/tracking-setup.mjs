import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const setup = path.join(root, 'cloudflare/.setup');
const configPath = path.join(setup, 'wrangler.json');
const secretsPath = path.join(setup, 'secrets.json');
const wranglerVersion = '4.151.3';
class SetupError extends Error {}

export function validWorkerName(value) {
  return /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(value);
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
    throw new SetupError('Use the https://name.account.workers.dev address printed by Wrangler.');
  }
  return url.origin;
}

export function createConfig(name, projectRoot) {
  if (!validWorkerName(name)) throw new SetupError('Use a lowercase name such as vynlo-tracking.');
  return {
    name,
    main: path.join(projectRoot, 'cloudflare/src/index.ts'),
    compatibility_date: '2026-10-22',
    workers_dev: true,
    observability: { enabled: false },
    triggers: { crons: ['17 3 * * *'] },
    ratelimits: [
      { name: 'PIXEL_LIMITER', namespace_id: '11201', simple: { limit: 2, period: 60 } },
      { name: 'API_LIMITER', namespace_id: '11202', simple: { limit: 120, period: 60 } },
    ],
  };
}

async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(question)).trim();
  } finally {
    prompt.close();
  }
}

async function readOptional(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new SetupError('Setup files must be regular files.');
    await chmod(file, 0o600);
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function savePrivate(file, value) {
  await readOptional(file);
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await chmod(file, 0o600);
}

async function wrangler(args) {
  // Secrets travel in a private file, never through command arguments or shell history.
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
        stdio: ['inherit', 'pipe', 'inherit'],
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        shell: false,
      },
    );
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
      process.stdout.write(data);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new SetupError(`Cloudflare command stopped (${code ?? 'interrupted'}).`));
    });
  });
}

async function verify(endpoint, secret) {
  const result = await globalThis.fetch(`${endpoint}/v1/check`, {
    headers: { Authorization: `Bearer ${secret}` },
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(15000),
  });
  if (!result.ok) throw new SetupError('The service did not accept the connection key.');
  const body = await result.json();
  if (body?.ok !== true) {
    throw new SetupError('The deployed service did not identify itself as Vynlo.');
  }
}

export async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'Vynlo open tracking setup\n\npnpm tracking:setup\n\n' +
        'Interactive: signs into Cloudflare, creates one D1 database and deploys one Worker.\n' +
        'Requires Node 22.13+, pnpm, internet and a Cloudflare account.\n' +
        'Nothing is deployed until you explicitly confirm. See docs/OPEN_TRACKING.md.\n',
    );
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new SetupError(
      'Run pnpm tracking:setup in an interactive terminal. No cloud changes were made.',
    );
  }
  process.stdout.write(
    '\nVynlo · optional open tracking\n\n' +
      'This publishes a public image endpoint and stores random IDs and event timestamps in Cloudflare.\n' +
      'Cloudflare receives request metadata. No message bodies, subjects or email addresses are uploaded.\n' +
      'A Cloudflare account is required. Free-plan limits apply; paid plans can incur charges.\n' +
      'This helper will not purchase a plan or accept terms for you.\n' +
      'Your existing Vynlo features work without this setup.\n\n',
  );
  if ((await ask('Create/update your Cloudflare service? Type yes to continue: ')) !== 'yes') {
    process.stdout.write('Cancelled. No cloud changes were made.\n');
    return;
  }
  await mkdir(setup, { recursive: true, mode: 0o700 });
  const directory = await lstat(setup);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new SetupError('The setup directory must be a regular local directory.');
  }
  await chmod(setup, 0o700);
  let config = await readOptional(configPath);
  if (!config) {
    const name = (await ask('Service name [vynlo-tracking]: ')) || 'vynlo-tracking';
    config = createConfig(name, root);
    await savePrivate(configPath, config);
  }
  if (!validWorkerName(config.name)) throw new SetupError('Invalid service name in saved setup.');
  // Refresh paths after the checkout is moved while retaining the database/account binding.
  config.main = path.join(root, 'cloudflare/src/index.ts');
  await savePrivate(configPath, config);
  process.stdout.write('\n1/4 · Sign in to Cloudflare in your browser.\n');
  await wrangler(['login']);
  if (!config.d1_databases?.some((db) => db.binding === 'DB' && db.database_id)) {
    process.stdout.write('\n2/4 · Create the event database.\n');
    await wrangler([
      'd1',
      'create',
      config.name,
      '--binding',
      'DB',
      '--update-config',
      '--config',
      configPath,
    ]);
    config = await readOptional(configPath);
  } else {
    process.stdout.write('\n2/4 · Reuse your existing event database.\n');
  }
  const binding = config?.d1_databases?.find((db) => db.binding === 'DB');
  if (!binding || !/^[a-f0-9-]{36}$/i.test(binding.database_id ?? '')) {
    throw new SetupError(
      'Cloudflare did not save a DB binding. See docs/OPEN_TRACKING.md for recovery.',
    );
  }
  binding.migrations_dir = path.join(root, 'cloudflare/migrations');
  await savePrivate(configPath, config);
  let secrets = await readOptional(secretsPath);
  if (!secrets) {
    secrets = { ADMIN_SECRET: randomBytes(32).toString('hex') };
    await savePrivate(secretsPath, secrets);
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secrets.ADMIN_SECRET ?? '')) {
    throw new SetupError('Invalid saved connection key. No secret was uploaded.');
  }
  process.stdout.write('\n3/4 · Apply the database schema.\n');
  await wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath]);
  process.stdout.write('\n4/4 · Publish the tracking service.\n');
  const output = await wrangler(['deploy', '--config', configPath, '--secrets-file', secretsPath]);
  const detected = output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/g)?.at(-1);
  let endpoint;
  while (!endpoint) {
    try {
      endpoint = normalizeEndpoint(
        detected || (await ask('Paste the https://…workers.dev URL above: ')),
      );
    } catch {
      if (detected)
        throw new SetupError('Cannot validate deployment URL. See docs/OPEN_TRACKING.md.');
      process.stdout.write('Enter the root workers.dev address, without a path or query.\n');
    }
  }
  const connectionPath = path.join(setup, 'connection.json');
  await savePrivate(connectionPath, { endpoint, secret: secrets.ADMIN_SECRET });
  try {
    await verify(endpoint, secrets.ADMIN_SECRET);
  } catch {
    throw new SetupError(
      'Published, but the connection check failed. Wait a minute and rerun setup. Your key is preserved.',
    );
  }
  process.stdout.write(
    `\nReady. In Vynlo Settings → Open tracking, paste the endpoint and connection key from:\n${connectionPath}\n\n` +
      'Keep that file private. Do not commit, screenshot or share the key.\n' +
      'The extension asks permission for your endpoint when you connect.\n' +
      'Tracking stays optional; insert a tracking image only in drafts you choose.\n',
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    if (error instanceof SetupError) process.stderr.write(`\n${error.message}\n`);
    process.stderr.write(
      '\nSetup stopped. Your progress is saved in cloudflare/.setup.\n' +
        'Review the preceding Cloudflare error, then rerun pnpm tracking:setup.\n' +
        'For help, see docs/OPEN_TRACKING.md. Do not share connection files or authentication logs.\n',
    );
    process.exitCode = 1;
  });
}
