import { CATEGORY_IDS, MODEL, isCategory, type Category, type Prediction } from './model';

const INVALID_DECISION = 'The local model returned an unsupported decision. Choose a tag manually.';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate locally computed category scores before they enter the extension data layer. */
export function parsePrediction(value: unknown): Prediction {
  const invalid = () => new Error(INVALID_DECISION);
  if (!object(value) || value.model !== MODEL || !object(value.answers)) throw invalid();
  const answer = value.answers.category;
  if (!object(answer) || answer.type !== 'choice' || !isCategory(answer.choice)) throw invalid();
  const scores = answer.probabilities;
  if (
    !object(scores) ||
    Object.keys(scores).length !== CATEGORY_IDS.length ||
    typeof answer.confidence !== 'number' ||
    !Number.isFinite(answer.confidence) ||
    answer.confidence < 0 ||
    answer.confidence > 1
  ) {
    throw invalid();
  }
  const probabilities = {} as Record<Category, number>;
  for (const id of CATEGORY_IDS) {
    const probability = scores[id];
    if (
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw invalid();
    }
    probabilities[id] = probability;
  }
  const sorted = Object.values(probabilities).sort((a, b) => b - a);
  const total = sorted.reduce((sum, probability) => sum + probability, 0);
  const top = sorted[0]!;
  if (Math.abs(total - 1) > 0.02 || probabilities[answer.choice] < top - 1e-8) throw invalid();
  return {
    category: answer.choice,
    probabilities,
    confidence: answer.confidence,
    // These are conservative review thresholds, not a claim of measured accuracy.
    needsReview: answer.choice === 'other' || top < 0.85 || top - sorted[1]! < 0.25,
  };
}
