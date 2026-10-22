import { describe, expect, it } from 'vitest';
import fixtureJson from '../fixtures/classification-eval.json';
import {
  precisionLowerBound,
  summarizeEvaluation,
  validateFixture,
  type EvaluationOutcome,
} from '../../scripts/evaluate-classifier';
import {
  CATEGORY_IDS,
  type Category,
  type Prediction,
} from '../../src/features/classification/model';

const fixture = validateFixture(fixtureJson);
function prediction(category: Category, needsReview = category === 'other'): Prediction {
  return {
    category,
    probabilities: Object.fromEntries(
      CATEGORY_IDS.map((id) => [id, id === category ? 1 : 0]),
    ) as Record<Category, number>,
    confidence: 1,
    needsReview,
  };
}
const perfectOutcomes = (): EvaluationOutcome[] =>
  fixture.examples.map((example, i) => ({
    id: example.id,
    prediction: prediction(example.acceptable[0]!),
    latencyMs: i === 0 ? 800 : 100,
  }));

describe('classification evaluation fixture', () => {
  it('contains 96 balanced ordinary subjects plus 24 ambiguity and injection cases', () => {
    expect(fixture.examples).toHaveLength(120);
    for (const category of CATEGORY_IDS) {
      expect(
        fixture.examples.filter(
          (entry) => entry.group === 'straightforward' && entry.acceptable[0] === category,
        ),
      ).toHaveLength(12);
    }
    expect(fixture.examples.filter((entry) => entry.group === 'ambiguous')).toHaveLength(12);
    expect(fixture.examples.filter((entry) => entry.group === 'adversarial')).toHaveLength(12);
    expect(
      fixture.examples.every(
        (entry) => entry.group === 'straightforward' || entry.acceptable.includes('other'),
      ),
    ).toBe(true);
  });
  it('rejects duplicate examples, unsupported categories and overlong subjects', () => {
    const first = fixture.examples[0]!;
    expect(() => validateFixture({ ...fixture, examples: [first, first] })).toThrow('duplicate');
    expect(() =>
      validateFixture({ ...fixture, examples: [{ ...first, acceptable: ['spam'] }] }),
    ).toThrow('Invalid');
    expect(() =>
      validateFixture({ ...fixture, examples: [{ ...first, subject: 'x'.repeat(501) }] }),
    ).toThrow('500');
    expect(() =>
      validateFixture({ ...fixture, examples: [{ ...first, acceptable: ['work', 'other'] }] }),
    ).toThrow('Invalid');
    expect(() => validateFixture({ ...fixture, examples: [] })).toThrow('Invalid');
  });
});

describe('classification evaluation metrics', () => {
  it('counts accuracy, per-category F1, acceptance precision and warm request latency independently', () => {
    const report = summarizeEvaluation(fixture.examples, perfectOutcomes());
    expect(report.straightforward.accuracy).toBe(1);
    expect(report.straightforward.macroF1).toBe(1);
    expect(report.acceptance.precision).toBe(1);
    expect(report.acceptance.coverage).toBeLessThan(1);
    expect(report.latency).toEqual({
      firstRequestMs: 800,
      remainingMedianMs: 100,
      remainingP95Ms: 100,
    });
    expect(report.gate.passed).toBe(true);
  });
  it('counts wrong high-score predictions instead of treating confidence as correctness', () => {
    const outcomes = perfectOutcomes();
    const work = fixture.examples.findIndex((entry) => entry.acceptable[0] === 'work');
    outcomes[work] = { ...outcomes[work]!, prediction: prediction('finance', false) };
    const report = summarizeEvaluation(fixture.examples, outcomes);
    expect(report.straightforward.confusion.work.finance).toBe(1);
    expect(report.straightforward.perCategory.work.recall).toBe(11 / 12);
    expect(report.straightforward.perCategory.finance.precision).toBe(12 / 13);
    expect(report.acceptance.precision).toBeLessThan(1);
    expect(report.gate.checks.precisionEvidence).toBe(false);
  });
  it('does not let abstaining on every example pass the gate', () => {
    const outcomes = perfectOutcomes().map((entry) => ({
      ...entry,
      prediction: { ...entry.prediction!, needsReview: true },
    }));
    const report = summarizeEvaluation(fixture.examples, outcomes);
    expect(report.straightforward.accuracy).toBe(1);
    expect(report.acceptance.precision).toBe(0);
    expect(report.acceptance.count).toBe(0);
    expect(report.gate.checks.acceptedSample).toBe(false);
    expect(report.gate.passed).toBe(false);
  });
  it('scores runtime failures as errors and wrong classifications in the denominator', () => {
    const outcomes = perfectOutcomes();
    outcomes[0] = { id: outcomes[0]!.id, error: 'Local model unavailable.', latencyMs: 20_000 };
    const report = summarizeEvaluation(fixture.examples, outcomes);
    expect(report.errors).toBe(1);
    expect(report.straightforward.accuracy).toBe(95 / 96);
    expect(report.straightforward.confusion.work.error).toBe(1);
    expect(report.gate.checks.noRuntimeErrors).toBe(false);
  });
  it('scores stress cases using their acceptable label set without polluting single-label F1', () => {
    const outcomes = perfectOutcomes().map((entry, i) =>
      fixture.examples[i]!.group === 'straightforward'
        ? entry
        : { ...entry, prediction: prediction('other') },
    );
    const report = summarizeEvaluation(fixture.examples, outcomes);
    expect(report.stress.ambiguous.acceptableRate).toBe(1);
    expect(report.stress.adversarial.acceptableRate).toBe(1);
    expect(report.straightforward.macroF1).toBe(1);
  });
  it('requires enough samples and never passes a tiny perfect benchmark', () => {
    expect(precisionLowerBound(0, 0)).toBe(0);
    expect(precisionLowerBound(20, 20)).toBeLessThan(0.95);
    expect(precisionLowerBound(100, 100)).toBeGreaterThan(0.95);
    const report = summarizeEvaluation(fixture.examples.slice(0, 2), perfectOutcomes().slice(0, 2));
    expect(report.gate.checks.balancedSample).toBe(false);
    expect(report.gate.passed).toBe(false);
  });
  it('rejects missing, duplicated, contradictory or invalid timing outcomes', () => {
    const outcomes = perfectOutcomes();
    expect(() => summarizeEvaluation(fixture.examples, outcomes.slice(1))).toThrow('exactly once');
    expect(() =>
      summarizeEvaluation(fixture.examples, [outcomes[0]!, ...outcomes.slice(0, -1)]),
    ).toThrow('exactly once');
    expect(() =>
      summarizeEvaluation(
        fixture.examples,
        outcomes.map((entry) => ({ ...entry, error: 'oops' })),
      ),
    ).toThrow('exactly once');
    expect(() =>
      summarizeEvaluation(
        fixture.examples,
        outcomes.map((entry) => ({ ...entry, latencyMs: NaN })),
      ),
    ).toThrow('exactly once');
  });
});
