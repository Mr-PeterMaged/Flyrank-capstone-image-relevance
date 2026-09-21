# Evidence ledger

This file distinguishes deterministic application tests from a real model evaluation. Synthetic provider tests are not a claim of vision or retrieval accuracy. Source images and private runtime data are ignored.

## Deterministic verification

`npm test`: 15 integration/unit tests passed with real HTTP and PostgreSQL and injected provider fixtures. Tests cover authentication, tenant isolation (including image bytes/review/costs), schema validation, image decoding/size, idempotent uploads/posts, job retry/dead-letter behavior, budget locking, safe matching, review enforcement and leases.

`npm run test:browser`:

```text
PASS browser login, authenticated image preview, job progress and cost summary
PASS browser matching, guard explanation and persistent human approval
PASS mobile workspace at 390px without page overflow
Browser proof: 3/3 passed. Synthetic provider only; not model accuracy evidence.
```

The executed notebook regenerates full output in `docs/proof/api-tests.txt` and `docs/proof/browser-tests.txt`. Screenshots named `mock-*` contain synthetic provider output and are labeled accordingly.

## Requirement map

| Requirement | Evidence |
|---|---|
| Strict structured vision | `schema rejects malformed vision, nonfinite confidence and invalid vectors`; worker never persists invalid output |
| Low confidence flagged | `low confidence and unknown subject are flagged and cannot become suggestions`; real blank-control result recorded separately |
| Background batch + retries | `invalid model output retries, never persists tags, and emits a terminal alert`; `transient embedding failure resumes without repeating completed vision` |
| Per-call vision/embedding costs | `worker stores validated tags and embeddings; every provider call has attributed usage`; every actual pilot/batch attempt also persisted in ai_calls |
| Stored vectors and ranked suggestions | Real PostgreSQL arrays/model/dimension plus `matching ranks the fox, rejects forced wolf, and refuses unsupported subject` |
| Equivalent concepts | Alias handling for Vulpes vulpes is tested; real semantic behavior is reported only after actual embeddings |
| Wrong wolf rejected | `guard maps scientific aliases and rejects a wolf even with perfect similarity`; forced-candidate endpoint verified |
| Human-readable refusal | Candidate reasons include the expected/detected subject and confidence/similarity failures |
| No confident match | Unsupported-subject and uncertain-image tests return `no_confident_match`, not a forced top result |
| Persistence/models/indexes | Versioned PostgreSQL migrations and composite ownership keys; actual DB exercised by every integration fixture |
| Validated review workflow | `review is inspectable and idempotent; guard rejection cannot be overridden`, plus real browser approve/inspect |
| Labeled top-1 evaluation | 18 visually annotated article cases, calibration/test separated; **real result pending until the live batch completes** |
| Documentation | README, DESIGN, API docs, BUILDLOG, env example, manifest, licensing sources, notebook and CI |

## Real provider evidence

The first Moondream pilot timed out once, then returned a schema-valid 0.5-confidence description. It was flagged, not accepted. Its failures and actual usage are retained. Qwen3-VL 2B is the replacement default.

A later full-batch attempt with Qwen3-VL 2B (600 s timeout) produced 0 successful vision calls out of 7 failed attempts (about 162 s on average) on a 4-core CPU with under 1 GB free RAM, and then Docker became unresponsive. The run was stopped; failed attempts are in `ai_calls`. Earlier pending jobs from the Moondream pipeline version were superseded by re-running `npm run seed`. The real evaluation therefore remains pending, and no score is inserted.

## Delivery boundaries

The repository is published at https://github.com/Mr-PeterMaged/Flyrank-capstone-image-relevance. Portal submission remains with the owner. This project is separate from the prior widget capstone. The local-first history is disclosed honestly.
