import type { ConversationRef } from '../../types/model';

export const CATEGORIES = {
  work: {
    label: 'Work',
    description: 'Work projects, clients, team discussions and professional coordination.',
  },
  recruiting: {
    label: 'Recruiting',
    description: 'Job applications, interviews, recruiter outreach and hiring.',
  },
  finance: { label: 'Finance', description: 'Bills, receipts, purchases, banking and payments.' },
  newsletters: {
    label: 'Newsletters',
    description: 'Recurring publications, digests, news and editorial subscriptions.',
  },
  promotions: {
    label: 'Promotions',
    description: 'Marketing offers, discounts, advertising and sales campaigns.',
  },
  personal: {
    label: 'Personal',
    description: 'Friends, family, personal plans and non-work conversations.',
  },
  notifications: {
    label: 'Notifications',
    description:
      'Automated account, service, shipping or system updates, excluding financial receipts.',
  },
  other: {
    label: 'Other',
    description: 'Unclear, insufficient context, mixed topics or none of the other categories.',
  },
} as const;
export type BuiltinCategory = keyof typeof CATEGORIES;
export type CustomCategoryId = `custom:${string}`;
export type Category = BuiltinCategory | CustomCategoryId;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as BuiltinCategory[];
export const MAX_CUSTOM_CATEGORIES = 16;
export const normalizeCategoryName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export const isCustomCategoryId = (value: unknown): value is CustomCategoryId =>
  typeof value === 'string' &&
  /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export interface UserCategory {
  id: CustomCategoryId;
  accountId: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}
export const MODEL = 'tev1:0.8b';
export const isCategory = (value: unknown): value is Category =>
  typeof value === 'string' && (Object.hasOwn(CATEGORIES, value) || isCustomCategoryId(value));
export interface Prediction {
  category: Category;
  probabilities: Record<Category, number>;
  /** Probability concentration, not calibrated correctness. */
  confidence: number;
  needsReview: boolean;
}
export interface ClassificationPreferences {
  enabled: boolean;
  automatic: boolean;
}
export const DEFAULT_CLASSIFICATION: ClassificationPreferences = {
  enabled: false,
  automatic: false,
};
export interface TaggedConversation extends ConversationRef {
  id: string;
  category: Category;
  source: 'manual' | 'model';
  model?: typeof MODEL;
  reviewed: boolean;
  confidence?: number;
  createdAt: number;
  updatedAt: number;
}
export interface ClassifierStatus extends ClassificationPreferences {
  permission: boolean;
  model: typeof MODEL;
}
export interface ConnectionCheck {
  version: string;
  model: typeof MODEL;
}
