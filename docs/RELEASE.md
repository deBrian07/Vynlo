# Release preparation

Vynlo 0.1 is a compatibility preview. A successful build does not remove the live Gmail gate. Do not publish a store listing that implies ordinary opaque Gmail routes are supported until that restriction is resolved and verified.

## Build and inspect

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm zip
```

The unpacked extension is `.output/chrome-mv3`. WXT places the distributable ZIP in `.output/`; use the filename reported by the packaging command. The archive must contain `manifest.json` at its root alongside the referenced scripts, pages and icons. Do not wrap the extension in another parent directory inside the ZIP.

Load the extracted archive through `chrome://extensions` → Developer mode → Load unpacked, using a fresh test profile. This checks the actual deliverable instead of a development build. Keep a backup of personal Vynlo records before changing installations or uninstalling.

CI validates source and creates a build artifact. The workflow does not publish a release, upload to the Chrome Web Store or require production credentials. Check the GitHub run itself after the project is hosted; a workflow file is not a completed CI run.

## Versioning

`package.json` supplies the extension version. Use numeric `major.minor.patch` values compatible with Chrome. Patch releases fix supported behavior; minor releases add compatible features; changes that require migration or alter documented privacy behavior need explicit review and release notes. Database/backup schema versions are separate: increment them only with corresponding migration or import handling. Test upgrading a profile containing the previous version's data.

## Release checklist

- [ ] Frozen-lockfile install succeeds in a clean environment.
- [ ] Formatting, lint, strict TypeScript, unit/integration tests and production build pass.
- [ ] Playwright fixture journeys pass; record browser and test results.
- [ ] Complete and record the real Gmail checks in [GMAIL_COMPATIBILITY.md](GMAIL_COMPATIBILITY.md).
- [ ] Verify the supported account/thread path is practical for intended users; do not ship a misleading primary tracking promise.
- [ ] Test pending reminders after worker/browser restart, due dashboard recovery, notification denial, snooze and resolve.
- [ ] Review import/export, account isolation, clearing data and corrupted-input behavior.
- [ ] Inspect the generated manifest: only `storage`, `alarms`, `notifications`; Gmail-only content matches; no development server access or remote code.
- [ ] Inspect ZIP structure and load that exact artifact in a fresh Chrome profile.
- [ ] Review dependencies and bundled code for unapproved network use and secret/user-data leakage.
- [ ] Record bundle sizes and any performance measurements without claiming unmeasured improvements.
- [ ] Set the real repository, documentation, support and privacy-policy URLs.
- [ ] Establish a private security-reporting channel.
- [ ] Capture screenshots with synthetic data and accurate feature states.
- [ ] Compare privacy/store disclosures against the actual submitted package.
- [ ] Obtain explicit owner authorization before publishing, submitting or paying any registration fee.

## Chrome Web Store listing draft

**Name:** Vynlo — Gmail conversation tracking

**Short description:** Track Gmail conversations, schedule local follow-up reminders and insert reusable snippets. Free and open source.

**Single purpose:** Help users manage their personal Gmail follow-up workflow through local conversation tracking, reminders, notes and reusable writing snippets.

**Description draft:**

Vynlo adds a local productivity panel to Gmail. Mark a supported conversation Needs Reply, Waiting, Follow Up or Resolved, then review your next steps in one dashboard. Set a reminder, save a contact note or insert a snippet you wrote into your draft.

Your Vynlo records stay in your browser profile. There is no Vynlo account, subscription, cloud service, AI provider or advertising. Data is exportable as JSON. Local storage and exported files are not encrypted by Vynlo.

Tracking is manual. Vynlo does not detect replies or send email. Desktop reminders depend on Chrome and operating-system availability; due items stay visible in the dashboard. The compatibility preview supports only corroborated legacy thread routes, not most opaque Gmail URLs. Check the published compatibility guide before installation.

Publish this draft only after filling the support/privacy links and validating the promised environment. Update its limitations if the verified supported scope changes; do not simply remove them for marketing.

## Permission explanations and data disclosure

| Permission/access           | Store explanation                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `storage`                   | Save local preferences and coordinate extension views. Structured user records use extension-owned IndexedDB.          |
| `alarms`                    | Wake the extension to process scheduled follow-up reminders and recover overdue work.                                  |
| `notifications`             | Show optional generic desktop reminders requested by the user.                                                         |
| Gmail content-script access | Display controls in Gmail, identify the supported current account/thread and insert requested plain text into a draft. |

The extension handles account/contact email addresses, minimal communication references, user-authored notes/snippets, dates and settings. It does not transmit these to Vynlo or an analytics provider. Do not describe the product as handling no user data merely because processing is local. The current implementation has no browsing-history collection, credentials, OAuth tokens, mailbox body archive, tracking pixels, remote code or automatic sending.

The publisher must review the dashboard's current disclosure categories and answer them against the submitted build. The [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) treats local collection/use as data handling; the [Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use) constrains purpose and transfer. Review the [privacy policy draft](PRIVACY.md) and publish a stable policy URL. These checks do not constitute store approval.

## Screenshot checklist

- [ ] Conversation status/note controls on a genuinely supported fixture or verified Gmail view; label fixture imagery accurately.
- [ ] Dashboard with synthetic Waiting, Follow Up and due-reminder examples.
- [ ] Command palette showing search and an explained unavailable action.
- [ ] Snippet variable form and preserved draft text, with no accidental Send action.
- [ ] Contact notes and tags using invented addresses.
- [ ] Light/dark settings and export/import controls.
- [ ] No real subjects, addresses, message text, account avatars, tokens or notification content.
- [ ] Check current store image size requirements at submission; do not stretch mockups into proof of unsupported functionality.

## Notification behavior to disclose

Chrome alarms may be delayed and do not wake a sleeping device. Vynlo reconstructs schedules when its service worker resumes; it cannot notify while Chrome cannot run. See the [Chrome alarms documentation](https://developer.chrome.com/docs/extensions/reference/api/alarms). A persisted notification attempt can be missed if the worker crashes immediately before dispatch. The due record remains available, and snoozing schedules another attempt.
