# Privacy policy draft

Applies to the Vynlo 0.1 local-first extension. Reviewed against the implementation on 2026-10-22. Before public distribution, the maintainer must publish this policy at a stable URL and add a real support contact.

## Data Vynlo handles

Vynlo reads limited visible Gmail page information needed for its features: the current account email, a supported conversation's identifier and title, and the state of a supported compose editor. It observes page changes to keep those controls associated with the current view. It does not enumerate your mailbox or automatically scrape your contacts.

When you choose to track a conversation, Vynlo stores its account namespace, thread identifier, Gmail navigation link, title, status, dates and notes you enter. It also stores reminders, contact email addresses and names you enter, contact notes/tags, saved snippets and settings. Snippets are shared across your local Vynlo workspace. Account records, conversations, contacts, reminders and email tags remain separated by account. Tags store a minimal conversation reference, category, source and review status.

Vynlo does not store entire received message bodies or attachments. Text you deliberately type into a note or snippet becomes part of that record; avoid including information you do not want stored locally.

## Where data goes

Structured records stay in IndexedDB under the extension origin. Small preferences and UI revision signals use `chrome.storage.local`. Vynlo does not use Chrome storage sync, run a server, request Google OAuth, use a Gmail API token, collect analytics or send your records to the project maintainer or third parties.

Optional local AI starts off. After you enable it and grant loopback access, Vynlo sends only the subject of a supported opened conversation to local Ollama at `http://127.0.0.1:11434`. It checks the local runtime and installed model first; it does not scan the mailbox or download models. Inference runs in a separate local application that you control. Use the local-only setup in [classification](CLASSIFICATION.md). Manual tags work without AI. Disabling AI stops new inference; clearing Vynlo data also resets AI opt-in. Backups include tags, but never enable AI on import.

The extension has no hosted AI service, advertising, tracking pixels or automatic email sending. Inserting a snippet edits your Gmail draft only when you request it. Google may sync that draft as part of Gmail's normal behavior; Vynlo does not control Gmail's own network activity.

Desktop reminders use generic text without the conversation subject or contact name. Your browser and operating system control notification display. Clicking a reminder opens its saved Gmail reference. Exporting creates a JSON file on your device; you decide whether to share or move that file.

## Security and retention

Vynlo does not encrypt its database or exported backups. It does not provide end-to-end encryption. Browser-profile access, device malware, backups of your computer or an untrusted extension update can expose local records. Protect your device and exported files accordingly.

Records remain until you delete them, clear Vynlo data, remove the extension or clear the relevant browser-profile data. There is no automatic retention timer. Browser removal and storage clearing are controlled by the browser; export anything you want to keep first. Clearing Vynlo data does not delete Gmail messages or backup files you previously downloaded.

## Your controls

Settings let you disable Gmail enhancements, turn desktop notifications on or off, export records, import a backup and clear local Vynlo data. Individual contacts, snippets and tracked conversations can be removed separately. Removing conversation tracking also removes its reminder. Disabling Gmail UI enhancements alone does not delete stored records or necessarily stop scheduled reminders; use notification preferences or dismiss reminders for that purpose.

## Permission purposes

| Access                        | Why it is needed                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail content-script match    | Add Vynlo controls and read the current supported page context on `mail.google.com`                                                                              |
| `storage`                     | Persist small preferences and notify extension views about local changes                                                                                         |
| `alarms`                      | Resume the service worker when a local reminder is due                                                                                                           |
| `notifications`               | Display an optional desktop reminder                                                                                                                             |
| Optional `http://127.0.0.1/*` | Connect to local Ollama only after permission and AI opt-in; Chrome host patterns cannot restrict ports, while the client fixes port 11434 and rejects redirects |

Vynlo does not request browsing history, all-site access, cookies or the `tabs` permission. Opening a user-requested Gmail link uses the browser's tab-creation API without reading browsing history.

## Publication review

Local handling still involves user data. The Chrome Web Store disclosure must accurately describe account identifiers and communication-related references, even though they are not transmitted. The publisher should review the current [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) and [Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use) against the final package. This draft is not a claim of store approval or legal compliance.
