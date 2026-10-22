# Privacy policy draft

Applies to the Vynlo 0.1 local-first extension. Reviewed against the implementation on 2026-10-22. Before public distribution, the maintainer must publish this policy at a stable URL and add a real support contact.

## Data Vynlo handles

Vynlo reads limited visible Gmail page information needed for its features: the current account email, a supported conversation's identifier and title, and the state of a supported compose editor. It observes page changes to keep those controls associated with the current view. It does not enumerate your mailbox or automatically scrape your contacts.

When you choose to track a conversation, Vynlo stores its account namespace, thread identifier, Gmail navigation link, title, status, dates and notes you enter. It also stores reminders, contact email addresses and names you enter, contact notes/tags, saved snippets and settings. Snippets are shared across your local Vynlo workspace. Account records, conversations, contacts and reminders remain separated by account.

Vynlo does not store entire received message bodies or attachments. Text you deliberately type into a note or snippet becomes part of that record; avoid including information you do not want stored locally.

## Where data goes

Structured records stay in IndexedDB under the extension origin. Small preferences and UI revision signals use `chrome.storage.local`. Vynlo does not use Chrome storage sync, automatically connect to a server, request Google OAuth, use a Gmail API token, collect analytics or send plaintext workspace records to the project maintainer or third parties. Optional encrypted backups are described below.

The extension has no remote AI service, advertising, tracking pixels or automatic email sending. Inserting a snippet edits your Gmail draft only when you request it. Google may sync that draft as part of Gmail's normal behavior; Vynlo does not control Gmail's own network activity.

Desktop reminders use generic text without the conversation subject or contact name. Your browser and operating system control notification display. Clicking a reminder opens its saved Gmail reference. Exporting creates a JSON file on your device; you decide whether to share or move that file.

## Security and retention

Vynlo does not encrypt its local browser database or legacy JSON exports. Data protection files use password-based PBKDF2-SHA256 (600,000 iterations, random salt) and AES-256-GCM. Optional cloud snapshots use a random recovery secret with separate HKDF-derived encryption and server authorization keys. Only ciphertext leaves the extension; this does not protect against a compromised browser or recovery file. Browser-profile access, device malware, backups of your computer or an untrusted extension update can expose local records. Protect your device and exported files accordingly.

Records remain until you delete them, clear Vynlo data, remove the extension or clear the relevant browser-profile data. There is no automatic retention timer. Browser removal and storage clearing are controlled by the browser; export anything you want to keep first. Clearing Vynlo data does not delete Gmail messages or backup files you previously downloaded.

## Optional encrypted backups

Cloud backups start disabled. Preparing a service connection verifies the selected Worker but does not upload workspace records. Enabling requires explicit consent and confirmation that the recovery file was saved outside Chrome. Only then are encrypted snapshots uploaded after changes and periodically while Chrome can run. Permission is requested for the selected HTTPS Workers origin, from an optional manifest host pattern. Cloudflare sees request metadata, object sizes, update timing and a random vault ID; it does not receive the recovery secret or workspace plaintext. The private R2 object also stores a hash of an independent authorization token.

A snapshot contains all local accounts, minimal conversation references, notes, reminders, contacts, snippets and settings. If the separate open-tracking module has data in this profile, the encrypted snapshot includes its local history and capabilities. Those capabilities are not sent as plaintext. Restoring does not automatically grant tracking host permissions. Normal Gmail message bodies and attachments are not collected.

The recovery file contains an unencrypted master secret and must be kept private outside Chrome. Anyone holding it can retrieve, decrypt and replace that vault. The service operator cannot reset a lost key. The current installation retains the secret locally to run unattended backups; browser-profile compromise can expose it. Legacy exports remain plaintext and exclude these extra recovery capabilities.

Pausing stops uploads but leaves the cloud object intact. There is no automatic expiry or deletion endpoint. The operator can delete the private R2 object after uploads stop. Clearing local data or uninstalling loses local backup configuration and keys, but does not remove downloaded files or cloud objects. A separate recovery file is necessary to recover after reinstalling. The service retains only the latest snapshot, not revision history; conditional writes prevent silently overwriting a newer remote copy.

## Your controls

Settings let you disable Gmail enhancements, turn desktop notifications on or off, export records, import a backup and clear local Vynlo data. Individual contacts, snippets and tracked conversations can be removed separately. Removing conversation tracking also removes its reminder. Disabling Gmail UI enhancements alone does not delete stored records or necessarily stop scheduled reminders; use notification preferences or dismiss reminders for that purpose.

## Permission purposes

| Access                     | Why it is needed                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------- |
| Gmail content-script match | Add Vynlo controls and read the current supported page context on `mail.google.com` |
| `storage`                  | Persist small preferences and notify extension views about local changes            |
| `alarms`                   | Resume the service worker when a local reminder is due                              |
| `notifications`            | Display an optional desktop reminder                                                |

Vynlo does not request browsing history, all-site access, cookies or the `tabs` permission. Opening a user-requested Gmail link uses the browser's tab-creation API without reading browsing history.

## Publication review

Local handling still involves user data. The Chrome Web Store disclosure must accurately describe account identifiers and communication-related references, even though they are not transmitted. The publisher should review the current [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) and [Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use) against the final package. This draft is not a claim of store approval or legal compliance.
