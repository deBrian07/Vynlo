import type { ConversationRef } from '../../types/model';
import { senderKind, type MessageSender } from '../../services/background';
import { VynloDatabase } from '../../services/storage/database';
import { conversationId, isAccountId, validConversationRef } from '../../services/validation';
import { validBrowserStatus, type BrowserRuntimeStatus } from './browser/model';
import {
  DEFAULT_CLASSIFICATION,
  MODEL,
  isCategory,
  type Category,
  type ClassificationPreferences,
  type ClassifierStatus,
  type ConnectionCheck,
  type Prediction,
  type TaggedConversation,
} from './model';

export type ClassificationRequest =
  | {
      type:
        | 'classify-status'
        | 'classify-browser-status'
        | 'classify-prepare'
        | 'classify-release'
        | 'classify-remove-model';
    }
  | { type: 'classify-configure'; preferences: ClassificationPreferences }
  | { type: 'classify-check' }
  | { type: 'classify-suggest' | 'classify-automatic'; ref: ConversationRef }
  | { type: 'classify-set'; ref: ConversationRef; category: Category }
  | { type: 'classify-remove'; ref: ConversationRef }
  | { type: 'classify-open'; accountId: string; id: string };
export type ClassificationData =
  ClassifierStatus | ConnectionCheck | TaggedConversation | BrowserRuntimeStatus | null;
export type ClassificationResponse =
  { ok: true; data: ClassificationData } | { ok: false; error: string };
export interface ClassificationPlatform {
  extensionId: string;
  getPreferences(): Promise<unknown>;
  setPreferences(preferences: ClassificationPreferences): Promise<void>;
  hasPermission(): Promise<boolean>;
  isEnhancementEnabled(): Promise<boolean>;
  publishRevision(): Promise<void>;
  openTab(url: string): Promise<void>;
  infer?(subject: string): Promise<Prediction>;
  check?(): Promise<ConnectionCheck>;
  browserStatus?(): Promise<BrowserRuntimeStatus>;
  prepare?(): Promise<BrowserRuntimeStatus>;
  release?(): Promise<void>;
  removeModel?(): Promise<void>;
}
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const preferences = (v: unknown): v is ClassificationPreferences =>
  object(v) &&
  typeof v.enabled === 'boolean' &&
  typeof v.automatic === 'boolean' &&
  (v.enabled || !v.automatic);
function validRequest(v: unknown): v is ClassificationRequest {
  if (!object(v)) return false;
  switch (v.type) {
    case 'classify-status':
    case 'classify-browser-status':
    case 'classify-prepare':
    case 'classify-release':
    case 'classify-remove-model':
    case 'classify-check':
      return true;
    case 'classify-configure':
      return preferences(v.preferences);
    case 'classify-suggest':
    case 'classify-automatic':
    case 'classify-remove':
      return validConversationRef(v.ref);
    case 'classify-set':
      return validConversationRef(v.ref) && isCategory(v.category);
    case 'classify-open':
      return (
        isAccountId(v.accountId) &&
        typeof v.id === 'string' &&
        v.id.startsWith(`${v.accountId}:`) &&
        v.id.length <= 1024
      );
    default:
      return false;
  }
}
const cancelled =
  'Classification changed while this request was running. Your current tags were kept.';
const setupError =
  'Prepare the browser AI model in Vynlo settings and check GPU support. You can always choose a tag manually.';

/** The worker owns tags. Inference never holds a database transaction open. */
export function createClassificationService({
  database,
  platform,
  now = Date.now,
}: {
  database: VynloDatabase;
  platform: ClassificationPlatform;
  now?: () => number;
}) {
  let epoch = 0;
  let configurationRevision = 0;
  const edits = new Map<string, number>();
  let flight: { key: string; promise: Promise<TaggedConversation | null> } | undefined;
  // The map only covers the one active inference, so it cannot grow with mailbox size.
  const changed = (key: string) => {
    // Also cancels a request still awaiting preferences, before its flight is registered.
    epoch++;
    if (flight?.key === key) edits.set(key, (edits.get(key) ?? 0) + 1);
  };
  const invalidate = () => {
    epoch++;
    configurationRevision++;
  };
  const getPreferences = async (): Promise<ClassificationPreferences> => {
    const value = await platform.getPreferences();
    return preferences(value)
      ? { enabled: value.enabled, automatic: value.automatic }
      : { ...DEFAULT_CLASSIFICATION };
  };
  const status = async (): Promise<ClassifierStatus> => ({
    ...(await getPreferences()),
    permission: await platform.hasPermission(),
    model: MODEL,
  });
  const check = async () => {
    if (!(await platform.hasPermission()))
      throw new Error('Allow model download access in Vynlo settings first.');
    if (!platform.check) throw new Error(setupError);
    // The bridge returns fixed, user-safe WebGPU errors. Preserve those details for recovery.
    return platform.check();
  };
  const classify = async (ref: ConversationRef, automatic: boolean) => {
    const startedEpoch = epoch;
    const prefs = await getPreferences();
    if (
      !prefs.enabled ||
      (automatic && !prefs.automatic) ||
      !(await platform.isEnhancementEnabled()) ||
      !(await platform.hasPermission()) ||
      startedEpoch !== epoch
    ) {
      if (automatic) return null;
      throw new Error('Enable local suggestions in Vynlo settings first.');
    }
    if (
      !ref.title.trim() ||
      /^(?:untitled|untitled conversation|no subject|\(no subject\))$/i.test(ref.title.trim())
    ) {
      if (automatic) return null;
      throw new Error('This conversation has too little subject context. Choose a tag manually.');
    }
    const key = conversationId(ref.accountId, ref.threadId);
    if (flight) {
      if (flight.key === key) return flight.promise;
      if (automatic) return null;
      throw new Error('A local suggestion is already running. Try again when it finishes.');
    }
    const revision = edits.get(key) ?? 0;
    const promise = (async (): Promise<TaggedConversation | null> => {
      const before = (await database.read(ref.accountId)).emailTags.find((tag) => tag.id === key);
      if (automatic && before) return before;
      if (startedEpoch !== epoch || revision !== (edits.get(key) ?? 0)) return null;
      if (!platform.infer) throw new Error(setupError);
      const prediction = await platform.infer(ref.title);
      if (
        !isCategory(prediction.category) ||
        !Number.isFinite(prediction.confidence) ||
        prediction.confidence < 0 ||
        prediction.confidence > 1
      )
        throw new Error(setupError);
      const currentPreferences = await getPreferences();
      if (
        !currentPreferences.enabled ||
        (automatic && !currentPreferences.automatic) ||
        !(await platform.isEnhancementEnabled()) ||
        !(await platform.hasPermission()) ||
        startedEpoch !== epoch
      )
        return null;
      let saved: TaggedConversation | null = null;
      await database.update((records) => {
        if (startedEpoch !== epoch || revision !== (edits.get(key) ?? 0)) return;
        const existing = records.emailTags.find((tag) => tag.id === key);
        if (automatic && existing) return;
        const timestamp = now();
        saved = {
          accountId: ref.accountId,
          threadId: ref.threadId,
          title: ref.title,
          url: ref.url,
          id: key,
          category: prediction.category,
          source: 'model',
          model: MODEL,
          reviewed: false,
          confidence: prediction.confidence,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        if (!records.accounts.some((account) => account.id === ref.accountId))
          records.accounts.push({ id: ref.accountId, email: ref.accountId, createdAt: timestamp });
        records.emailTags = records.emailTags.filter((tag) => tag.id !== key);
        records.emailTags.push(saved);
      });
      if (saved) await platform.publishRevision();
      return saved;
    })();
    flight = { key, promise };
    try {
      return await promise;
    } finally {
      if (flight?.promise === promise) flight = undefined;
      edits.delete(key);
    }
  };
  async function handle(message: unknown, sender: MessageSender): Promise<ClassificationResponse> {
    const kind = senderKind(sender, platform.extensionId);
    if (!kind || !validRequest(message))
      return { ok: false, error: 'This classification request could not be verified.' };
    if (
      kind !== 'extension' &&
      [
        'classify-configure',
        'classify-check',
        'classify-browser-status',
        'classify-prepare',
        'classify-release',
        'classify-remove-model',
      ].includes(message.type)
    )
      return { ok: false, error: 'Open Vynlo settings to change local classification.' };
    try {
      switch (message.type) {
        case 'classify-status':
          return { ok: true, data: await status() };
        case 'classify-check':
          return { ok: true, data: await check() };
        case 'classify-browser-status': {
          if (!platform.browserStatus) throw new Error(setupError);
          const result = await platform.browserStatus();
          if (!validBrowserStatus(result)) throw new Error(setupError);
          return { ok: true, data: result };
        }
        case 'classify-prepare': {
          if (!(await platform.hasPermission()) || !platform.prepare) throw new Error(setupError);
          const result = await platform.prepare();
          if (!validBrowserStatus(result)) throw new Error(setupError);
          return { ok: true, data: result };
        }
        case 'classify-release':
          invalidate();
          await platform.release?.();
          return { ok: true, data: null };
        case 'classify-remove-model':
          invalidate();
          await platform.setPreferences({ ...DEFAULT_CLASSIFICATION });
          await platform.removeModel?.();
          await platform.publishRevision();
          return { ok: true, data: null };
        case 'classify-configure': {
          // Pausing invalidates model work immediately, before any asynchronous storage operation.
          invalidate();
          const revision = configurationRevision;
          if (message.preferences.enabled) await check();
          else await platform.release?.();
          if (revision !== configurationRevision) throw new Error(cancelled);
          await platform.setPreferences({ ...message.preferences });
          // A concurrent pause must also win if a storage write was already in progress.
          if (revision !== configurationRevision) {
            await platform.setPreferences({ ...DEFAULT_CLASSIFICATION });
            throw new Error(cancelled);
          }
          await platform.publishRevision();
          return { ok: true, data: await status() };
        }
        case 'classify-suggest':
        case 'classify-automatic':
          return {
            ok: true,
            data: await classify(message.ref, message.type === 'classify-automatic'),
          };
        case 'classify-set': {
          const ref = message.ref;
          const key = conversationId(ref.accountId, ref.threadId);
          changed(key);
          let saved: TaggedConversation | null = null;
          await database.update((records) => {
            const existing = records.emailTags.find((tag) => tag.id === key);
            const timestamp = now();
            saved = {
              accountId: ref.accountId,
              threadId: ref.threadId,
              title: ref.title,
              url: ref.url,
              id: key,
              category: message.category,
              source: 'manual',
              reviewed: true,
              createdAt: existing?.createdAt ?? timestamp,
              updatedAt: timestamp,
            };
            if (!records.accounts.some((account) => account.id === ref.accountId))
              records.accounts.push({
                id: ref.accountId,
                email: ref.accountId,
                createdAt: timestamp,
              });
            records.emailTags = records.emailTags.filter((tag) => tag.id !== key);
            records.emailTags.push(saved);
          });
          await platform.publishRevision();
          return { ok: true, data: saved };
        }
        case 'classify-remove': {
          const key = conversationId(message.ref.accountId, message.ref.threadId);
          changed(key);
          await database.update((records) => {
            records.emailTags = records.emailTags.filter(
              (tag) => tag.accountId !== message.ref.accountId || tag.id !== key,
            );
          });
          await platform.publishRevision();
          return { ok: true, data: null };
        }
        case 'classify-open': {
          const tag = (await database.read(message.accountId)).emailTags.find(
            (tag) => tag.id === message.id && tag.accountId === message.accountId,
          );
          if (!tag || !validConversationRef(tag))
            throw new Error('This tagged conversation is no longer available.');
          await platform.openTab(tag.url);
          return { ok: true, data: null };
        }
      }
    } catch (error) {
      const allowed = [
        setupError,
        cancelled,
        'Local AI needs WebGPU with shader-f16 support. Try an updated Chrome browser.',
        'Allow model download access in Vynlo settings first.',
        'Enable local suggestions in Vynlo settings first.',
        'This conversation has too little subject context. Choose a tag manually.',
        'A local suggestion is already running. Try again when it finishes.',
        'This tagged conversation is no longer available.',
      ];
      return {
        ok: false,
        error:
          error instanceof Error && allowed.includes(error.message)
            ? error.message
            : 'Local GPU classification failed. Check the model and device in Vynlo settings, or choose a tag manually.',
      };
    }
  }
  return { handle, invalidate };
}
