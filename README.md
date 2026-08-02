# RightsRadar

RightsRadar is a hosted-app foundation for the Google Cloud Agentic Cinema Hackathon — Parallel
Track. It helps production teams research possible rights-clearance concerns in scripts and assets.
It is research assistance only: it does not provide legal advice or make final infringement
determinations.

The first walking skeleton accepts a script excerpt, identifies deterministic mock brand and
quotation leads, gathers traceable mock evidence, stores the case, and lets a reviewer dismiss or
escalate each finding.

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

To deliberately call configured real services, set `RIGHTSRADAR_ENABLE_REAL_SMOKE=true` and a
non-mock mode, then run `make smoke-real`. With the default environment, it prints a skip message
and makes no external calls.

## Testing and quality gates

- `pytest` covers case creation and persisted reviewer status updates.
- `Vitest` checks the generated client request contract.
- `Playwright` submits the original fictional sample, checks cited evidence, and dismisses a
  finding through the API.
- GitHub Actions runs linting, unit tests, type checks, generated-client freshness, builds, and
  the mocked browser workflow for every pull request.

## Current scope and next milestone

This foundation intentionally excludes authentication, payment, queues, deployment automation,
media analysis, and final legal decisions. The recommended next milestone is asset ingestion: add
Cloud Storage-backed uploads and a reviewer case history while preserving the same repositories,
OpenAPI-first contract, and human review workflow.
