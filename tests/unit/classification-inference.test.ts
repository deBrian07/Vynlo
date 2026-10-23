import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS, MODEL, type Category } from '../../src/features/classification/model';
import { parsePrediction } from '../../src/features/classification/inference';

const scores = (category: Category, top: number) =>
  Object.fromEntries(CATEGORY_IDS.map((id) => [id, id === category ? top : (1 - top) / 7]));
const prediction = (category: Category = 'work', top = 0.93) => ({
  model: MODEL,
  answers: {
    category: {
      type: 'choice',
      choice: category,
      probabilities: scores(category, top),
      confidence: top,
    },
  },
});

describe('local classifier decision validation', () => {
  it('accepts normalized category scores and marks suggestions for review', () => {
    expect(parsePrediction(prediction())).toMatchObject({
      category: 'work',
      confidence: 0.93,
      needsReview: false,
    });
    expect(parsePrediction(prediction('other', 0.99)).needsReview).toBe(true);
  });

  it('marks low-margin decisions for review', () => {
    expect(parsePrediction(prediction('work', 0.4)).needsReview).toBe(true);
  });

  it.each([
    null,
    {},
    { ...prediction(), model: 'different-model' },
    { ...prediction(), answers: { category: { type: 'text', choice: 'work' } } },
    {
      ...prediction(),
      answers: { category: { ...prediction().answers.category, choice: 'unknown' } },
    },
    {
      ...prediction(),
      answers: {
        category: {
          ...prediction().answers.category,
          probabilities: { ...scores('work', 0.93), finance: Number.NaN },
        },
      },
    },
    {
      ...prediction(),
      answers: {
        category: {
          ...prediction().answers.category,
          probabilities: scores('finance', 0.93),
        },
      },
    },
  ])('rejects malformed decision data: %j', (value) => {
    expect(() => parsePrediction(value)).toThrow(/unsupported decision/);
  });
});
