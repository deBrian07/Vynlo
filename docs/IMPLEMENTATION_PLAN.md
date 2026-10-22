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

The execution environment protects the workspace `.git` path and rejected initialization. Local commits are maintained in `/private/tmp/vynlo-history.git` with this workspace as its work tree. A portable bundle will be delivered with the release so history can be restored without losing work. No remote publication is authorized.
