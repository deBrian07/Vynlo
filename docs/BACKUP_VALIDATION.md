# Data protection validation

Branch: `feat/data-backups`, based directly on main `e9244ed7165cf91dba330c0a97a7152bd40783de`. The separate open-tracking branch is not merged here. Its supported stored records and connection can be preserved by an explicit addon codec.

## Implemented

- Password-protected local files using AES-256-GCM and PBKDF2-SHA256; authenticated format metadata, fresh random salts/nonces, bounded input and strict validation.
- Optional automatic cloud snapshots, off by default. Separate HKDF-derived encryption/authentication keys; recovery file saved outside Chrome; exact Worker-origin permission requested on explicit setup/recovery actions.
- Private R2 Worker accepts only encrypted envelopes. Initial provisioning and conditional ETag writes prevent unauthenticated creation and silent stale overwrites. No server plaintext, key upload, email content, analytics or deployment from the extension.
- Persisted backup state, stable alarm deadlines, retry/backoff, pause/status, counts-only restore preview, account-preserving merge and replayable restore journal. Clear cancels pending replay before deleting core data; failed core clears retain recovery credentials.
- Guided settings, encrypted download, cloud enable confirmation, legacy JSON compatibility, restore failure feedback, unsaved-preference protection and operator setup helper.
- Existing core database name/version are unchanged. Updates preserve that database under the same extension ID/profile. Uninstall recovery requires an external file/password or recovery kit and reachable vault.

## Executed checks

- Prettier, ESLint, WXT type generation and strict TypeScript: passed.
- Full Vitest suite: **182 tests in 28 files passed**. Includes actual Node WebCrypto, fake IndexedDB, React Testing Library, production background entrypoint with mocked Chrome APIs, and the actual Worker handler with a mock R2 bucket.
- Production WXT build and ZIP generation: passed. Manifest inspected: storage/alarms/notifications, Gmail-only content script, optional workers.dev access; CSP prohibits remote scripts. ZIP has manifest at root and contains only packaged extension assets.
- Vite design fixture build: passed. Existing native Chrome preview showed the Data protection layout, password fields, disabled empty download, cloud Off state, collapsed setup and file restore disclosure. It does not execute production Chrome extension APIs; backup actions intentionally require the installed extension. Browser preview inspection is not an end-to-end recovery test.
- Playwright: attempted all 13 existing fixture journeys. **All 13 failed before running their journeys**, because Chrome for Testing exited during launch with SIGABRT and the sandbox reported EPERM. No Playwright journey is claimed as passing.
- GitHub publication attempted; terminal could not resolve github.com. The branch and complete commit history are delivered locally with a Git bundle for import/push.

## Remaining release gates

1. Run Playwright in an environment that permits Chromium launch. Run the exact packaged extension in a disposable Chrome profile; test upgrade, browser restart, uninstall/reinstall, wrong password, interrupted restore, revoked permission and notification recovery. Keep the source profile until comparisons pass.
2. With owner authorization, deploy the private Worker and verify the actual R2 binding, successful encrypted write/read, stale ETag conflict, offline retry and saved recovery-file restore in a separate profile. Check network requests contain no plaintext or recovery key. Setup health/auth checks alone do not prove R2 writes.
3. Complete live authenticated Gmail compatibility testing. This branch does not add a new Gmail adapter or claim live compatibility.
4. When merging open tracking, combine background routing/clear behavior, settings and manifest changes deliberately; run both branches' suites. Restoring tracking capabilities never grants host access or recreates expired/deleted server records.

## Limits

Cloud storage keeps the latest snapshot, not revision history or multi-device synchronization. An upload whose acknowledgement is lost can require restoring the latest cloud copy before resuming. Current records with matching IDs win during restore; this is recovery into a fresh profile, not a way to roll back existing edits. Local downloads are manual. Browser scheduling can be delayed; pending status is not proof of a confirmed upload. A prepared download is not proof it was saved. Recovery files are secrets. Working browser data is not encrypted at rest by Vynlo. There is no password/key reset. Pausing/clearing does not delete remote objects or downloaded files; delete remote objects through your Cloudflare R2 dashboard after pausing uploads.
