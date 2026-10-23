import {
  CATEGORIES,
  CATEGORY_IDS,
  isCustomCategoryId,
  type Category,
  type TaggedConversation,
  type UserCategory,
} from './model';

export interface DecisionContext {
  categories: Array<{ id: Category; name: string; description: string; examples: string[] }>;
}
export const MIN_LEARNING_EXAMPLES = 3;
export const normalizeExample = (subject: string) =>
  subject.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function confirmedExamples(
  tags: TaggedConversation[],
  accountId: string,
  category: Category,
  excludeThread?: string,
) {
  const seen = new Set<string>();
  return tags
    .filter((tag) => {
      const normalized = normalizeExample(tag.title);
      if (
        tag.accountId !== accountId ||
        tag.category !== category ||
        tag.threadId === excludeThread ||
        tag.source !== 'manual' ||
        !tag.reviewed ||
        !normalized ||
        seen.has(normalized)
      )
        return false;
      seen.add(normalized);
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
/** Only explicit user decisions become references. No model-generated feedback loop. */
export function buildDecisionContext(
  accountId: string,
  subject: string,
  threadId: string,
  categories: UserCategory[],
  tags: TaggedConversation[],
): DecisionContext | undefined {
  const custom = categories
    .filter((c) => c.accountId === accountId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const choices = [
    ...CATEGORY_IDS.map((id) => ({
      id: id as Category,
      name: CATEGORIES[id].label,
      description: CATEGORIES[id].description as string,
      examples: [] as string[],
    })),
    ...custom.map((c) => ({
      id: c.id as Category,
      name: c.name,
      description: c.description,
      examples: [] as string[],
    })),
  ];
  const words = new Set(normalizeExample(subject).match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const references = choices.flatMap((choice) =>
    confirmedExamples(tags, accountId, choice.id, threadId).map((tag) => ({
      choice,
      tag,
      score: (normalizeExample(tag.title).match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) =>
        words.has(w),
      ).length,
    })),
  );
  references.sort((a, b) => b.score - a.score || b.tag.updatedAt - a.tag.updatedAt);
  let count = 0;
  for (const { choice, tag } of references) {
    if (count >= 8) break;
    if (choice.examples.length >= 2) continue;
    choice.examples.push(tag.title.slice(0, 120));
    count++;
  }
  return custom.length || count ? { categories: choices } : undefined;
}
export const contextCategoryIds = (context?: DecisionContext): Category[] =>
  context?.categories.map((c) => c.id) ?? [...CATEGORY_IDS];
export function validDecisionContext(value: unknown): value is DecisionContext {
  if (
    !value ||
    typeof value !== 'object' ||
    !('categories' in value) ||
    !Array.isArray(value.categories)
  )
    return false;
  const categories = value.categories as unknown[];
  if (categories.length < 8 || categories.length > 24) return false;
  const seen = new Set<string>();
  let examples = 0;
  return categories.every((c, i) => {
    if (!c || typeof c !== 'object') return false;
    const v = c as Record<string, unknown>;
    if (
      typeof v.id !== 'string' ||
      (i < 8 ? v.id !== CATEGORY_IDS[i] : !isCustomCategoryId(v.id)) ||
      seen.has(v.id)
    )
      return false;
    seen.add(v.id);
    if (
      typeof v.name !== 'string' ||
      !v.name.trim() ||
      v.name.length > 50 ||
      typeof v.description !== 'string' ||
      v.description.length > 160 ||
      !Array.isArray(v.examples) ||
      v.examples.length > 2 ||
      !v.examples.every((e) => typeof e === 'string' && e.length > 0 && e.length <= 120)
    )
      return false;
    examples += v.examples.length;
    return examples <= 8;
  });
}
