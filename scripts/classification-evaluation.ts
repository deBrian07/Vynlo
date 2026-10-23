import {
  CATEGORY_IDS,
  isCategory,
  type Category,
  type Prediction,
} from '../src/features/classification/model';

export interface EvaluationExample {
  id: string;
  group: 'straightforward' | 'ambiguous' | 'adversarial';
  subject: string;
  acceptable: Category[];
}
export interface EvaluationFixture {
  schemaVersion: 1;
  description: string;
  examples: EvaluationExample[];
}
export interface EvaluationOutcome {
  id: string;
  prediction?: Prediction;
  error?: string;
  latencyMs: number;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateFixture(value: unknown): EvaluationFixture {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    typeof value.description !== 'string' ||
    !Array.isArray(value.examples) ||
    !value.examples.length
  ) {
    throw new Error('Invalid evaluation fixture.');
  }
  const ids = new Set<string>();
  const subjects = new Set<string>();
  const examples = value.examples.map((entry: unknown) => {
    if (
      !object(entry) ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      ids.has(entry.id) ||
      typeof entry.subject !== 'string' ||
      subjects.has(entry.subject.trim().toLowerCase()) ||
      !['straightforward', 'ambiguous', 'adversarial'].includes(String(entry.group)) ||
      !Array.isArray(entry.acceptable) ||
      !entry.acceptable.length ||
      !entry.acceptable.every(isCategory) ||
      new Set(entry.acceptable).size !== entry.acceptable.length ||
      (entry.group === 'straightforward' && entry.acceptable.length !== 1)
    ) {
      throw new Error('Invalid or duplicate evaluation example.');
    }
    if (!entry.subject.trim() || entry.subject.length > 500)
      throw new Error('Evaluation subject must contain 1 to 500 characters.');
    ids.add(entry.id);
    subjects.add(entry.subject.trim().toLowerCase());
    return entry as unknown as EvaluationExample;
  });
  return { schemaVersion: 1, description: value.description, examples };
}

/** Wilson lower 95% bound: a perfect tiny sample is not strong precision evidence. */
export function precisionLowerBound(correct: number, total: number): number {
  if (!total) return 0;
  const z = 1.959963984540054;
  const proportion = correct / total;
  return (
    (proportion +
      (z * z) / (2 * total) -
      z * Math.sqrt((proportion * (1 - proportion)) / total + (z * z) / (4 * total * total))) /
    (1 + (z * z) / total)
  );
}
const fraction = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : 0;
const percentile = (numbers: number[], quantile: number) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]! : null;
};

export function summarizeEvaluation(examples: EvaluationExample[], outcomes: EvaluationOutcome[]) {
  const byId = new Map(outcomes.map((entry) => [entry.id, entry]));
  if (
    outcomes.length !== examples.length ||
    byId.size !== outcomes.length ||
    examples.some((entry) => !byId.has(entry.id)) ||
    outcomes.some(
      (entry) =>
        !entry.prediction === !entry.error ||
        !Number.isFinite(entry.latencyMs) ||
        entry.latencyMs < 0,
    )
  ) {
    throw new Error('Evaluation outcomes must match every example exactly once.');
  }
  const correct = (example: EvaluationExample) => {
    const prediction = byId.get(example.id)!.prediction;
    return !!prediction && example.acceptable.includes(prediction.category);
  };
  const straightforward = examples.filter((entry) => entry.group === 'straightforward');
  const confusion = Object.fromEntries(
    CATEGORY_IDS.map((category) => [
      category,
      Object.fromEntries([...CATEGORY_IDS, 'error'].map((id) => [id, 0])),
    ]),
  ) as Record<Category, Record<Category | 'error', number>>;
  for (const example of straightforward) {
    const row = confusion[example.acceptable[0]!]!;
    const predicted = byId.get(example.id)!.prediction?.category;
    const key = predicted && Object.hasOwn(row, predicted) ? predicted : 'error';
    row[key] = (row[key] ?? 0) + 1;
  }
  const perCategory = Object.fromEntries(
    CATEGORY_IDS.map((category) => {
      const support = straightforward.filter((entry) => entry.acceptable[0] === category).length;
      const predicted = straightforward.filter(
        (entry) => byId.get(entry.id)!.prediction?.category === category,
      ).length;
      const truePositive = confusion[category][category];
      const precision = fraction(truePositive, predicted);
      const recall = fraction(truePositive, support);
      return [
        category,
        { support, precision, recall, f1: fraction(2 * precision * recall, precision + recall) },
      ];
    }),
  ) as Record<Category, { support: number; precision: number; recall: number; f1: number }>;
  const accepted = examples.filter(
    (entry) => byId.get(entry.id)!.prediction?.needsReview === false,
  );
  const acceptedCorrect = accepted.filter(correct).length;
  const errors = outcomes.filter((entry) => entry.error).length;
  const accuracy = fraction(straightforward.filter(correct).length, straightforward.length);
  const macroF1 =
    CATEGORY_IDS.reduce((sum, category) => sum + perCategory[category].f1, 0) / CATEGORY_IDS.length;
  const acceptedPrecision = fraction(acceptedCorrect, accepted.length);
  const lowerBound = precisionLowerBound(acceptedCorrect, accepted.length);
  const groups = Object.fromEntries(
    ['ambiguous', 'adversarial'].map((group) => {
      const entries = examples.filter((entry) => entry.group === group);
      return [
        group,
        {
          count: entries.length,
          acceptableRate: fraction(entries.filter(correct).length, entries.length),
        },
      ];
    }),
  ) as Record<'ambiguous' | 'adversarial', { count: number; acceptableRate: number }>;
  const checks = {
    balancedSample:
      straightforward.length >= 96 &&
      CATEGORY_IDS.every((category) => perCategory[category].support >= 12),
    stressSample: groups.ambiguous.count >= 12 && groups.adversarial.count >= 12,
    noRuntimeErrors: errors === 0,
    accuracy: accuracy >= 0.9,
    macroF1: macroF1 >= 0.9,
    acceptedSample: accepted.length >= 50,
    acceptedPrecision: acceptedPrecision >= 0.98,
    precisionEvidence: lowerBound >= 0.95,
    ambiguity: groups.ambiguous.acceptableRate >= 0.9,
    adversarial: groups.adversarial.acceptableRate >= 0.9,
  };
  return {
    total: examples.length,
    errors,
    straightforward: { count: straightforward.length, accuracy, macroF1, perCategory, confusion },
    stress: groups,
    acceptance: {
      count: accepted.length,
      correct: acceptedCorrect,
      coverage: fraction(accepted.length, examples.length),
      precision: acceptedPrecision,
      precisionLower95: lowerBound,
    },
    latency: {
      firstRequestMs: outcomes[0]?.latencyMs ?? null,
      remainingMedianMs: percentile(
        outcomes.slice(1).map((entry) => entry.latencyMs),
        0.5,
      ),
      remainingP95Ms: percentile(
        outcomes.slice(1).map((entry) => entry.latencyMs),
        0.95,
      ),
    },
    gate: {
      passed: Object.values(checks).every(Boolean),
      checks,
      scope: 'Synthetic regression screen only; passing does not establish production readiness.',
    },
  };
}
