# Open-tracking validation

The feature branch implements a personal, optional Cloudflare Worker service. It has not been deployed to Cloudflare or verified against an authenticated Gmail session during this implementation.

## Executed checks

- ESLint, strict TypeScript and formatting pass.
- Vitest: 168 tests across 24 files pass, including the original functionality.
- Worker tests execute the production migration and SQL against real in-memory SQLite. They cover authorization, hashed capabilities, paused/activated records, expiry, rate limiting, bounded writes, deletion and fail-safe image responses.
- Extension-service tests route actual requests into that Worker with SQLite, covering creation, restart recovery, activation, refresh, revocation, account isolation, denied permissions and invalid responses. No external network is used.
- Draft tests use representative Gmail fixtures and a mocked native editor command. They cover content/caret preservation, duplicate prevention, modal teardown, unmounts and switching accounts or composers during a request. They do not prove Gmail image persistence or native undo.
- Setup tests verify endpoint/config validation and the deployment smoke-check request sequence, including cleanup after failed creation/activation. No cloud commands were executed.
- Built the production extension, design fixture and ZIP. Inspected the new activity and connection-file setup UI manually in Chrome Guest against fictional local data. The preview cannot connect to remote tracking.
- Attempted all 13 existing Playwright browser journeys. Chromium exited before any page loaded (`SIGABRT`; process cleanup reported `EPERM`). They are not passing results. Run them in a browser-capable environment before release.

## Live acceptance checklist

1. Run `pnpm tracking:setup` in a test Cloudflare account. Confirm the helper's real create/activate/read/delete smoke check succeeds, including cleanup.
2. Load the built extension. Verify no Worker requests occur by default. Import `connection.json`, leave consent unchecked and confirm no connection occurs. Connect with consent; verify Chrome requests only that Worker origin. Check denial, wrong key and unavailable Worker errors.
3. Open a synthetic Gmail draft. Choose **Track this draft**, add a local label and verify existing text and cursor remain intact. Confirm Gmail saves the image, undo works and no message is sent. Check multiple drafts, plain-text mode, replies, reloads and account switching.
4. Send the synthetic email manually. Activate the corresponding activity entry, then open it in a controlled recipient client. Refresh and verify the signal. Check blocked images, a proxy client and your own sent-message view. Document observed false negatives/positives; never interpret no signal as unread.
5. Restart Chrome and repeat refresh. Disconnect and reconnect. Delete an entry and confirm its image no longer creates events. Confirm expiry/cleanup on the deployed Worker using disposable test records, without changing real user records.
6. Verify core export excludes tracking capabilities/history; clear local data in a test profile and confirm connection/history are gone. Remote deletion is separate and must be completed before clear/uninstall for immediate revocation.

A successful local build does not close these live compatibility gates. Do not publish broad read-receipt claims.
