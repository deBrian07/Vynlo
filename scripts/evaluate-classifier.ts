import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  buildDecisionRequest,
  checkConnection,
  classifySubject,
} from '../src/features/classification/inference';
import {
  CATEGORY_IDS,
  MODEL,
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
    buildDecisionRequest(entry.subject);
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
  for (const example of straightforward)
    confusion[example.acceptable[0]!][byId.get(example.id)!.prediction?.category ?? 'error']++;
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

export async function runCli(): Promise<number> {
  const fixtureText = await readFile(resolve('tests/fixtures/classification-eval.json'), 'utf8');
  const fixture = validateFixture(JSON.parse(fixtureText) as unknown);
  // No email data is sent during this check. Abort before scoring when the runtime is missing.
  let connection;
  try {
    connection = await checkConnection();
  } catch (error) {
    process.stderr.write(
      `Evaluation blocked: ${error instanceof Error ? error.message : 'Local model unavailable.'}\nNo model quality report was generated.\n`,
    );
    return 2;
  }
  const startedAt = new Date().toISOString();
  // Stable shuffled order avoids benchmarking one entire category only during warm-up.
  const examples = [...fixture.examples].sort((a, b) =>
    createHash('sha256')
      .update(a.id)
      .digest('hex')
      .localeCompare(createHash('sha256').update(b.id).digest('hex')),
  );
  const outcomes: EvaluationOutcome[] = [];
  for (const example of examples) {
    const start = performance.now();
    try {
      outcomes.push({
        id: example.id,
        prediction: await classifySubject(example.subject),
        latencyMs: performance.now() - start,
      });
    } catch (error) {
      outcomes.push({
        id: example.id,
        error: error instanceof Error ? error.message : 'Inference failed.',
        latencyMs: performance.now() - start,
      });
    }
    process.stdout.write(`${outcomes.length}/${examples.length} ${example.id}\n`);
  }
  const metrics = summarizeEvaluation(examples, outcomes);
  const report = {
    schemaVersion: 1,
    model: MODEL,
    ollamaVersion: connection.version,
    startedAt,
    completedAt: new Date().toISOString(),
    environment: { platform: process.platform, architecture: process.arch, node: process.version },
    fixtureSha256: createHash('sha256').update(fixtureText).digest('hex'),
    requestTemplateSha256: createHash('sha256')
      .update(JSON.stringify(buildDecisionRequest('evaluation template')))
      .digest('hex'),
    evidence: fixture.description,
    metrics,
    outcomes,
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/classification-evaluation.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  process.stdout.write(
    JSON.stringify(metrics, null, 2) + '\nReport: artifacts/classification-evaluation.json\n',
  );
  process.stdout.write(
    'This is a synthetic screen. Release requires a separate consented, held-out mailbox evaluation.\n',
  );
  return metrics.gate.passed ? 0 : 1;
}
