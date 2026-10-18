# Model-call reliability contract

All image and video generation paths must follow the same lifecycle:

1. Resolve the requested model against an enabled, healthy Provider configuration.
2. Preserve reference assets as asset IDs until the Worker resolves them.
3. Before an upstream call, ensure every remote image URL is publicly readable and has a valid image content type. Provider-specific minimum dimensions must be normalized before submission.
4. Send the Provider-specific request shape selected by the configuration; never infer fields from a model name alone.
5. Parse success, asynchronous task creation, terminal failure, and business rejection separately. Accept numeric and string status codes and nested task/result fields.
6. Only mark a model unhealthy for authentication, balance, missing-model, or repeated real failures. A single schema mismatch, safety rejection, invalid input, or remote asset failure is request-level failure.
7. Persist the job result and Canvas element using the same job ID. Frontend synchronization must merge server-created video elements and must not overwrite them with an older full-canvas snapshot.
8. Persist a private Provider-result checkpoint immediately after a successful response and before downloading output. Retries must resume from that checkpoint and must never call the Provider or charge the job again.
9. Use a deterministic object path derived from the job ID, upsert the asset record by that path, and insert the Canvas element idempotently. Asset or Canvas failures enter `sync_pending`; exhausted automatic retries enter `sync_failed` and remain manually recoverable.

Required regression coverage:

- approval confirmation is idempotent and charges once;
- degraded-but-not-unhealthy models remain callable when explicitly requested;
- nested Provider task IDs and video URLs are parsed;
- Provider business errors preserve a safe message and code;
- low-resolution reference images are normalized;
- external reference URLs are checked before upstream submission;
- successful jobs persist an asset and Canvas element;
- Provider success followed by download or Storage failure resumes from the checkpoint with one Provider call and one asset record;
- concurrent synchronization creates at most one asset reference and one Canvas element per job;
- Canvas autosave preserves server-created video elements.

Model-family profiles are mandatory for every built-in provider family:

- MiniMax/Lingke and Metaso MiniMax: provider-native resolution, public first-frame URL, asynchronous task polling.
- Replicate Kling, Seedance, Wan, Sora: model-specific input field names, T2V/I2V endpoint selection, duration, ratio and audio rules.
- Google Developer and Vertex Veo: operation polling, provider-specific image encoding, duration/resolution limits and RAI handling.
- OpenAI/Kuaipao, Gemini, Flux and Volces images: model-specific image input transport, quality/size mapping and output parsing.
- Custom models: explicit request templates and explicit response paths; generic fallback is not considered verified.

Probe and retirement rules:

- A `configuration_only` probe checks database configuration, health, cooldown, billing and response mappings only. It makes zero Provider calls and must never be reported as proof of online availability.
- Retired or unsupported model IDs are rejected before model routing, approval, credit calculation, job creation, or Provider resolution. They must not be silently replaced by another model.
- Provider wrappers are the final guard for internal callers; registry lists and model-selection routes must apply the same retirement filter.
- A successful Provider response must have the expected JSON shape and a non-empty URL or inline payload. Malformed 2xx responses are `invalid_provider_response`, not generic runtime errors.
- `tool.completed.output.errorCode` must preserve the classified Provider/Worker code. `invalid_input` must not trigger model failover; authentication, provider request, invalid response, and upstream terminal codes may trigger the configured video failover policy.
