import { describe, expect, it } from 'vitest';
import { threadControlPosition } from '../../src/features/conversations/ThreadControl';

describe('thread control placement', () => {
  it('sits under the toolbar and stays inside the viewport', () => {
    expect(threadControlPosition({ bottom: 120, right: 900 }, 1440)).toEqual({
      top: 128,
      left: 720,
    });
    expect(threadControlPosition({ bottom: 0, right: 40 }, 300).left).toBe(8);
    expect(threadControlPosition({ bottom: 40, right: 2000 }, 360).left).toBe(172);
  });
});
