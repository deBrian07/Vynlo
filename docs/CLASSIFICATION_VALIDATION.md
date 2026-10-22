# Classification validation

Executed on 2026-10-22 in `/Users/brianchen/Documents/Vynlo`, branch `feat/local-classification`, based directly on local main `e9244ed`.

## Executed checks

| Check                            | Result                                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                     | Passed formatting, ESLint, strict TypeScript, 179 tests across 27 files and a production WXT build                                                 |
| `pnpm preview:build`             | Passed; design harness built without a model or fabricated predictions                                                                             |
| `pnpm zip`                       | Produced `.output/vynlo-0.1.0-chrome.zip`; 14 files, 220566 bytes                                                                                  |
| ZIP/manifest inspection          | Root Manifest V3, required storage/alarms/notifications, optional loopback host only, fixed local connect policy; no source/test/profile artifacts |
| `pnpm test:classifier`           | Attempted; exited 2 before inference because local Ollama was unreachable. No model accuracy report generated                                      |
| `pnpm test:e2e --max-failures=1` | Attempted; Chromium aborted during launch with SIGABRT and EPERM, before the first test body. 13 remaining tests did not run                       |
| Live Gmail                       | Not executed in this environment                                                                                                                   |
| Branch publication               | `git push -u origin feat/local-classification` attempted; blocked by `Could not resolve host: github.com`                                          |

The 179 tests include the 120-example fixture validator and metric calculations, local response validation, denied permissions, malformed messages, account isolation, database migration, backup round trips, UI consent/review, stale inference, manual correction races and cleanup. Mocked inference tests establish application behavior, **not Tev1 classification quality**.

## Model evaluation blocker

No Ollama executable, running local service or Tev1 weights are present. Shell requests cannot resolve Hugging Face, Ollama's registry or GitHub. The system Python also lacks Transformers and PyTorch. The Hugging Face checkpoint cannot run here without an obtainable runtime and weights. Browser access to a model card does not provide an execution runtime.

## Release gate

Tev1 classification is **experimental and not approved for production automation**. All model results remain suggestions requiring review, even when automatically generated. Manual tagging is independent of the model. Keep AI opt-in off by default.

Once the local runtime is available, run `pnpm test:classifier` for the frozen 120-subject synthetic screen. Inspect the generated report and errors. A passing synthetic screen is only a first gate; production approval requires a separate representative, consented held-out dataset and supported-hardware latency measurements, followed by browser and authenticated Gmail checks. The setup and decision criteria are in [CLASSIFICATION.md](CLASSIFICATION.md).

The browser suite adds manual tag persistence, no-inference defaults and account switching. Two pre-existing fixture issues were corrected: the reminder preset locator now includes its displayed date in the accessible name, and seeded thread URLs include the required account query. These changes still need execution on a Chromium-capable host.

## Local loading

Run `pnpm build`, load `.output/chrome-mv3` through Chrome's **Load unpacked**, then reload Gmail. Continue using the same installed extension path/ID to preserve its local data. This branch does not include the separate brand-kit branch or alter an existing `release/Vynlo` folder. Do not load that older folder expecting this build.
