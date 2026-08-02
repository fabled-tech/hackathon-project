# Code Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the independent review's cloud-runtime, consistency, browser-race, OpenAPI-client, and smoke-test findings without changing mock-first behavior or widening product scope.

**Architecture:** Keep FastAPI routes as HTTP coordinators: run blocking repository calls in a worker thread from async upload handling; expose a public `Asset` response while repositories retain a separate storage-bearing record; and make real Firestore writes transactional where competing reviewer updates share an array. Cloud rollback prioritizes observability over hiding a failed cleanup: if a GCS object cannot be deleted, its Firestore metadata remains so it is discoverable. The generated client continues to be emitted from FastAPI's OpenAPI document, but operation parameters/body fields are read from the schema rather than copied into templates.

**Tech Stack:** FastAPI, Starlette thread pool, Pydantic v2, Firestore transactions, Google Cloud Storage, pytest, Vitest, Playwright, TypeScript, pnpm, uv.

## Global Constraints

- Preserve `RIGHTSRADAR_MODE=mock` as the default; no external call occurs without explicitly selecting a real integration and the real smoke opt-in.
- FastAPI OpenAPI is the only API-contract source; regenerate `packages/api-client/src/generated.ts` after any route/model change.
- Accept only UTF-8, NUL-free `text/plain` files up to 256 KiB; reject invalid content before repository storage.
- Preserve the legal-research disclaimer, human reviewer workflow, existing case/finding routes, and metadata-only browser experience.
- Keep asset bytes private. Browser responses and generated TypeScript types must not contain storage object references, bucket credentials, signed URLs, or raw asset content.
- Do not add auth, payments, queues, media analysis, deployment work, public URLs, or cloud provisioning.
- Do not add secrets, ADC files, or project-specific credentials to source control.
- All new behavior is test-driven: record an expected RED test before the corresponding production change and a focused GREEN result afterward.

---

## File map

| Path | Responsibility |
| --- | --- |
| `services/api/app/models/assets.py` | Public `Asset` API model and private `StoredAsset` persistence model. |
| `services/api/app/repositories/assets.py` | Private asset storage/cleanup behavior with discoverable cloud failures. |
| `services/api/app/repositories/cases.py` | Transactional reviewer-status update and disposable case deletion. |
| `services/api/app/routes/cases.py` | Thread-pooled async upload coordination, byte validation, public response shaping. |
| `services/api/app/smoke_real.py` | Explicitly enabled disposable real-repository create/store/read/cleanup smoke path. |
| `scripts/generate_api_client.py` | OpenAPI-derived operation metadata and TypeScript helper rendering. |
| `packages/api-client/src/generated.ts` | Generated public client; never hand-edited. |
| `apps/web/components/script-review.tsx` | Request-generation guards that prevent stale responses from changing case state. |
| `services/api/tests/test_assets.py` | Upload text/response/rollback API coverage. |
| `services/api/tests/test_case_routes.py` | Async route thread-pool coordination tests. |
| `services/api/tests/test_repositories.py` | Cloud cleanup and Firestore transaction fake-client coverage. |
| `services/api/tests/test_generate_api_client.py` | Operation-schema derivation regression coverage. |
| `apps/web/tests/api-client.test.ts` | Public generated client shape/request tests. |
| `tests/e2e/review-workflow.spec.ts` | Stale-response browser interaction regression. |
| `README.md` and `.env.example` | Accurate real repository smoke instructions and non-secret environment guidance. |

## Task 1: Make real repository mutations consistent and recoverable

**Files:**
- Modify: `services/api/app/repositories/assets.py`, `services/api/app/repositories/cases.py`, `services/api/app/repositories/__init__.py`
- Modify: `services/api/tests/test_repositories.py`

**Interfaces:**
- Consumes: current `AssetRepository`, `CaseRepository`, Firestore/GCS injected fake clients.
- Produces: storage cleanup that preserves metadata when object deletion fails; `CaseRepository.delete(case_id)`; transactional real reviewer updates.

- [ ] **Step 1: Add RED tests for discoverable cleanup and transactions**

Add fake-client tests that store a cloud asset, force `blob.delete()` to raise during `repository.delete(asset)`, and assert the asset document remains present. Add the complementary metadata-delete failure test, asserting its document remains while blob deletion was attempted. Add a transaction fake with `get` and `update` recording and assert `FirestoreCaseRepository.update_finding_status` reads and writes through that transaction rather than an ordinary document update. Add an in-memory and Firestore case-delete test for the disposable smoke contract.

- [ ] **Step 2: Verify RED repository behavior**

Run: `cd services/api && uv run python -m pytest tests/test_repositories.py -v`

Expected: FAIL because cloud delete removes metadata after a failed blob delete, reviewer updates do not use a transaction, and no delete-case contract exists.

- [ ] **Step 3: Implement the private persistence changes**

Extend `CaseRepository` with `delete(case_id: str) -> None`; remove an in-memory case or, in Firestore, delete the parent document after its assets have already been removed. In `CloudStorageAssetRepository.delete`, delete the GCS object first; if it fails, re-raise without deleting the Firestore asset metadata. If it succeeds but document deletion fails, propagate that error while the remaining document continues to make the state observable.

For a real Firestore client, follow the official `@firestore.transactional` pattern: create a transaction, read the case snapshot through `document.get(transaction=transaction)`, locate/mutate one finding, and `transaction.update(document, {"findings": ...})`. Provide an injected transaction runner/fake seam that verifies the same read/update contract without ADC or a network call. Preserve `CaseRepositoryNotFound` and `FindingNotFound` semantics.

- [ ] **Step 4: Verify GREEN repository behavior**

Run: `cd services/api && uv run python -m pytest tests/test_repositories.py -v`

Expected: PASS, including simulated cleanup failures, transaction use, and disposable case deletion.

- [ ] **Step 5: Commit repository integrity**

```bash
git add services/api/app/repositories services/api/tests/test_repositories.py
git commit -m "fix: harden real repository consistency"
```

## Task 2: Enforce safe upload bytes and public asset responses

**Files:**
- Modify: `services/api/app/models/assets.py`, `services/api/app/models/__init__.py`
- Modify: `services/api/app/repositories/assets.py`, `services/api/app/routes/cases.py`
- Modify: `services/api/tests/test_assets.py`, `services/api/tests/test_case_routes.py`

**Interfaces:**
- Consumes: Task 1 repository contracts and `AssetUpload`.
- Produces: public `Asset` responses without a storage reference, private `StoredAsset` records for repositories, and a non-blocking async upload route.

- [ ] **Step 1: Add RED API tests for response privacy, text bytes, and blocking calls**

Add tests that upload valid UTF-8 plain text and assert the response/list payload contains only `id`, `case_id`, `filename`, `content_type`, `byte_size`, and `created_at`—never `storage_reference`. Add invalid `text/plain` payloads with invalid UTF-8 and with a NUL byte; both must return 422 and leave no asset in the mock repository. Patch the route's thread-pool boundary in a focused test and assert synchronous `get`, `store`, `increment_asset_count`, and rollback deletion are submitted through it rather than executed on the event loop.

- [ ] **Step 2: Verify RED API behavior**

Run: `cd services/api && uv run python -m pytest tests/test_assets.py tests/test_case_routes.py -v`

Expected: FAIL because `storage_reference` is public, invalid bytes pass, and upload calls repositories directly.

- [ ] **Step 3: Implement public/private asset separation and safe route coordination**

Keep `Asset` as the Pydantic public response model with only safe metadata. Add `StoredAsset(Asset)` with `storage_reference: str` for repository maps, Firestore metadata, Cloud Storage reads, and rollback deletion. Have repository methods that require the object reference use `StoredAsset`; FastAPI response models remain `Asset`, causing the extra private field to be stripped by response validation and absent from OpenAPI/client output.

Validate MIME first, bound read to `MAX_ASSET_BYTES + 1`, reject over-limit payloads, decode UTF-8, and reject `b"\\x00"` before creating `AssetUpload`. Import `run_in_threadpool` and use it for every synchronous repository operation in `upload_asset`, including case existence, storage, count increment, and best-effort rollback. Log a generic cleanup failure with no asset content or credential data while preserving the original count-increment error.

- [ ] **Step 4: Verify GREEN API behavior and schema**

Run: `cd services/api && uv run python -m pytest tests/test_assets.py tests/test_case_routes.py -v`

Run: `cd services/api && uv run python -c "from app.main import create_app; print(create_app().openapi()['components']['schemas']['Asset'])"`

Expected: PASS and the emitted public `Asset` schema has no `storage_reference` property.

- [ ] **Step 5: Commit the safe upload contract**

```bash
git add services/api/app/models services/api/app/repositories/assets.py services/api/app/routes/cases.py services/api/tests/test_assets.py services/api/tests/test_case_routes.py
git commit -m "fix: keep asset uploads private and nonblocking"
```

## Task 3: Generate operation helpers from the OpenAPI document

**Files:**
- Modify: `scripts/generate_api_client.py`, `packages/api-client/src/generated.ts`
- Modify: `services/api/tests/test_generate_api_client.py`, `apps/web/tests/api-client.test.ts`

**Interfaces:**
- Consumes: FastAPI's emitted `paths`, parameter declarations, request bodies, and response schemas after Task 2.
- Produces: generated client helper paths, parameters, request-body field names, and return types derived from the schema.

- [ ] **Step 1: Add RED generator tests for changed operation metadata**

Factor a pure helper that accepts a minimal OpenAPI operation and asserts it extracts the path parameter name, query parameter name/default type, JSON body component, multipart field name, and successful response component. Feed a fixture whose multipart field is intentionally named `upload` and assert the rendered helper appends `upload`, not a hard-coded `file`; feed a case path parameter named `id` and assert URL interpolation follows that schema value.

- [ ] **Step 2: Verify RED generator behavior**

Run: `cd services/api && uv run python -m pytest tests/test_generate_api_client.py -v`

Expected: FAIL because helpers are static templates and ignore altered operation metadata.

- [ ] **Step 3: Implement schema-derived helper rendering**

Add small `OperationSpec`/request-body extraction functions that read each required operation from `schema["paths"]`, resolve request-body `$ref` schemas, and return the exact public component names/field names. Render the known ergonomic helper names from those specs, but derive method, encoded path parameters, multipart field, JSON payload component, query key, and successful response type from OpenAPI. Keep generated TypeScript free of manual edits and preserve `FormData` without a manual `Content-Type` header.

- [ ] **Step 4: Regenerate and verify GREEN client behavior**

Run: `make generate-client`

Run: `cd services/api && uv run python -m pytest tests/test_generate_api_client.py -v`

Run: `pnpm --filter @rightsrader/web test -- api-client.test.ts`

Run: `make check-client`

Expected: PASS; generated `Asset` omits storage reference and multipart behavior uses the OpenAPI field name.

- [ ] **Step 5: Commit contract-derived code generation**

```bash
git add scripts/generate_api_client.py packages/api-client/src/generated.ts services/api/tests/test_generate_api_client.py apps/web/tests/api-client.test.ts
git commit -m "fix: derive API client helpers from openapi"
```

## Task 4: Prevent stale browser responses from mixing cases

**Files:**
- Modify: `apps/web/components/script-review.tsx`, `tests/e2e/review-workflow.spec.ts`

**Interfaces:**
- Consumes: generated `createCase`, `getCase`, `listAssets`, `uploadAsset`, and current case state.
- Produces: a monotonically increasing case-operation generation and case-ID checks around asynchronous state updates.

- [ ] **Step 1: Add RED browser regression for stale case results**

Use Playwright route interception to delay an old case's `GET /api/cases/{case_id}` or `GET /assets` response. Start reopening that old case, then select a distinct current case before releasing the delayed response. Assert the editor, findings, and asset list still show the newer case after the stale response resolves. Add an upload variation where the active case changes before `uploadAsset`/`listAssets` completes and assert it does not replace the new case's assets.

- [ ] **Step 2: Verify RED browser behavior**

Run: `pnpm exec playwright test tests/e2e/review-workflow.spec.ts --grep "stale"`

Expected: FAIL because delayed operations currently overwrite current state.

- [ ] **Step 3: Implement request-generation guards**

Store a `useRef<number>` generation counter and a `useRef<string | null>` active case ID. Increment the generation before script submission or historical reopen; capture it for each request; set the active case ID only when a request becomes the current winner; and apply fetched case/assets state only if the generation and active ID still match. Capture the case ID during upload and discard its completion if a newer case operation changed the active ID. Always clear operation-specific loading flags in `finally` without clearing a newer operation's indicator.

- [ ] **Step 4: Verify GREEN browser behavior**

Run: `pnpm exec playwright test tests/e2e/review-workflow.spec.ts --grep "stale"`

Run: `make e2e`

Expected: PASS, including existing review/status/upload/history flows.

- [ ] **Step 5: Commit stale-response protection**

```bash
git add apps/web/components/script-review.tsx tests/e2e/review-workflow.spec.ts
git commit -m "fix: ignore stale case responses"
```

## Task 5: Make the opt-in real smoke actually exercise repositories

**Files:**
- Modify: `services/api/app/smoke_real.py`, `services/api/tests/test_smoke_real.py`
- Modify: `README.md`, `.env.example`

**Interfaces:**
- Consumes: Task 1's case delete and Task 2's `StoredAsset` repository behavior plus configured real repositories.
- Produces: a real-smoke path that creates a unique disposable case, stores a short valid text asset, reads metadata/content, increments and observes count, and cleans up assets then case in `finally`.

- [ ] **Step 1: Add RED smoke tests with fake real-mode services**

Add unit tests that set the opt-in flag and inject fake case/asset repositories. Assert the smoke creates a UUID-scoped case, stores `b"smoke test"`, verifies `get_content` and metadata, increments count, and calls asset deletion followed by case deletion even when an intermediate verification raises. Keep tests for mock mode/disabled opt-in returning a skip without touching services.

- [ ] **Step 2: Verify RED smoke behavior**

Run: `cd services/api && uv run python -m pytest tests/test_smoke_real.py -v`

Expected: FAIL because the existing smoke only invokes the agent service and never uses repositories.

- [ ] **Step 3: Implement disposable repository smoke and accurate documentation**

Refactor `smoke_real.main` into a testable function accepting settings/services. Require `RIGHTSRADAR_ENABLE_REAL_SMOKE=true` and real repository selection; do not invoke real Gemini or Parallel. Generate a UUID case with no findings, create it, store an original short UTF-8 `text/plain` asset, assert asset list/content and `asset_count == 1`, then in `finally` delete the stored asset and case. If cleanup errors after a primary failure, report them without hiding the primary failure. Update README and `.env.example` to state precisely that this command reads/writes the configured repositories, creates only short disposable smoke records, and requires explicit opt-in plus ADC.

- [ ] **Step 4: Verify GREEN smoke behavior**

Run: `cd services/api && uv run python -m pytest tests/test_smoke_real.py -v`

Run: `make smoke-real`

Expected: fake-service tests PASS; the default command still prints a skip and performs no external call.

- [ ] **Step 5: Commit real smoke coverage**

```bash
git add services/api/app/smoke_real.py services/api/tests/test_smoke_real.py README.md .env.example
git commit -m "fix: exercise repositories in real smoke"
```

## Task 6: Persist and reconcile private asset lifecycle state

**Files:**
- Modify: `services/api/app/models/assets.py`, `services/api/app/models/__init__.py`
- Modify: `services/api/app/repositories/assets.py`, `services/api/app/repositories/__init__.py`
- Modify: `services/api/app/dependencies.py`, `services/api/app/config.py`
- Create: `services/api/app/reconcile_assets.py`
- Modify: `services/api/tests/test_repositories.py`, `services/api/tests/test_reconcile_assets.py`
- Modify: `README.md`, `.env.example`, `Makefile`

**Interfaces:**
- Consumes: private `StoredAsset`, real/memory asset repositories, explicit settings.
- Produces: `AssetLifecycle`, `AssetRepository.reconcile_pending(limit)`, idempotent cloud cleanup, and a manually opt-in reconciliation command.

- [ ] **Step 1: Write failing lifecycle and reconciliation tests**

Add fake-cloud tests for this exact dual-failure sequence: private metadata creation succeeds; GCS upload succeeds; marking the record ready fails; compensating blob delete fails. Assert the Firestore record remains and is marked `cleanup_pending`, the record contains the generated object reference, and `list_for_case` does not return it. Add a test where GCS deletion succeeds but document deletion fails; a later `reconcile_pending` must treat GCS `NotFound` as success and remove the surviving document. Add a `reconcile_assets` command test proving it skips unless both real repositories and `RIGHTSRADAR_ENABLE_RECONCILIATION=true` are selected, then calls only repository reconciliation through injected fakes.

- [ ] **Step 2: Verify RED lifecycle behavior**

Run: `cd services/api && uv run python -m pytest tests/test_repositories.py tests/test_reconcile_assets.py -v`

Expected: FAIL because metadata is written after upload, there is no lifecycle state/reconciliation operation, and object `NotFound` stops cleanup.

- [ ] **Step 3: Implement private lifecycle records and idempotent cleanup**

Add private `AssetLifecycle` values `pending`, `ready`, and `cleanup_pending` to `StoredAsset`, defaulting legacy persisted records to `ready`. Keep public `Asset` unchanged. In `CloudStorageAssetRepository.store`, first persist a private `pending` metadata document containing the server-generated object reference; only then upload bytes and update the record to `ready`. On upload/final-state failure, attempt cleanup. If bytes cannot be removed, retain the private metadata and update it to `cleanup_pending`; never return pending/cleanup records through `list_for_case` or `get_content`.

Make cloud deletion idempotent: catch the Google Storage `NotFound` exception as successful object cleanup, then continue to delete Firestore metadata. If document deletion fails after bytes are absent, leave `cleanup_pending` metadata so a later retry can complete. In memory, retain corresponding private lifecycle state and implement the same public-listing behavior. Add `reconcile_pending(limit: int) -> int` to `AssetRepository`; real repositories query pending cleanup records, retry `delete`, and return the number fully removed, while mock repositories do the same without external calls.

- [ ] **Step 4: Add the manual reconciliation command**

Add `RIGHTSRADAR_ENABLE_RECONCILIATION: bool = False` to settings. Extract repository construction from `build_services` into a small reusable helper so the command creates real repositories without constructing Gemini/Parallel/AgentService. `python -m app.reconcile_assets` must skip unless the explicit flag and real repository mode are both selected; when enabled, call `reconcile_pending(limit=100)` and print only a count, never bucket/project/object names or raw provider errors. Add `make reconcile-assets` as the documented explicit command; it must skip safely by default.

- [ ] **Step 5: Verify GREEN behavior and API privacy**

Run: `cd services/api && uv run python -m pytest tests/test_repositories.py tests/test_reconcile_assets.py -v`

Run: `make reconcile-assets`

Run: `cd services/api && uv run python -m pytest tests/test_assets.py -v`

Expected: PASS; default reconciliation skips; public asset responses still return only ready metadata and contain no private lifecycle/object fields.

- [ ] **Step 6: Document and commit durable cleanup**

Document the private lifecycle and that manual reconciliation is explicit, uses ADC/repository configuration, performs cleanup attempts, and reports failures without exposing identifiers. Do not add project-specific values.

```bash
git add services/api/app services/api/tests README.md .env.example Makefile
git commit -m "fix: persist recoverable asset cleanup state"
```

## Final verification

- [ ] Run `make lint`.
- [ ] Run `make typecheck`.
- [ ] Run `make test`.
- [ ] Run `make check-client`.
- [ ] Run `make build`.
- [ ] Run `make e2e`.
- [ ] Run `make smoke-real` and confirm the default skip.
- [ ] Run `docker compose up --build --detach`, check `GET /health` reports mock mode and the web root responds, then run `docker compose down`.
- [ ] Confirm `git diff --check`, clean tracked working tree, and no credential/ADC file is tracked.
