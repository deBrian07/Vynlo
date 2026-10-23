# Browser AI

Vynlo's browser classification path runs Tev1 on WebGPU. It does not need Ollama, a companion app, an API key, or a hosted inference service. Manual tags work without downloading a model.

This path is experimental. Software tests do not establish Tev1's email accuracy, and no measured speed or memory claim is made until the actual packaged extension has been evaluated on supported hardware. See [classification validation](CLASSIFICATION_VALIDATION.md) for the current evidence.

## Using it

Open Vynlo settings and choose **Download model**. Vynlo checks the packaged runtime and GPU support before downloading **946,078,454 bytes** of model and tokenizer files (about 946 MB), excluding browser overhead. The first setup can take time depending on the connection and shader compilation. Subsequent use reuses cached files. Reopening settings resumes the progress display and cancellation controls. If download access was revoked, **Allow model access** restores it without removing cached files.

The GPU must support `shader-f16` and buffer/storage-binding limits of at least **508,559,360 bytes**. The pinned embedding graph contains a single `[248320, 1024]` float16 table that ONNX Runtime binds as one buffer. Preflight rejects smaller limits before a large download. Passing this check does not establish that enough total GPU memory is free. M-series Macs may provide WebGPU acceleration; actual browser/adapter support is checked. There is no automatic CPU fallback.

Enable suggestions separately after setup. Automatic suggestions, if enabled, apply only to supported conversations as you open them. Vynlo classifies the subject, never scans the whole mailbox, and does not change Gmail's labels. Suggestions remain reviewable; manual corrections are preserved.

Turning off browser AI cancels pending work and releases the model worker. Cached weights are separate from loaded GPU resources: a cached model does not mean the GPU remains active. Browser storage cleanup or extension removal may remove the model cache, requiring another download.

## Resource limits

The browser path uses a dedicated worker in a single offscreen extension document so inference does not run on Gmail's main thread. It loads only the text embedding and quantized decoder sessions, without the vision encoder. Each classification scores eight option letters in one forward pass rather than generating an email response.

The implementation caps tokenized prompts at 768 tokens and runs one inference at a time without queuing subjects. It releases the worker after 30 seconds of inactivity. Forward execution has an 8-second deadline, model loading 120 seconds, and explicit downloading 10 minutes; exceeding a deadline resets the worker. Cancellation also terminates it. These are resource safeguards, not claims about normal latency. Loading time and tokenization/scoring time are reported separately. No background mailbox polling or unattended model download occurs.

Setup starts as an asynchronous job followed through short status requests, so one Chrome message is not held open for the whole download. Only active jobs send service-worker heartbeats. Completed files survive an interrupted download and can be reused on retry; browser shutdown or worker termination can still stop setup.

Model file size is not peak RAM or GPU memory. Loading may temporarily allocate downloaded buffers, ONNX Runtime memory, GPU weights, and intermediate tensors at the same time. Measure peak memory and repeated-use latency on the target device before approving a release.

## Preparing a development build

Development, production builds and ZIP packaging prepare the executable runtime automatically. Additional checks are explicit:

```sh
pnpm build
pnpm check:browser-ai
pnpm check:browser-ai:tokenizer
```

The preparation script downloads three exact browser package archives into `artifacts/browser-ai-deps`, verifies their SHA-512 integrity, and extracts only reviewed browser files. It does not install native inference/image dependencies or resolve a second dependency tree. It bundles the browser entry with Vite and copies the matching WASM factory, binary and licenses into `public/inference-runtime`. Model weights are excluded. The generated manifest records sizes and SHA-256 hashes; checks verify packaging, not model quality.

Prepared dependencies:

- `@huggingface/transformers` **4.3.1**.
- Its pinned `onnxruntime-web` **1.31.0-dev.20260914-8d85527a0** and `onnxruntime-common` **1.31.0-dev.20260911-2a43ec07e**.

The prepared runtime uses ONNX Runtime's external-WASM browser entry rather than embedding additional WASM variants in JavaScript. The executable browser bundle is about 610 KB and its single WASM binary is 26,861,777 bytes. These are measured packaged file sizes, not runtime memory estimates.

The preparation step stages a complete runtime and verifies it before replacing an existing one. Dependency or network failures exit with code 2 and preserve a previously prepared runtime. A normal extension build prepares these files automatically; builds fail if the reviewed runtime cannot be prepared. Manual tags do not depend on AI setup.

Do not replace missing runtime files with dummy modules, CDN script imports, or a heuristic presented as Tev1. Production ZIPs with browser AI must contain the verified runtime assets. The runtime's default CDN WASM loading is overridden with packaged extension URLs; WASM cache factory rewriting is disabled, with a single WASM thread and no proxy worker.

## Normalization correction

The pinned third-party conversion copied Qwen's zero-centered RMSNorm weights into ONNX scale inputs without their required `+1`. Vynlo corrects exactly 61 verified scales: 48 layer input/post-attention norms, 12 attention query/key norms and the final norm. Gated DeltaNet norms use a different formula and are excluded.

Before creating a decoder session, Vynlo checks the cached decoder graph's exact size and SHA-256, validates its expected initializer names, shapes and consumers, then inserts constant scale corrections. The original graph and external weight files remain unchanged in CacheStorage. Existing downloads can be reused; there is no new permission, remote inference or additional weight download. A changed or malformed graph fails closed. The repair is deterministic, versioned and applied only in memory to the pinned graph.

Run `pnpm check:browser-ai:normalization` after the runtime has been prepared. This checks the real pinned graph through the production cache-fetch path and executes synthetic normalization graphs in the packaged ONNX runtime against an independent mathematical reference. It does not execute full Tev1 weights. The browser benchmark displays and exports the correction revision so corrected runs cannot be confused with older results. Reload an already-open benchmark page before rerunning the same 120 subjects; keep its existing model cache.

This repairs model arithmetic, not evidence of email-classification accuracy. The user's original run completed with zero runtime errors but only 12/96 ordinary subjects correct. A corrected real-model run and then an independent held-out evaluation remain necessary before production use.

Primary implementation references: [Qwen RMSNorm formula](https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen3_5/modeling_qwen3_5.py), [third-party transplant](https://github.com/raphaelmansuy/edgextract/blob/master/scripts/export_tev1_onnx.py) and [its initializer mapping](https://github.com/raphaelmansuy/edgextract/blob/master/scripts/tev1_onnx_weights.py).

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

Model downloads validate their pinned URL, approved HTTPS delivery hosts and exact decoded byte counts. The listed LFS hashes are reference metadata; the browser does not currently compute a streaming content digest for the weight files. Archive/runtime integrity checks are separate. Local browser-profile compromise is outside this protection boundary.

Local processing does not encrypt local storage. The model can make mistakes, especially with vague subjects, mixed topics, prompt injection, or unfamiliar languages. A concentrated score over eight options is not a calibrated probability that the chosen category is correct.

## Validation in this environment

`pnpm check:browser-ai` verifies the five packaged runtime/license files, rebuilds from the pinned archives in an empty directory with network access disabled, and executes a tiny real ONNX Identity graph with JavaScript string compilation disabled. It also checks real float16 tensor conversion. This is CPU packaging evidence, not Tev1 or WebGPU execution.

`pnpm check:browser-ai:tokenizer` downloads about 13 MB of pinned tokenizer metadata on first use. It runs all 120 synthetic subjects through the real tokenizer/template and production engine with GPU/model forward explicitly stubbed. The measured prompts use 267–281 tokens; an over-budget Unicode subject is rejected. It caught the missing standalone template and an upstream tokenizer discovery request that omitted the revision. The runtime URL template now pins every discovery/model read to the immutable revision. This check produces no classification-accuracy score.

A Playwright browser launch aborted before page creation. Starting the local GPU benchmark server was also blocked by `listen EPERM` on `127.0.0.1:4174`. No GPU inference latency, peak memory or Tev1 classification accuracy is claimed for this environment.

## Run the actual classification screen

Run `pnpm test:classifier:browser` and open `http://127.0.0.1:4174` in a supported Chrome browser. Check GPU support, explicitly download the model, then run the 120 synthetic cases. The harness uses the production engine and real weights, stops on runtime failures/timeouts, and exports actual decisions, confusion/quality metrics, timings, model revision, fixture hash and available adapter details. Cancel/unload and delete-cache controls are included. No model result is invented when execution is unavailable. This localhost harness does not validate the extension's offscreen integration or live Gmail.

## Release requirements

The corrected user-provided GPU run reached 81.25% ordinary-subject accuracy and still failed the quality gate. The benchmark's **Prompt to evaluate** selector now compares the production baseline with two experimental prompts. These do not alter extension settings. See [experiment evidence and instructions](CLASSIFICATION_EXPERIMENTS.md); export each run and retain a fresh holdout before promoting a prompt.

Before calling this production ready:

1. Prepare the actual runtime, build the extension, and verify the ZIP includes the reviewed files.
2. Run the actual model benchmark through the browser implementation, preserving outputs, fixture hash, adapter details, load time, inference latency, errors, and memory measurements where available.
3. Test cancellation, repeated use, idle unloading, permission removal, offline cached use, changed accounts, and a missing or lost GPU adapter in Chrome.
4. Run a separately labeled, consented, held-out email evaluation. Synthetic fixtures are a regression screen, not a production accuracy guarantee.
5. Resolve the Tev1 fine-tuned weights' release license before distributing them or advertising broad production availability. The upstream and conversion model cards currently say this license is being finalized; the base model's Apache-2.0 license does not settle the fine-tune's terms.

If the runtime or weights cannot be downloaded in the execution environment, report that exact blocker. Mocked inference and passing component tests cannot be reported as GPU execution or model accuracy evidence.

Sources: [upstream Tev1 intended interface and limitations](https://huggingface.co/togethercomputer/Tev1-0.8B-experimental), [browser conversion and dtype mapping](https://huggingface.co/raphaelmansuy/tev1-0.8b-onnx-webgpu), [Transformers.js 4.3.1 release](https://github.com/huggingface/transformers.js/releases/tag/4.3.1), [tagged runtime dependencies](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/package.json), [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen), [WXT unlisted entrypoints](https://wxt.dev/guide/essentials/entrypoints.html#unlisted-pages).
