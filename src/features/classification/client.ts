import { validBrowserStatus } from './browser/model';
import type { ConversationRef } from '../../types/model';
import { validEmailTag } from '../../services/validation';
import type { ClassificationRequest } from './service';
import {
  MODEL,
  type Category,
  type ClassificationPreferences,
  type ClassifierStatus,
  type ConnectionCheck,
  type TaggedConversation,
} from './model';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const invalidResponse = 'Vynlo returned an unexpected response. Reload and try again.';
async function request<T>(
  message: ClassificationRequest,
  valid: (value: unknown) => value is T,
): Promise<T> {
  let response: unknown;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch {
    throw new Error('Vynlo could not connect. Reload Gmail and try again.');
  }
  if (!object(response)) throw new Error(invalidResponse);
  if (response.ok === false && typeof response.error === 'string' && response.error.length <= 500)
    throw new Error(response.error);
  if (response.ok !== true || !valid(response.data)) throw new Error(invalidResponse);
  return response.data;
}
const status = (v: unknown): v is ClassifierStatus =>
  object(v) &&
  v.model === MODEL &&
  typeof v.enabled === 'boolean' &&
  typeof v.automatic === 'boolean' &&
  typeof v.permission === 'boolean' &&
  (v.enabled || !v.automatic);
const connection = (v: unknown): v is ConnectionCheck =>
  object(v) && v.model === MODEL && typeof v.version === 'string' && v.version.length <= 50;
const tagFor =
  (ref: ConversationRef) =>
  (v: unknown): v is TaggedConversation =>
    validEmailTag(v) && v.accountId === ref.accountId && v.threadId === ref.threadId;
const suggestionFor =
  (ref: ConversationRef) =>
  (v: unknown): v is TaggedConversation | null =>
    v === null || tagFor(ref)(v);
const empty = (v: unknown): v is null => v === null;
export const classificationClient = {
  browserStatus: () => request({ type: 'classify-browser-status' }, validBrowserStatus),
  prepare: () => request({ type: 'classify-prepare' }, validBrowserStatus),
  release: () => request({ type: 'classify-release' }, empty),
  removeModel: () => request({ type: 'classify-remove-model' }, empty),
  status: () => request({ type: 'classify-status' }, status),
  configure: (preferences: ClassificationPreferences) =>
    request({ type: 'classify-configure', preferences }, status),
  check: () => request({ type: 'classify-check' }, connection),
  suggest: (ref: ConversationRef) => request({ type: 'classify-suggest', ref }, suggestionFor(ref)),
  automatic: (ref: ConversationRef) =>
    request({ type: 'classify-automatic', ref }, suggestionFor(ref)),
  set: (ref: ConversationRef, category: Category) =>
    request({ type: 'classify-set', ref, category }, tagFor(ref)),
  remove: (ref: ConversationRef) => request({ type: 'classify-remove', ref }, empty),
  open: (tag: TaggedConversation) =>
    request({ type: 'classify-open', accountId: tag.accountId, id: tag.id }, empty),
};
