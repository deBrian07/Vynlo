# Email classification

Vynlo can suggest a category for a supported, opened conversation using Tev1 0.8B in Chrome's local WebGPU runtime. Ollama is not required. Manual tags always work, and model suggestions start disabled and remain reviewable.

See [browser AI setup, privacy and resource limits](BROWSER_AI.md) for the short user setup and [classification validation](CLASSIFICATION_VALIDATION.md) for measured evidence and release gates.

Classification uses only the visible conversation subject. Vynlo does not scan the mailbox, save the subject as a model record, change Gmail labels, or send subject text to the model host. Model weights are downloaded only after the user chooses setup and approves the requested Hugging Face access. Inference runs locally in an extension-owned worker. No Ollama, account, API key or hosted inference service is involved.

The model is experimental. Subject-only decisions can be wrong or lack context; a score over candidate categories is not calibrated accuracy. Keep manual review enabled. The Tev1 fine-tuned model card says its release license is pending finalization, so weight redistribution and public production release remain gated on licensing review.
