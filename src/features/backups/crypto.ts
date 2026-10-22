import { isAccountId, validBackup } from '../../services/validation';
import type { EncryptedBackup, FullBackup } from './types';

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_ENVELOPE_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const hex = (v: Uint8Array) => Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('');
const token = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const time = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000;
const optionalTime = (v: unknown) => v === null || time(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((key) => allowed.includes(key));

export function workerEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter the HTTPS Worker URL from setup.');
  }
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Use your HTTPS workers.dev URL without a path.');
  return url.origin;
}
function endpoint(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try {
    return workerEndpoint(v) === v;
  } catch {
    return false;
  }
}
export function validFullBackup(v: unknown): v is FullBackup {
  if (
    !object(v) ||
    v.format !== 'vynlo-workspace-backup' ||
    v.version !== 1 ||
    !keys(v, ['format', 'version', 'workspace', 'addons']) ||
    !validBackup(v.workspace)
  )
    return false;
  if (v.addons === undefined) return true;
  if (!object(v.addons) || !keys(v.addons, ['openTracking'])) return false;
  const tracking = v.addons.openTracking;
  if (tracking === undefined) return true;
  if (
    !object(tracking) ||
    !keys(tracking, ['records', 'connection']) ||
    !Array.isArray(tracking.records) ||
    tracking.records.length > 20000
  )
    return false;
  const seen = new Set<string>();
  for (const r of tracking.records) {
    if (
      !object(r) ||
      !keys(r, [
        'id',
        'accountId',
        'label',
        'createdAt',
        'expiresAt',
        'firstOpenedAt',
        'lastOpenedAt',
        'openCount',
        'armedAt',
        'endpoint',
        'readToken',
        'deleteToken',
      ]) ||
      !token(r.id) ||
      seen.has(r.id) ||
      !isAccountId(r.accountId) ||
      typeof r.label !== 'string' ||
      r.label.length > 120 ||
      !endpoint(r.endpoint) ||
      !token(r.readToken) ||
      !token(r.deleteToken) ||
      !time(r.createdAt) ||
      !time(r.expiresAt) ||
      r.expiresAt < r.createdAt ||
      !optionalTime(r.firstOpenedAt) ||
      !optionalTime(r.lastOpenedAt) ||
      !optionalTime(r.armedAt) ||
      !Number.isInteger(r.openCount) ||
      Number(r.openCount) < 0 ||
      Number(r.openCount) > 1000
    )
      return false;
    if (
      (r.openCount === 0) !== (r.firstOpenedAt === null) ||
      (r.firstOpenedAt === null) !== (r.lastOpenedAt === null) ||
      (typeof r.firstOpenedAt === 'number' && r.firstOpenedAt < r.createdAt) ||
      (typeof r.lastOpenedAt === 'number' &&
        typeof r.firstOpenedAt === 'number' &&
        r.lastOpenedAt < r.firstOpenedAt) ||
      (typeof r.armedAt === 'number' && r.armedAt < r.createdAt)
    )
      return false;
    seen.add(r.id);
  }
  const connection = tracking.connection;
  return (
    connection === undefined ||
    (object(connection) &&
      keys(connection, ['endpoint', 'secret']) &&
      endpoint(connection.endpoint) &&
      typeof connection.secret === 'string' &&
      /^[a-zA-Z0-9_-]{32,256}$/.test(connection.secret))
  );
}
function base64(bytes: Uint8Array): string {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 16384)
    result += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(result);
}
function decode(value: unknown, max: number): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(max / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new Error('Invalid encrypted backup.');
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length > max || base64(bytes) !== value) throw new Error('Invalid encrypted backup.');
  return bytes;
}
export function validEncryptedBackup(v: unknown): v is EncryptedBackup {
  try {
    if (
      !object(v) ||
      !keys(v, ['format', 'version', 'algorithm', 'iv', 'ciphertext', 'kdf']) ||
      v.format !== 'vynlo-encrypted-backup' ||
      v.version !== 1 ||
      v.algorithm !== 'AES-GCM' ||
      decode(v.iv, 12).length !== 12 ||
      decode(v.ciphertext, MAX_BACKUP_BYTES + 16).length < 16
    )
      return false;
    if (v.kdf === undefined) return true;
    return (
      object(v.kdf) &&
      keys(v.kdf, ['algorithm', 'iterations', 'salt']) &&
      v.kdf.algorithm === 'PBKDF2' &&
      v.kdf.iterations === 600000 &&
      decode(v.kdf.salt, 16).length === 16
    );
  } catch {
    return false;
  }
}
export function generateSecret(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}
export async function deriveVault(
  secret: string,
): Promise<{ key: CryptoKey; vaultId: string; token: string }> {
  if (!token(secret)) throw new Error('Invalid recovery key.');
  const input = Uint8Array.from(secret.match(/../g)!, (v) => parseInt(v, 16));
  const master = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveBits']);
  const derive = async (purpose: string) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: encoder.encode('vynlo-backup-v1'),
          info: encoder.encode(purpose),
        },
        master,
        256,
      ),
    );
  const [rawKey, vaultId, auth] = await Promise.all([
    derive('encryption'),
    derive('vault-id'),
    derive('authorization'),
  ]);
  return {
    key: await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']),
    vaultId: hex(vaultId),
    token: hex(auth),
  };
}
export async function validRecoveryKit(v: unknown): Promise<boolean> {
  if (
    !object(v) ||
    !keys(v, ['format', 'version', 'endpoint', 'vaultId', 'secret']) ||
    v.format !== 'vynlo-recovery-kit' ||
    v.version !== 1 ||
    !endpoint(v.endpoint) ||
    !token(v.vaultId) ||
    !token(v.secret)
  )
    return false;
  return (await deriveVault(v.secret)).vaultId === v.vaultId;
}
const aad = (envelope: EncryptedBackup) =>
  encoder.encode(
    JSON.stringify({
      format: envelope.format,
      version: envelope.version,
      algorithm: envelope.algorithm,
      ...(envelope.kdf
        ? {
            kdf: {
              algorithm: envelope.kdf.algorithm,
              iterations: envelope.kdf.iterations,
              salt: envelope.kdf.salt,
            },
          }
        : {}),
    }),
  );
async function encrypt(
  document: FullBackup,
  key: CryptoKey,
  kdf?: EncryptedBackup['kdf'],
): Promise<EncryptedBackup> {
  if (!validFullBackup(document)) throw new Error('Invalid workspace backup.');
  const plaintext = encoder.encode(JSON.stringify(document));
  if (plaintext.length > MAX_BACKUP_BYTES)
    throw new Error('Workspace backup exceeds the 10 MB limit.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const envelope: EncryptedBackup = {
    format: 'vynlo-encrypted-backup',
    version: 1,
    algorithm: 'AES-GCM',
    iv: base64(iv),
    ciphertext: '',
    ...(kdf ? { kdf } : {}),
  };
  envelope.ciphertext = base64(
    new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(envelope) },
        key,
        plaintext,
      ),
    ),
  );
  return envelope;
}
async function decrypt(envelope: EncryptedBackup, key: CryptoKey): Promise<FullBackup> {
  try {
    const bytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(envelope.iv, 12), additionalData: aad(envelope) },
      key,
      decode(envelope.ciphertext, MAX_BACKUP_BYTES + 16),
    );
    const document: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!validFullBackup(document)) throw new Error();
    return document;
  } catch {
    throw new Error('Could not unlock this backup. Check your recovery key or password.');
  }
}
export async function encryptBackup(
  document: FullBackup,
  secret: string,
): Promise<EncryptedBackup> {
  return encrypt(document, (await deriveVault(secret)).key);
}
export async function decryptBackup(
  envelope: EncryptedBackup,
  secret: string,
): Promise<FullBackup> {
  if (!validEncryptedBackup(envelope) || envelope.kdf) throw new Error('Invalid cloud backup.');
  return decrypt(envelope, (await deriveVault(secret)).key);
}
async function localKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024)
    throw new Error('Use a password of 12 to 1024 characters.');
  const input = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt },
    input,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptLocal(
  document: FullBackup,
  passphrase: string,
): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return encrypt(document, await localKey(passphrase, salt), {
    algorithm: 'PBKDF2',
    iterations: 600000,
    salt: base64(salt),
  });
}
export async function decryptLocal(
  envelope: EncryptedBackup,
  passphrase: string,
): Promise<FullBackup> {
  if (!validEncryptedBackup(envelope) || !envelope.kdf)
    throw new Error('Invalid encrypted backup file.');
  return decrypt(envelope, await localKey(passphrase, decode(envelope.kdf.salt, 16)));
}
