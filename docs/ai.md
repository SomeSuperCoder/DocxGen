# AI processing

AI processing is asynchronous. Starting `/api/documents/:id/process` creates an
idempotent queue job and returns `202`; the worker changes the document to
`processed` or `ai_failed`. A failed document is retried through
`POST /api/documents/:id/retry`, which creates a new attempt instead of reusing
the failed idempotency key.

## Providers

`AI_PROVIDER` selects one implementation:

- `mock` is deterministic and needs no external service;
- `openai-compat` calls `AI_BASE_URL` with `AI_API_KEY`, `AI_MODEL`,
  `AI_TEMPERATURE` and `AI_TIMEOUT_MS`;
- `opencode` invokes the configured local, Docker or Podman OpenCode runtime.

The provider receives the draft and document type schema. Its response is
parsed as structured JSON containing corrected text and extracted requisites.
The original draft is retained in the document and in the processing log.

## Grounding and validation

Extracted fields are checked against the source text. A field that is missing,
ambiguous or not grounded in the draft is reported as a warning/pending field;
the user can correct it in the requisites form before rendering. The document
view exposes `version.aiFields`, `version.warnings`, `pending` and
`placeholders` so all clients can show the same state.

The renderer does not silently invent required values. Rendering is rejected
until the selected document type and template are present and all required
fields have been resolved.

## Debugging

With `DEBUG_COMMANDS=1`, the MAX and VK bots accept `/ai_fail` and the backend
exposes the owner-scoped debug route `POST /api/debug/ai-fault`. Processing
stages, prompt metadata, raw provider output and validation results are stored
in `processing_log` and are available via `GET /api/documents/:id/log`.
