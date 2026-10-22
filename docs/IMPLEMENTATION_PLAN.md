# Implementation plan

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

## Local classification branch

`feat/local-classification` starts directly from local main `e9244ed` in the original repository. Remote main verification is blocked by GitHub DNS. It deliberately does not merge branding, tracking or backup branches.

1. Typed eight-category taxonomy, strict local decision-response validation, bounded loopback-only Ollama client. No model downloads initiated by the extension.
2. Versioned account-scoped tag records in extension storage, backup compatibility, manual edits and removal; core tracking status is independent.
3. Trusted service-worker routing, opt-in local inference and automatic classification of supported opened conversation subjects. No whole-mailbox scan, body storage, native Gmail label mutation or background polling.
4. Guided settings and setup check, category browser/filter, current-conversation tagging and correction. Default off; automatic mode separately enabled; uncertain decisions marked for review.
5. Synthetic decision fixtures/evaluation runner, failure/account-switch tests, build checks and documentation distinguishing mock inference from actual model evaluation.

Acceptance: local tags persist without forcing follow-up tracking; records remain account-scoped; model failures cannot break Gmail/core actions; manual corrections survive automatic visits; all imported tags are validated and imports never silently enable inference.

Classification implementation status (2026-10-22): tasks 1–5 implemented, including default-off settings, manual review, account-indexed database migration, backup compatibility and a 120-subject evaluation runner. `pnpm check` passed 179 tests and the production build; the ZIP was inspected. Actual model quality, browser fixtures and authenticated Gmail remain explicit release gates, not completed milestones. See [executed validation](CLASSIFICATION_VALIDATION.md). Publishing the branch was attempted but GitHub DNS is unavailable in this environment.
