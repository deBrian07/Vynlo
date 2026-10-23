# Your categories

Open **Email tags → New category**, give it a name and explain what belongs there. You can immediately choose that category when tagging a supported conversation, even with AI disabled.

Confirm at least **three different subject lines** in a category. When local AI and automatic suggestions are enabled in Settings, Vynlo can use your confirmed examples to categorize new conversations you open. You can also request a suggestion manually before reaching three examples.

Suggestions always remain unconfirmed until you choose **Keep** or manually select a category. Correcting a tag updates its example; removing a tag removes the example. Deleting a category removes its Vynlo tags and examples after confirmation. Gmail messages and Gmail labels are unchanged.

## What learning means

The existing local Tev1 model receives a bounded selection of your confirmed subject lines alongside category descriptions. This is in-context learning, not model weight training. Only manually chosen or explicitly confirmed tags supply examples. Unconfirmed AI predictions cannot reinforce themselves.

Examples and category definitions are isolated by verified Gmail account, stored in extension IndexedDB, and included in Vynlo backups. Subject lines remain on the device during inference. There is no embedding service, remote training, new model download, mailbox scan or message-body storage.

## Limits

- Up to 16 custom categories per account, alongside the eight defaults.
- Names: 50 characters. Descriptions: 160 characters.
- Up to eight reference excerpts, each at most 120 characters, with at most two per category. Selection favors subjects sharing words with the new subject, then recent confirmations. Duplicate subject lines count once.
- The current conversation never supplies its own reference example. Automatic assignment requires three distinct confirmed examples in the predicted custom category, excluding the current conversation.
- The existing 768-token limit and one-forward-pass inference are retained. The runtime trims context when necessary, and fails safely when the category names and current subject still cannot fit. Longer taxonomies may retain fewer examples.
- Three examples establish eligibility, not reliable accuracy. Sparse, overlapping, vague or adversarial subjects still need review. Custom-category model quality has not been established by a real GPU benchmark or held-out user dataset.
- Automatic suggestions apply only to supported conversations opened while the feature is enabled. These are Vynlo tags, not native Gmail labels.

Custom category definitions and confirmed examples survive extension updates with the same extension ID. Reinstallation can remove browser-local data; export a backup or enable the separately optional encrypted backup feature where available.

## Validation for this implementation

- `pnpm check`: 310 unit/component/integration tests across 38 files, formatting, ESLint, strict TypeScript and production build passed.
- `pnpm check:browser-ai`: verified runtime packaging and actual CPU ONNX Identity execution passed with JavaScript string compilation disabled.
- `pnpm check:browser-ai:tokenizer`: 360 existing prompt contracts and four personalized contracts passed using the real pinned tokenizer. The personalized cases retained eight references at 9 choices (475/525 tokens) and 24 choices (617/667 tokens), below the 768-token ceiling. Model forward/GPU were stubbed; these are contract checks, not quality or end-to-end latency measurements.
- `pnpm test:classifier:browser:build`: browser benchmark build passed.
- `pnpm exec playwright test --max-failures=1`: blocked during Chromium launch (`SIGABRT`, process cleanup `EPERM`); the first test failed before UI interaction and the remaining 13 did not run. No live Gmail interaction or personalized GPU inference was verified here.

Before enabling this broadly, evaluate fresh custom categories with separate teaching and held-out subjects, including overlapping categories, misleading names and instruction-like subjects. Report per-category precision/recall and review coverage. The existing fixed-category synthetic results do not establish personalized accuracy.

## Pre-merge review follow-up

The follow-up review fixed mixed automatic/manual request coalescing, inconsistent category-name normalization across UI/import/storage, older duplicate learning references, explicit unknown-account UI fallback, and recovery after a blocked IndexedDB upgrade. Regression tests cover these fixes.

`pnpm check` now passes **316 tests across 38 files**, formatting, lint, TypeScript and a production build. The real-tokenizer check still passes all 364 contracts. Playwright test discovery includes 15 browser fixtures, including the new custom-category creation/tagging/reload/deletion flow; discovery does not execute browser interactions. The attempted browser run still crashes during Chromium startup before interaction.

Remaining merge verification: run `pnpm test:e2e` in an environment where Chromium launches, and measure actual personalized Tev1 predictions on fresh held-out subjects after teaching custom categories. Until those checks pass, custom-category AI remains experimental and its accuracy is unverified.
