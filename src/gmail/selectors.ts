/** Private Gmail DOM contracts. Keep all provider-specific selectors here. */
export const selectors = {
  account:
    '[role="banner"] a[aria-label^="Google Account:"], [role="banner"] button[aria-label^="Google Account:"]',
  main: '[role="main"]',
  thread: 'h2[data-thread-perm-id][data-legacy-thread-id]',
  toolbar: '[gh="mtb"]',
  composer: '[role="textbox"][contenteditable="true"][g_editable="true"]',
} as const;
