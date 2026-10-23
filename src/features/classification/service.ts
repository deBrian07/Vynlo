import type { ConversationRef } from '../../types/model';
import { senderKind, type MessageSender } from '../../services/background';
import { VynloDatabase } from '../../services/storage/database';
import { conversationId, isAccountId, validConversationRef } from '../../services/validation';
import { validBrowserStatus, type BrowserRuntimeStatus } from './browser/model';
import { parsePrediction } from './inference';
import {
  buildDecisionContext,
  contextCategoryIds,
  confirmedExamples,
  MIN_LEARNING_EXAMPLES,
  type DecisionContext,
} from './decision-context';
import {
  CATEGORIES,
  CATEGORY_IDS,
  MAX_CUSTOM_CATEGORIES,
  normalizeCategoryName,
  isCustomCategoryId,
  type CustomCategoryId,
  type UserCategory,
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
  | {
      type: 'classify-save-category';
      accountId: string;
      id?: CustomCategoryId;
      name: string;
      description: string;
    }
  | { type: 'classify-delete-category'; accountId: string; id: CustomCategoryId }
  | { type: 'classify-open'; accountId: string; id: string };
export type ClassificationData =
  | ClassifierStatus
  | ConnectionCheck
  | TaggedConversation
  | BrowserRuntimeStatus
  | UserCategory
  | null;
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
  infer?(subject: string, context?: DecisionContext): Promise<Prediction>;
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
    case 'classify-save-category':
      return (
        isAccountId(v.accountId) &&
        (v.id === undefined || isCustomCategoryId(v.id)) &&
        typeof v.name === 'string' &&
        !!v.name.trim() &&
        v.name.length <= 50 &&
        typeof v.description === 'string' &&
        v.description.length <= 160
      );
    case 'classify-delete-category':
      return isAccountId(v.accountId) && isCustomCategoryId(v.id);
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
  let pendingConfiguration = 0;
  let configurationQueue: Promise<unknown> = Promise.resolve();
  // Reserve the gate synchronously: pausing must prevent new inference while Chrome
  // is still releasing a GPU document or persisting the user's preference.
  const configureSerially = <T>(task: () => Promise<T>): Promise<T> => {
    const next = configurationQueue.then(task, task);
    configurationQueue = next.catch(() => undefined);
    return next;
  };
  const withConfigurationGate = async <T>(task: () => Promise<T>): Promise<T> => {
    pendingConfiguration++;
    try {
      return await task();
    } finally {
      pendingConfiguration--;
    }
  };
  const edits = new Map<string, number>();
  let flight:
    { key: string; automatic: boolean; promise: Promise<TaggedConversation | null> } | undefined;
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
      pendingConfiguration > 0 ||
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
      if (flight.key === key && flight.automatic === automatic) return flight.promise;
      if (automatic) return null;
      throw new Error('A local suggestion is already running. Try again when it finishes.');
    }
    const revision = edits.get(key) ?? 0;
    const promise = (async (): Promise<TaggedConversation | null> => {
      const snapshot = await database.read(ref.accountId);
      const before = snapshot.emailTags.find((tag) => tag.id === key);
      const context = buildDecisionContext(
        ref.accountId,
        ref.title,
        ref.threadId,
        snapshot.categories ?? [],
        snapshot.emailTags,
      );
      if (automatic && before) return before;
      if (startedEpoch !== epoch || revision !== (edits.get(key) ?? 0)) return null;
      if (!platform.infer) throw new Error(setupError);
      const result = context
        ? await platform.infer(ref.title, context)
        : await platform.infer(ref.title);
      const prediction = parsePrediction(
        {
          model: MODEL,
          answers: {
            category: {
              type: 'choice',
              choice: result?.category,
              probabilities: result?.probabilities,
              confidence: result?.confidence,
            },
          },
        },
        contextCategoryIds(context),
      );
      if (
        automatic &&
        isCustomCategoryId(prediction.category) &&
        confirmedExamples(snapshot.emailTags, ref.accountId, prediction.category, ref.threadId)
          .length < MIN_LEARNING_EXAMPLES
      )
        return null;
      const currentPreferences = await getPreferences();
      if (
        pendingConfiguration > 0 ||
        !currentPreferences.enabled ||
        (automatic && !currentPreferences.automatic) ||
        !(await platform.isEnhancementEnabled()) ||
        !(await platform.hasPermission()) ||
        startedEpoch !== epoch
      )
        return null;
      let saved: TaggedConversation | null = null;
      await database.update((records) => {
        if (
          pendingConfiguration > 0 ||
          startedEpoch !== epoch ||
          revision !== (edits.get(key) ?? 0)
        )
          return;
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
    flight = { key, automatic, promise };
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
        case 'classify-remove-model': {
          invalidate();
          return await withConfigurationGate(() =>
            configureSerially(async () => {
              // Complete explicit removal before any newer configuration is saved.
              await platform.setPreferences({ ...DEFAULT_CLASSIFICATION });
              await platform.removeModel?.();
              await platform.publishRevision();
              return { ok: true as const, data: null };
            }),
          );
        }
        case 'classify-configure': {
          invalidate();
          const revision = configurationRevision;
          return await withConfigurationGate(async () => {
            // A slow enable preflight must not hold up a newer pause request.
            if (message.preferences.enabled) await check();
            else await platform.release?.();
            if (revision !== configurationRevision) throw new Error(cancelled);
            return configureSerially(async () => {
              if (revision !== configurationRevision) throw new Error(cancelled);
              // Removal may have finished while this enable waited for a write.
              if (message.preferences.enabled) await check();
              if (revision !== configurationRevision) throw new Error(cancelled);
              await platform.setPreferences({ ...message.preferences });
              // Storage writes cannot be cancelled. Serialize their repair before
              // the next intent so an older completion cannot undo a newer choice.
              if (revision !== configurationRevision) {
                await platform.setPreferences({ ...DEFAULT_CLASSIFICATION });
                throw new Error(cancelled);
              }
              await platform.publishRevision();
              return { ok: true as const, data: await status() };
            });
          });
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
            if (
              isCustomCategoryId(message.category) &&
              !records.categories.some(
                (c) => c.accountId === ref.accountId && c.id === message.category,
              )
            )
              throw new Error('This category is no longer available.');
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
        case 'classify-save-category': {
          epoch++;
          let saved: UserCategory | undefined;
          await database.update((records) => {
            const local = records.categories.filter((c) => c.accountId === message.accountId);
            const existing = message.id ? local.find((c) => c.id === message.id) : undefined;
            if (message.id && !existing) throw new Error('This category is no longer available.');
            const name = message.name.trim();
            if (
              local.some(
                (c) =>
                  c.id !== message.id &&
                  normalizeCategoryName(c.name) === normalizeCategoryName(name),
              ) ||
              CATEGORY_IDS.some(
                (id) => normalizeCategoryName(CATEGORIES[id].label) === normalizeCategoryName(name),
              )
            )
              throw new Error('A category with this name already exists.');
            if (!existing && local.length >= MAX_CUSTOM_CATEGORIES)
              throw new Error('You can create up to 16 custom categories per account.');
            const timestamp = now();
            saved = {
              id: existing?.id ?? `custom:${crypto.randomUUID()}`,
              accountId: message.accountId,
              name,
              description: message.description.trim(),
              createdAt: existing?.createdAt ?? timestamp,
              updatedAt: timestamp,
            };
            if (!records.accounts.some((a) => a.id === message.accountId))
              records.accounts.push({
                id: message.accountId,
                email: message.accountId,
                createdAt: timestamp,
              });
            records.categories = records.categories.filter((c) => c.id !== saved!.id);
            records.categories.push(saved);
          });
          await platform.publishRevision();
          return { ok: true, data: saved! };
        }
        case 'classify-delete-category': {
          epoch++;
          await database.update((records) => {
            records.categories = records.categories.filter(
              (c) => c.accountId !== message.accountId || c.id !== message.id,
            );
            records.emailTags = records.emailTags.filter(
              (t) => t.accountId !== message.accountId || t.category !== message.id,
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
        'This subject exceeds the local AI token budget. Choose a tag manually.',
        'Local AI cannot safely score these category choices.',
        'This category is no longer available.',
        'A category with this name already exists.',
        'You can create up to 16 custom categories per account.',
        cancelled,
        'Local AI needs WebGPU with shader-f16 support. Try an updated Chrome browser.',
        'Local AI needs GPU buffers of at least 485 MiB. This device cannot fit the model. Manual tags remain available.',
        'Allow model download access in Vynlo settings first.',
        'Enable local suggestions in Vynlo settings first.',
        'This conversation has too little subject context. Choose a tag manually.',
        'A local suggestion is already running. Try again when it finishes.',
        'This tagged conversation is no longer available.',
        'Download the local AI model in Vynlo settings first.',
        'The local model returned an unsupported decision. Choose a tag manually.',
        'Local GPU inference is unavailable. Open Vynlo settings to check this device.',
        'Local AI is busy. Wait for the current operation or release the GPU.',
        'Local AI stopped. Your tags were kept.',
        'Local classification took too long. The GPU session was released; choose a tag manually or try again.',
        'Model preparation timed out. Cancelled downloads do not enable AI.',
        'Local AI took too long. The GPU session was released.',
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
