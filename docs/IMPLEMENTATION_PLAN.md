# Implementation plan

## Corrected brand kit branch

`feat/brand-kit` starts directly from main `e9244ed`, independently of backup and open-tracking branches.

- [x] Preserve the complete supplied corrected kit under `assets/brand`.
- [x] Replace Chrome icons with supplied exact-size navy/mint exports.
- [x] Adapt inline local vector mark and outlined wordmark in workspace, popup and Gmail launcher, with light/dark and accessible labels.
- [x] Extend navy/mint/teal tokens across light/dark controls, navigation, semantic states and palette; validate contrast.
- [x] Shorten README, use supplied theme-aware banners with truthful illustration labeling, move detailed instructions to `docs/USAGE.md`.
- [x] Validate formatting, lint, types, 103 tests, build, preview build, ZIP and asset/reference checks. Installed-extension visuals/live Gmail remain release gates.
- [x] Prepare independent branch history and package. Publication requires reachable GitHub; current terminal DNS is blocked.

See [BRANDING.md](BRANDING.md) for asset mapping and merge notes.

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
