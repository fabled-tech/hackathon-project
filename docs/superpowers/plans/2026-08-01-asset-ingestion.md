# Mock-first Asset Ingestion and Case History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a complete mock-first workflow for attaching validated plain-text production assets to cases and reopening recent cases, while preserving opt-in Firestore and Cloud Storage persistence behind the existing repository interfaces.

**Architecture:** FastAPI owns multipart validation and returns Pydantic metadata. CaseRepository persists cases, summaries, and reviewer statuses; AssetRepository persists asset metadata and bytes. Mock repositories remain the default. Real mode stores case data and asset metadata in Firestore and asset bytes in the private GCS bucket. The Next.js UI uses only the generated client and never receives cloud credentials.

**Tech Stack:** FastAPI, Pydantic v2, python-multipart, Firestore, Google Cloud Storage, Next.js App Router, React, TypeScript, Vitest, Playwright, pytest, Ruff, mypy, pnpm, uv.

## Global Constraints

- Preserve RIGHTSRADAR_MODE=mock as the default; no external call occurs without an explicitly selected real integration.
- FastAPI OpenAPI is the only API-contract source; regenerate packages/api-client/src/generated.ts after route-model changes.
- Accept only text/plain files up to 256 KiB; reject invalid data before repository storage.
- Preserve the legal-research disclaimer, human reviewer workflow, and existing case/finding routes.
- Do not add auth, payments, queues, media analysis, direct browser-to-storage uploads, public URLs, deployment work, or cloud provisioning.
- Keep asset bytes private. The browser sees metadata only and receives no bucket credential, signed URL, or raw-content endpoint.
- Do not add secrets, ADC files, or project-specific credentials to source control.

---

## File map

| Path | Responsibility |
| --- | --- |
| services/api/app/models/assets.py | Public Asset and CaseSummary response models. |
| services/api/app/models/cases.py | Adds durable asset_count to Case. |
| services/api/app/models/requests.py | Shared upload constraints. |
| services/api/app/repositories/assets.py | Asset-upload value object and mock/cloud asset persistence. |
| services/api/app/repositories/cases.py | Recent-case query and atomic asset-count update. |
| services/api/app/routes/cases.py | Thin history and multipart-upload endpoints. |
| services/api/app/dependencies.py | Constructs real repositories with project, collection, and bucket. |
| services/api/pyproject.toml and uv.lock | Adds multipart parsing support. |
| scripts/generate_api_client.py | Emits history and asset client helpers. |
| packages/api-client/src/generated.ts | Generated output; never hand-edited. |
| apps/web/components/script-review.tsx | Upload and recent-case interaction state. |
| apps/web/app/styles.css | Styles for the added sections. |
| services/api/tests/test_assets.py | Mock API and validation coverage. |
| services/api/tests/test_repositories.py | Cloud-adapter behavior with fake clients. |
| apps/web/tests/api-client.test.ts | Generated client request-contract tests. |
| tests/fixtures/production-note.txt | Original plain-text upload fixture. |
| tests/e2e/review-workflow.spec.ts | Browser upload, history, and reviewer-state flow. |
| README.md and .env.example | Mock and opt-in real-repository setup guidance. |

## Task 1: Domain models and in-memory repository contracts

**Files:**
- Create: services/api/app/models/assets.py
- Modify: services/api/app/models/__init__.py, services/api/app/models/cases.py
- Modify: services/api/app/repositories/assets.py, services/api/app/repositories/cases.py, services/api/app/repositories/__init__.py
- Test: services/api/tests/test_assets.py

**Interfaces:**
- Consumes: existing Case, CaseRepository, and AssetRepository.
- Produces: Asset, CaseSummary, AssetUpload, AssetRepository.store/list_for_case/get_content, and CaseRepository.list_recent/increment_asset_count.

- [ ] **Step 1: Write failing tests for mock asset and history persistence**

    def test_in_memory_asset_repository_keeps_case_metadata_and_content() -> None:
        repository = InMemoryAssetRepository()
        asset = repository.store(
            "case-1",
            AssetUpload(filename="production-note.txt", content_type="text/plain", content=b"note"),
        )

        assert asset.case_id == "case-1"
        assert asset.filename == "production-note.txt"
        assert asset.byte_size == 4
        assert repository.list_for_case("case-1") == [asset]
        assert repository.get_content(asset.id) == b"note"


    def test_in_memory_case_repository_returns_newest_case_summaries() -> None:
        repository = InMemoryCaseRepository()
        first = make_case("case-1", created_at=datetime(2026, 8, 1, tzinfo=UTC))
        second = make_case("case-2", created_at=datetime(2026, 8, 2, tzinfo=UTC))
        repository.create(first)
        repository.create(second)
        repository.increment_asset_count("case-2")

        summary = repository.list_recent(limit=1)[0]
        assert summary.id == "case-2"
        assert summary.finding_count == len(second.findings)
        assert summary.asset_count == 1

- [ ] **Step 2: Run the focused tests to verify the contract gaps**

Run: cd services/api && uv run python -m pytest tests/test_assets.py -v

Expected: FAIL because AssetUpload, Asset, CaseSummary, list_recent, and increment_asset_count do not exist.

- [ ] **Step 3: Implement public models and mock behavior**

    class Asset(BaseModel):
        id: str
        case_id: str
        filename: str
        content_type: str
        byte_size: int = Field(ge=0)
        storage_reference: str
        created_at: datetime


    class CaseSummary(BaseModel):
        id: str
        created_at: datetime
        script_excerpt: str
        finding_count: int = Field(ge=0)
        asset_count: int = Field(ge=0)


    @dataclass(frozen=True)
    class AssetUpload:
        filename: str
        content_type: str
        content: bytes


    class AssetRepository(Protocol):
        def store(self, case_id: str, upload: AssetUpload) -> Asset: ...
        def list_for_case(self, case_id: str) -> list[Asset]: ...
        def get_content(self, asset_id: str) -> bytes: ...

Set Case.asset_count to a non-negative field with a default of zero. In-memory asset storage generates UUIDs and UTC timestamps, stores bytes by asset ID, returns a memory URI reference, and filters metadata by case. In-memory case history sorts created_at descending, returns at most limit summaries, and uses the first 160 script characters. increment_asset_count changes only the stored case and raises the existing case-not-found exception for unknown IDs.

- [ ] **Step 4: Run the focused tests to verify mock behavior**

Run: cd services/api && uv run python -m pytest tests/test_assets.py -v

Expected: PASS for mock persistence and newest-first history behavior.

- [ ] **Step 5: Commit the contract change**

    git add services/api/app/models services/api/app/repositories services/api/tests/test_assets.py
    git commit -m "feat: add asset and case history contracts"

## Task 2: Firestore and Cloud Storage repository behavior

**Files:**
- Modify: services/api/app/repositories/assets.py, services/api/app/repositories/cases.py, services/api/app/dependencies.py
- Test: services/api/tests/test_repositories.py

**Interfaces:**
- Consumes: Task 1 models and repositories plus project, case collection, and bucket settings.
- Produces: lazy real adapters with the same semantics as mock mode.

- [ ] **Step 1: Write failing cloud-adapter tests with injected fake clients**

    def test_cloud_asset_repository_writes_private_bytes_and_firestore_metadata() -> None:
        storage = FakeStorageClient()
        firestore = FakeFirestoreClient()
        repository = CloudStorageAssetRepository(
            project="test-project",
            bucket_name="asset-bucket",
            case_collection="cases",
            storage_client=storage,
            firestore_client=firestore,
        )

        asset = repository.store(
            "case-1",
            AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
        )

        assert storage.uploads[asset.storage_reference] == (b"rights note", "text/plain")
        assert firestore.documents[("cases", "case-1", "assets", asset.id)]["filename"] == "note.txt"


    def test_firestore_case_repository_increments_asset_count_and_lists_newest() -> None:
        repository = FirestoreCaseRepository("test-project", "cases", client=FakeFirestoreClient())
        repository.create(make_case("case-1", created_at=datetime(2026, 8, 1, tzinfo=UTC)))
        repository.increment_asset_count("case-1")

        assert repository.list_recent(limit=10)[0].asset_count == 1

- [ ] **Step 2: Run adapter tests to verify the seams are absent**

Run: cd services/api && uv run python -m pytest tests/test_repositories.py -v

Expected: FAIL because constructors lack injectable clients and storage-metadata/history behavior.

- [ ] **Step 3: Implement lazy real-adapter persistence**

    class CloudStorageAssetRepository:
        def __init__(
            self,
            project: str,
            bucket_name: str,
            case_collection: str,
            storage_client: StorageClient | None = None,
            firestore_client: FirestoreClient | None = None,
        ) -> None: ...

        def store(self, case_id: str, upload: AssetUpload) -> Asset:
            asset = Asset(..., storage_reference=f"cases/{case_id}/assets/{asset_id}", ...)
            blob.upload_from_string(upload.content, content_type=upload.content_type)
            try:
                self._case_collection.document(case_id).collection("assets").document(asset.id).set(
                    asset.model_dump(mode="json")
                )
            except Exception:
                blob.delete()
                raise
            return asset

Only import Google SDK modules when default clients are needed. list_for_case reads the cases/case_id/assets subcollection ordered by created_at. get_content finds asset metadata with a Firestore collection-group query and downloads the matching private GCS object. FirestoreCaseRepository.list_recent orders parent case documents by created_at descending and maps them to CaseSummary. increment_asset_count uses Firestore's atomic increment. Update build_services to pass the same project and case collection to both real repositories.

- [ ] **Step 4: Run adapter and existing case tests**

Run: cd services/api && uv run python -m pytest tests/test_repositories.py tests/test_cases.py -v

Expected: PASS with no Google credential or network requirement.

- [ ] **Step 5: Commit cloud persistence**

    git add services/api/app/repositories services/api/app/dependencies.py services/api/tests/test_repositories.py
    git commit -m "feat: persist asset metadata and case history"

## Task 3: Multipart upload and history API contract

**Files:**
- Modify: services/api/pyproject.toml, uv.lock
- Modify: services/api/app/models/requests.py, services/api/app/routes/cases.py
- Test: services/api/tests/test_assets.py

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: GET /api/cases, POST /api/cases/case_id/assets, and GET /api/cases/case_id/assets.

- [ ] **Step 1: Write failing HTTP tests for valid and rejected uploads**

    def test_uploading_a_text_asset_returns_metadata_and_lists_it() -> None:
        client = TestClient(create_app())
        case = client.post("/api/cases", json={"script_text": "Nimbus Soda appears."}).json()

        upload = client.post(
            f"/api/cases/{case['id']}/assets",
            files={"file": ("production-note.txt", b"Keep the fictional brand.", "text/plain")},
        )

        assert upload.status_code == 201
        assert upload.json()["byte_size"] == len(b"Keep the fictional brand.")
        listed = client.get(f"/api/cases/{case['id']}/assets")
        assert [asset["filename"] for asset in listed.json()] == ["production-note.txt"]


    def test_upload_rejects_unsupported_content_and_oversized_files() -> None:
        client = TestClient(create_app())
        case_id = client.post("/api/cases", json={"script_text": "A scene."}).json()["id"]

        invalid_type = client.post(
            f"/api/cases/{case_id}/assets",
            files={"file": ("poster.jpg", b"image", "image/jpeg")},
        )
        oversized = client.post(
            f"/api/cases/{case_id}/assets",
            files={"file": ("long.txt", b"x" * (256 * 1024 + 1), "text/plain")},
        )

        assert invalid_type.status_code == 422
        assert oversized.status_code == 422

- [ ] **Step 2: Run endpoint tests to verify routes are absent**

Run: cd services/api && uv run python -m pytest tests/test_assets.py -v

Expected: FAIL because the history and asset endpoints are missing.

- [ ] **Step 3: Implement validated thin routes and multipart support**

Add python-multipart>=0.0.20,<1 to API dependencies and refresh uv.lock. Add ALLOWED_ASSET_CONTENT_TYPE = "text/plain" and MAX_ASSET_BYTES = 256 * 1024 to request models. The upload route reads the file once, validates type and size before calling the repository, and never uses the submitted filename as an object path:

    @router.post("/{case_id}/assets", response_model=Asset, status_code=status.HTTP_201_CREATED)
    async def upload_asset(case_id: str, file: UploadFile, request: Request) -> Asset:
        services = _services(request)
        services.case_repository.get(case_id)
        content = await file.read()
        if file.content_type != ALLOWED_ASSET_CONTENT_TYPE:
            raise HTTPException(status_code=422, detail="Only text/plain assets are supported")
        if len(content) > MAX_ASSET_BYTES:
            raise HTTPException(status_code=422, detail="Asset must not exceed 256 KiB")
        asset = services.asset_repository.store(
            case_id,
            AssetUpload(
                filename=file.filename or "asset.txt",
                content_type=file.content_type,
                content=content,
            ),
        )
        services.case_repository.increment_asset_count(case_id)
        return asset

Add GET /api/cases with limit: int = Query(default=10, ge=1, le=50) and GET /api/cases/case_id/assets, which confirms the case exists before listing. Convert repository not-found errors to 404. Responses contain metadata only.

- [ ] **Step 4: Run endpoint tests and inspect OpenAPI paths**

Run: cd services/api && uv run python -m pytest tests/test_cases.py tests/test_assets.py -v

Run: cd services/api && uv run python -c "from app.main import create_app; print(sorted(create_app().openapi()['paths']))"

Expected: all tests PASS and printed paths include the asset path.

- [ ] **Step 5: Commit API contract changes**

    git add services/api/pyproject.toml uv.lock services/api/app/models/requests.py services/api/app/routes/cases.py services/api/tests/test_assets.py
    git commit -m "feat: add asset upload and case history endpoints"

## Task 4: Generated TypeScript client

**Files:**
- Modify: scripts/generate_api_client.py
- Regenerate: packages/api-client/src/generated.ts
- Test: apps/web/tests/api-client.test.ts

**Interfaces:**
- Consumes: Task 3 OpenAPI models and routes.
- Produces: listCases, uploadAsset, listAssets, Asset, and CaseSummary exports.

- [ ] **Step 1: Write failing client-contract tests**

    it('uploads an asset without setting a JSON content type', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'asset-1', filename: 'production-note.txt' }), { status: 201 })
      );

      await uploadAsset(
        'case-1',
        new File(['note'], 'production-note.txt', { type: 'text/plain' }),
        'http://api.test',
        fetcher
      );

      expect(fetcher).toHaveBeenCalledWith(
        'http://api.test/api/cases/case-1/assets',
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
      );
    });

- [ ] **Step 2: Run the client test to verify helpers are absent**

Run: pnpm --filter @rightsrader/web test -- apps/web/tests/api-client.test.ts

Expected: FAIL because uploadAsset is not exported.

- [ ] **Step 3: Extend the generator and regenerate output**

Require all new operations before rendering. Generate listCases(limit, ...), listAssets(caseId, ...), and this multipart helper. Its FormData body must omit a JSON content-type header:

    export function uploadAsset(
      caseId: string,
      file: File,
      baseUrl: string,
      fetcher: ApiFetcher = fetch
    ): Promise<Asset> {
      const body = new FormData();
      body.append('file', file);
      return request<Asset>(
        '/api/cases/' + encodeURIComponent(caseId) + '/assets',
        baseUrl,
        { method: 'POST', body },
        fetcher
      );
    }

Run make generate-client; never directly edit the generated file.

- [ ] **Step 4: Run client tests, type checks, and stale-output validation**

Run: pnpm --filter @rightsrader/web test -- apps/web/tests/api-client.test.ts

Run: make typecheck && make check-client

Expected: all commands PASS and make check-client leaves no generated-client diff.

- [ ] **Step 5: Commit generated contract changes**

    git add scripts/generate_api_client.py packages/api-client/src/generated.ts apps/web/tests/api-client.test.ts
    git commit -m "feat: generate asset and history API client"

## Task 5: Browser workflow, documentation, and complete verification

**Files:**
- Modify: apps/web/components/script-review.tsx, apps/web/app/styles.css
- Create: tests/fixtures/production-note.txt
- Modify: tests/e2e/review-workflow.spec.ts, README.md, .env.example

**Interfaces:**
- Consumes: Task 4 client helpers and types.
- Produces: accessible upload and case-history UI plus exact mock/real-repository setup guidance.

- [ ] **Step 1: Write the failing browser workflow**

    test('uploads a text asset and reopens it from recent cases', async ({ page }) => {
      await page.goto('/');
      await page.getByLabel('Script text').fill('Nimbus Soda appears in a shot.');
      await page.getByRole('button', { name: 'Analyze script' }).click();

      await page.getByLabel('Attach plain-text asset').setInputFiles('tests/fixtures/production-note.txt');
      await page.getByRole('button', { name: 'Upload asset' }).click();
      await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');

      await page.getByRole('button', { name: 'Refresh recent cases' }).click();
      await page.getByTestId('recent-cases').getByRole('button').first().click();
      await expect(page.getByTestId('asset-list')).toContainText('production-note.txt');
    });

- [ ] **Step 2: Run Playwright to verify controls are absent**

Run: pnpm e2e -- --grep "uploads a text asset"

Expected: FAIL because the page lacks upload and recent-case controls.

- [ ] **Step 3: Implement accessible UI and documentation**

Add selected-file, upload-pending, asset-list, recent-case-list, and error state to ScriptReview. Show upload only with a loaded case; on success, replace state from listAssets and clear the file input. A recent-case button calls listCases; selecting a row calls getCase followed by listAssets. Do not render storage_reference. Add asset-panel, asset-list, recent-cases, and recent-case-button CSS classes without changing existing finding styles.

Create the text fixture. Update README.md with the 256 KiB plain-text limit and this non-secret, repository-only hybrid configuration:

    RIGHTSRADAR_MODE=hybrid
    RIGHTSRADAR_REPOSITORY_MODE=real
    RIGHTSRADAR_GOOGLE_CLOUD_PROJECT=<project-id>
    RIGHTSRADAR_FIRESTORE_COLLECTION=rightsrader_cases
    RIGHTSRADAR_CLOUD_STORAGE_BUCKET=<private-bucket-name>

Update .env.example with matching commented placeholders and state that Gemini and Parallel remain mock for a repository-only smoke run. Do not include deployed project ID, bucket name, ADC path, API key, or token.

- [ ] **Step 4: Run browser regressions and all project verification**

Run: pnpm e2e -- --grep "uploads a text asset"

Run: pnpm e2e -- --grep "submits a script and lets the reviewer dismiss a finding"

Run: make lint && make typecheck && make test && make check-client && make build && make e2e && make smoke-real

Run: docker compose build && docker compose up -d --wait && docker compose ps && docker compose down --remove-orphans

Expected: both focused browser tests and every Make target PASS, real smoke skips in default mode, containers become healthy in mock mode, and Compose leaves no running containers.

- [ ] **Step 5: Commit UI, documentation, and verification changes**

    git add apps/web tests/fixtures tests/e2e README.md .env.example
    git commit -m "feat: add mock-first asset review workflow"

## Plan self-review

- **Spec coverage:** Tasks 1 through 3 implement metadata, validation, mock behavior, Firestore/GCS boundaries, and history. Task 4 preserves OpenAPI-generated client use. Task 5 implements the browser workflow, documentation, and all required validation.
- **Constraint coverage:** The plan preserves mock default, private assets, no direct client-cloud access, no auth, no media analysis, no new resource provisioning, and no real Gemini or Parallel calls.
- **Type consistency:** Asset, CaseSummary, AssetUpload, list_recent, and increment_asset_count are defined in Task 1; Tasks 2 through 5 consume those names exactly.
- **Placeholder scan:** The plan has no deferred work markers or unspecified implementation steps.

