# Security model

Vynlo's initial release handles personal email references and user-authored notes locally. There is no backend, Gmail API authorization, remote script loader or automatic message-sending path.

## Boundaries and controls

- Gmail DOM is untrusted input. Account and thread detection must fail closed when identity is missing, stale or ambiguous. Subject text is display metadata, never an identifier.
- Structured persistence belongs to the extension service worker. Runtime messages validate both the request shape and sender. Bulk import/export, clear and settings writes are reserved for extension pages.
- Account-scoped queries and mutations check account ownership. Numeric Gmail account slots are never database namespaces. This prevents accidental cross-account association; it is not cryptographic authentication of page-provided identities.
- Saved links are restricted to the expected Gmail origin, account query and thread hash before opening. Imported backups receive schema, length, duplicate-ID and relationship validation.
- Snippets resolve to plain text. Composer insertion uses Chromium's native text-editing command; it does not parse template text as HTML or activate Gmail's Send control.
- The production extension packages its reviewed JavaScript and WASM inference runtime. Optional Hugging Face host permission is used only after explicit user action to download fixed model files at a pinned revision; inference uses an extension-origin cache-only fetcher and does not send subjects to the network. AI starts off. Content scripts do not load executable remote code. Development tooling may use a local development server; audit the production package separately.
- Database operations use transactions. A settings journal recovers interrupted cross-storage imports. Alarms are reconstructed from durable reminder records.

Model decisions are untrusted suggestions and never send, archive, move or relabel Gmail messages. Manual corrections and cleared data take precedence over delayed inference. A malicious or altered model file can produce false decisions; a pinned revision and TLS transport are not cryptographic proof of model behavior.

## Limits of protection

Local storage and backup files are not encrypted by Vynlo. The extension does not protect against a compromised browser profile, operating system, malicious update or a page deliberately impersonating Gmail identity attributes. Gmail DOM changes can disable functionality. They must never be worked around by blindly accepting a subject or stale URL.

Notification delivery is best-effort. Persisting the attempt before calling Chrome avoids duplicate attempts after worker restarts but can miss a desktop alert if the worker exits between those operations. Due reminders remain in the dashboard. This is not a system for safety-critical or exact-time deadlines.

## Review before release

1. Inspect the generated manifest. Require only `storage`, `alarms`, `notifications` and `offscreen`; keep content matches limited to Gmail. Optional host access should be limited to the fixed Hugging Face model download hosts.
2. Search source and built code for network clients, remote script URLs, HTML insertion, page-main-world execution and message forwarding. Investigate each occurrence rather than assuming a keyword scan proves safety.
3. Run invalid-sender, invalid-import, malicious-snippet, stale-identity and cross-account tests.
4. Test import failure/retry and reminder restart behavior. Verify errors do not erase valid records.
5. Review dependency changes and lockfile integrity. Check the ZIP contains no credentials, personal fixtures, source backups or development-only access.
6. Complete the real Gmail release gate before advertising general compatibility.

## Reporting a security problem

A public security-reporting contact has not been configured for this preview. Before publication, the maintainer must establish a private reporting channel and add it here. Do not post personal messages, account addresses, browser profiles, tokens or complete backups in a public issue. Use synthetic reproduction data and describe the affected version and boundary.

See [privacy](PRIVACY.md), [release checks](RELEASE.md) and the project [working rules](../AGENTS.md).
