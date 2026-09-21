# Design

## Decision to support
An editor needs an appropriate image for a post, with an explicit explanation when no image is reliable enough. A fox article must never silently receive a wolf. Non-goal: a general web image search service or paid generation.

## Layers and flow
```text
Owner → authenticated API → image upload / article creation → PostgreSQL + local image files
                                            │ atomic queue insert
                                     durable batch worker
                                   /                      \
                         vision + schema             text embeddings
                              │                           │
                        metadata/tags → caption vector    │
                              └──────── cosine ranking ───┘
                                        subject/confidence/similarity guard
                                        explained suggestion or refusal
                                        human approval / rejection
```

## Data model
Tenant owners and hashed opaque sessions; tenant-owned images (content hash, generated safe filename, processing status), schema-valid metadata and normalized tags; tenant-owned posts and subject intent; stored image/post vectors with model/version/dimension; durable leased jobs; per-call usage ledger; frozen match runs, candidate scores/reasons and review decisions. Composite foreign keys and all queries enforce tenant ownership. Indexes cover tenant/content hashes, jobs due time, candidate rank and cost timestamps.

## AI boundaries
Use an actual vision model and actual text embedding model. Mock providers are for deterministic tests only and cannot support claims about real matching quality. Model responses are untrusted: strict JSON schema, finite confidence and vectors, bounded inputs/outputs, retries and failure flags. Do not use source filenames, source tags, corpus labels or evaluation targets as model input. Embedding text comes exclusively from validated model metadata and article text.

## Guard and evaluation
Maintain a small declared subject ontology with scientific/common aliases; extract specific subject intent from article content and reject conflicting image tags. Unrecognized or multi-subject intents require review. Cosine similarity and model confidence must exceed thresholds; uncertain image tags are excluded. Threshold selection uses a calibration split, followed by a separate held-out labeled split. Report exact-image top-1 over all labeled posts, abstention coverage, and subject correctness separately. A guessed match does not count as correct. AI-assisted labels are disclosed and need intern review.

## Reliability and cost
Enqueue vision/embedding work in short DB transactions, execute outside the HTTP path; leases, bounded exponential retries and terminal alerts. Deduplicate uploads by tenant/content hash and jobs by target/version. Store every AI attempt in a cost ledger before calling the provider, attribute tenant/job/target/model, and finish it with usage/error status. Lock a tenant budget row to enforce daily call and USD limits atomically. Local model calls have $0 API fees but still record tokens/duration and consume the call budget; hardware costs are excluded.

## Corpus and delivery
Use at least 40 licensed public images with reproducible download URLs and attribution in a manifest; images and all runtime datasets stay ignored. Keep the eval specification separate from inference input. Build in this independent local repository. A new public repository URL is requested; do not publish to the previous capstone repository. Keep real phase commits, a notebook executed top to bottom, and honest EVIDENCE/BUILDLOG documents.
