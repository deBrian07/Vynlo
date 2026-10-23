# Classification validation

Validation is split into software behavior, browser execution and classification quality. Passing unit tests cannot establish model accuracy or live Gmail compatibility.

## What is verified in this checkout

- The Tev1 model repository, immutable revision, file sizes and LFS hashes are pinned in `src/features/classification/browser/assets.ts`.
- Model files download only after a user action and a Chrome host permission prompt. Inference uses cached files only; the runtime cannot make a model-host request with a subject.
- Unit tests exercise cache completion, truncation, cancellation, allowed redirect hosts, the runtime worker bridge, account-scoped tags, conservative review handling, and unsupported GPU behavior.
- Engine tests use mocked WebGPU, tokenizers and model outputs. They verify prompt limits, one-forward eight-choice scoring, tensor cleanup and lifecycle behavior. They do not run Tev1 weights.
- Browser tests use local Gmail fixtures. They do not prove compatibility with every Gmail layout.
- A real Playwright Chromium startup was attempted but this environment's browser process aborted with a macOS Mach-port rendezvous error before page creation. No actual WebGPU adapter or model inference was exercised here.

## Production evidence still needed

The browser integration is experimental until it has been exercised on supported physical devices. Run the extension with the pinned weights, and record the Chrome version, GPU adapter, model load time, warm inference median/p95, memory where available, failures, model revision and evaluation fixture hash. Include an Apple Silicon Mac and a supported non-Apple device. Verify that idle release and cancellation return resources.

Run the fixed synthetic screening set and inspect per-category confusion, ambiguous/injection acceptance, runtime errors, coverage and review-threshold precision. Then run a separately labeled, consented and held-out evaluation representative of real subjects. Freeze the prompt and thresholds before the held-out run. A score concentrated on one candidate is not a calibrated probability of correctness.

Keep suggestions opt-in and reviewable until independent quality and supported-hardware performance results justify a broader claim. The Tev1 fine-tuned model card currently says its release license is pending finalization; resolve licensing before public distribution or production claims.

## Earlier implementation checks

Before the WebGPU implementation, the Ollama-based tag storage and UI passed 179 tests and a WXT build. The Ollama runtime requirement has since been removed. Those historical checks do not validate the current packaged inference runtime. Current results should be appended below after running `pnpm check`, `pnpm test:e2e`, `pnpm zip` and inspecting the resulting package.

## Current browser implementation checks

Run on 2026-10-22 in the original checkout, branch `feat/local-classification`:

| Check | Result |
| --- | --- |
| `pnpm check` | Passed formatting, ESLint, strict TypeScript, 195 tests across 30 files, and production WXT build. |
| `pnpm test:e2e` | Blocked before test bodies: all 14 launches of Playwright Chromium exited with `SIGABRT` and `EPERM` during browser startup. |
| `pnpm zip` | Passed; produced `.output/vynlo-0.1.0-chrome.zip` (7.00 MB compressed; WXT reports 28.29 MB unpacked). |
| ZIP inspection | Confirmed Manifest V3, offscreen permission, optional Hugging Face download hosts, and packaged inference HTML, JavaScript, WASM and runtime manifest. No broad tab/history/cookie permission. |
| Runtime integrity | `node scripts/prepare-browser-ai.mjs --check` passed against all five packaged runtime/license files. |
| Actual model/GPU | Not run. The environment could not launch Chromium, so it did not download Tev1 weights or inspect WebGPU. No latency, memory or accuracy result is claimed. |
| Live Gmail | Not run. Fixture tests and UI tests are not live-Gmail compatibility evidence. |

The host printed a pnpm registry metadata DNS warning while running local commands, but the installed toolchain completed the checks. The packaged runtime preparation used the already verified local artifacts; the generated browser build did not contain a CDN runtime import.
