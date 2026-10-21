# Vynlo working rules

- Build a local-first Gmail extension. No backend, Gmail API, OAuth, analytics or automatic sending.
- Keep Gmail selectors inside `src/gmail`. Fail closed when account or conversation identity is uncertain.
- All structured storage belongs to the extension service worker, never the Gmail origin.
- Preserve account isolation. Validate messages and imported data at runtime.
- Run type checks, unit/integration tests, lint and a production build for changes.
- Use many small commits with short, straightforward conventional messages. No co-author or contributor trailers.
- Parallel work must have separate file ownership. The main thread handles commits and integration.
- Do not claim fixture tests establish live Gmail compatibility.
