# RightsRadar

RightsRadar is a hosted-app foundation for the Google Cloud Agentic Cinema Hackathon — Parallel
Track. It helps production teams research possible rights-clearance concerns in scripts and assets.
It is research assistance only: it does not provide legal advice or make final infringement
determinations.

The first walking skeleton accepts a script excerpt, identifies deterministic mock brand and
quotation leads, gathers traceable mock evidence, stores the case, and lets a reviewer dismiss or
escalate each finding.

It also accepts plain-text production notes. Assets are limited to 256 KiB and their browser view
shows only filename, size, and upload timestamp; stored content and storage references are not
rendered or exposed in the UI.

## Requirements

- Node.js 20.9+ and `pnpm` 10
- Python 3.11+ and `uv`
- Docker (optional, for containers)

## Setup and development

```bash
cp .env.example .env
make setup
make dev
```

Open <http://127.0.0.1:3000>. `make dev` starts FastAPI with reload on port 8000 and Next.js with
hot reload on port 3000. The default `RIGHTSRADAR_MODE=mock` uses in-memory repositories and
deterministic Gemini/Parallel fixtures, so no API keys or cloud credentials are needed.

## Commands

```bash
make setup            # install JavaScript/Python dependencies, generate client, install Chromium
make dev              # start API and web app with hot reload
make lint             # Ruff and ESLint
make typecheck        # mypy and TypeScript
make test             # pytest and Vitest
make generate-client  # regenerate the typed client from FastAPI OpenAPI
make check-client     # regenerate and fail if the committed client changed
make build            # build Python distribution and Next.js production app
make e2e              # mocked Playwright workflow
make smoke-real       # opt-in smoke path; skips unless explicitly enabled
make reconcile-assets # explicit cleanup of incomplete private asset records; skips by default
```

For containers, run `docker compose up --build`. The compose setup remains in mock mode unless
you explicitly set other environment values.

## Architecture

```text
apps/web/                  Next.js App Router UI
services/api/app/
  agents/                  AgentService orchestration
  integrations/            GeminiClient and ParallelSearchClient adapters
  repositories/            CaseRepository and AssetRepository adapters
  routes/                  Thin FastAPI HTTP routes
  models/                  Pydantic domain and request models
packages/api-client/       Generated TypeScript client from FastAPI OpenAPI
tests/e2e/                 Mocked browser workflow
infra/terraform/           No-resource Terraform foundation
```

FastAPI's OpenAPI document is the contract source of truth. `scripts/generate_api_client.py`
loads it and deterministically writes `packages/api-client/src/generated.ts`; CI runs
`make check-client` to reject stale generated output. API routes only coordinate HTTP concerns;
the agent, integrations, and persistence sit behind small interfaces.

## Environment modes

`RIGHTSRADAR_MODE` controls defaults:

| Mode | Gemini | Parallel | repositories |
| --- | --- | --- | --- |
| `mock` (default) | deterministic fixture | deterministic fixture | in-memory |
| `hybrid` | each `*_MODE` selects `mock` or `real` | independently selected | independently selected |
| `cloud` | Vertex AI Gemini | Parallel Search API | Firestore and Cloud Storage |

Set `RIGHTSRADAR_MODE=hybrid` and any of `RIGHTSRADAR_GEMINI_MODE`,
`RIGHTSRADAR_PARALLEL_MODE`, or `RIGHTSRADAR_REPOSITORY_MODE` to `real` to enable only that
adapter. Set `RIGHTSRADAR_MODE=cloud` to enable all real integrations. The real Gemini adapter
uses Application Default Credentials (ADC) with Vertex AI; it follows the current
[Google Gen AI SDK for Vertex AI](https://cloud.google.com/vertex-ai/generative-ai/docs/sdks/overview).
The Parallel adapter uses its documented [Search API](https://docs.parallel.ai/api-reference/search/search)
with `RIGHTSRADAR_PARALLEL_API_KEY` only on the server. No secret is exposed to the browser or
written to logs.

### Repository-only hybrid smoke setup

Use this non-secret configuration when you want to exercise only Firestore and Cloud Storage while
keeping Gemini and Parallel deterministic mocks:

```bash
RIGHTSRADAR_MODE=hybrid
RIGHTSRADAR_REPOSITORY_MODE=real
RIGHTSRADAR_GOOGLE_CLOUD_PROJECT=<project-id>
RIGHTSRADAR_FIRESTORE_COLLECTION=rightsrader_cases
RIGHTSRADAR_CLOUD_STORAGE_BUCKET=<private-bucket-name>
```

Leave `RIGHTSRADAR_GEMINI_MODE` and `RIGHTSRADAR_PARALLEL_MODE` unset (or set them to `mock`) for
this repository-only smoke run. Authenticate locally with Application Default Credentials (ADC),
then set `RIGHTSRADAR_ENABLE_REAL_SMOKE=true` only when you deliberately intend to contact the
configured repositories. `make smoke-real` creates a UUID-scoped disposable case and short
`text/plain` asset, reads its metadata and bytes, verifies the case asset count, then attempts to
delete the asset before the case. Any cleanup failure is reported. It does not call Gemini or
Parallel. With the default environment, it prints a skip message and makes no external calls.

### Private asset lifecycle reconciliation

Real asset storage first creates a zero-byte private Cloud Storage marker with an exact GCS
generation precondition. It records that marker generation in a single atomic Firestore batch that
creates both the `pending` asset record and its lifecycle index. Content upload must match the
saved marker generation, so a reconciliation deletion that wins makes a delayed upload fail rather
than creating untracked bytes. The resulting content generation is also private persisted metadata
through `ready` and `cleanup_pending`. Every cleanup delete uses that exact GCS generation
precondition; if it changes, the private lifecycle record remains for a later manual review rather
than deleting by object name. A short writer lease still prevents normal active uploads from being
claimed; `ready` promotion also requires the same lease. Only `ready` assets are available through
the application API. Cleanup first fences a `ready` record into private `cleanup_pending` before
touching its bytes, so a missing object never leaves a public record exposed.

Incomplete records are indexed only in a private lifecycle collection derived from the configured
case collection. Reconciliation reads that scoped namespace rather than a project-wide Firestore
collection group. It can claim an expired writer lease or a cleanup record; it also scans only the
unambiguous private RightsRadar marker prefix for a marker left behind by a failed Firestore batch.
It never scans ready objects or unrelated prefixes. A writer that has lost its lease checks
ownership before upload and, even in the final interleaving window, cannot publish untracked bytes
because its GCS generation fence has been removed or changed. When failed promotion leaves no
saved content generation, reconciliation first verifies immutable private RightsRadar case, asset,
and writer metadata, saves the observed generation to the cleanup record transactionally, and only
then attempts its conditional delete.

Reconciliation is deliberately manual: it is not a queue or background task. With real
repositories selected and ADC configured, set `RIGHTSRADAR_ENABLE_RECONCILIATION=true`, then run:

```bash
make reconcile-assets
```

The command retries cleanup for at most 100 incomplete records and prints only aggregate removed
and failed-record counts. It exits nonzero if any record fails, without exposing bucket, object,
project, credential, or provider-error details. It does not create agents or contact Gemini or
Parallel. Without both the explicit flag and real repository mode, it safely skips without
contacting cloud services.

## Testing and quality gates

- `pytest` covers case creation and persisted reviewer status updates.
- `Vitest` checks the generated client request contract.
- `Playwright` submits the original fictional sample, checks cited evidence, and dismisses a
  finding through the API.
- GitHub Actions runs linting, unit tests, type checks, generated-client freshness, builds, and
  the mocked browser workflow for every pull request.

## Current scope and next milestone

This foundation intentionally excludes authentication, payment, queues, deployment automation,
media analysis, and final legal decisions. The recommended next milestone is configurable Gemini
and Parallel evaluation with a human-review quality rubric, while preserving the same
OpenAPI-first contract and reviewer workflow.
