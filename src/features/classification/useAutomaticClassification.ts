import { useEffect } from 'react';
import type { ConversationRef } from '../../types/model';
import { classificationClient } from './client';

/** No mailbox scan: only a verified conversation the user has opened. */
export function useAutomaticClassification(ref: ConversationRef | null, enabled: boolean) {
  const accountId = ref?.accountId,
    threadId = ref?.threadId,
    title = ref?.title,
    url = ref?.url;
  useEffect(() => {
    if (!enabled || !accountId || !threadId || !title || !url) return;
    let active = true;
    const run = () => {
      if (active) {
        // The worker checks explicit opt-in and local permission before any network request.
        // Failure is non-blocking; the Tags view provides a deliberate retry with feedback.
        void classificationClient
          .automatic({ accountId, threadId, title, url })
          .catch(() => undefined);
      }
    };
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.classificationPreferences) run();
    };
    run();
    chrome.storage.onChanged.addListener(changed);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [enabled, accountId, threadId, title, url]);
}
