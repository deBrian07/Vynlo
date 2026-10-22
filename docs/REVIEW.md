# Product and reliability review

## Changes from the initial implementation

- Reworked the interface into flatter conversation rows, compact counters and tabs, restrained neutral surfaces, a warm charcoal command menu and a responsive workspace sidebar. Reviewed public [Superhuman Mail imagery](https://superhuman.com/apps/mail) and its [command interaction reference](https://help.superhuman.com/hc/en-us/articles/46005789591693-Speed-Up-With-Shortcuts). Vynlo retains its own identity and assets; its Gmail integration does not replace the underlying Gmail interface or promise pixel-for-pixel parity.
- Added direct reminder actions, inline status selection and a Due filter. Relative dates refresh while the dashboard is open. Presets display the date and time they will save.
- Kept status shortcuts immediate: they update tracking and show a confirmation instead of opening the workspace. The command palette also works from the open workspace. Typing within Vynlo is isolated from Gmail's bubbling keyboard listeners.
- Protected unsaved preferences when switching views. Clean settings synchronize with other views, and saves merge untouched preference changes rather than replacing them blindly.
- Replaced editor discard prompts with native in-app confirmation dialogs. Pending actions cannot be dismissed or submitted twice; failures remain readable inside the dialog.
- Protected existing contact notes when adding a duplicate email. Contact identity stays fixed during editing; tags are validated before saving.
- Added personalized plain-text snippet previews. A modal is closed before handing focus back to a composer; the adapter refuses insertion if that exact composer cannot receive focus. This prevents accidentally inserting into a variable input while the Gmail editor is inert.
- Corrected startup behavior so subsequent storage changes do not reopen a deliberately closed workspace. Request generations prevent stale reads from replacing the current account view.
- Added strictly corroborated modern thread-route support; unknown encodings, drafts and stale or ambiguous headings remain disabled. See [Gmail compatibility](GMAIL_COMPATIBILITY.md).
- Removed the separate design-preview header. Theme controls, commands, tagline and fictional-data disclosure now live inside the workspace sidebar; draft tools expand on demand.
- Added `pnpm release` to produce a visible `release/Vynlo` folder, ZIP and offline three-step installation guide. A prepared build requires Chrome only; developer tooling is needed only when building source.

## Executed validation

- TypeScript and ESLint passed after the review changes.
- The complete Vitest run passed 103 tests across 19 files, covering storage, reminders, import validation, route decoding, account isolation, composer targeting, keyboard actions, dialogs, settings and component workflows.
- The production MV3 build and the separate design-preview build succeeded.
- Manually exercised the actual components in a Chrome Guest window against the local fictional-data fixture: light and dark views, command palette search/navigation, opening settings with arrow keys and Enter, unsaved-settings navigation guard, due filtering, snooze persistence, and responsive layout at increased browser zoom. The separate fictional draft lab also exercised the actual adapter with Chromium native editing: literal `<Acme>` text was inserted after existing content, focus returned to the correct editor, and Cmd+Z restored the original draft. This verifies the native editing path in that fixture, not Gmail autosave.
- Compared the rendered command menu against the public reference. No proprietary images, fonts, icons or code were added to the extension.
- Re-ran formatting, ESLint, TypeScript, all 103 tests and production build after the sidebar/setup changes. Built the release, checked MV3 permissions and referenced resources, and verified the ZIP and visible unpacked folder match the production build byte for byte. Opened the setup guide in Chrome and exercised the relocated theme, commands and draft-lab controls in the fictional-data fixture. These checks do not install the extension or verify authenticated Gmail.

## Remaining release gates

- Current Playwright execution is blocked before the page loads: Chromium exits with `SIGABRT`, and sandbox process cleanup reports `EPERM`. The expanded browser journeys exist and typecheck; they are not reported as passing in this review. Run `pnpm build && pnpm test:e2e` in an environment that permits Chromium processes.
- No authenticated Gmail session was used in this review. Verify the adapter selectors, account links, Gmail draft autosave/undo and all documented layouts using the [manual checklist](GMAIL_COMPATIBILITY.md).
- Gmail's own interface remains Gmail. Visual changes apply to Vynlo's controls and workspace. Broader identity support, automatic reply detection and cloud integrations are separate engineering work.
- A public repository URL, support channel, privacy-policy hosting and Chrome Web Store submission are still pending. Nothing was published.

## Local visual inspection

Run `pnpm preview:build` followed by `pnpm preview`. The fixture is visibly labeled with fictional data, uses a separate IndexedDB database and never loads as a production extension entrypoint. It uses the same React components and local background service, while notifications and navigation to fictional conversations are intentionally unavailable. The Draft lab button additionally exercises native insertion and undo using Vynlo’s actual snippet picker and adapter on a fictional editable draft. It provides UI validation without Google credentials; it does not stand in for a real Gmail compatibility test.
