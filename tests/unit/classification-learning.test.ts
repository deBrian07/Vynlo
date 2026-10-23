import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { createClassificationService } from '../../src/features/classification/service';
import {
  buildDecisionContext,
  confirmedExamples,
  validDecisionContext,
} from '../../src/features/classification/decision-context';
import {
  CATEGORY_IDS,
  type Prediction,
  type UserCategory,
} from '../../src/features/classification/model';
import { VynloDatabase } from '../../src/services/storage/database';
import type { ConversationRef } from '../../src/types/model';
const sender = { id: 'test', url: 'chrome-extension://test/options.html' };
const ref: ConversationRef = {
  accountId: 'a@example.com',
  threadId: '1234567890abcdef',
  title: 'Robotics practice',
  url: 'https://mail.google.com/mail/?authuser=a%40example.com#all/1234567890abcdef',
};
async function fixture() {
  const db = new VynloDatabase(crypto.randomUUID(), new IDBFactory());
  const infer = vi.fn();
  const service = createClassificationService({
    database: db,
    platform: {
      extensionId: 'test',
      getPreferences: async () => ({ enabled: true, automatic: true }),
      setPreferences: async () => {},
      hasPermission: async () => true,
      isEnhancementEnabled: async () => true,
      publishRevision: async () => {},
      openTab: async () => {},
      infer,
    },
  });
  const send = (message: unknown) => service.handle(message, sender);
  const response = await send({
    type: 'classify-save-category',
    accountId: ref.accountId,
    name: 'Robotics',
    description: 'Robot club practice and competition',
  });
  if (!response.ok) throw new Error(response.error);
  return { db, infer, send, category: response.data as UserCategory };
}
describe('personal category learning', () => {
  it('creates categories without AI and rejects foreign or deleted category assignments', async () => {
    const f = await fixture();
    try {
      expect(
        (
          await f.send({
            type: 'classify-set',
            ref: { ...ref, accountId: 'b@example.com', url: ref.url.replace('a%40', 'b%40') },
            category: f.category.id,
          })
        ).ok,
      ).toBe(false);
      expect((await f.send({ type: 'classify-set', ref, category: f.category.id })).ok).toBe(true);
      await f.send({
        type: 'classify-delete-category',
        accountId: ref.accountId,
        id: f.category.id,
      });
      expect((await f.db.read(ref.accountId)).emailTags).toHaveLength(0);
      expect((await f.send({ type: 'classify-set', ref, category: f.category.id })).ok).toBe(false);
      expect(f.infer).not.toHaveBeenCalled();
    } finally {
      await f.db.close();
    }
  });
  it('requires three distinct manual examples before automatic custom tagging', async () => {
    const f = await fixture();
    try {
      const ids = [...CATEGORY_IDS, f.category.id];
      f.infer.mockResolvedValue({
        category: f.category.id,
        probabilities: Object.fromEntries(
          ids.map((id) => [id, id === f.category.id ? 1 : 0]),
        ) as Prediction['probabilities'],
        confidence: 1,
        needsReview: false,
      } satisfies Prediction);
      expect(await f.send({ type: 'classify-automatic', ref })).toEqual({ ok: true, data: null });
      for (let i = 0; i < 3; i++)
        await f.send({
          type: 'classify-set',
          ref: {
            ...ref,
            threadId: `1234567890abcde${i}`,
            url: ref.url.replace(ref.threadId, `1234567890abcde${i}`),
            title: `Robot competition ${i}`,
          },
          category: f.category.id,
        });
      const result = await f.send({ type: 'classify-automatic', ref });
      expect(result.ok && result.data).toMatchObject({
        category: f.category.id,
        source: 'model',
        reviewed: false,
      });
      const snapshot = await f.db.read(ref.accountId);
      expect(confirmedExamples(snapshot.emailTags, ref.accountId, f.category.id)).toHaveLength(3);
      const context = f.infer.mock.calls.at(-1)?.[1];
      expect(validDecisionContext(context)).toBe(true);
      expect(context.categories.at(-1).examples).toHaveLength(2);
      expect(
        buildDecisionContext(
          'b@example.com',
          ref.title,
          ref.threadId,
          snapshot.categories!,
          snapshot.emailTags,
        ),
      ).toBeUndefined();
    } finally {
      await f.db.close();
    }
  });
  it('deduplicates subjects and never learns from model suggestions', async () => {
    const f = await fixture();
    try {
      for (let i = 0; i < 3; i++)
        await f.send({
          type: 'classify-set',
          ref: {
            ...ref,
            threadId: `1234567890abcde${i}`,
            url: ref.url.replace(ref.threadId, `1234567890abcde${i}`),
            title: i ? ' Robot  club ' : 'robot club',
          },
          category: f.category.id,
        });
      const snapshot = await f.db.read(ref.accountId);
      expect(confirmedExamples(snapshot.emailTags, ref.accountId, f.category.id)).toHaveLength(1);
      expect(
        confirmedExamples(
          snapshot.emailTags.map((t) => ({ ...t, source: 'model', reviewed: false })),
          ref.accountId,
          f.category.id,
        ),
      ).toHaveLength(0);
    } finally {
      await f.db.close();
    }
  });
});

it('rejects malformed or cross-taxonomy runtime contexts', () => {
  const categories = CATEGORY_IDS.map((id) => ({ id, name: id, description: '', examples: [] }));
  expect(validDecisionContext({ categories })).toBe(true);
  expect(validDecisionContext({ categories: [...categories].reverse() })).toBe(false);
  expect(validDecisionContext({ categories: [...categories, { ...categories[0] }] })).toBe(false);
  expect(
    validDecisionContext({ categories: categories.map((c) => ({ ...c, examples: ['x', 'y'] })) }),
  ).toBe(false);
});

it('cancels in-flight predictions after a category changes', async () => {
  const f = await fixture();
  try {
    let resolve!: (value: Prediction) => void;
    f.infer.mockImplementation(
      () =>
        new Promise<Prediction>((done) => {
          resolve = done;
        }),
    );
    const pending = f.send({ type: 'classify-suggest', ref });
    await vi.waitFor(() => expect(f.infer).toHaveBeenCalled());
    await f.send({ type: 'classify-delete-category', accountId: ref.accountId, id: f.category.id });
    resolve({
      category: f.category.id,
      probabilities: Object.fromEntries(
        [...CATEGORY_IDS, f.category.id].map((id) => [id, id === f.category.id ? 1 : 0]),
      ) as Prediction['probabilities'],
      confidence: 1,
      needsReview: false,
    });
    expect(await pending).toEqual({ ok: true, data: null });
    expect((await f.db.read(ref.accountId)).emailTags).toHaveLength(0);
  } finally {
    await f.db.close();
  }
});
