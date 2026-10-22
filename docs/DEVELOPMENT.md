# Development

Use Node.js 22.13.0 or newer and pnpm 11.9.0, matching `package.json`. Install from the committed lockfile with `pnpm install --frozen-lockfile`. The postinstall step prepares WXT's generated TypeScript configuration.

## Commands

| Command             | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | WXT development mode with reload support      |
| `pnpm build`        | Production Chrome Manifest V3 extension       |
| `pnpm zip`          | Build and package the extension in `.output/` |
| `pnpm typecheck`    | Prepare WXT and check strict TypeScript       |
| `pnpm lint`         | ESLint                                        |
| `pnpm format`       | Apply Prettier                                |
| `pnpm format:check` | Verify formatting                             |
| `pnpm test`         | Vitest unit and integration suite             |
| `pnpm test:watch`   | Vitest watch mode                             |
| `pnpm test:e2e`     | Playwright browser fixture suite              |
| `pnpm check`        | Formatting, lint, typecheck, tests and build  |

For Playwright, install Chromium first with `pnpm exec playwright install chromium`; Linux CI may need `pnpm exec playwright install --with-deps chromium`. These test fixtures use synthetic identities and require no Google credentials.

The production unpacked directory is `.output/chrome-mv3`. Load it from `chrome://extensions` with Developer mode enabled. Reload the extension after a production rebuild and reload existing Gmail tabs. Inspect the service worker from the extension's details page when debugging alarms or messages.

## Test boundaries

Vitest exercises pure utilities, React interactions, adapter fixtures and persistence/background behavior. Fake IndexedDB makes storage tests deterministic. Platform interfaces allow reminder timing and notification failures to be simulated without waiting for an operating-system notification.

Playwright exercises Chromium behavior against controlled fixtures. It does not log into Google, and it cannot establish Gmail autosave behavior or compatibility with every Gmail DOM rollout. Follow [GMAIL_COMPATIBILITY.md](GMAIL_COMPATIBILITY.md) for the separate live release gate. Keep test output explicit about which environment actually ran.

When fixing an adapter regression, first add a minimal synthetic fixture reproducing it. Test absent, stale and duplicate elements as well as the working case. Account-switching changes need isolation checks; composer changes need preservation, wrong-target and text-safety checks.

## Data and migrations

Only the extension service worker may access structured storage. Do not open a database from Gmail's content-script execution environment. Keep requests in `src/types/messages.ts` and runtime checks in `src/services/validation.ts` aligned.

Database and JSON backup schemas both start at version 1. Export includes all five record collections and settings. Import rejects unsupported schema versions, duplicate IDs, invalid links and broken relationships. Valid records merge by ID without overwriting local records; settings are replaced through the journaled path. Changing that policy requires an explicit user-facing migration design.

## Diagnostics

Use fake subjects, addresses and note text in tests and bug reports. Never log email bodies, user notes, snippets, credentials, imported backups or complete runtime messages. Errors shown to users should identify a recoverable action without exposing a stack trace or private data.

If dependency installation is unavailable, report the exact failure. Running a tool from an existing local installation can validate code, but does not prove a fresh frozen-lockfile install succeeds. Do not remove checks or manufacture a lockfile to hide an environment limitation.

## Useful references

- [WXT entrypoints](https://wxt.dev/guide/essentials/entrypoints.html)
- [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Chrome extension content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

## Interactive visual fixture

Run `pnpm preview:build` then `pnpm preview` and open the printed localhost URL. The preview is explicitly labeled with fictional data and uses the real UI/background service with a separate database. The Draft lab uses the actual Gmail adapter against a synthetic contenteditable editor so you can verify plain-text insertion, focus restoration and native undo without Google credentials. Notifications and opening fictional conversations are test platform stubs; this preview does not validate live Gmail integration.
