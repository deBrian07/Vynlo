# Browser AI

Vynlo's browser classification path runs Tev1 on WebGPU. It does not need Ollama, a companion app, an API key, or a hosted inference service. Manual tags work without downloading a model.

This path is experimental. Software tests do not establish Tev1's email accuracy, and no measured speed or memory claim is made until the actual packaged extension has been evaluated on supported hardware. See [classification validation](CLASSIFICATION_VALIDATION.md) for the current evidence.

## Using it

Open Vynlo settings and choose the browser AI setup action. Vynlo checks whether Chrome exposes a suitable WebGPU adapter before loading the model. Approve the model download explicitly; it is roughly **947 MB** for the text model and tokenizer, excluding runtime files and browser overhead. The first setup can take time depending on the connection and shader compilation. Subsequent use reuses the browser's model cache when available.

The GPU must support `shader-f16`. M-series Macs can provide GPU acceleration through Chrome's WebGPU implementation, but Vynlo checks the actual adapter rather than assuming support from the computer model. Hardware acceleration, browser policy, available memory, and the browser version affect availability. There is no automatic CPU fallback: unexpectedly running this model on the CPU could consume too much time and energy.

Enable suggestions separately after setup. Automatic suggestions, if enabled, apply only to supported conversations as you open them. Vynlo classifies the subject, never scans the whole mailbox, and does not change Gmail's labels. Suggestions remain reviewable; manual corrections are preserved.

Turning off browser AI cancels pending work and releases the model worker. Cached weights are separate from loaded GPU resources: a cached model does not mean the GPU remains active. Browser storage cleanup or extension removal may remove the model cache, requiring another download.

## Resource limits

The browser path uses a dedicated worker in a single offscreen extension document so inference does not run on Gmail's main thread. It loads only the text embedding and quantized decoder sessions, without the vision encoder. Each classification scores eight option letters in one forward pass rather than generating an email response.

The implementation caps tokenized prompts at 768 tokens, runs one inference at a time, and bounds the queue. It releases the worker after 30 seconds of inactivity. An inference exceeding 8 seconds or a model load exceeding 120 seconds resets the worker; cancellation also terminates the worker. These are resource safeguards, not claims about normal latency. No background mailbox polling or unattended model download occurs.

Model file size is not peak RAM or GPU memory. Loading may temporarily allocate downloaded buffers, ONNX Runtime memory, GPU weights, and intermediate tensors at the same time. Measure peak memory and repeated-use latency on the target device before approving a release.

## Preparing a development build

Executable runtime files must be packaged with the extension. A developer prepares them once:

```sh
node scripts/prepare-browser-ai.mjs
node scripts/prepare-browser-ai.mjs --check
pnpm build
```

The preparation script installs the pinned runtime in `artifacts/browser-ai-deps`, without changing the root package manifest or lockfile, then bundles its browser entry with the repository's Vite. If npm installation fails, it can use three browser-only upstream package archives with pinned SHA-512 integrity checks; this avoids downloading native inference dependencies. It copies the matching ONNX Runtime asyncify factory, WASM binary, and licenses into `public/inference-runtime`. It does not download model weights. The generated manifest records file sizes and SHA-256 hashes for packaging verification; hashes detect changed packaged files, not the trustworthiness or accuracy of the model.

Prepared dependencies:

- `@huggingface/transformers` **4.3.1**.
- Its pinned `onnxruntime-web` **1.31.0-dev.20260914-8d85527a0** and `onnxruntime-common` **1.31.0-dev.20260911-2a43ec07e**.

The prepared runtime uses ONNX Runtime's external-WASM browser entry rather than embedding additional WASM variants in JavaScript. The executable browser bundle is about 610 KB and its single WASM binary is 26,861,777 bytes. These are measured packaged file sizes, not runtime memory estimates.

The preparation step stages a complete runtime and verifies it before replacing an existing one. Dependency or network failures exit with code 2 and preserve a previously prepared runtime. A normal extension build prepares these files automatically; builds fail if the reviewed runtime cannot be prepared. Manual tags do not depend on AI setup.

Do not replace missing runtime files with dummy modules, CDN script imports, or a heuristic presented as Tev1. Production ZIPs with browser AI must contain the verified runtime assets. The runtime's default CDN WASM loading is overridden with packaged extension URLs; WASM cache factory rewriting is disabled, with a single WASM thread and no proxy worker.

## Model and privacy boundary

The fixed model is [raphaelmansuy/tev1-0.8b-onnx-webgpu](https://huggingface.co/raphaelmansuy/tev1-0.8b-onnx-webgpu), pinned to revision:

```text
26a904f1d138eddc711f9f116e045bffc1924dbd
```

Its text path uses:

- `onnx/embed_tokens_fp16.onnx` and its external `.onnx_data` weights.
- `onnx/decoder_model_merged_q4f16.onnx` and its external `.onnx_data` weights.
- The pinned configuration and tokenizer files.

The public model card reports roughly 509 MB for embedding weights, 424 MB for decoder weights, and 12.8 MB for the tokenizer. File sizes may be displayed with rounded units by Hugging Face; the pinned revision and the download controls identify the actual assets.

Only static model asset downloads contact Hugging Face and its file delivery infrastructure. Email subjects are processed locally and must never be included in remote URLs, headers, or request bodies. Runtime JavaScript and WASM are packaged, not downloaded as executable code at use time. Model weights are cached under the extension origin, not Gmail's origin. User-created tag records remain in the service worker's account-scoped database.

Local processing does not encrypt local storage. The model can make mistakes, especially with vague subjects, mixed topics, prompt injection, or unfamiliar languages. A concentrated score over eight options is not a calibrated probability that the chosen category is correct.

## Validation in this environment

The actual pinned runtime archives were downloaded and verified against the npm registry's SHA-512 integrity values. The preparation script successfully bundled them; its `--check` verified all five packaged runtime and license files against the generated SHA-256 manifest. npm itself failed DNS resolution, so the verified browser-only archive route was used.

A minimal Playwright browser launch was attempted. Chromium exited during startup with a macOS Mach-port rendezvous error before a page or GPU adapter could be inspected. This is a browser execution blocker; no GPU inference latency, peak memory, or Tev1 classification accuracy result follows from the packaging checks.

## Release requirements

Before calling this production ready:

1. Prepare the actual runtime, build the extension, and verify the ZIP includes the reviewed files.
2. Run the actual model benchmark through the browser implementation, preserving outputs, fixture hash, adapter details, load time, inference latency, errors, and memory measurements where available.
3. Test cancellation, repeated use, idle unloading, permission removal, offline cached use, changed accounts, and a missing or lost GPU adapter in Chrome.
4. Run a separately labeled, consented, held-out email evaluation. Synthetic fixtures are a regression screen, not a production accuracy guarantee.
5. Resolve the Tev1 fine-tuned weights' release license before distributing them or advertising broad production availability. The upstream and conversion model cards currently say this license is being finalized; the base model's Apache-2.0 license does not settle the fine-tune's terms.

If the runtime or weights cannot be downloaded in the execution environment, report that exact blocker. Mocked inference and passing component tests cannot be reported as GPU execution or model accuracy evidence.

Sources: [upstream Tev1 intended interface and limitations](https://huggingface.co/togethercomputer/Tev1-0.8B-experimental), [browser conversion and dtype mapping](https://huggingface.co/raphaelmansuy/tev1-0.8b-onnx-webgpu), [Transformers.js 4.3.1 release](https://github.com/huggingface/transformers.js/releases/tag/4.3.1), [tagged runtime dependencies](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/package.json), [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen), [WXT unlisted entrypoints](https://wxt.dev/guide/essentials/entrypoints.html#unlisted-pages).
