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
        // Keep the TTY so account selection and Cloudflare confirmations remain usable.
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

export async function verify(endpoint, secret, fetcher = globalThis.fetch) {
  endpoint = normalizeEndpoint(endpoint);
  async function request(route, token, method = 'GET', body) {
    const result = await fetcher(`${endpoint}${route}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(15000),
    });
    if (!result.ok)
      throw new SetupError('The deployment check failed. Check its schema and bindings.');
    return result.json();
  }
  const identity = await request('/health');
  if (identity?.service !== 'vynlo-tracking' || identity?.version !== 1) {
    throw new SetupError('The deployed service did not identify itself as Vynlo.');
  }
  const check = await request('/v1/check', secret);
  if (check?.ok !== true) throw new SetupError('The service did not accept the connection key.');
  const credentials = {
    id: randomBytes(32).toString('hex'),
    readToken: randomBytes(32).toString('hex'),
    deleteToken: randomBytes(32).toString('hex'),
  };
  const route = `/v1/trackings/${credentials.id}`;
  let failure;
  let cleanupFailed = false;
  // Delete even after an uncertain POST response: D1 may have committed before a timeout.
  try {
    const created = await request('/v1/trackings', secret, 'POST', credentials);
    if (
      created?.pixelUrl !== `${endpoint}/p/${credentials.id}.gif` ||
      !Number.isSafeInteger(created?.expiresAt) ||
      created.expiresAt <= Date.now()
    )
      throw new SetupError('The deployment returned an invalid setup test record.');
    const paused = await request(route, credentials.readToken);
    if (paused?.armedAt !== null || paused?.openCount !== 0) {
      throw new SetupError('The deployment did not create a paused setup test record.');
    }
    const activation = await request(`${route}/activate`, credentials.deleteToken, 'POST');
    if (
      activation?.ok !== true ||
      !Number.isSafeInteger(activation?.armedAt) ||
      activation.armedAt <= 0
    ) {
      throw new SetupError('The deployment could not activate the setup test record.');
    }
    const active = await request(route, credentials.readToken);
    if (active?.armedAt !== activation.armedAt || active?.openCount !== 0) {
      throw new SetupError('The deployment did not persist the setup test record correctly.');
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      const response = await fetcher(`${endpoint}${route}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credentials.deleteToken}` },
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(15000),
      });
      if (response.status !== 404 && (!response.ok || (await response.json())?.deleted !== true)) {
        cleanupFailed = true;
      }
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    throw new SetupError(
      'The setup test record could not be deleted. Check Cloudflare D1 and retry setup; ' +
        'the temporary record expires after 30 days. Setup has not reported success.',
    );
  }
  if (failure) throw failure;
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
      'The final check creates, activates and deletes a temporary test record. No pixel is loaded.\n' +
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
  config = { ...config, ...createConfig(config.name, root) };
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
  await wrangler(['deploy', '--config', configPath, '--secrets-file', secretsPath]);
  let endpoint;
  while (!endpoint) {
    try {
      endpoint = normalizeEndpoint(await ask('Paste the https://…workers.dev URL printed above: '));
    } catch {
      process.stdout.write('Enter the root workers.dev address, without a path or query.\n');
    }
  }
  const connectionPath = path.join(setup, 'connection.json');
  await savePrivate(connectionPath, { endpoint, secret: secrets.ADMIN_SECRET });
  try {
    await verify(endpoint, secrets.ADMIN_SECRET);
  } catch (error) {
    if (error instanceof SetupError) throw error;
    throw new SetupError(
      'Published, but the connection check failed. Wait a minute and rerun setup. Your key is preserved.',
    );
  }
  process.stdout.write(
    `\nReady. In Vynlo Settings → Email open tracking, choose "Choose connection file" and select:\n${connectionPath}\n\n` +
      'Keep that file private. Do not commit, screenshot or share the key.\n' +
      'The extension asks permission for your endpoint when you connect.\n' +
      'Tracking stays optional; insert a tracking image only in drafts you choose.\n',
  );
  if ((await ask('Show your connection file in the file manager? [Y/n]: ')).toLowerCase() !== 'n') {
    await revealConnection(connectionPath);
  }
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
