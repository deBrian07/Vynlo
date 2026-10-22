# Using Vynlo

Vynlo adds a productivity panel to Gmail. It works in your existing browser profile, without a Vynlo account or subscription.

## Track a conversation

Open a supported Gmail conversation and choose **Needs Reply**, **Waiting**, **Follow Up** or **Resolved**. Add your own note or schedule a reminder. Your records remain available after refreshing Gmail.

Open the dashboard to search tracked conversations, filter by status or due reminders, and review your next steps. You can change a status or schedule a reminder directly from a conversation row.

Tracking is manual. **Waiting** means you marked that conversation as waiting; it does not mean Vynlo checked for a reply. Vynlo never sends email.

If tracking is unavailable, read the explanation in the panel. Vynlo requires a visible conversation heading corroborated against its URL. Legacy hexadecimal routes and a restricted modern `f` token format are supported when the visible identifiers agree. Draft tokens, unknown formats and ambiguous views disable tracking. Saved references use a corroborated 16-character hexadecimal ID; subjects are never unique identifiers. See [Gmail compatibility](GMAIL_COMPATIBILITY.md) for the supported paths and manual validation checklist.

## Manage reminders

Schedule a reminder, then snooze it, dismiss it or resolve the conversation when you're done. Due reminders remain in the dashboard even if your operating system suppresses the desktop notification.

Resolving a conversation dismisses its reminder. Removing tracking also removes the associated reminder. Reminder delivery depends on Chrome and the operating system; Vynlo does not guarantee exact-time notifications or infer whether someone replied.

## Insert a snippet

1. Focus the Gmail draft you want to edit.
2. Open Vynlo's snippet picker using its visible control.
3. Choose a snippet, fill any requested variables and insert it.
4. Review the result, then send through Gmail yourself.

Snippets are categorized and searchable. Variables such as `{{first_name}}` ask for values rather than guessing recipient details. A new install includes starter templates that you can edit or delete.

Insertion adds plain text and preserves existing draft content. If text is selected, Vynlo inserts after the selection instead of replacing it. Supported composer behavior is covered by fixtures; actual Gmail draft autosave and compatibility still need the live checks in [Gmail compatibility](GMAIL_COMPATIBILITY.md).

## Keep contact notes

Save notes and tags against a contact email address under the current Gmail account. Vynlo does not scrape your contact list or store entire email histories.

Conversations, reminders and contacts are account-scoped. Snippets are shared across your local Vynlo workspace.

## Keyboard shortcuts

| Action          | macOS       | Windows/Linux |
| --------------- | ----------- | ------------- |
| Command palette | Cmd+K       | Ctrl+K        |
| Dashboard       | Cmd+Shift+Y | Ctrl+Shift+Y  |
| Mark waiting    | Cmd+Shift+U | Ctrl+Shift+U  |
| Mark resolved   | Cmd+Shift+E | Ctrl+Shift+E  |
| Snippets        | Cmd+Shift+. | Ctrl+Shift+.  |

Shortcuts deliberately do not fire while typing in an input or composer, preserving Gmail's link-insertion command. Use visible controls when composing, and change bindings in settings if another extension or browser shortcut conflicts.

In the command palette, use arrow keys to select, **Enter** to run and **Escape** to close. You can also open it from inside the workspace. Mark Waiting and Mark Resolved shortcuts update the conversation with a brief confirmation without opening the dashboard.

## Settings and data

Open settings from the extension popup or Vynlo's workspace. Choose light, dark or automatic theme, adjust keyboard shortcuts, and export, import or clear local data.

Exports contain all accounts, snippets, contact notes, conversations, reminders and settings. They are readable JSON, not encrypted archives. Keep them private.

Import validates schema version 1, merges missing records and keeps existing local records with the same IDs. Imported settings replace current preferences. Save an export before importing.

Your structured records live in extension-owned IndexedDB; preferences use `chrome.storage.local`. Chrome alarms wake the Manifest V3 service worker for reminders. Normal extension updates preserve browser-profile storage. Export before uninstalling or changing installation paths: another extension ID has a separate data store.

Vynlo reads visible Gmail structures to identify the current account, supported conversation and composer. It stores minimal conversation references and user-created data. It does not store message bodies or attachments, intercept Gmail traffic, request OAuth or transmit records to a server. Anyone with access to your browser profile may be able to read local records. Normal Gmail behavior, including syncing a draft you edit, remains controlled by Google.

Read the [privacy policy draft](PRIVACY.md), [security model](SECURITY.md) and [known limitations](LIMITATIONS.md). Automatic reply detection, smart inboxes, cloud synchronization and Gmail API access are outside this release.

## Install and update a local build

Use Chrome/Chromium 120 or newer, Node.js 22.13.0 or newer and pnpm 11.9.0.

```sh
pnpm install --frozen-lockfile
pnpm build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `.output/chrome-mv3` inside this repository.
3. Open or reload `https://mail.google.com/mail/`.
4. Open Vynlo from its Gmail control, or open settings from the extension popup.

After rebuilding, reload the extension in `chrome://extensions`, then reload Gmail. To make a ZIP, run `pnpm zip`; WXT writes it into `.output/`. Extract the ZIP before using **Load unpacked**. These commands do not publish the extension. See [release instructions](RELEASE.md) for package checks and remaining public-distribution requirements.

## Development and design preview

```sh
pnpm dev
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm zip
```

`pnpm check` runs formatting, ESLint, TypeScript, unit/integration tests and a production build. Vitest, React Testing Library and Playwright exercise the layers that can be tested without Google credentials.

For an interactive design fixture with fictional data, run `pnpm preview` and open the printed local URL. It uses the real UI and storage service in a separate test database; it is not a Gmail compatibility test. Browser fixture testing is a separate command.

See [development](DEVELOPMENT.md), [architecture](ARCHITECTURE.md) and [contributing](../CONTRIBUTING.md). The source is [MIT-licensed](../LICENSE), and the repository is [deBrian07/Vynlo](https://github.com/deBrian07/Vynlo). A private support channel has not been configured; do not post personal email data in public issues.

## Screenshot checklist

The README banner is a marketing illustration, not a verified Gmail capture. Live Gmail screenshots are not included. Capture only synthetic accounts and messages after completing the release checks:

- Supported conversation controls
- Dashboard with due reminders
- Command palette
- Snippet variables
- Light and dark settings

The live preview runs at `http://127.0.0.1:4173/` and updates when source changes. Keep its terminal open; press Ctrl+C to stop. To inspect a static production preview, run `pnpm preview:build` then `pnpm preview:static` instead. Both use port 4173, so stop one before starting the other. The fixture uses fictional data, not your Gmail mailbox.
