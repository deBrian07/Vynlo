import { senderKind, type MessageSender } from '../../services/background';
import { validBackup } from '../../services/validation';
import type { Backup } from '../../types/model';
import { BackupStateStore, type BackupState, type RestorePreview } from './state';
import {
  decryptBackup,
  decryptLocal,
  deriveVault,
  encryptBackup,
  encryptLocal,
  generateSecret,
  validFullBackup,
  validRecoveryKit,
  validEncryptedBackup,
  workerEndpoint,
  MAX_ENVELOPE_BYTES,
} from './crypto';
import type { FullBackup, RecoveryKit } from './types';
import type { BackupData, BackupResponse, PreviewSummary, ProtectionStatus } from './contracts';

export const BACKUP_ALARM = 'vynlo-workspace-backup';
const HEX = /^[a-f0-9]{64}$/;
const ETAG = /^"[a-zA-Z0-9_-]{1,128}"$/;
export interface BackupPlatform {
  extensionId: string;
  readWorkspace(): Promise<Backup>;
  restoreWorkspace(backup: Backup): Promise<void>;
  readAddons(): Promise<FullBackup['addons']>;
  restoreAddons(addons: FullBackup['addons']): Promise<void>;
  hasPermission(origin: string): Promise<boolean>;
  setAlarm(at: number): Promise<void>;
  clearAlarm(): Promise<void>;
}
class Conflict extends Error {}
export function createBackupService(
  platform: BackupPlatform,
  store = new BackupStateStore(),
  fetcher: typeof fetch = fetch,
  now = Date.now,
) {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  }
  async function status(): Promise<ProtectionStatus> {
    const state = await store.read();
    const c = state.cloud;
    return {
      configured: !!c,
      automatic: c?.enabled ?? false,
      pending: c?.dirty ?? false,
      conflict: c?.conflict ?? false,
      recoveryPending: !!state.pendingRestore,
      ...(c ? { endpoint: c.endpoint, lastSuccess: c.lastSuccess, error: c.error } : {}),
      lastLocalExport: state.lastLocalExport,
    };
  }
  async function fullDocument(): Promise<FullBackup> {
    const document: FullBackup = {
      format: 'vynlo-workspace-backup',
      version: 1,
      workspace: await platform.readWorkspace(),
      addons: await platform.readAddons(),
    };
    if (!validFullBackup(document))
      throw new Error('Your workspace could not be verified. Existing backups were preserved.');
    return document;
  }
  async function request(
    endpoint: string,
    route: string,
    options: {
      token?: string;
      method?: string;
      body?: unknown;
      etag?: string;
      provision?: string;
    } = {},
  ) {
    endpoint = workerEndpoint(endpoint);
    if (!(await platform.hasPermission(`${endpoint}/*`)))
      throw new Error('Allow access to your backup service in Data protection first.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetcher(`${endpoint}${route}`, {
        method: options.method ?? 'GET',
        headers: {
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.etag
            ? { 'If-Match': options.etag }
            : options.method === 'PUT'
              ? { 'If-None-Match': '*' }
              : {}),
          ...(options.provision ? { 'X-Vynlo-Provision': options.provision } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      if (response.status === 409)
        throw new Conflict(
          'Another copy changed the cloud backup. Restore its latest version before enabling backups again.',
        );
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? 'No cloud backup was found for this recovery file.'
            : response.status === 403 || response.status === 401
              ? 'The service did not accept these connection details.'
              : response.status === 429
                ? 'The backup service is busy. Try again shortly.'
                : 'Your backup service is unavailable. Your local workspace is unchanged.',
        );
      const reader = response.body?.getReader();
      if (!reader) throw new Error('The service returned an empty response.');
      let length = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > MAX_ENVELOPE_BYTES) {
          await reader.cancel();
          throw new Error('The backup response is too large.');
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return { data, etag: response.headers.get('ETag') };
    } catch (error) {
      if (error instanceof Conflict) throw error;
      if (
        error instanceof Error &&
        !['TypeError', 'AbortError', 'SyntaxError'].includes(error.name)
      )
        throw error;
      throw new Error('Could not reach your backup service. Your local workspace is safe.', {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  async function schedule(state: BackupState, retry = false) {
    if (state.pendingRestore || !state.cloud?.enabled) await platform.clearAlarm();
    else
      await platform.setAlarm(
        retry
          ? now() + 15 * 60_000
          : state.cloud.dirty
            ? Math.max(now() + 1000, (state.cloud.dirtySince ?? now()) + 60_000)
            : Math.max(now() + 60_000, (state.cloud.lastSuccess ?? now()) + 24 * 60 * 60_000),
      );
  }
  async function upload(force = false) {
    const state = await store.read();
    if (state.pendingRestore) throw new Error('Finish the pending restore before backing up.');
    const c = state.cloud;
    if (!c?.enabled) {
      await platform.clearAlarm();
      return;
    }
    if (c.conflict) throw new Error('Restore the latest cloud backup to resolve this conflict.');
    if (!force && !c.dirty && c.lastSuccess && now() - c.lastSuccess < 24 * 60 * 60_000) {
      await schedule(state);
      return;
    }
    try {
      const { token } = await deriveVault(c.secret);
      const encrypted = await encryptBackup(await fullDocument(), c.secret);
      const { data } = await request(c.endpoint, `/v1/vaults/${c.vaultId}`, {
        method: 'PUT',
        token,
        body: encrypted,
        etag: c.etag,
        provision: !c.etag ? c.provision : undefined,
      });
      if (
        !data ||
        typeof data !== 'object' ||
        !('etag' in data) ||
        typeof data.etag !== 'string' ||
        !ETAG.test(data.etag)
      )
        throw new Error('The service did not confirm the backup. Retry before reinstalling.');
      c.etag = data.etag;
      c.lastSuccess = now();
      c.dirty = false;
      delete c.dirtySince;
      delete c.error;
      delete c.provision;
      await store.write(state);
      await schedule(state);
    } catch (error) {
      c.error = error instanceof Error ? error.message : 'Your backup could not be saved.';
      c.dirty = true;
      if (error instanceof Conflict) {
        c.conflict = true;
        c.enabled = false;
      }
      await store.write(state);
      await schedule(state, true);
      throw error;
    }
  }
  function summary(preview: RestorePreview): PreviewSummary {
    const w = preview.document.workspace;
    return {
      ticket: preview.id,
      exportedAt: w.exportedAt,
      accounts: w.accounts.length,
      conversations: w.conversations.length,
      reminders: w.reminders.length,
      contacts: w.contacts.length,
      snippets: w.snippets.length,
      tracking: preview.document.addons?.openTracking?.records.length ?? 0,
      source: preview.cloud ? 'cloud' : 'file',
    };
  }
  async function finishRestore(state: BackupState) {
    const pending = state.pendingRestore;
    if (!pending) return;
    // Core imports are transactional and merge existing IDs. Addon replay is idempotent.
    await platform.restoreWorkspace(pending.document.workspace);
    await platform.restoreAddons(pending.document.addons);
    if (pending.cloud)
      state.cloud = { ...pending.cloud, enabled: false, dirty: true, dirtySince: now() };
    else if (state.cloud) {
      state.cloud.enabled = false;
      state.cloud.dirty = true;
      state.cloud.dirtySince = now();
    }
    delete state.pendingRestore;
    delete state.preview;
    await store.write(state);
    await schedule(state);
  }
  async function handleInternal(message: unknown, sender: MessageSender): Promise<BackupResponse> {
    if (
      senderKind(sender, platform.extensionId) !== 'extension' ||
      !message ||
      typeof message !== 'object' ||
      !('type' in message)
    )
      return { ok: false, error: 'Open Vynlo settings to manage backups.' };
    const m = message as Record<string, unknown>;
    try {
      const state = await store.read();
      if (
        state.pendingRestore &&
        !['backup-status', 'backup-resume-restore', 'backup-export-file', 'backup-pause'].includes(
          String(m.type),
        )
      )
        throw new Error('Finish the pending restore before changing backup settings.');
      let data: BackupData = null;
      switch (m.type) {
        case 'backup-resume-restore':
          await finishRestore(state);
          data = await status();
          break;
        case 'backup-status':
          data = await status();
          break;
        case 'backup-export-file': {
          if (typeof m.password !== 'string' || m.password.length < 12 || m.password.length > 1024)
            throw new Error('Use a backup password of 12–1024 characters.');
          data = await encryptLocal(await fullDocument(), m.password);
          state.lastLocalExport = now();
          await store.write(state);
          break;
        }
        case 'backup-preview-file': {
          if (typeof m.password !== 'string' || m.password.length > 1024)
            throw new Error('Enter the backup password.');
          let document: FullBackup;
          if (validBackup(m.file))
            document = { format: 'vynlo-workspace-backup', version: 1, workspace: m.file };
          else {
            if (!validEncryptedBackup(m.file))
              throw new Error('Choose a supported Vynlo backup file.');
            document = await decryptLocal(m.file, m.password);
          }
          const preview: RestorePreview = {
            id: crypto.randomUUID(),
            document,
            expiresAt: now() + 10 * 60_000,
          };
          state.preview = preview;
          await store.write(state);
          data = summary(preview);
          break;
        }
        case 'backup-prepare-cloud': {
          if (state.cloud?.etag)
            throw new Error(
              'A cloud backup is already connected. Use its recovery file to restore or resume it.',
            );
          if (
            typeof m.endpoint !== 'string' ||
            typeof m.provision !== 'string' ||
            !HEX.test(m.provision)
          )
            throw new Error('Choose the connection file from backup service setup.');
          const endpoint = workerEndpoint(m.endpoint);
          const health = await request(endpoint, '/health');
          if (
            !health.data ||
            typeof health.data !== 'object' ||
            !('service' in health.data) ||
            health.data.service !== 'vynlo-backups' ||
            !('version' in health.data) ||
            health.data.version !== 1
          )
            throw new Error('This address is not a compatible Vynlo backup service.');
          const check = await request(endpoint, '/v1/check', { token: m.provision });
          if (
            !check.data ||
            typeof check.data !== 'object' ||
            !('ok' in check.data) ||
            check.data.ok !== true
          )
            throw new Error('The connection key could not be verified.');
          const secret = generateSecret();
          const { vaultId } = await deriveVault(secret);
          state.cloud = {
            format: 'vynlo-recovery-kit',
            version: 1,
            endpoint,
            secret,
            vaultId,
            provision: m.provision,
            enabled: false,
            dirty: true,
            dirtySince: now(),
          };
          await store.write(state);
          data = { format: 'vynlo-recovery-kit', version: 1, endpoint, secret, vaultId };
          break;
        }
        case 'backup-recovery-file': {
          const c = state.cloud;
          if (!c) throw new Error('Prepare a cloud backup first.');
          data = {
            format: 'vynlo-recovery-kit',
            version: 1,
            endpoint: c.endpoint,
            secret: c.secret,
            vaultId: c.vaultId,
          };
          break;
        }
        case 'backup-enable': {
          if (m.savedRecovery !== true || !state.cloud)
            throw new Error('Save your recovery file before enabling automatic backups.');
          if (state.cloud.conflict)
            throw new Error('Restore the latest cloud copy before enabling automatic backups.');
          state.cloud.enabled = true;
          state.cloud.dirtySince = now();
          state.cloud.dirty = true;
          await store.write(state);
          await upload(true);
          data = await status();
          break;
        }
        case 'backup-pause':
          if (state.cloud) {
            state.cloud.enabled = false;
            await store.write(state);
          }
          await platform.clearAlarm();
          data = await status();
          break;
        case 'backup-now':
          if (!state.cloud?.enabled)
            throw new Error('Enable automatic backups first, or download a local file.');
          await upload(true);
          data = await status();
          break;
        case 'backup-preview-cloud': {
          if (!(await validRecoveryKit(m.kit)))
            throw new Error('Choose the recovery file saved when you enabled cloud backups.');
          const kit = m.kit as RecoveryKit;
          const { token } = await deriveVault(kit.secret);
          const response = await request(kit.endpoint, `/v1/vaults/${kit.vaultId}`, { token });
          if (!response.etag || !ETAG.test(response.etag))
            throw new Error('The cloud backup revision could not be verified.');
          if (!validEncryptedBackup(response.data))
            throw new Error('The cloud backup has an unsupported format.');
          const document = await decryptBackup(response.data, kit.secret);
          const preview: RestorePreview = {
            id: crypto.randomUUID(),
            document,
            expiresAt: now() + 10 * 60_000,
            cloud: { ...kit, enabled: false, dirty: true, etag: response.etag },
          };
          state.preview = preview;
          await store.write(state);
          data = summary(preview);
          break;
        }
        case 'backup-restore': {
          if (
            typeof m.ticket !== 'string' ||
            !state.preview ||
            state.preview.id !== m.ticket ||
            state.preview.expiresAt < now()
          )
            throw new Error('This restore preview expired. Choose the backup again.');
          if (state.cloud) state.cloud.enabled = false;
          state.pendingRestore = state.preview;
          await store.write(state);
          await platform.clearAlarm();
          try {
            await finishRestore(state);
          } catch {
            throw new Error(
              'Recovery is incomplete. Keep your backup file and retry the restore; existing records were preserved.',
            );
          }
          data = await status();
          break;
        }
        default:
          throw new Error('This backup action is unavailable.');
      }
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : 'This backup action could not be completed.',
      };
    }
  }
  return {
    handle: (message: unknown, sender: MessageSender) =>
      serial(() => handleInternal(message, sender)),
    initialize: () =>
      serial(async () => {
        const state = await store.read();
        if (state.pendingRestore) await finishRestore(state);
        await schedule(state);
      }),
    changed: () =>
      serial(async () => {
        const state = await store.read();
        if (state.cloud) {
          if (!state.cloud.dirty || state.cloud.dirtySince === undefined)
            state.cloud.dirtySince = now();
          state.cloud.dirty = true;
          await store.write(state);
          await schedule(state);
        }
      }),
    process: () => serial(() => upload()),
    prepareClear: () =>
      serial(async () => {
        const state = await store.read();
        if (state.cloud) state.cloud.enabled = false;
        // An explicit clear cancels pending imports before core deletion. A later
        // backup-state write failure must never replay old data into a cleared workspace.
        delete state.pendingRestore;
        delete state.preview;
        await store.write(state);
        await platform.clearAlarm();
      }),
    beforeClear: () =>
      serial(async () => {
        await store.write({ version: 1 });
        await platform.clearAlarm();
      }),
  };
}
