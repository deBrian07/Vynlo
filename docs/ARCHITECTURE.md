# Architecture

Vynlo has three execution boundaries: Gmail's page, an isolated content script and extension pages/service worker. Gmail-specific selectors live in `src/gmail`. React components consume typed context and send requests rather than interpreting Gmail DOM themselves.

## Modules

| Location                           | Responsibility                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `entrypoints/`                     | WXT content, service worker, popup and options entrypoints                                   |
| `src/gmail/`                       | Visible account/thread identification, navigation observation, theme and composer operations |
| `src/features/`                    | Dashboard, commands, shortcuts, snippets, contacts and settings interfaces                   |
| `src/services/client.ts`           | Typed runtime-message client                                                                 |
| `src/services/background.ts`       | Serialized business operations, sender checks, account filtering and reminder recovery       |
| `src/services/storage/database.ts` | Extension-owned IndexedDB schema and transactions                                            |
| `src/services/validation.ts`       | Runtime request, backup, identity and navigation-link validation                             |
| `src/types/`                       | Shared data and message contracts                                                            |

The content UI uses styling isolation rather than rewriting Gmail styles. Adapter subscriptions share an observer and batch updates. Disposing the last subscriber removes the observer and listeners. Identity failures produce unavailable context instead of a guessed reference.

## Identity and persistence

An account namespace is its normalized email address, never the numeric `/u/0` slot. The adapter requires a supported visible account control and a single supported thread heading. A hexadecimal route token must agree with the heading's legacy thread ID. Account changes and route/DOM disagreement disable writes. See [the integration checkpoint](GMAIL_COMPATIBILITY.md) for evidence and unsupported layouts.

Conversation IDs combine account email and thread ID. Contact IDs combine account email and contact email. A reminder uses a deterministic ID derived from its conversation, giving each conversation one current reminder. Snippets use random UUIDs and are intentionally shared across accounts in the same browser profile.

All structured writes run in the service worker's extension origin. Database version 1 contains `accounts`, `conversations`, `reminders`, `contacts`, `snippets` and a `metadata` journal store. Account-scoped tables have account indexes, and reminders have a conversation index. The initial migration creates missing stores without deleting existing data. Future schema changes must increment the version and preserve older records.

Requests are serialized within a worker instance. IndexedDB transactions enforce atomic record changes. Current reads load the local record collections before filtering; the indexes leave room for targeted queries, but large imported workspaces will still incur full-snapshot costs.

Settings use `chrome.storage.local`. Import and clear operations first commit a pending-settings journal with the IndexedDB transaction. The worker applies those settings and removes the journal; a restart retries an unfinished settings write. This avoids silently losing the cross-storage part of an import.

## Message boundary

Only messages carrying the same extension ID and originating from the permitted extension pages or top-level Gmail frames are accepted. Every request is checked at runtime. Gmail content scripts cannot export, import, clear all records or replace global settings. Requests without an identified account do not receive account records. Opening a saved link requires the expected Gmail origin, account query and thread hash.

This is an application isolation boundary, not cryptographic account authentication. The adapter derives account identity from untrusted visible page attributes. A malicious page capable of impersonating those attributes remains outside the honest-Gmail compatibility model; Vynlo never claims to authenticate a Google session.

## Reminder lifecycle

Persisted records are authoritative; Chrome alarm state is disposable. The worker marks elapsed pending reminders due, attempts desktop notifications and schedules one alarm for the earliest remaining pending reminder. It reconciles on worker initialization, startup, installation/update, matching alarms and ordinary requests.

The notification-attempt timestamp is persisted before notifying Chrome. This prevents restart loops from creating duplicate attempts, but a crash between those two steps can lose a desktop alert. The due dashboard record survives. Notification failures are not retried automatically; snoozing creates a new scheduled attempt. Resolving or untracking a conversation clears its pending work.

Times are absolute epoch milliseconds. Calendar-day presets retain local wall-clock time across daylight-saving transitions. Later today is 6:00pm local when that is at least an hour away, and 9:00am the next morning otherwise. Changing time zones changes display, not the previously scheduled instant. Chrome and OS scheduling can delay delivery.

## Extending the product

Add commands through the typed command registry. Add provider behavior through the adapter boundary. New storage fields require validation, migration/import consideration and tests. Optional Gmail API integration would require a separate permission/privacy design; no dormant OAuth or network interception is included. The explicitly optional backup service has its own boundary.

## Data protection

`src/features/backups` wraps the existing version-one core export/import service without changing its databases. A separate validated version-one IndexedDB store contains cloud configuration, generated recovery material, restore previews and a pending restore journal. Content scripts never receive these records. The independent Cloudflare Worker stores opaque authenticated ciphertext in private R2. Cloud backup is disabled by default; exact-origin host access is optional.

User changes queue an upload deadline anchored to the first dirty change. A daily fallback is anchored to the last confirmed upload, so service-worker restarts do not postpone it. Alarms are reconstructed on startup/update. Uploads capture core records and installed tracking addons, encrypt locally and use the last known ETag. Failed uploads retain dirty state; conflicts pause the vault. The service does not provide continuous multi-device sync or version history.

Restores decrypt/validate first, return a counts-only preview and require explicit confirmation. Core import merges missing records and journals preferences. Tracking addon restoration merges absent capability records, rejecting identity/capability conflicts; current tracking connection settings win. A separate pending restore journal enables idempotent retry across these databases. Automatic upload remains paused until recovery finishes and the user enables it again.
