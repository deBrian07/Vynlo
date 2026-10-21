# Gmail compatibility checkpoint

The adapter uses visible Gmail DOM only. This release does not use InboxSDK, Gmail API, page globals or intercepted requests. The supported identity path is deliberately narrow: one visible account control, one visible conversation heading, and a legacy hexadecimal URL matching that heading. Uncertain states disable persistence.

## Evidence and supported scope

Reviewed on 2026-10-21:

- [InboxSDK's GmailThreadView source](https://github.com/InboxSDK/InboxSDK/blob/master/src/platform-implementation-js/dom-driver/gmail/views/gmail-thread-view.ts) reads `data-thread-perm-id` and `data-legacy-thread-id` from a thread identity element. Its asynchronous fallback depends on other SDK infrastructure that Vynlo does not use.
- [A Gmail permalink userscript author's May 2026 live observations](https://gist.github.com/jamezpolley/6db9635f1dbd093290e78d09a5bda7f8) identify a heading with both attributes and the `[gh="mtb"]` toolbar. Vynlo independently implements a narrower selector restricted to visible headings within Gmail's main region.
- [Google account control example](https://gist.github.com/daniel-barrows/93864da22cc017723a344b684f38fbb5) demonstrates the account email in the Google Account accessibility label. Vynlo requires the explicit control prefix and exactly one email; it never scans all arbitrary email addresses or uses the numeric account slot as identity.

These are private DOM details, not an official Gmail extension API. They establish feasibility, not verification against a signed-in Gmail session. All repository fixtures use invented accounts and content.

## Current limitations

- Conversation tracking requires a URL ending in the same 16-character hexadecimal legacy thread ID exposed by the visible heading, for example `#all/18b123456789abcd`. Most modern Gmail navigation uses opaque tokens; those routes are disabled because their correspondence to the visible heading cannot be established by this implementation. It does not offer a guessed conversion or silently associate a stale heading after SPA navigation.
- Reading panes, multiple visible threads, missing attributes and localized account controls other than the supported `Google Account:` accessibility label fail closed.
- Account identity is a canonical lowercase email. Numeric `/u/0` slots are not durable identities. Saved links use `?authuser=<email>` and need live validation for every supported account type.
- Account controls and headings can update separately. The adapter rejects stale headings across observed account changes and rejects unchanged identities across an observed account path change.
- Compose insertion supports a visible Gmail textbox with `contenteditable=true` and `g_editable=true`. A focused editor takes priority; with multiple editors the user must focus one first. The captured editor and cursor must still exist when insertion runs.
- Plain text is inserted through Chromium's native `insertText` editing command, preserving existing content and its undo/input pipeline. Selected text is retained; insertion occurs after it. No HTML is interpreted and no Send control is activated. Unsupported editing environments report an error instead of mutating the draft with an unverified fallback.
- Theme detection uses computed background luminance, then the operating-system preference. Gmail image themes may need an explicit setting.

## Manual release gate

Do not advertise broad Gmail compatibility until these checks are executed in a real signed-in Chrome session. Record date, browser version, Gmail layout/language and outcome; never commit credentials, real email captures or personal messages.

- [ ] Open a supported canonical thread link; verify account, title and thread association.
- [ ] Change Inbox → thread → another thread → Inbox quickly; no stale tracking actions.
- [ ] Track, reload and find the persisted record on the dashboard.
- [ ] Open two Gmail accounts in separate tabs; isolate records and open saved links in the intended account.
- [ ] Reorder signed-in account slots and confirm identity remains email-based.
- [ ] Check unsupported opaque URLs, reading panes and absent/duplicate headings fail closed.
- [ ] Insert a multiline snippet into an existing rich-text draft and inline reply. Verify autosave, undo, selection preservation and no automatic send.
- [ ] Open two composers, focus each and confirm insertion targets the chosen draft.
- [ ] Close a captured composer before insertion; confirm error and no other draft mutation.
- [ ] Verify light, dark and image themes, keyboard focus and screen-reader labels.
- [ ] Disable/reload extension; no orphaned controls or observers, Gmail remains usable.
