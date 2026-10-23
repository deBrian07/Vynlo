# Vynlo working rules

- Build a local-first Gmail extension. No hosted backend, Gmail API, OAuth, analytics or automatic sending. The user authorized optional Tev1 0.8B inference inside the extension through WebGPU, with explicit model downloads from Hugging Face. Bundle executable runtime code locally; never send subjects to download hosts. Default off, no cloud inference or mailbox-body persistence.
- Keep Gmail selectors inside `src/gmail`. Fail closed when account or conversation identity is uncertain.
- All structured storage belongs to the extension service worker, never the Gmail origin.
- Preserve account isolation. Validate messages and imported data at runtime.
- Run type checks, unit/integration tests, lint and a production build for changes.
- Use many small commits with short, straightforward conventional messages. No co-author or contributor trailers.
- Parallel work must have separate file ownership. The main thread handles commits and integration.
- Do not claim fixture tests establish live Gmail compatibility.
