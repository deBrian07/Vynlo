# Local email tags

Vynlo can tag supported Gmail conversations using **Tev1 0.8B through local Ollama**. You can always choose tags manually. Model inference and automatic suggestions start off.

Only the conversation subject is sent to `http://127.0.0.1:11434`. Message bodies, attachments, contact notes and the rest of your mailbox are excluded. Tags belong to Vynlo and are isolated by Gmail account; they do not change Gmail labels. There is no background mailbox scan or reply detection.

## Setup

1. Install [Ollama](https://ollama.com/download), version **0.35.0 or later**.
2. Download the model once: `ollama pull tev1:0.8b`.
3. Open Vynlo settings, follow the local connection instructions, and check the connection. Allow the optional loopback permission when Chrome asks.
4. Enable local suggestions. Enable suggestions as you open conversations separately if desired.

Use the specific extension origin shown in settings if Ollama rejects the connection. Do not expose Ollama to your network or allow every browser origin. `OLLAMA_NO_CLOUD=1` disables Ollama cloud features. Vynlo accepts only the local `tev1:0.8b` model and rejects remote model metadata and redirects.

Chrome host permissions cannot restrict a URL pattern to one port. The optional permission covers the loopback host; Vynlo's client only requests the fixed port and three fixed endpoints. Connection checks send no email subject. Downloading a model requires internet access through Ollama; classification itself uses the local runtime.

Model suggestions remain reviewable. A subject can lack enough context or fit several categories. Manual corrections are preserved. Turning off suggestions prevents further inference; existing tags remain available. Local data is not encrypted by this feature.

## Using the Hugging Face checkpoint instead

The [original Tev1 0.8B checkpoint](https://huggingface.co/togethercomputer/Tev1-0.8B-experimental) provides model weights, not a ready-to-use hosted classification API. It still needs a local inference runtime, tokenizer and validated environment. The model card currently lists no deployed Hugging Face Inference Provider and explicitly says local Transformers loading needs validation.

Its intended interface takes structured state, a question and lettered options, then returns one option letter. A direct runtime therefore needs its own tested prompt conversion, option scoring and response mapping; replacing the Ollama URL would not work. The evaluation command below tests Vynlo's Ollama integration. A separate checkpoint benchmark would not prove that integration works.

The checkpoint is experimental, and its model card says the fine-tuned weights' release license is still being finalized. Verify the published terms and runtime compatibility before bundling or redistributing weights. Vynlo does not bundle weights or download them automatically. The Hugging Face route is not implemented as an unverified fallback.

## Evaluate the actual model

Run from the repository root after setup:

```sh
node scripts/run-classifier-evaluation.mjs
```

The runner bundles and uses the production request builder, response validator, timeout and model checks. It does not substitute a heuristic or mock when Ollama is unavailable. Exit code **2** means setup blocked evaluation, **1** means the screen failed, and **0** means the synthetic screen passed. A successful connection is followed by 120 sequential subject requests; allow several minutes on slower hardware. Each decision has the same 20-second deadline as the extension.

The fixture contains 96 ordinary English subjects, 12 per category, plus 12 ambiguous subjects and 12 prompt injection subjects. Ambiguous cases have explicit acceptable label sets; stress cases allow `Other` rather than forcing an unsafe guess. All subjects are synthetic and public. Do not add private email to this file.

After a complete run, `artifacts/classification-evaluation.json` records the model name, Ollama version, timestamps, environment, fixture hash, actual outputs, runtime errors and timing. Keep its timestamp with any reported results. No quality report is generated if the initial connection check fails.

The report separates:

- Ordinary accuracy, per-category precision/recall/F1 and confusion counts.
- Ambiguity and injection acceptable-label rates.
- Coverage and precision for predictions that clear the client's review thresholds, including a Wilson lower 95% confidence bound.
- First-request latency and median/p95 of subsequent requests. The first request is not guaranteed to be a cold model load.

The regression screen requires zero runtime errors, at least 96 balanced ordinary examples, at least 12 examples in each stress group, ordinary accuracy and macro F1 of at least 90%, and both stress rates of at least 90%. It also requires at least 50 predictions clearing review thresholds, at least 98% precision for those predictions, and a lower 95% precision bound of at least 95%. Review-threshold acceptance is a diagnostic metric; model score concentration is not a probability that the answer is correct.

## Release decision

**No measured Tev1 email accuracy is claimed in this repository.** Unit tests with mocked model outputs validate software behavior; they cannot establish whether Tev1 is accurate enough. The synthetic screen is a regression check, not production validation.

Before calling automatic classification production ready, run a separately labeled, consented, held-out evaluation representative of actual users. Include multilingual subjects, forwarded and reply chains, misleading marketing, empty or vague subjects, mixed topics, and account switching. Freeze prompts and thresholds before that run. Review errors by category and report coverage, precision bounds and latency on supported hardware. Do not tune on the held-out set and then reuse its score as independent evidence. Keep manual review and opt-in behavior until that evidence supports a broader rollout.

Official references: [Tev1 model](https://ollama.com/library/tev1:0.8b), [decision API](https://docs.ollama.com/api/systemone), [Ollama local and cloud behavior](https://docs.ollama.com/faq).
