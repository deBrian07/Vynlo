import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionMessages } from '../../src/features/classification/decision-prompt';
import { buildBenchmarkDecisionMessages } from '../browser-ai/prompt-candidates';

const mocks = vi.hoisted(() => ({
  options: undefined as { buildMessages: (subject: string) => DecisionMessages } | undefined,
  infer: vi.fn<(subject: string) => Promise<unknown>>(),
  status: vi.fn(async () => ({ state: 'ready' })),
}));
vi.mock('../../src/features/classification/browser/engine', () => ({
  createBrowserEngine: (options: NonNullable<typeof mocks.options>) => {
    mocks.options = options;
    return { infer: mocks.infer, status: mocks.status };
  },
}));

let receive: (event: MessageEvent<unknown>) => void;
const postMessage = vi.fn();
const send = (data: unknown) => receive(new MessageEvent('message', { data }));

beforeEach(async () => {
  vi.resetModules();
  mocks.options = undefined;
  mocks.infer.mockReset();
  mocks.status.mockClear();
  postMessage.mockClear();
  vi.stubGlobal('self', {
    postMessage,
    addEventListener: (type: string, listener: typeof receive) => {
      if (type === 'message') receive = listener;
    },
  });
  await import('../browser-ai/worker');
});
afterEach(() => vi.unstubAllGlobals());

describe('benchmark worker prompt isolation', () => {
  it('rejects overlapping inference without changing the active request prompt', async () => {
    let finish!: (prediction: unknown) => void;
    mocks.infer.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const first = {
      id: 'first',
      type: 'infer',
      subject: 'First subject',
      promptVariant: 'clear-boundaries',
    };
    send(first);
    expect(mocks.infer).toHaveBeenCalledExactlyOnceWith(first.subject);
    send({
      id: 'overlapping',
      type: 'infer',
      subject: 'Second subject',
      promptVariant: 'clear-boundaries-defended',
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'overlapping', ok: false }),
      ),
    );
    expect(mocks.infer).toHaveBeenCalledOnce();
    expect(mocks.options!.buildMessages(first.subject)).toEqual(
      buildBenchmarkDecisionMessages(first.subject, 'clear-boundaries'),
    );
    const prediction = { category: 'work' };
    finish(prediction);
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({
        id: 'first',
        ok: true,
        data: { prediction, status: { state: 'ready' }, promptVariant: 'clear-boundaries' },
      }),
    );

    mocks.infer.mockResolvedValueOnce(prediction);
    send({ ...first, id: 'next', promptVariant: 'clear-boundaries-defended' });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'next',
          ok: true,
          data: expect.objectContaining({ promptVariant: 'clear-boundaries-defended' }),
        }),
      ),
    );
    expect(mocks.infer).toHaveBeenCalledTimes(2);
    expect(mocks.options!.buildMessages(first.subject)).toEqual(
      buildBenchmarkDecisionMessages(first.subject, 'clear-boundaries-defended'),
    );
  });

  it('rejects an unknown prompt before model execution', async () => {
    send({ id: 'invalid', type: 'infer', subject: 'A subject', promptVariant: 'user-supplied' });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({
        id: 'invalid',
        ok: false,
        error: 'Unknown benchmark prompt.',
      }),
    );
    expect(mocks.infer).not.toHaveBeenCalled();
  });

  it('releases the request lock after inference fails', async () => {
    mocks.infer.mockRejectedValueOnce(new Error('Synthetic runtime failure'));
    send({ id: 'failed', type: 'infer', subject: 'A subject', promptVariant: 'baseline' });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({
        id: 'failed',
        ok: false,
        error: 'Synthetic runtime failure',
      }),
    );
    mocks.infer.mockResolvedValueOnce({ category: 'work' });
    send({ id: 'retry', type: 'infer', subject: 'A subject', promptVariant: 'baseline' });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'retry', ok: true })),
    );
    expect(mocks.infer).toHaveBeenCalledTimes(2);
  });
});
