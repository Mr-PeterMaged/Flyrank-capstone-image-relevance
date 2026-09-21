# API contract

Base: `http://localhost:3200`. Private routes use `Authorization: Bearer <opaque-session>`. All owner data is tenant-scoped. Error responses are JSON `{error:{code,message}}`; invalid input → 400, missing auth → 401, foreign/missing IDs → 404, not-ready/unsafe approval/key conflict → 409, oversize → 413, wrong JSON type → 415, auth/budget limits → 429 where applicable.

## Authentication
`POST /auth/register` and `/auth/login` accept `{email,password}` (password 12–128 characters). Return `{token,owner,expiresIn:86400}`. `POST /auth/logout` revokes that token. Login/register are limited per IP. No private data is exposed through cross-origin CORS.

## Ingestion and processing
| Method | Route | Input/result |
|---|---|---|
| POST | `/api/images` | Multipart single `image` file; decoded JPEG/PNG/WebP, 5 MiB, 20 MP max. 202 new / 200 duplicate; `{id,status,replayed}` |
| GET | `/api/images` | Paginated metadata/status list |
| GET | `/api/images/:id` | Inspect status, metadata and flag reason |
| GET | `/api/images/:id/file` | Authenticated normalized JPEG |
| POST | `/api/batches` | `{imageIds:[uuid,...]}` 1–100 owned IDs; idempotently enqueue current pipeline version |
| GET | `/api/jobs` | Paginated items + counts by state |
| POST | `/api/jobs/:id/retry` | Empty JSON `{}`; retry a failed owned job |
| GET | `/api/costs` | Attributed call ledger, token totals, API fees, configured daily budgets |

States: images `pending`, `ready`, `flagged`, `failed`; jobs `pending`, `processing`, `done`, `failed`. A low-confidence image can have a successfully completed job and still remain `flagged`. Budget exhaustion ends the job with `budget_exceeded`; retry only after increasing/waiting for its budget. Provider failures are retried up to 3 attempts, then a redacted alert is emitted and retained in job status.

Structured image output: `{subject,category,attributes,caption,confidence}`; unknown properties/types/out-of-range confidence are rejected. The raw provider response is never accepted as metadata without validation. Vectors must have 8–4096 finite components and nonzero norm, then are normalized.

## Articles and matching
| Method | Route | Input/result |
|---|---|---|
| POST | `/api/posts` | `{title,content}` and `Idempotency-Key` (8–128 letters/digits/underscore/hyphen); 202 queues embedding, 200 identical retry, 409 changed content with same key |
| GET | `/api/posts` | Paginated owned articles |
| GET | `/api/posts/:id` | One article and processing state |
| GET | `/api/posts/:id/images` | Read-only ranked candidates; `{status,reasons,candidates}` |
| GET | `/api/posts/:id/images/:imageId/check` | Force one owned candidate through the guard; `{imageId,similarity,accepted,reasons}` |
| POST | `/api/posts/:id/matches` | Empty JSON `{}` creates a frozen decision snapshot; candidates now include `suggestionId` |
| GET | `/api/suggestions/:id` | Inspect score, confidence, guard decision/reasons and human review |
| PUT | `/api/suggestions/:id/review` | `{decision:"approve"|"reject",note?:string}`; idempotent latest decision |

Title 3–180 characters; article text 10–6000 characters. JSON body max 32 KiB. Lists accept `limit` 1–100 and `offset` 0–100000; unknown query keys are rejected. Text and model fields are rendered as text, never HTML.

Matching calls **no model during the request**. It reads ready persisted vectors for the configured model. A missing post vector returns 409. Semantic cosine ranking is filtered by subject agreement, vision confidence and similarity thresholds. Status `no_confident_match` includes reasons even if there are no candidates. A rejected wolf cannot be approved for a fox article by sending a direct API request.

## Cost semantics
Every attempt reserves an entry and tenant/day budget before inference. The ledger includes owner, job, target, kind, model, status, input/output tokens when known, duration and USD API fee. All local calls cost $0 in provider fees but consume the call cap. Failed and interrupted attempts remain visible. Schema-validation failures are still counted as calls. No image bytes, tokens, passwords or raw provider exceptions are logged.

## Unsupported features
No arbitrary remote URL ingestion (avoids SSRF), no anonymous image access, no public inference endpoint, no hosted/paid provider, and no automatic override of rejected pairings.
