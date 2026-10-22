import { beforeEach, expect, it, vi } from 'vitest';
import { classificationClient } from '../../src/features/classification/client';
const send = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
});
it('rejects malformed responses rather than exposing undefined state to React', async () => {
  for (const data of [
    undefined,
    null,
    {},
    { model: 'tev1:0.8b', enabled: false, automatic: true, permission: true },
  ]) {
    send.mockResolvedValueOnce({ ok: true, data });
    await expect(classificationClient.status()).rejects.toThrow('unexpected response');
  }
});
it('rejects a valid tag response from a different account', async () => {
  const ref = {
    accountId: 'a@example.com',
    threadId: '1234567890abcdef',
    title: 'Project',
    url: 'https://mail.google.com/mail/?authuser=a@example.com#all/1234567890abcdef',
  };
  send.mockResolvedValue({
    ok: true,
    data: {
      ...ref,
      accountId: 'b@example.com',
      id: 'b@example.com:1234567890abcdef',
      url: ref.url.replace('a@example.com', 'b@example.com'),
      category: 'work',
      source: 'manual',
      reviewed: true,
      createdAt: 1,
      updatedAt: 1,
    },
  });
  await expect(classificationClient.set(ref, 'work')).rejects.toThrow('unexpected response');
});
it('reports connection failures and deliberate worker errors safely', async () => {
  send.mockRejectedValueOnce(new Error('internal stack'));
  await expect(classificationClient.status()).rejects.toThrow('could not connect');
  send.mockResolvedValueOnce({ ok: false, error: 'Choose a tag manually.' });
  await expect(classificationClient.status()).rejects.toThrow('Choose a tag manually.');
});
