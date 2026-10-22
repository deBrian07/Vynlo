# Implementation plan

## Data protection branch

Branch `feat/data-backups` starts at verified GitHub main `e9244ed`. It does not include the separate open-tracking feature branch.

1. Versioned encrypted backup codec: AES-GCM with independent vault authentication and encryption keys; passphrase-protected local files; recovery-file validation. Test tampering, wrong keys, malformed input and key separation.
2. Independent private Cloudflare R2 service: bounded encrypted envelopes, hashed capabilities, conditional writes, no plaintext records. Test authorization, concurrent writes and failures.
3. Extension-owned backup controller: off by default, explicit host grants, encrypted local export, preview/confirm restore, persisted recovery journal, queued automatic snapshots, restart recovery and conflict handling.
4. Guided settings: local file download/restore; optional cloud setup, recovery-file save, enable/pause/status and restore after reinstall. Never require a cloud connection for local backups.
5. Preserve optional open-tracking records/capabilities when the installed profile contains that separate module; do not grant its host permission during restore.
6. Guided operator deployment, privacy/security documentation, production package and complete checks. Distinguish local tests from live Cloudflare/Chrome validation; do not deploy or merge without owner action.

Acceptance: a clean install can restore core records/settings/reminders from a validated local file or encrypted cloud vault using an external recovery file. Default installation makes no backup network requests. Failed backups/restores never silently erase existing data; stale cloud writes do not overwrite newer snapshots.

Vynlo enhances Gmail locally. The initial release includes P0 and P1; automatic reply detection and all other P2 work remain out of scope.

## Milestones and gates

| Milestone             | Tasks                                                                      | Acceptance                                                                                           | Status                                                                             |
| --------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 0 Foundation          | WXT/React/strict TypeScript, Tailwind, tooling, icons, MIT                 | Production MV3 build; lint and type checks                                                           | Done in this checkout                                                              |
| 1 Gmail proof         | Isolated mounting, navigation, account/thread detection, composer adapter  | Representative fixture tests; uncertainty disables persistence; compatibility limitations documented | Fixture proof done. Live Gmail remains a release gate                              |
| 2 Tracking            | Extension-owned IndexedDB, account scoping, dashboard, notes/status/search | Track/reload/isolation tests and working UI                                                          | Done against fixtures                                                              |
| 3 Reminders           | Persistent records, scheduler, due queue, snooze/dismiss/resolve           | Restart/reconcile tests; no duplicate schedules; OS caveat documented                                | Done against fixtures                                                              |
| 4 Keyboard            | Command registry/palette, fuzzy search, configurable shortcuts             | Keyboard/component tests and typing safety                                                           | Done against fixtures                                                              |
| 5 People and snippets | Contact notes/tags, templates, safe composer insertion                     | CRUD/variables/insertion tests                                                                       | Done against fixtures, including starter templates                                 |
| 6 Settings and polish | Themes, onboarding, backup validation, clear data, accessibility           | Settings persistence, safe import, browser UI checks                                                 | Done against fixtures                                                              |
| 7 Release             | CI, docs, security review, fixture browser journeys, ZIP                   | All checks pass; artifact inspected; remaining live checks explicit                                  | CI and fixture journeys exist. Live Gmail, screenshots and store submission remain |

## Architecture decisions

- One service worker owns IndexedDB; Gmail content scripts communicate through validated messages. No Gmail-origin database.
- Stable email namespaces, not `/u/0` account slots. No account-dependent writes when identification fails.
- No API calls, network interception, remote scripts, analytics or automatic sending.
- Durable reminder records are authoritative. Alarm state is rebuilt on worker activation.
- Imported backups merge validated records rather than silently replacing the database.
- Shadow DOM isolates the Gmail UI. Adapter selectors stay outside React.

## Validation

Run focused tests while implementing, then formatting, ESLint, TypeScript, complete Vitest suite, production build and Playwright fixture journeys. Validate the resulting ZIP and manifest. Real authenticated Gmail testing is a separate release gate; fixtures cannot prove compatibility with every Gmail rollout.

## Workspace constraint

History lives in this repository. Do not publish a remote or submit the extension without an explicit request. Real authenticated Gmail testing is still a separate release gate.

## Review and polish validation

The review adds source-correlated opaque thread routes, safer native snippet insertion, inline workflow actions, a due queue, protected unsaved edits, isolated keyboard events, and refined light/dark screens. The latest executed checks and remaining browser/Gmail gates are recorded in [REVIEW.md](REVIEW.md). The local interactive design fixture and draft lab provide repeatable visual and native-editing checks without an account.
