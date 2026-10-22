import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { classificationClient } from '../../src/features/classification/client';
import { useAutomaticClassification } from '../../src/features/classification/useAutomaticClassification';
import type { ConversationRef } from '../../src/types/model';
vi.mock('../../src/features/classification/client', () => ({
  classificationClient: { automatic: vi.fn(async () => null) },
}));
const listeners = new Set<
  (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
>();
const ref: ConversationRef = {
  accountId: 'a@example.com',
  threadId: '1234567890abcdef',
  title: 'Project review',
  url: 'https://mail.google.com/mail/?authuser=a@example.com#all/1234567890abcdef',
};
beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: {
        addListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.add(fn),
        removeListener: (fn: typeof listeners extends Set<infer T> ? T : never) =>
          listeners.delete(fn),
      },
    },
  });
});
it('does nothing in unsupported contexts or when enhancements are disabled', () => {
  const { rerender, unmount } = renderHook(
    ({ current, enabled }) => useAutomaticClassification(current, enabled),
    { initialProps: { current: null as ConversationRef | null, enabled: true } },
  );
  rerender({ current: ref, enabled: false });
  expect(classificationClient.automatic).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
  unmount();
});
it('responds once per opened conversation, not every storage revision, and cleans up on account switches', () => {
  const { rerender, unmount } = renderHook(
    ({ current }) => useAutomaticClassification(current, true),
    { initialProps: { current: ref } },
  );
  expect(classificationClient.automatic).toHaveBeenCalledExactlyOnceWith(ref);
  rerender({ current: { ...ref } });
  act(() => listeners.forEach((fn) => fn({ revision: { newValue: 'changed' } }, 'local')));
  expect(classificationClient.automatic).toHaveBeenCalledTimes(1);
  act(() =>
    listeners.forEach((fn) =>
      fn({ classificationPreferences: { newValue: { enabled: true, automatic: true } } }, 'local'),
    ),
  );
  expect(classificationClient.automatic).toHaveBeenCalledTimes(2);
  const other = {
    ...ref,
    accountId: 'b@example.com',
    url: ref.url.replace('a@example.com', 'b@example.com'),
  };
  rerender({ current: other });
  expect(classificationClient.automatic).toHaveBeenLastCalledWith(other);
  expect(listeners.size).toBe(1);
  unmount();
  expect(listeners.size).toBe(0);
});
it('keeps Gmail usable after a failed automatic request', async () => {
  vi.mocked(classificationClient.automatic).mockRejectedValueOnce(new Error('Offline'));
  const { unmount } = renderHook(() => useAutomaticClassification(ref, true));
  await act(async () => {
    await Promise.resolve();
  });
  expect(classificationClient.automatic).toHaveBeenCalledTimes(1);
  unmount();
});
