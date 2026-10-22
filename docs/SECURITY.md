# Security model

Vynlo's initial release handles personal email references and user-authored notes locally. There is no backend, Gmail API authorization, remote script loader or automatic message-sending path.

## Boundaries and controls

- Gmail DOM is untrusted input. Account and thread detection must fail closed when identity is missing, stale or ambiguous. Subject text is display metadata, never an identifier.
- Structured persistence belongs to the extension service worker. Runtime messages validate both the request shape and sender. Bulk import/export, clear and settings writes are reserved for extension pages.
- Account-scoped queries and mutations check account ownership. Numeric Gmail account slots are never database namespaces. This prevents accidental cross-account association; it is not cryptographic authentication of page-provided identities.
- Saved links are restricted to the expected Gmail origin, account query and thread hash before opening. Imported backups receive schema, length, duplicate-ID and relationship validation.
- Snippets resolve to plain text. Composer insertion uses Chromium's native text-editing command; it does not parse template text as HTML or activate Gmail's Send control.
- The production extension-page CSP permits only packaged scripts and allows connections only to local `http://127.0.0.1:11434` for optional inference. Requests use fixed endpoints, omit credentials/referrers, reject redirects, enforce size/deadline bounds and validate model decisions. Loopback access requires an optional host permission; AI is separately off by default. Content scripts do not load executable remote code. Development tooling may use a local development server; audit the production package separately.
- Database operations use transactions. A settings journal recovers interrupted cross-storage imports. Alarms are reconstructed from durable reminder records.

Model decisions are untrusted suggestions and never send, archive, move or relabel Gmail messages. Manual corrections and cleared data take precedence over delayed inference. A local process impersonating Ollama or altered model weights can produce false decisions; local model naming is not cryptographic weight verification.

## Limits of protection

Local storage and backup files are not encrypted by Vynlo. The extension does not protect against a compromised browser profile, operating system, malicious update or a page deliberately impersonating Gmail identity attributes. Gmail DOM changes can disable functionality. They must never be worked around by blindly accepting a subject or stale URL.

Notification delivery is best-effort. Persisting the attempt before calling Chrome avoids duplicate attempts after worker restarts but can miss a desktop alert if the worker exits between those operations. Due reminders remain in the dashboard. This is not a system for safety-critical or exact-time deadlines.

## Review before release

1. Inspect the generated manifest. Require only `storage`, `alarms` and `notifications`; keep content matches limited to Gmail. The only optional host permission is loopback HTTP for local inference.
2. Search source and built code for network clients, remote script URLs, HTML insertion, page-main-world execution and message forwarding. Investigate each occurrence rather than assuming a keyword scan proves safety.
3. Run invalid-sender, invalid-import, malicious-snippet, stale-identity and cross-account tests.
4. Test import failure/retry and reminder restart behavior. Verify errors do not erase valid records.
5. Review dependency changes and lockfile integrity. Check the ZIP contains no credentials, personal fixtures, source backups or development-only access.
6. Complete the real Gmail release gate before advertising general compatibility.

## Reporting a security problem

A public security-reporting contact has not been configured for this preview. Before publication, the maintainer must establish a private reporting channel and add it here. Do not post personal messages, account addresses, browser profiles, tokens or complete backups in a public issue. Use synthetic reproduction data and describe the affected version and boundary.

See [privacy](PRIVACY.md), [release checks](RELEASE.md) and the project [working rules](../AGENTS.md).
