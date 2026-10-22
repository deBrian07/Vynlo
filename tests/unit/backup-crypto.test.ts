// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/types/model';
import type { FullBackup, RecoveryTrackingRecord } from '../../src/features/backups/types';
import {
  decryptBackup,
  decryptLocal,
  deriveVault,
  encryptBackup,
  encryptLocal,
  generateSecret,
  validEncryptedBackup,
  validFullBackup,
  validRecoveryKit,
  workerEndpoint,
} from '../../src/features/backups/crypto';

const document = (): FullBackup => ({
  format: 'vynlo-workspace-backup',
  version: 1,
  workspace: {
    schemaVersion: 1,
    exportedAt: 1,
    accounts: [],
    conversations: [],
    contacts: [],
    reminders: [],
    snippets: [
      {
        id: 'snippet',
        title: 'Private title',
        content: 'Private email content 🌿',
        category: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    settings: structuredClone(DEFAULT_SETTINGS),
  },
});
const record = (): RecoveryTrackingRecord => ({
  id: '1'.repeat(64),
  accountId: 'a@example.com',
  label: 'Private label',
  createdAt: 1,
  expiresAt: 100,
  firstOpenedAt: null,
  lastOpenedAt: null,
  openCount: 0,
  armedAt: null,
  endpoint: 'https://vynlo.example.workers.dev',
  readToken: '2'.repeat(64),
  deleteToken: '3'.repeat(64),
});
describe('encrypted workspace backups', () => {
  it('derives stable independent capabilities and a nonexportable AES key', async () => {
    const secret = generateSecret();
    const a = await deriveVault(secret);
    const b = await deriveVault(secret);
    expect(a.vaultId).toBe(b.vaultId);
    expect(a.token).toBe(b.token);
    expect(new Set([secret, a.token, a.vaultId]).size).toBe(3);
    expect(a.key.extractable).toBe(false);
    expect(a.key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', a.key)).rejects.toThrow();
    await expect(deriveVault('not a secret')).rejects.toThrow('Invalid recovery key');
  });
  it('roundtrips complete data and private tracking capabilities without plaintext disclosure', async () => {
    const original = document();
    original.addons = {
      openTracking: {
        records: [record()],
        connection: { endpoint: record().endpoint, secret: '4'.repeat(64) },
      },
    };
    const secret = generateSecret();
    const encrypted = await encryptBackup(original, secret);
    expect(validEncryptedBackup(encrypted)).toBe(true);
    expect(await decryptBackup(encrypted, secret)).toEqual(original);
    for (const sensitive of [
      'Private title',
      'Private email content',
      'Private label',
      record().readToken,
      secret,
    ])
      expect(JSON.stringify(encrypted)).not.toContain(sensitive);
    const second = await encryptBackup(original, secret);
    expect(second.iv).not.toBe(encrypted.iv);
    expect(second.ciphertext).not.toBe(encrypted.ciphertext);
  });
  it('rejects wrong keys, corruption, noncanonical encoding and mutated headers', async () => {
    const secret = generateSecret();
    const envelope = await encryptBackup(document(), secret);
    await expect(decryptBackup(envelope, generateSecret())).rejects.toThrow('Could not unlock');
    const bytes = Uint8Array.from(atob(envelope.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] = bytes[0]! ^ 1;
    const corrupted = { ...envelope, ciphertext: btoa(String.fromCharCode(...bytes)) };
    await expect(decryptBackup(corrupted, secret)).rejects.toThrow('Could not unlock');
    for (const mutation of [
      { ...envelope, version: 2 },
      { ...envelope, format: 'other' },
      { ...envelope, algorithm: 'AES-CBC' },
      { ...envelope, iv: 'AAAA' },
      { ...envelope, ciphertext: envelope.ciphertext + '\n' },
      { ...envelope, secret },
      { ...envelope, ciphertext: 'A'.repeat(16 * 1024 * 1024) },
    ])
      expect(validEncryptedBackup(mutation)).toBe(false);
  });
  it('encrypts portable files with a salted password KDF and rejects wrong passwords', async () => {
    const original = document();
    const password = '  correct horse battery  ';
    const a = await encryptLocal(original, password);
    const b = await encryptLocal(original, password);
    expect(a.kdf?.iterations).toBe(600000);
    expect(a.kdf?.salt).not.toBe(b.kdf?.salt);
    expect(await decryptLocal(a, password)).toEqual(original);
    expect(
      await decryptLocal(
        { ...a, kdf: { salt: a.kdf!.salt, iterations: 600000, algorithm: 'PBKDF2' } },
        password,
      ),
    ).toEqual(original);
    await expect(decryptLocal(a, password.trim())).rejects.toThrow('Could not unlock');
    await expect(decryptBackup(a, generateSecret())).rejects.toThrow('Invalid cloud');
    await expect(encryptLocal(original, 'short')).rejects.toThrow('12 to 1024');
    const tampered = structuredClone(a);
    tampered.kdf!.iterations = 1 as 600000;
    expect(validEncryptedBackup(tampered)).toBe(false);
    const salt = Uint8Array.from(atob(a.kdf!.salt), (c) => c.charCodeAt(0));
    salt[0] = salt[0]! ^ 1;
    tampered.kdf = { ...a.kdf!, salt: btoa(String.fromCharCode(...salt)) };
    await expect(decryptLocal(tampered, password)).rejects.toThrow('Could not unlock');
  });
  it('checks recovery kit binding and limits the remote endpoint', async () => {
    const secret = generateSecret();
    const { vaultId } = await deriveVault(secret);
    const kit = {
      format: 'vynlo-recovery-kit',
      version: 1,
      endpoint: record().endpoint,
      vaultId,
      secret,
    };
    expect(await validRecoveryKit(kit)).toBe(true);
    expect(await validRecoveryKit({ ...kit, vaultId: '0'.repeat(64) })).toBe(false);
    expect(await validRecoveryKit({ ...kit, endpoint: 'https://evil.example' })).toBe(false);
    expect(workerEndpoint(record().endpoint + '/')).toBe(record().endpoint);
    for (const endpoint of [
      'http://vynlo.example.workers.dev',
      'https://vynlo.example.workers.dev/path',
      'https://vynlo.example.workers.dev?secret=1',
      'https://user@vynlo.example.workers.dev',
      'https://evil.example',
    ])
      expect(() => workerEndpoint(endpoint)).toThrow();
  });
  it('handles large ciphertext without recursive decoding and enforces the plaintext size limit', async () => {
    const original = document();
    original.workspace.snippets[0]!.content = 'x'.repeat(100000);
    original.workspace.snippets = Array.from({ length: 5 }, (_, index) => ({
      ...original.workspace.snippets[0]!,
      id: String(index),
    }));
    const secret = generateSecret();
    const envelope = await encryptBackup(original, secret);
    expect(validEncryptedBackup(envelope)).toBe(true);
    expect(await decryptBackup(envelope, secret)).toEqual(original);
    original.workspace.snippets = Array.from({ length: 106 }, (_, index) => ({
      ...original.workspace.snippets[0]!,
      id: String(index),
    }));
    await expect(encryptBackup(original, secret)).rejects.toThrow('10 MB');
  });
  it('validates versioned workspace and tracking records before accepting recovery', () => {
    expect(validFullBackup(document())).toBe(true);
    expect(validFullBackup({ ...document(), version: 2 })).toBe(false);
    const withRecord = (value: unknown) => ({
      ...document(),
      addons: { openTracking: { records: [value] } },
    });
    expect(validFullBackup(withRecord(record()))).toBe(true);
    for (const change of [
      { accountId: 'A@example.com' },
      { openCount: 1001 },
      { openCount: -1 },
      { openCount: 0.5 },
      { readToken: 'bad' },
      { label: 'a'.repeat(121) },
      { endpoint: 'https://evil.test' },
      { expiresAt: 0 },
      { createdAt: Infinity },
      { lastOpenedAt: 'today' },
      { armedAt: undefined },
      { surprise: true },
    ])
      expect(validFullBackup(withRecord({ ...record(), ...change }))).toBe(false);
    expect(
      validFullBackup({
        ...document(),
        addons: { openTracking: { records: [record(), record()] } },
      }),
    ).toBe(false);
  });
});
