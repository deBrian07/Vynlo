import { senderKind, type MessageSender } from '../../services/background';
import { TrackingDatabase } from './database';
import {
  trackingAccount,
  trackingToken,
  workerEndpoint,
  type TrackingRecord,
  type TrackingResponse,
  type TrackingSnapshot,
} from './types';

interface Config {
  endpoint: string;
  secret: string;
}
export interface TrackingPlatform {
  extensionId: string;
  getConfig(): Promise<unknown>;
  setConfig(value: Config | null): Promise<void>;
  hasPermission(origin: string): Promise<boolean>;
}
const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
const secretValid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-zA-Z0-9_-]{32,256}$/.test(v);

export function createTrackingService(
  platform: TrackingPlatform,
  database = new TrackingDatabase(),
  fetcher: typeof fetch = fetch,
  now = Date.now,
) {
  let queue: Promise<unknown> = Promise.resolve();
  async function config(): Promise<Config | null> {
    const value = await platform.getConfig();
    if (
      !value ||
      typeof value !== 'object' ||
      !('endpoint' in value) ||
      typeof value.endpoint !== 'string' ||
      !('secret' in value) ||
      !secretValid(value.secret)
    )
      return null;
    const endpoint = workerEndpoint(value.endpoint);
    if (!(await platform.hasPermission(`${endpoint}/*`))) return null;
    return { endpoint, secret: value.secret };
  }
  async function api(
    endpoint: string,
    route: string,
    token?: string,
    method = 'GET',
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    workerEndpoint(endpoint);
    if (!(await platform.hasPermission(`${endpoint}/*`)))
      throw new Error('Allow access to your tracking Worker in Settings first.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetcher(`${endpoint}${route}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (response.status === 404 && method === 'DELETE') return {};
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'Your tracking key was not accepted. Check the key in Settings.'
            : response.status === 429
              ? 'Tracking is busy. Wait a minute and try again.'
              : 'The tracking Worker could not complete the request. Try again shortly.',
        );
      if (response.status === 204) return {};
      const reader = response.body?.getReader();
      if (!reader) throw new Error('The tracking Worker returned an empty response.');
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 16_384) {
          await reader.cancel();
          throw new Error('The tracking Worker returned an unexpected response.');
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder().decode(bytes);
      const json: unknown = JSON.parse(text);
      if (!json || typeof json !== 'object' || Array.isArray(json))
        throw new Error('The tracking Worker returned an unexpected response.');
      return json as Record<string, unknown>;
    } catch (error) {
      if (
        error instanceof Error &&
        !['TypeError', 'AbortError', 'SyntaxError'].includes(error.name)
      )
        throw error;
      throw new Error(
        'Could not reach your tracking Worker. Check its URL and connection, then try again.',
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async function snapshot(accountId?: string): Promise<TrackingSnapshot> {
    const c = await config();
    return {
      connected: !!c,
      ...(c ? { endpoint: c.endpoint } : {}),
      records: (await database.read())
        .filter((r) => !accountId || r.accountId === accountId)
        .map(
          ({
            id,
            accountId,
            label,
            createdAt,
            expiresAt,
            firstOpenedAt,
            lastOpenedAt,
            openCount,
            armedAt,
          }) => ({
            id,
            accountId,
            label,
            createdAt,
            expiresAt,
            firstOpenedAt,
            lastOpenedAt,
            openCount,
            armedAt,
          }),
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    };
  }
  async function handleInternal(
    message: unknown,
    sender: MessageSender,
  ): Promise<TrackingResponse> {
    const kind = senderKind(sender, platform.extensionId);
    if (!kind || !message || typeof message !== 'object' || !('type' in message))
      return { ok: false, error: 'This tracking request could not be verified.' };
    const m = message as Record<string, unknown>;
    try {
      if (
        kind !== 'extension' &&
        ['tracking-connect', 'tracking-disconnect'].includes(String(m.type))
      )
        throw new Error('Open Vynlo Settings to manage your tracking connection.');
      if (m.type === 'tracking-connect') {
        if (typeof m.endpoint !== 'string' || !secretValid(m.secret))
          throw new Error('Enter the Worker URL and setup key (at least 32 characters).');
        const endpoint = workerEndpoint(m.endpoint);
        const health = await api(endpoint, '/health');
        if (health.service !== 'vynlo-tracking' || health.version !== 1)
          throw new Error('This URL does not point to a compatible Vynlo tracking Worker.');
        const check = await api(endpoint, '/v1/check', m.secret);
        if (check.ok !== true) throw new Error('The tracking key could not be verified.');
        await platform.setConfig({ endpoint, secret: m.secret });
        return { ok: true, data: null };
      }
      if (m.type === 'tracking-disconnect') {
        await platform.setConfig(null);
        return { ok: true, data: null };
      }
      if (m.type === 'tracking-snapshot') {
        if (m.accountId !== undefined && !trackingAccount(m.accountId))
          throw new Error('Select a supported Gmail account.');
        if (kind === 'gmail' && !m.accountId)
          return { ok: true, data: { connected: !!(await config()), records: [] } };
        return { ok: true, data: await snapshot(m.accountId as string | undefined) };
      }
      if (!trackingAccount(m.accountId)) throw new Error('Select a supported Gmail account first.');
      const accountId = m.accountId;
      if (m.type === 'tracking-create') {
        const c = await config();
        if (!c) throw new Error('Connect your tracking Worker in Vynlo Settings first.');
        if (typeof m.label !== 'string' || m.label.length > 120 || !m.label.trim())
          throw new Error('Give this tracked draft a short local name.');
        const records = await database.read();
        if (records.length >= 100)
          throw new Error(
            'Your tracking history is full (100 entries). Remove old entries before adding another.',
          );
        const record: TrackingRecord = {
          id: randomToken(),
          accountId,
          label: m.label.trim(),
          endpoint: c.endpoint,
          readToken: randomToken(),
          deleteToken: randomToken(),
          createdAt: now(),
          expiresAt: now() + 30 * 86_400_000,
          firstOpenedAt: null,
          lastOpenedAt: null,
          openCount: 0,
          armedAt: null,
        };
        // Persist capabilities before requesting a remote record, so a worker crash cannot lose them.
        await database.put(record);
        const result = await api(c.endpoint, '/v1/trackings', c.secret, 'POST', {
          id: record.id,
          readToken: record.readToken,
          deleteToken: record.deleteToken,
        });
        const pixelUrl = `${c.endpoint}/p/${record.id}.gif`;
        if (
          result.pixelUrl !== pixelUrl ||
          typeof result.expiresAt !== 'number' ||
          result.expiresAt <= now() ||
          result.expiresAt > now() + 31 * 86_400_000
        )
          throw new Error(
            'The tracking Worker returned an invalid tracking reference. Your draft was not changed.',
          );
        record.expiresAt = result.expiresAt;
        await database.put(record);
        return { ok: true, data: { id: record.id, pixelUrl } };
      }
      if (m.type === 'tracking-remove') {
        if (!trackingToken(m.id)) throw new Error('This tracking entry is unavailable.');
        const record = (await database.read()).find(
          (r) => r.id === m.id && r.accountId === accountId,
        );
        if (!record) throw new Error('This tracking entry is unavailable in this account.');
        await api(record.endpoint, `/v1/trackings/${record.id}`, record.deleteToken, 'DELETE');
        await database.remove(record.id);
        return { ok: true, data: null };
      }
      if (m.type === 'tracking-activate') {
        if (!trackingToken(m.id)) throw new Error('This tracking entry is unavailable.');
        const record = (await database.read()).find(
          (r) => r.id === m.id && r.accountId === accountId,
        );
        if (!record || record.expiresAt <= now())
          throw new Error('This tracking entry is unavailable or expired.');
        const activated = await api(
          record.endpoint,
          `/v1/trackings/${record.id}/activate`,
          record.deleteToken,
          'POST',
        );
        if (
          activated.ok !== true ||
          typeof activated.armedAt !== 'number' ||
          !Number.isSafeInteger(activated.armedAt) ||
          activated.armedAt < record.createdAt ||
          activated.armedAt > now() + 60_000
        )
          throw new Error('The Worker could not confirm activation. Refresh or try again.');
        await database.put({ ...record, armedAt: activated.armedAt });
        return { ok: true, data: null };
      }
      if (m.type === 'tracking-refresh') {
        if (!(await config()))
          throw new Error('Reconnect your tracking Worker in Settings before refreshing.');
        for (const record of (await database.read()).filter(
          (r) => r.accountId === accountId && r.expiresAt > now() && r.armedAt !== null,
        )) {
          const result = await api(record.endpoint, `/v1/trackings/${record.id}`, record.readToken);
          const timestamp = (v: unknown) =>
            v === null ||
            (typeof v === 'number' &&
              Number.isSafeInteger(v) &&
              v >= record.createdAt &&
              v <= now() + 60_000);
          if (
            result.id !== record.id ||
            !timestamp(result.firstOpenedAt) ||
            !timestamp(result.lastOpenedAt) ||
            typeof result.openCount !== 'number' ||
            !Number.isSafeInteger(result.openCount) ||
            result.openCount < 0 ||
            result.openCount > 1000 ||
            (result.openCount === 0) !== (result.firstOpenedAt === null) ||
            (result.firstOpenedAt === null) !== (result.lastOpenedAt === null) ||
            (typeof result.firstOpenedAt === 'number' &&
              typeof result.lastOpenedAt === 'number' &&
              result.lastOpenedAt < result.firstOpenedAt)
          )
            throw new Error(
              'The tracking Worker returned an invalid event. Existing history was preserved.',
            );
          await database.put({
            ...record,
            firstOpenedAt: result.firstOpenedAt as number | null,
            lastOpenedAt: result.lastOpenedAt as number | null,
            openCount: result.openCount,
          });
        }
        return { ok: true, data: await snapshot(accountId) };
      }
      throw new Error('This tracking action is unavailable.');
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Tracking is temporarily unavailable. Try again.',
      };
    }
  }
  return {
    handle(message: unknown, sender: MessageSender) {
      const next = queue.then(() => handleInternal(message, sender));
      queue = next.catch(() => undefined);
      return next;
    },
    clearLocal() {
      const next = queue.then(async () => {
        await platform.setConfig(null);
        await database.clear();
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
