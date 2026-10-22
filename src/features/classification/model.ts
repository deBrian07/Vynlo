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
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];
export const MODEL = 'tev1:0.8b';
export const CLASSIFIER_ORIGIN = 'http://127.0.0.1:11434';
export const CLASSIFIER_PERMISSION = `${CLASSIFIER_ORIGIN}/*`;
export const isCategory = (value: unknown): value is Category =>
  typeof value === 'string' && Object.hasOwn(CATEGORIES, value);
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
