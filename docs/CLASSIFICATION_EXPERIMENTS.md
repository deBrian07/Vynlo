# Classification prompt experiments

The corrected Tev1 run completed without runtime errors but failed the quality gate. These experiments address the observed errors without changing the extension's production prompt, model, categories or thresholds.

## Baseline evidence

Source: user-provided `vynlo-browser-ai-2026-10-23T04-33-30.676Z.json`. SHA-256: `48143ef7d0242c3a28635b555eea003fc60aa135db5cbe2ae2f62032e9437e17`. Its 120 examples match the repository fixture exactly. The report identifies the corrected normalization revision, an Apple `metal-3` WebGPU adapter and Chrome 155. This is user-provided execution evidence, not a browser run performed by this agent.

| Group                | Correct | Accepted without review | Correct among accepted |
| -------------------- | ------- | ----------------------- | ---------------------- |
| Ordinary subjects    | 78/96   | 38                      | 38                     |
| Ambiguous subjects   | 11/12   | 2                       | 2                      |
| Adversarial subjects | 9/12    | 3                       | 1                      |

All 18 ordinary mistakes were flagged for review. Thirteen incorrectly chose Other: six Work subjects, three Newsletters, one Recruiting, one Personal and two Notifications. All six missed Work subjects had Work as their strongest alternative. Examples include an architecture discussion and an engineering meeting. The two confident mistakes were pure instructions impersonating system messages, classified as Promotions and Recruiting.

Globally dropping Other would produce only 80/96 correct on this development set and break valid Other examples. Raising confidence thresholds trades away coverage and does not repair category understanding. Neither is the proposed fix.

The file reports a warm median of `139.30000001192093` ms and p95 of `152.59999999403954` ms; its first request includes model loading. This is distinct from the timing excerpt pasted earlier. Main-page heap measurements exclude GPU and worker memory.

## Compare three prompts

Run `pnpm test:classifier:browser`, open `http://127.0.0.1:4174` and use **Prompt to evaluate**. Existing model downloads are reused. Export each run before starting another.

| Prompt                                 | Change from baseline                                                                                                                                       | Real-tokenizer prompt range on the 120 subjects |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Current production prompt              | None                                                                                                                                                       | 267–281 tokens                                  |
| Clear category boundaries              | Broader task descriptions, financial reminders distinct from general notifications, editorial digests distinct from work, narrower Other criterion         | 388–402 tokens                                  |
| Clear boundaries + instruction defense | Same category descriptions as the previous experiment; adds a system instruction distinguishing an email's topic from instructions embedded in its subject | 461–475 tokens                                  |

Each inference still uses one forward pass with a 768-token ceiling. Longer prompts may cost more time; compare measured warm latency, not just accuracy. The report exports the selected prompt ID, its SHA-256 and exact template with an empty subject, alongside model and fixture revisions. The worker rejects unknown prompts and concurrent attempts to change an active prompt. Experimental prompt text is bundled only into the development benchmark, not the extension.

The real tokenizer passed all 360 subject/prompt combinations and rejected an over-budget Unicode subject under every variant. Those are tokenizer contracts with model output stubbed, not accuracy results. Prompt isolation tests also use a mocked model. No experimental candidate's full-model quality has been measured by this agent.

Checks executed for these changes: `pnpm check` passed formatting, ESLint, strict TypeScript, 284 unit/integration tests across 35 files and the production build. `pnpm check:browser-ai:tokenizer`, `pnpm check:browser-ai:normalization`, `pnpm test:classifier:browser:build` and `pnpm zip` passed. ZIP inspection confirmed that the production baseline is present and experimental prompts are absent. Starting `pnpm test:classifier:browser` failed with `listen EPERM` on `127.0.0.1:4174`, so no candidate GPU result is claimed.

## Promotion gate

Compare the complete confusion matrix, accepted precision and coverage, adversarial errors, runtime failures and latency. Keep the existing release gate unchanged. This 120-case set has now informed prompt design, so it is development data. Freeze a promising candidate before evaluating a fresh, separately labeled holdout representative of actual email subjects. Include legitimate subjects mentioning system messages, instructions or category names so instruction defense is tested for false rejections too.

Do not promote a candidate just because it fixes the known examples. If no candidate improves the quality and resource tradeoff, evaluate another model or task-specific training rather than weakening the gate.
