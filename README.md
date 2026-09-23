# Lens — Image Relevance Workspace

**Designed and developed by [Peter Maged](https://petermaged.com/).**

Match an image library to editorial content with explainable guardrails and human approval.

## Product and technical overview

- **Implementation:** Node.js 24, Express 5, PostgreSQL, Sharp, Ollama vision and embedding models.
- **Deployment:** Vercel frontend with an external backend; [DEPLOYMENT.md](DEPLOYMENT.md) contains exact settings and operational requirements.
- **Ownership:** Peter Maged's project implementation; third-party libraries and upstream materials retain their attribution.
- **License:** [LICENSE](LICENSE). Available for portfolio review, evaluation and further development under these terms.

For project enquiries and implementation work: [petermaged.com](https://petermaged.com/).

## Engineering guide and existing evidence

# Lens — image understanding and content matching

Understand a licensed image library, retrieve semantic matches for articles, and refuse a pairing when its subject, similarity or confidence does not fit. An editor can inspect every reason, then approve or reject a persisted suggestion.

The application uses **actual local Ollama models**: Qwen3-VL 2B for structured vision and all-minilm for text embeddings. PostgreSQL stores tenants, image metadata/tags, vectors, jobs, match snapshots, reviews and attributed per-call usage. No paid account or API key is required.

## Run with Docker

```sh
docker compose up --build -d
docker compose exec app sh -c "node scripts/download-corpus.js && node scripts/seed.js"
```

Open **http://localhost:3200**. The first start downloads model weights (about 2 GB plus the Ollama image); model setup finishes before the app starts. CPU processing is slow and runs asynchronously. Wait for image/post jobs to finish before evaluating; use the workspace's Refresh button or `GET /api/jobs` to monitor progress.

Seed downloads 40 licensed source images, adds one explicitly synthetic blank control, creates 18 evaluation articles, and queues idempotent jobs. It creates an editor account with a random password stored inside the ignored data volume at `/app/data/demo-credentials.json`. Copy that file locally with `docker compose cp app:/app/data/demo-credentials.json ./demo-credentials.local.json` **outside your clone**, or create your own account in the UI. Never publish that credential file. You may rerun seed; it reuses existing records.

Use `docker compose logs app` to see redacted retry/dead-letter events. `docker compose down` stops services while retaining named data/model volumes. Compose only exposes the UI/API on loopback; database and Ollama are internal.

## Native development on Windows

Requires Node.js 24+, PostgreSQL 16 and an Ollama server. The prepared local services use database port 5434 and Ollama port 11435; `.env.example` documents all settings.

```powershell
npm.cmd ci
npm.cmd run migrate
npm.cmd run corpus
npm.cmd run seed
npm.cmd start
```

Ensure `qwen3-vl:2b` and `all-minilm` have been pulled into the configured Ollama server first. Use `npm` instead of `npm.cmd` outside PowerShell. Local credentials are in ignored `data/demo-credentials.json`. Runtime images, model weights and private records are never tracked by Git.

## Try the workflow

1. Sign in, then upload a JPEG, PNG or WebP (5 MiB / 20 MP maximum). Original filenames and EXIF are discarded. Upload returns 202 immediately; duplicates reuse the same tenant image/job.
2. Refresh to see structured subject/category/caption/attributes/confidence. Low-confidence or unknown subjects stay flagged; invalid model JSON is retried and then marked failed.
3. Choose a ready article, click **Find a confident match**, and inspect accepted and rejected candidates. Rankings use persisted semantic vectors, never the source filenames or evaluation answers.
4. Approve or reject a pairing. Guard-rejected candidates cannot be approved by bypassing the UI; the API enforces the same rule.
5. Inspect processing activity and per-call cost. Local calls cost $0 in API fees; input/output tokens and duration remain visible. Hardware/electricity costs are excluded.

## Architecture

```text
Editor → authenticated HTTP API → normalized images / articles → PostgreSQL
                                     │ atomic job insertion
                                     ▼
                           background worker with leases
                         vision JSON → strict schema → tags
                         caption/post → embedding → vectors
                                     │
                  cosine ranking → subject/confidence/similarity guard
                                     │
                     explained snapshot / no confident match
                                     │
                           approve / reject / inspect

Every AI attempt → atomic tenant budget reservation → usage/cost ledger
```

HTTP, model adapters, guard, worker and database access are separate modules. Schema migrations include ownership foreign keys, uniqueness constraints and indexes. For this small corpus, exact cosine search over stored PostgreSQL arrays is appropriate; no approximate-vector extension is needed.

## Real evaluation

<!-- REAL_EVALUATION_START -->
**No top-1 precision number is claimed yet.** A real-model batch was attempted on the development machine (4-core CPU, about 8 GB RAM, Ollama and PostgreSQL in Docker): 0 of 7 Qwen3-VL calls succeeded before Docker became unresponsive, so the run was stopped. Every failed attempt is recorded in the cost ledger. Run the batch on a machine with more memory, then `npm run evaluate`, and paste the result here. Deterministic tests are not evidence of vision or retrieval quality.
<!-- REAL_EVALUATION_END -->

[Evaluation protocol](evals/README.md): 6 calibration articles select thresholds; 12 separate held-out articles measure exact-image top-1, semantic-subject correctness, coverage and safe abstention. Labels were manually drafted by the assistant from a contact sheet and need intern review. Results are from a tiny curated set, not a claim of production accuracy.

After the real jobs finish:

```sh
docker compose exec app node scripts/evaluate.js
```

Or `npm run evaluate` in the native setup. The evaluation refuses to report with pending/failed images. Threshold changes require an API restart. Keep model versions and the library fixed when comparing results.

## Verification

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
python -m pip install -r requirements-verify.txt
python scripts/verify-notebook.py
```

Tests require the PostgreSQL connection from `.env`/defaults and isolate each fixture in a disposable schema. They use injected synthetic model responses, real HTTP, real PostgreSQL and Chromium; there is no cloud spend. The notebook runs all checks top to bottom and records outputs. CI uses the same deterministic tests on Linux.

See [EVIDENCE.md](EVIDENCE.md), [API documentation](docs/API.md), [DESIGN.md](DESIGN.md), [BUILDLOG.md](BUILDLOG.md), and the [corpus licensing manifest](corpus/README.md).

## Honest limits

- The ontology is intentionally bounded: fox, wolf, dog, bear, deer, pizza, coffee, mountain, forest, car and bicycle. Unsupported or ambiguous multi-subject articles are refused. A subject can appear in descriptive context; this is not a general entity extraction model.
- Model confidence is self-reported and uncalibrated. A confident misclassification can still evade the guard. Human review matters; no claim of perfect rejection is made.
- Exact-image gold labels are strict; another semantically appropriate image counts as incorrect. Some source search results are artwork or distractors, not clean labels. Source search words never enter inference.
- The default local models run slowly on CPU. A timeout/failure appears in jobs and cost logs; it is never replaced with a fabricated successful response. The daily call cap includes failed attempts and retries.
- API fees are zero for the local provider. A dollar cap is reserved transactionally, alongside the effective daily call cap. Paid/cloud adapters are not implemented. An interrupted call can have unknown token totals; this is recorded, not estimated as successful usage.
- The workspace shows the first 100 images in summary counts and paginates the library by 12. API lists paginate up to 100. Ranking is bounded to 2,000 candidate images; the intended corpus is about 40–50.
- Authentication uses hashed opaque sessions and scrypt. This is a local capstone, without email verification, recovery, HTTPS termination, malware scanning or production retention automation.
- This project is independent of the previous capstone. It was developed locally first and published to GitHub afterwards, so public-from-day-one cannot be claimed. Portal submission is done separately by the owner.

## Primary references

[Ollama structured output](https://docs.ollama.com/capabilities/structured-outputs), [embedding API](https://docs.ollama.com/api/embed), [Qwen3-VL 2B](https://ollama.com/library/qwen3-vl:2b), and [Commons licensing](https://commons.wikimedia.org/wiki/Commons:Licensing).
