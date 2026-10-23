# Classification validation

Validation is split into software behavior, browser execution and classification quality. Passing unit tests cannot establish model accuracy or live Gmail compatibility.

## What is verified in this checkout

- The Tev1 model repository, immutable revision, file sizes and LFS hashes are pinned in `src/features/classification/browser/assets.ts`.
- Model files download only after a user action and a Chrome host permission prompt. Inference uses cached files only; the runtime cannot make a model-host request with a subject.
- Unit tests exercise cache completion, truncation, cancellation, compressed downloads, storage limits, allowed redirect hosts, the runtime worker bridge, account-scoped tags, conservative review handling, and unsupported GPU behavior.
- Engine tests use mocked WebGPU, tokenizers and model outputs. They verify all eight category mappings with noncontiguous token IDs, float16 decoding, stable softmax with extreme logits, invariance to score offsets, tied decisions, prompt limits, one-forward scoring, tensor cleanup and lifecycle behavior. They do not run Tev1 weights.
- The real packaged tokenizer and standalone template process all 120 synthetic subjects through the production engine. Forward execution is explicitly stubbed. This verifies the pinned asset URLs, tokenizer/template integration, 267–281-token prompts, and rejection of an oversized Unicode input; it produces no accuracy score.
- The actual packaged ONNX runtime executes a tiny Identity graph under Node with JavaScript string compilation disabled. Its real float16 tensor conversion is checked. This verifies CPU runtime packaging, not Tev1 or the WebGPU/CSP execution path.
- Consent tests cover concurrent enable/pause/removal, corrupted model scores, late inference completions and actual background routing for import, clear-data and disabled enhancements. Offscreen tests cover active-job heartbeats and cleanup; bridge tests cover delayed handshakes, cancelled creation, stale ports, worker recovery and asynchronous setup.
- Browser tests use local Gmail fixtures. They do not prove compatibility with every Gmail layout.
- Playwright Chromium startup exited with `SIGABRT` and `EPERM` before page creation. The local real-model benchmark server was also blocked by `listen EPERM` at `127.0.0.1:4174`. No actual WebGPU adapter or model inference was exercised here.

## Fixed during this review

The actual tokenizer exposed two defects that mocks missed: its configuration does not contain a chat template, and upstream tokenizer-file discovery drops the requested model revision. The engine now loads the pinned standalone template and pins URL construction as well as model-loading options. Raw float16 logits are converted before scoring, avoiding decisions based on their unsigned integer bit patterns.

Setup now checks the packaged runtime and the model's minimum GPU buffer limits before the 946 MB download, survives reopening settings, and returns immediately while work continues through short progress requests. Only active offscreen jobs send heartbeats; cancellation, timeouts, failed sessions and stale worker ports release or restart resources. Configuration writes are serialized so pausing, removing or importing data cannot be undone by an older enable request.

## Production evidence still needed

The browser integration is experimental until it has been exercised on supported physical devices. Run the extension with the pinned weights, and record the Chrome version, GPU adapter, model load time, warm inference median/p95, memory where available, failures, model revision and evaluation fixture hash. Include an Apple Silicon Mac and a supported non-Apple device. Verify that idle release and cancellation return resources.

Run the fixed synthetic screening set and inspect per-category confusion, ambiguous/injection acceptance, runtime errors, coverage and review-threshold precision. Then run a separately labeled, consented and held-out evaluation representative of real subjects. Freeze the prompt and thresholds before the held-out run. A score concentrated on one candidate is not a calibrated probability of correctness.

Keep suggestions opt-in and reviewable until independent quality and supported-hardware performance results justify a broader claim. The Tev1 fine-tuned model card currently says its release license is pending finalization; resolve licensing before public distribution or production claims.

## User-provided GPU result and conversion diagnosis

After the initial review, the user supplied a completed 120-case browser run: zero runtime errors, 12/96 straightforward subjects correct (12.5%), macro F1 `0.029702970297029705`, and no predictions above the acceptance threshold. Recruiting received 89/96 straightforward predictions; the other seven were Work. The reported post-first-request median was `139.10000002384186` ms and p95 was `147` ms. These timings and outputs came from the user's run, not execution by this agent; the supplied excerpt did not include adapter/browser identity. This run failed the synthetic quality gate.

Inspection found a numerical mismatch in the third-party model conversion. Qwen's zero-centered RMSNorm applies `normalized_x * (1 + weight)`; the conversion copies the raw weights into fused ONNX normalization scale inputs. The pinned decoder graph has no intervening addition. Exactly 61 scales are affected. The 18 gated DeltaNet norms use ordinary scales and must not receive the same correction. Earlier tokenizer, scoring and lifecycle tests did not establish source-to-export numerical parity.

The repair validates the immutable decoder graph's hash and structure before inserting `+1` on those specific scale inputs. It leaves cached graph/weight bytes intact, so the user's existing download is reusable. The executable normalization check exercises the production graph-fetch path and compares ONNX normalization results to an independent numerical reference. The benchmark report records the correction revision. No corrected full-model accuracy is claimed until that benchmark actually runs.

Correction checks executed in this checkout:

- `pnpm check`: formatting, lint, strict types, **273 tests across 33 files**, and production build passed.
- `pnpm check:browser-ai:normalization`: passed the actual pinned graph, production cache-fetch path and real packaged CPU execution on 61 synthetic normalization scales. Maximum corrected error was `1.453656057748276e-7`, compared with `1.4605933166247507` before repair. Both normalization operator types were exercised; the exempt gated scale and cached source were unchanged.
- The corrected graph is 668,429 bytes; SHA-256 `f2e415be0de484d8155f0f95bdbfb9b03a1850ca4adbe23d7ef9e99cd9c6fdbd`. The regression check pins this exact output as well as its original source hash.
- `pnpm check:browser-ai:tokenizer`: all 120 real-tokenizer contracts still passed, with model output stubbed. The prompt, categories and thresholds were not changed.
- `pnpm test:classifier:browser:build` and `pnpm zip`: passed. ZIP inspection verified the repair is included, packaged runtime hashes match, files match the unpacked build, permissions are unchanged, and no model weights or development tests are included. ZIP size: 7,009,383 bytes; unpacked size: 28,304,704 bytes.
- Starting `pnpm test:classifier:browser` was blocked by `listen EPERM` on `127.0.0.1:4174`. Playwright still exited with `SIGABRT`/`EPERM` during startup, before test bodies. No corrected full-model GPU, accuracy or live-Gmail result was produced here.

Arithmetic results are saved in ignored `artifacts/browser-ai-normalization/report.json`. The correction adds graph constants in memory, without copying the large external weights or redownloading a valid existing cache. If the small cached graph fails its hash check, only that graph and the completion marker are evicted; retrying setup retains the large weight files.

To rerun the user's benchmark, restart the local server with `pnpm test:classifier:browser`, reload `http://127.0.0.1:4174` and confirm the page says `qwen-zero-centered-rmsnorm-v1`. Check GPU, then choose **Run 120 synthetic fixtures**. Existing cached weights are reused. Keep both reports; do not treat an arithmetic regression as an improved classification score.

## Earlier implementation checks

Before the WebGPU implementation, the local tag storage and UI passed 179 tests and a WXT build. Those historical checks do not validate the current packaged inference runtime.

## Initial browser implementation checks

Run on 2026-10-22 in the original checkout, branch `feat/local-classification`. Final review results:

| Check                             | Result                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                      | Passed formatting, ESLint, strict TypeScript, 247 tests across 32 files, and production WXT build.                                                                                             |
| `pnpm test:e2e --max-failures=1`  | Blocked in browser launch before the first test body: Chromium exited with `SIGABRT` and `EPERM`; 13 remaining tests did not run. Earlier attempts were blocked the same way.                  |
| `pnpm zip`                        | Passed; produced `.output/vynlo-0.1.0-chrome.zip` (7,005,959 bytes; 28,295,195 bytes unpacked).                                                                                                |
| ZIP inspection                    | Confirmed Manifest V3, offscreen permission, optional Hugging Face download hosts, and packaged inference HTML, JavaScript, WASM and runtime manifest. No broad tab/history/cookie permission. |
| `pnpm check:browser-ai`           | Passed all five runtime/license hashes, a clean archive-only rebuild with networking disabled, actual ONNX Identity inference and actual float16 conversion.                                   |
| `pnpm check:browser-ai:tokenizer` | Passed the real tokenizer/template contract on all 120 subjects; GPU/model outputs stubbed. Fixture SHA-256: `c381577bf27cd4a8e4f540036b2d6971d55bbe8cb5a6fb5a8947c20e51da2841`.               |
| Browser harness builds            | `pnpm test:classifier:browser:build` and `pnpm preview:build` passed. Building is not execution.                                                                                               |
| Actual model/GPU                  | Not run. The environment could not launch Chromium, so it did not download Tev1 weights or inspect WebGPU. No latency, memory or accuracy result is claimed.                                   |
| Live Gmail                        | Not run. Fixture tests and UI tests are not live-Gmail compatibility evidence.                                                                                                                 |

The host printed a pnpm registry metadata DNS warning while running local commands, but the installed toolchain completed the checks. Runtime preparation used verified pinned archives. No model weights were downloaded. The tokenizer contract report is saved in ignored `artifacts/browser-ai-tokenizer/report.json`; runtime smoke results are printed to the terminal.

To obtain real model-quality evidence on a supported device, run `pnpm test:classifier:browser`, open `http://127.0.0.1:4174`, check the GPU, download the model and run the 120 synthetic cases. Export the report. The harness uses the production engine with actual weights, reports failures and measured timings, and never substitutes a prediction. This does not replace extension/offscreen tests or a separately labeled held-out evaluation.
