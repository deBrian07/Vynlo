# Vynlo

Email, without the friction.

Vynlo is a free, MIT-licensed Chrome extension that adds conversation tracking, follow-up reminders, snippets and contact notes to Gmail. Your records stay in your browser profile. There is no Vynlo account, server, subscription or AI service.

**Compatibility preview:** the first version supports a deliberately narrow Gmail identity path. Tracking requires a visible conversation heading whose legacy thread ID matches the URL. Most modern opaque Gmail URLs are currently unsupported. Vynlo disables tracking when it cannot establish identity. Automated fixtures do not establish live Gmail compatibility; see the [compatibility checklist](docs/GMAIL_COMPATIBILITY.md) before relying on this release.

## What you can do

- Track supported conversations as Needs Reply, Waiting, Follow Up or Resolved; add your own notes.
- Search and filter a dashboard by status, with due-date and recent-update sorting.
- Schedule local reminders, snooze them, dismiss them or resolve the conversation.
- Open a searchable command palette and use configurable keyboard shortcuts.
- Save categorized snippets, fill variables such as `{{first_name}}` and insert plain text into a supported Gmail composer.
- Keep contact notes and tags under each Gmail account.
- Choose light, dark or automatic themes; export, import or clear local data in settings.

Vynlo never sends email. Waiting means you manually marked the conversation; reminders do not prove that no reply has arrived. Snippets are shared across your local Vynlo workspace; conversations, reminders and contacts are account-scoped.

## Install locally

Requirements: Chrome/Chromium 120 or newer, Node.js 22.13.0 or newer and pnpm 11.9.0.

From this repository:

```sh
pnpm install --frozen-lockfile
pnpm build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `.output/chrome-mv3` inside this repository.
3. Open or reload `https://mail.google.com/mail/`.
4. Open Vynlo from its Gmail control or use the extension popup to open settings.

After rebuilding, reload the extension in `chrome://extensions`, then reload Gmail. Export your records before uninstalling or changing installation paths: another extension ID has a separate data store.

To make a ZIP, run `pnpm zip`. WXT writes it into `.output/`; extract it before using **Load unpacked**. See [release instructions](docs/RELEASE.md) for package checks. Nothing in these commands publishes the extension.

## Use Vynlo

Open a supported conversation, choose a status, then add a note or reminder. If tracking is unavailable, read the explanation in the panel. Do not infer or invent a thread ID from a subject line. Supported references use a corroborated 16-character hexadecimal ID; [Gmail compatibility](docs/GMAIL_COMPATIBILITY.md) explains the current restrictions.

Open the dashboard to review your next steps. Due reminders remain visible even if the operating system suppresses the desktop notification. Resolve a conversation to dismiss its reminder; removing tracking also removes its associated reminder.

For snippets, focus the intended Gmail draft, then open Vynlo's snippet picker using its visible control. Fill any requested variables and choose insert. Insertion preserves existing content, including a selected passage, and inserts after the selection. Review the result before sending through Gmail yourself.

| Action          | macOS       | Windows/Linux |
| --------------- | ----------- | ------------- |
| Command palette | Cmd+K       | Ctrl+K        |
| Dashboard       | Cmd+Shift+Y | Ctrl+Shift+Y  |
| Snippets        | Cmd+Shift+. | Ctrl+Shift+.  |

Shortcuts deliberately do not fire while typing in an input or composer, preserving Gmail's link-insertion command. Change bindings in settings if another extension or browser shortcut conflicts. The command palette uses arrow keys, Enter and Escape.

Backups contain all accounts, snippets, contact notes, conversations, reminders and settings. Import validates schema version 1, merges missing records and keeps existing local records with the same IDs. Imported settings replace current preferences. Keep an export before importing; files are readable JSON, not encrypted archives.

## Development

```sh
pnpm dev
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm zip
```

`pnpm check` runs formatting, ESLint, TypeScript, unit/integration tests and the production build. Browser fixture testing is a separate command. See [development](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md) and [contributing](CONTRIBUTING.md).

The stack is TypeScript, React, WXT/Vite, Tailwind CSS, Lucide and Zustand. Structured records live in extension-owned IndexedDB; preferences use `chrome.storage.local`. Chrome alarms wake a Manifest V3 service worker for reminders. Vitest, React Testing Library and Playwright cover the layers that can be exercised without Google credentials.

## Privacy and limits

Vynlo reads the visible Gmail structures needed to identify the current account, supported thread and composer. It stores minimal conversation references and user-created data. It does not read entire mailboxes, store message bodies or attachments, intercept Gmail traffic, request OAuth or transmit records to a server.

Local data is **not encrypted by Vynlo**. Anyone with access to your browser profile may be able to read it. Export files and text you insert into Gmail need the same care as other personal documents. Normal Gmail behavior, including syncing a draft you edit, remains controlled by Google.

Read the [privacy policy draft](docs/PRIVACY.md), [security model](docs/SECURITY.md) and [known limitations](docs/LIMITATIONS.md). Automatic reply detection, smart inboxes, cloud synchronization and Gmail API access are outside this release. The [roadmap](docs/ROADMAP.md) prioritizes broader verified Gmail support first.

## Screenshots

Screenshot placeholders: supported conversation controls; due-reminder dashboard; command palette; snippet variables; light/dark settings. No live Gmail screenshots are included. Capture only synthetic accounts and messages after completing the release checks.

## Project information

The source is licensed under [MIT](LICENSE). Contributions should follow [CONTRIBUTING.md](CONTRIBUTING.md). A public repository URL and maintainer support address have not been configured yet; this preview does not invent either. Public distribution requires the remaining items in the [release checklist](docs/RELEASE.md).
