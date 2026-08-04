# Production Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a production workspace that preserves immutable source versions, monitoring runs, and reviewer audit history while surfacing neutral, traceable rights-research leads for every current production source.

**Architecture:** Add a focused ProductionRepository alongside the existing case and private-asset repositories. A synchronous ProductionMonitoringService takes a stable production snapshot, calls the existing AgentService once for each active source, and atomically appends one immutable run only if the production revision is unchanged. FastAPI exposes a production-specific safe projection, the generated API client consumes the OpenAPI contract, and the home page becomes a horizontal production-monitoring workspace.

**Tech Stack:** Python 3.11, FastAPI, Pydantic 2, Firestore, Cloud Storage, Google ADK / Gemini through the existing AgentService, Parallel Search through the existing agent boundary, pytest, Ruff, mypy, Next.js 16, React 19, TypeScript, Vitest, Playwright.

## Global Constraints

- Work on branch patrick/fab-13-monitor-a-whole-production-for-changing-rights-clearance, based on codex/curated-evidence-focused-workspace.
- Preserve every existing /api/cases route, case repository, asset-history behavior, and deterministic mock-mode test; FAB-13 does not migrate or delete cases.
- Model each production as multiple named scripts and multiple named plain-text assets. A source edit or asset replacement must append an immutable version instead of mutating a historic version.
- Calculate every content fingerprint as lowercase SHA-256 of the exact UTF-8 bytes. Keep fingerprints, private asset IDs, Cloud Storage references, bytes, credentials, provider diagnostics, and raw provider failures server-only.
- Normal monitoring is manual and only runs when at least one source is new, changed, or newly retired. Explicit recheck is manual and runs all active sources even when none changed. Do not add a scheduler, polling, webhook, background job, or notification system.
- Use the existing AgentService exactly once per active source, passing its source-version ID as the analysis identifier. In real mode that preserves FAB-9's one-native-ADK-agent / Parallel Search workflow; in mock mode it remains deterministic and cloud-independent.
- Analyze all source content before persisting a run. Any content, agent, mapping, or persistence failure must leave all prior runs, source pointers, reviewer statuses, and audit events unchanged.
- A normal run must return HTTP 409 when nothing changed; a revision that changes during analysis must return a safe retryable HTTP 409. Missing production, source, run, and finding IDs return HTTP 404.
- Reviewer statuses remain pending, accepted, dismissed, and escalated. A status change appends an immutable ReviewEvent atomically with the run finding update.
- RightsRadar provides research assistance only. No backend response, generated type, UI copy, test fixture, or error may conclude ownership, registration, infringement, permission, licensing, clearance, fair use, legal risk, or whether content may be used or released.
- Keep the production UI horizontally split on desktop, stack it below 760px, retain visible labels and keyboard controls, and use polite progress or error announcements. Retain submitted script edits after a recoverable request failure.
- FastAPI is the OpenAPI source of truth. Regenerate packages/api-client/src/generated.ts with make generate-client; never hand-edit generated output.
- Finish with make lint, make typecheck, make test, make check-client, make build, and mocked make e2e. Keep real-cloud smoke opt-in.

---

## File structure

| File | Responsibility |
| --- | --- |
| services/api/app/models/productions.py | Internal immutable production/version/run models, safe API projections, change-state calculation, and SHA-256 fingerprint helper. |
| services/api/app/models/requests.py | Validated production, script, and reviewer-status request payloads. |
| services/api/app/models/__init__.py | Public model exports used by routes, repositories, and tests. |
| services/api/app/repositories/productions.py | ProductionRepository protocol plus deterministic in-memory and Firestore implementations. |
| services/api/app/repositories/__init__.py | Production repository exports and typed repository exceptions. |
| services/api/app/services/production_monitoring.py | Whole-production analysis orchestration with all-or-nothing run persistence. |
| services/api/app/services/__init__.py | Service export for dependency construction. |
| services/api/app/routes/asset_uploads.py | Shared plain-text upload validation used by legacy case assets and production assets. |
| services/api/app/routes/productions.py | Production HTTP contract, safe error mapping, asset cleanup, and response projections. |
| services/api/app/routes/cases.py | Reuse shared upload validation without changing the case contract. |
| services/api/app/routes/__init__.py and services/api/app/main.py | Register the production router and allow PUT and DELETE CORS methods. |
| services/api/app/dependencies.py | Construct matching in-memory or Firestore production repositories and the monitoring service. |
| services/api/tests/test_production_models.py | Fingerprint, version, change-state, and safe-projection unit tests. |
| services/api/tests/test_production_monitoring.py | Agent-call, aggregation, explicit-recheck, failure, and revision-conflict service tests. |
| services/api/tests/test_production_routes.py | Production API and private-asset boundary tests. |
| services/api/tests/test_repositories.py | Firestore repository tests using the existing fake Firestore client and transaction helpers. |
| services/api/tests/test_case_routes.py | Assert legacy upload validation still uses the shared validation path. |
| services/api/tests/test_dependencies.py and services/api/tests/test_smoke_real.py | Update ApplicationServices fixtures and verify real/mock repository selection. |
| scripts/generate_api_client.py | Render all production OpenAPI operations, including JSON, path/query, and multipart requests. |
| packages/api-client/src/generated.ts | Regenerated production types and client helpers. |
| services/api/tests/test_generate_api_client.py and apps/web/tests/api-client.test.ts | Generator and browser-client request-shape coverage for every production endpoint. |
| apps/web/components/production-monitor.tsx | Production picker, source inventory/editor, summary, run history, review queue, and audit timeline. |
| apps/web/app/page.tsx and apps/web/app/styles.css | Make production monitoring the home experience and implement the horizontal responsive layout. |
| tests/e2e/review-workflow.spec.ts | Browser acceptance coverage for the new home experience, history, review audit, and stale-response protection. |
| README.md | Operator-facing production-monitoring workflow and research-assistance boundary. |

## Interfaces introduced by this plan

~~~python
class ProductionSourceKind(StrEnum):
    SCRIPT = "script"
    ASSET = "asset"


class SourceChangeState(StrEnum):
    NEW = "new"
    CHANGED = "changed"
    UNCHANGED = "unchanged"
    RETIRED = "retired"


class ProductionRunTrigger(StrEnum):
    INITIAL = "initial"
    CHANGES_DETECTED = "changes_detected"
    EXPLICIT_RECHECK = "explicit_recheck"


class Production(BaseModel):
    id: str
    name: str
    revision: int
    created_at: datetime
    updated_at: datetime


class ProductionSource(BaseModel):
    id: str
    production_id: str
    kind: ProductionSourceKind
    name: str
    active: bool
    current_version_id: str
    last_monitored_version_id: str | None
    content_type: str | None = None
    byte_size: int | None = None
    created_at: datetime
    updated_at: datetime


class ProductionSourceVersion(BaseModel):
    id: str
    source_id: str
    fingerprint_sha256: str
    script_text: str | None = None
    asset_id: str | None = None
    created_at: datetime


class ProductionMonitoringSource(BaseModel):
    source: ProductionSource
    version: ProductionSourceVersion
    change_state: SourceChangeState


class ProductionMonitoringSnapshot(BaseModel):
    production: Production
    sources: list[ProductionMonitoringSource]
    has_successful_run: bool


class ProductionFinding(BaseModel):
    id: str
    run_id: str
    source_id: str
    category: str
    detected_item: str
    explanation: str
    confidence: float
    supporting_evidence: list[Evidence]
    source_urls: list[str]
    retrieved_at: datetime
    reviewer_status: ReviewerStatus
    evidence: EvidenceSelection


class StoredProductionRunSourceSnapshot(BaseModel):
    source_id: str
    source_version_id: str
    kind: ProductionSourceKind
    name: str
    fingerprint_sha256: str
    change_state: SourceChangeState


class StoredProductionRun(BaseModel):
    id: str
    production_id: str
    production_revision: int
    trigger: ProductionRunTrigger
    created_at: datetime
    source_snapshots: list[StoredProductionRunSourceSnapshot]
    findings: list[ProductionFinding]


class ProductionRepository(Protocol):
    def create(self, production: Production) -> Production: ...
    def list_recent(self, limit: int) -> list[ProductionSummary]: ...
    def get_detail(self, production_id: str) -> ProductionDetail: ...
    def create_source(
        self, production_id: str, source: ProductionSource, version: ProductionSourceVersion
    ) -> ProductionSource: ...
    def append_source_version(
        self, production_id: str, source_id: str, version: ProductionSourceVersion, updated_at: datetime
    ) -> ProductionSource: ...
    def retire_source(self, production_id: str, source_id: str, updated_at: datetime) -> ProductionSource: ...
    def get_monitoring_snapshot(self, production_id: str) -> ProductionMonitoringSnapshot: ...
    def append_complete_run(self, snapshot: ProductionMonitoringSnapshot, run: StoredProductionRun) -> ProductionRun: ...
    def list_runs(self, production_id: str, limit: int) -> list[ProductionRunSummary]: ...
    def get_run(self, production_id: str, run_id: str) -> ProductionRun: ...
    def update_finding_status(self, production_id: str, run_id: str, finding_id: str, reviewer_status: ReviewerStatus, updated_at: datetime) -> ReviewUpdate: ...
    def list_review_events(self, production_id: str, limit: int) -> list[ReviewEvent]: ...


class ProductionMonitoringService:
    def monitor(self, production_id: str, *, explicit_recheck: bool) -> ProductionRun: ...
~~~

The public ProductionDetail, ProductionRun, ProductionRunSourceSnapshot, ProductionRunSummary, ProductionSourceView, ProductionSummary, and ReviewUpdate models deliberately omit fingerprints, source-version IDs, private asset IDs, storage references, and asset bytes. ProductionSourceVersion and StoredProductionRun are repository-only models.

### Task 1: Add production domain models, exact fingerprints, and safe projections

**Files:**
- Create: services/api/app/models/productions.py
- Modify: services/api/app/models/__init__.py
- Test: services/api/tests/test_production_models.py

**Interfaces:**
- Consumes: Evidence, EvidenceSelection, ReviewerStatus, and the existing Finding-compatible evidence shape from services/api/app/models/cases.py.
- Produces: all production enums and models listed above, fingerprint_utf8, source_change_state, to_public_run, ProductionSummary, ProductionDetail, ProductionSourceView, ProductionRunSummary, and ReviewUpdate for every later task.

- [ ] **Step 1: Write failing fingerprint, validation, state, and projection tests**

~~~python
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models import (
    ProductionSource,
    ProductionSourceKind,
    ProductionSourceVersion,
    SourceChangeState,
    StoredProductionRun,
    fingerprint_utf8,
    source_change_state,
    to_public_run,
)


def test_fingerprint_utf8_uses_exact_lowercase_sha256() -> None:
    assert fingerprint_utf8("Café") == (
        "73473dcc12b763085904a5279d048c4d5b3b008c46f1f32443b99de04aa83a14"
    )
    assert fingerprint_utf8("Cafe") != fingerprint_utf8("Café")


@pytest.mark.parametrize(
    ("active", "last_version_id", "expected"),
    [
        (True, None, SourceChangeState.NEW),
        (True, "older-version", SourceChangeState.CHANGED),
        (True, "version-1", SourceChangeState.UNCHANGED),
        (False, None, SourceChangeState.RETIRED),
        (False, "older-version", SourceChangeState.RETIRED),
        (False, "version-1", SourceChangeState.UNCHANGED),
    ],
)
def test_source_change_state_marks_a_retirement_once(
    active: bool, last_version_id: str | None, expected: SourceChangeState
) -> None:
    source = ProductionSource(
        id="source-1",
        production_id="production-1",
        kind=ProductionSourceKind.SCRIPT,
        name="Episode one",
        active=active,
        current_version_id="version-1",
        last_monitored_version_id=last_version_id,
        created_at=datetime(2026, 8, 3, tzinfo=UTC),
        updated_at=datetime(2026, 8, 3, tzinfo=UTC),
    )
    assert source_change_state(source) is expected


def test_source_version_requires_exactly_one_server_side_content_reference() -> None:
    with pytest.raises(ValidationError):
        ProductionSourceVersion(
            id="version-1",
            source_id="source-1",
            fingerprint_sha256="a" * 64,
            script_text="A scene.",
            asset_id="asset-1",
            created_at=datetime(2026, 8, 3, tzinfo=UTC),
        )
~~~

- [ ] **Step 2: Run the focused model tests to verify they fail**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_production_models.py -q

Expected: FAIL because production models and fingerprint helpers do not exist.

- [ ] **Step 3: Implement the model boundary and conversion helpers**

Create the enums and models shown in the interface section. Put the exact byte and change logic in services/api/app/models/productions.py:

~~~python
def fingerprint_utf8(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def source_change_state(source: ProductionSource) -> SourceChangeState:
    if not source.active and source.last_monitored_version_id != source.current_version_id:
        return SourceChangeState.RETIRED
    if source.last_monitored_version_id is None:
        return SourceChangeState.NEW
    if source.last_monitored_version_id != source.current_version_id:
        return SourceChangeState.CHANGED
    return SourceChangeState.UNCHANGED


class ProductionSourceVersion(BaseModel):
    id: str
    source_id: str
    fingerprint_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    script_text: str | None = None
    asset_id: str | None = None
    created_at: datetime

    @model_validator(mode="after")
    def require_one_content_reference(self) -> Self:
        if (self.script_text is None) == (self.asset_id is None):
            raise ValueError("exactly one source content reference is required")
        return self
~~~

Implement the following public projections in the same module:

~~~python
class ProductionRunSourceSnapshot(BaseModel):
    source_id: str
    kind: ProductionSourceKind
    name: str
    change_state: SourceChangeState


class ProductionRun(BaseModel):
    id: str
    production_id: str
    production_revision: int
    trigger: ProductionRunTrigger
    created_at: datetime
    source_snapshots: list[ProductionRunSourceSnapshot]
    findings: list[ProductionFinding]


def to_public_run(stored: StoredProductionRun) -> ProductionRun:
    return ProductionRun(
        id=stored.id,
        production_id=stored.production_id,
        production_revision=stored.production_revision,
        trigger=stored.trigger,
        created_at=stored.created_at,
        source_snapshots=[
            ProductionRunSourceSnapshot(
                source_id=item.source_id,
                kind=item.kind,
                name=item.name,
                change_state=item.change_state,
            )
            for item in stored.source_snapshots
        ],
        findings=[item.model_copy(deep=True) for item in stored.findings],
    )
~~~

ProductionDetail must derive safe script/asset source views and aggregate neutral reviewer counts from the latest run. A script source view may include its current script_text; an asset source view exposes only filename/name, text/plain, byte size, active/retired status, and derived change state. Export every public model and helper from app/models/__init__.py.

- [ ] **Step 4: Extend the focused tests for safe API-facing serialization**

~~~python
def test_public_run_omits_internal_fingerprint_and_version_identifier() -> None:
    public = to_public_run(
        StoredProductionRun.model_validate(
            {
                "id": "run-1",
                "production_id": "production-1",
                "production_revision": 2,
                "trigger": "changes_detected",
                "created_at": "2026-08-03T00:00:00Z",
                "source_snapshots": [
                    {
                        "source_id": "source-1",
                        "source_version_id": "version-private",
                        "kind": "script",
                        "name": "Episode one",
                        "fingerprint_sha256": "a" * 64,
                        "change_state": "changed",
                    }
                ],
                "findings": [],
            }
        )
    )

    assert public.model_dump()["source_snapshots"] == [
        {
            "source_id": "source-1",
            "kind": "script",
            "name": "Episode one",
            "change_state": "changed",
        }
    ]
~~~

- [ ] **Step 5: Run the focused model tests to verify they pass**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_production_models.py -q

Expected: PASS; exact UTF-8 fingerprints, retirement-once semantics, immutable content-reference validation, and safe run projection are covered.

- [ ] **Step 6: Commit the tested domain contract**

~~~bash
git add services/api/app/models/productions.py services/api/app/models/__init__.py services/api/tests/test_production_models.py
git commit -m "feat: define production monitoring models"
~~~

### Task 2: Implement the deterministic production repository and immutable run semantics

**Files:**
- Create: services/api/app/repositories/productions.py
- Modify: services/api/app/repositories/__init__.py
- Modify: services/api/tests/test_production_models.py

**Interfaces:**
- Consumes: Task 1 production models and current UTC timestamps supplied by callers.
- Produces: ProductionRepository, InMemoryProductionRepository, ProductionRepositoryNotFound, ProductionSourceNotFound, ProductionRunNotFound, ProductionFindingNotFound, ProductionRevisionConflict, and the protocol methods listed in the interface section.

- [ ] **Step 1: Add failing in-memory repository tests**

~~~python
from app.repositories import InMemoryProductionRepository, ProductionRevisionConflict


def test_in_memory_repository_preserves_versions_runs_and_review_audit() -> None:
    repository = InMemoryProductionRepository()
    production = repository.create(make_production("production-1", revision=0))
    source = repository.create_source(
        production.id,
        make_script_source("source-1", production.id, "version-1"),
        make_script_version("version-1", "source-1", "Nimbus Soda appears."),
    )
    snapshot = repository.get_monitoring_snapshot(production.id)
    saved = repository.append_complete_run(snapshot, make_run(snapshot, "run-1"))
    updated = repository.append_source_version(
        production.id,
        source.id,
        make_script_version("version-2", source.id, "Nimbus Soda appears again."),
        utc(2),
    )
    review = repository.update_finding_status(
        production.id, saved.id, saved.findings[0].id, ReviewerStatus.ESCALATED, utc(3)
    )

    assert updated.current_version_id == "version-2"
    assert repository.get_run(production.id, saved.id).source_snapshots[0].change_state == "new"
    assert review.finding.reviewer_status is ReviewerStatus.ESCALATED
    assert [event.finding_id for event in repository.list_review_events(production.id, 10)] == [
        saved.findings[0].id
    ]


def test_in_memory_append_complete_run_is_revision_fenced_and_does_not_partially_advance_sources() -> None:
    repository = seeded_repository_with_one_script()
    snapshot = repository.get_monitoring_snapshot("production-1")
    repository.append_source_version(
        "production-1",
        "source-1",
        make_script_version("version-2", "source-1", "New text."),
        utc(2),
    )

    with pytest.raises(ProductionRevisionConflict):
        repository.append_complete_run(snapshot, make_run(snapshot, "run-stale"))

    assert repository.list_runs("production-1", 10) == []
    assert repository.get_monitoring_snapshot("production-1").sources[0].change_state == (
        SourceChangeState.CHANGED
    )
~~~

Define make_production, make_script_source, make_script_version, make_run, seeded_repository_with_one_script, and utc as complete local helpers in the test module. The run fixture must include one valid ProductionFinding with neutral explanation text and one traceable Evidence object.

- [ ] **Step 2: Run the focused repository tests to verify they fail**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_production_models.py -q

Expected: FAIL because the repository protocol and in-memory implementation do not exist.

- [ ] **Step 3: Implement deep-copied in-memory storage and one-time retirement handling**

Use separate dictionaries for production records, sources, source versions, stored runs, and review events. Return model_copy(deep=True) from every read and write. Source mutations must increment Production.revision and update Production.updated_at. Retiring a source must set active to False and last_monitored_version_id to None so the next successful run contains one retired snapshot; append_complete_run then advances last_monitored_version_id to current_version_id for every source snapshot, including retired sources.

~~~python
def append_complete_run(
    self, snapshot: ProductionMonitoringSnapshot, run: StoredProductionRun
) -> ProductionRun:
    current = self._productions.get(snapshot.production.id)
    if current is None:
        raise ProductionRepositoryNotFound(snapshot.production.id)
    if current.revision != snapshot.production.revision:
        raise ProductionRevisionConflict(snapshot.production.id)

    next_sources = copy.deepcopy(self._sources_by_production[snapshot.production.id])
    for item in snapshot.sources:
        next_sources[item.source.id].last_monitored_version_id = item.version.id

    self._sources_by_production[snapshot.production.id] = next_sources
    self._runs_by_production[snapshot.production.id][run.id] = run.model_copy(deep=True)
    return to_public_run(run)
~~~

The method must validate that every snapshot source belongs to the production and each StoredProductionRun finding references a source included in that run. Do all validation before assigning any dictionary so an exception cannot expose a partial run. list_runs and list_review_events return newest first; get_detail builds current source views and aggregate reviewer counts from the latest successful run.

- [ ] **Step 4: Add explicit recheck and retirement assertions**

~~~python
def test_retired_source_is_included_once_then_removed_from_future_monitoring_snapshots() -> None:
    repository = seeded_repository_with_one_script()
    first = repository.get_monitoring_snapshot("production-1")
    repository.append_complete_run(first, make_run(first, "run-1"))
    repository.retire_source("production-1", "source-1", utc(2))

    retired = repository.get_monitoring_snapshot("production-1")
    assert [item.change_state for item in retired.sources] == [SourceChangeState.RETIRED]
    repository.append_complete_run(retired, make_run(retired, "run-2"))

    assert repository.get_monitoring_snapshot("production-1").sources == []
~~~

- [ ] **Step 5: Run the focused repository tests to verify they pass**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_production_models.py -q

Expected: PASS; versions and runs are immutable, a stale run cannot persist, review events survive later source changes, and retirement is represented exactly once.

- [ ] **Step 6: Commit the deterministic repository**

~~~bash
git add services/api/app/repositories/productions.py services/api/app/repositories/__init__.py services/api/tests/test_production_models.py
git commit -m "feat: persist production monitoring in mock mode"
~~~

### Task 3: Add Firestore production persistence with transactional source and review updates

**Files:**
- Modify: services/api/app/repositories/productions.py
- Modify: services/api/tests/test_repositories.py

**Interfaces:**
- Consumes: Task 2 ProductionRepository protocol and the existing FakeFirestoreClient, FakeTransaction, fake_transactional, and run_fake_transaction test utilities.
- Produces: FirestoreProductionRepository(project, case_collection, client=..., transactional_decorator=..., transaction_runner=...) using the collection named f"{case_collection}_productions".

- [ ] **Step 1: Add failing Firestore repository tests using the existing fake client**

~~~python
from app.repositories import FirestoreProductionRepository


def fake_production_repository(firestore: FakeFirestoreClient) -> FirestoreProductionRepository:
    return FirestoreProductionRepository(
        "test-project",
        "cases",
        client=firestore,
        transactional_decorator=fake_transactional,
        transaction_runner=lambda operation: operation(firestore.transaction()),
    )


def test_firestore_production_repository_keeps_versions_and_runs_in_production_subcollections() -> None:
    firestore = FakeFirestoreClient()
    repository = fake_production_repository(firestore)
    production = repository.create(make_production("production-1", revision=0))
    repository.create_source(
        production.id,
        make_script_source("source-1", production.id, "version-1"),
        make_script_version("version-1", "source-1", "A scene."),
    )
    snapshot = repository.get_monitoring_snapshot(production.id)
    repository.append_complete_run(snapshot, make_run(snapshot, "run-1"))

    assert ("cases_productions", "production-1", "sources", "source-1") in firestore.documents
    assert (
        "cases_productions", "production-1", "sources", "source-1", "versions", "version-1"
    ) in firestore.documents
    assert ("cases_productions", "production-1", "runs", "run-1") in firestore.documents


def test_firestore_review_status_update_writes_audit_event_in_the_same_transaction() -> None:
    firestore = FakeFirestoreClient()
    repository = seeded_firestore_production_repository(firestore)

    result = repository.update_finding_status(
        "production-1", "run-1", "finding-1", ReviewerStatus.DISMISSED, utc(4)
    )

    assert result.finding.reviewer_status is ReviewerStatus.DISMISSED
    assert result.event.previous_status is ReviewerStatus.PENDING
    transaction = firestore.transactions[-1]
    assert any(path[-2:] == ("runs", "run-1") for path, _values in transaction.updates)
    assert any(
        path[:3] == ("cases_productions", "production-1", "review_events")
        for path in firestore.documents
    )
~~~

Define seeded_firestore_production_repository as a complete helper that uses the public repository methods to create one production, source, and stored run. Extend FakeQuery.stream only as needed to order generic subcollections by created_at; preserve all existing case and Cloud Storage fake behavior.

- [ ] **Step 2: Run the focused Firestore tests to verify they fail**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_repositories.py -q

Expected: FAIL because FirestoreProductionRepository has not implemented the repository operations.

- [ ] **Step 3: Implement the Firestore document layout and atomic writes**

Use a root collection derived from the configured case collection and do not put production documents under the legacy case collection:

~~~python
class FirestoreProductionRepository:
    def __init__(self, project: str, case_collection: str, *, client: Any | None = None, ...):
        ...
        self._collection = self._client.collection(f"{case_collection}_productions")

    def _source_document(self, production_id: str, source_id: str) -> Any:
        return self._collection.document(production_id).collection("sources").document(source_id)

    def _version_document(
        self, production_id: str, source_id: str, version_id: str
    ) -> Any:
        return self._source_document(production_id, source_id).collection("versions").document(
            version_id
        )
~~~

Create the production root and source/version documents using JSON-mode model dumps. For create_source and append_source_version, use a transaction that reads the root production, increments revision, writes the changed source pointer, writes the new immutable version document, and updates root updated_at. Never update a version document after it is set.

For append_complete_run, read the root production inside the transaction, compare its revision to snapshot.production.revision, create the complete run document with stored fingerprints, and update every referenced source's last_monitored_version_id inside the same transaction. For update_finding_status, read the run document, replace only the matching finding in its findings array, and transaction.set a new review_events document with previous_status and reviewer_status. Return public projections after the transaction completes.

- [ ] **Step 4: Add ordering and revision-fence tests**

~~~python
def test_firestore_run_listing_is_newest_first_and_rejects_a_stale_revision() -> None:
    firestore = FakeFirestoreClient()
    repository = seeded_firestore_production_repository(firestore)
    first = repository.get_monitoring_snapshot("production-1")
    repository.append_complete_run(first, make_run(first, "run-2", created_at=utc(2)))
    repository.append_source_version(
        "production-1",
        "source-1",
        make_script_version("version-2", "source-1", "Changed."),
        utc(3),
    )

    with pytest.raises(ProductionRevisionConflict):
        repository.append_complete_run(first, make_run(first, "run-stale", created_at=utc(4)))

    assert [run.id for run in repository.list_runs("production-1", 10)] == ["run-2", "run-1"]
~~~

- [ ] **Step 5: Run the focused Firestore tests to verify they pass**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_repositories.py -q

Expected: PASS; real-mode document paths, transactional review audit, newest-first history, and stale revision rejection are covered without cloud credentials.

- [ ] **Step 6: Commit the real repository implementation**

~~~bash
git add services/api/app/repositories/productions.py services/api/tests/test_repositories.py
git commit -m "feat: add firestore production monitoring repository"
~~~

### Task 4: Orchestrate whole-production monitoring through the existing research agent

**Files:**
- Create: services/api/app/services/__init__.py
- Create: services/api/app/services/production_monitoring.py
- Modify: services/api/app/errors.py
- Test: services/api/tests/test_production_monitoring.py

**Interfaces:**
- Consumes: Task 2 ProductionRepository, AssetRepository.get_content(owner_id, asset_id), AgentService.analyze(analysis_id, script_text), Finding, and AnalysisUnavailableError.
- Produces: ProductionMonitoringService.monitor(production_id, explicit_recheck), ProductionNoChangesError, ProductionContentUnavailableError, and safe source-scoped ProductionFinding conversion.

- [ ] **Step 1: Write failing service tests with recording fake collaborators**

~~~python
class RecordingAgent:
    def __init__(self, failure_after: int | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self.failure_after = failure_after

    def analyze(self, analysis_id: str, script_text: str) -> list[Finding]:
        self.calls.append((analysis_id, script_text))
        if self.failure_after is not None and len(self.calls) > self.failure_after:
            raise AnalysisUnavailableError("provider failure")
        return [make_agent_finding(analysis_id, script_text)]


def test_monitor_aggregates_active_scripts_and_assets_by_source_version() -> None:
    repository, assets = seeded_production_with_script_and_asset()
    agent = RecordingAgent()
    service = ProductionMonitoringService(repository, assets, agent, clock=lambda: utc(3))

    run = service.monitor("production-1", explicit_recheck=False)

    assert {analysis_id for analysis_id, _text in agent.calls} == {"version-script", "version-asset"}
    assert {finding.source_id for finding in run.findings} == {"script-1", "asset-1"}
    assert run.trigger is ProductionRunTrigger.INITIAL


def test_agent_failure_leaves_no_partial_production_run() -> None:
    repository, assets = seeded_production_with_script_and_asset()
    service = ProductionMonitoringService(repository, assets, RecordingAgent(failure_after=1))

    with pytest.raises(AnalysisUnavailableError):
        service.monitor("production-1", explicit_recheck=False)

    assert repository.list_runs("production-1", 10) == []
    assert repository.get_monitoring_snapshot("production-1").sources[0].change_state == (
        SourceChangeState.NEW
    )
~~~

The fixture must create one script version and one production-owned text asset using InMemoryAssetRepository.store("production-1", ...). make_agent_finding must create neutral explanation text and traceable evidence, but its case_id must be the supplied analysis ID so the test proves the production mapper does not leak case semantics.

- [ ] **Step 2: Run the focused monitoring tests to verify they fail**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_production_monitoring.py -q

Expected: FAIL because ProductionMonitoringService and its production-specific errors do not exist.

- [ ] **Step 3: Implement snapshot-first, analyze-then-append monitoring**

~~~python
def monitor(self, production_id: str, *, explicit_recheck: bool) -> ProductionRun:
    snapshot = self._production_repository.get_monitoring_snapshot(production_id)
    changed = {
        SourceChangeState.NEW,
        SourceChangeState.CHANGED,
        SourceChangeState.RETIRED,
    }
    if not explicit_recheck and not any(item.change_state in changed for item in snapshot.sources):
        raise ProductionNoChangesError(production_id)

    run_id = str(uuid4())
    findings: list[ProductionFinding] = []
    stored_snapshots: list[StoredProductionRunSourceSnapshot] = []
    for item in snapshot.sources:
        stored_snapshots.append(self._stored_snapshot(item))
        if not item.source.active:
            continue
        text = self._source_text(snapshot.production.id, item)
        findings.extend(
            self._map_findings(run_id, item.source.id, self._agent_service.analyze(item.version.id, text))
        )

    trigger = (
        ProductionRunTrigger.EXPLICIT_RECHECK
        if explicit_recheck
        else ProductionRunTrigger.INITIAL
        if not snapshot.has_successful_run
        else ProductionRunTrigger.CHANGES_DETECTED
    )
    return self._production_repository.append_complete_run(
        snapshot,
        StoredProductionRun(
            id=run_id,
            production_id=snapshot.production.id,
            production_revision=snapshot.production.revision,
            trigger=trigger,
            created_at=self._clock(),
            source_snapshots=stored_snapshots,
            findings=findings,
        ),
    )
~~~

_source_text returns version.script_text for scripts. For assets it calls asset_repository.get_content(production_id, version.asset_id), decodes UTF-8, and converts missing or malformed private content to ProductionContentUnavailableError without embedding source IDs, storage details, or provider diagnostics in public route errors. _map_findings copies the research fields, evidence selection, retrieved timestamp, and reviewer status from each Finding but generates a production finding ID and never preserves Finding.case_id.

- [ ] **Step 4: Add unchanged, explicit-recheck, retired-source, and revision-conflict tests**

~~~python
def test_normal_unchanged_run_requires_an_explicit_recheck_but_recheck_succeeds() -> None:
    repository, assets = seeded_completed_production()
    agent = RecordingAgent()
    service = ProductionMonitoringService(repository, assets, agent, clock=lambda: utc(4))

    with pytest.raises(ProductionNoChangesError):
        service.monitor("production-1", explicit_recheck=False)

    run = service.monitor("production-1", explicit_recheck=True)
    assert run.trigger is ProductionRunTrigger.EXPLICIT_RECHECK
    assert len(agent.calls) == 1


def test_retired_source_creates_a_zero_agent_changes_run_once() -> None:
    repository, assets = seeded_completed_production()
    repository.retire_source("production-1", "script-1", utc(4))
    service = ProductionMonitoringService(repository, assets, RecordingAgent(), clock=lambda: utc(5))

    run = service.monitor("production-1", explicit_recheck=False)

    assert run.findings == []
    assert [item.change_state for item in run.source_snapshots] == [SourceChangeState.RETIRED]


def test_revision_change_during_analysis_returns_conflict_without_saving(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository, assets = seeded_production_with_script_and_asset()
    agent = RecordingAgent()
    original = agent.analyze

    def analyze_then_edit(analysis_id: str, text: str) -> list[Finding]:
        result = original(analysis_id, text)
        repository.append_source_version(
            "production-1",
            "script-1",
            make_script_version("version-new", "script-1", "Changed during review."),
            utc(9),
        )
        return result

    monkeypatch.setattr(agent, "analyze", analyze_then_edit)
    with pytest.raises(ProductionRevisionConflict):
        ProductionMonitoringService(repository, assets, agent).monitor(
            "production-1", explicit_recheck=False
        )
    assert repository.list_runs("production-1", 10) == []
~~~

- [ ] **Step 5: Run the focused monitoring tests to verify they pass**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_production_monitoring.py -q

Expected: PASS; every active source is analyzed once, retired sources are recorded but not analyzed, explicit recheck works, and all failure paths preserve historic state.

- [ ] **Step 6: Commit production orchestration**

~~~bash
git add services/api/app/services services/api/app/errors.py services/api/tests/test_production_monitoring.py
git commit -m "feat: monitor complete production source sets"
~~~

### Task 5: Expose the production HTTP contract and wire matching real/mock services

**Files:**
- Create: services/api/app/routes/asset_uploads.py
- Create: services/api/app/routes/productions.py
- Modify: services/api/app/routes/cases.py
- Modify: services/api/app/routes/__init__.py
- Modify: services/api/app/main.py
- Modify: services/api/app/models/requests.py
- Modify: services/api/app/dependencies.py
- Modify: services/api/tests/test_case_routes.py
- Modify: services/api/tests/test_dependencies.py
- Modify: services/api/tests/test_smoke_real.py
- Create: services/api/tests/test_production_routes.py

**Interfaces:**
- Consumes: Tasks 1-4, ApplicationServices, AssetRepository.store/delete/get_content, and the existing plain-text asset constants.
- Produces: all /api/productions endpoints from the approved design, ProductionMonitoringService in ApplicationServices, and build_repositories(settings) returning (CaseRepository, AssetRepository, ProductionRepository).

- [ ] **Step 1: Write failing API tests for an end-to-end production flow and safe errors**

~~~python
def test_production_routes_create_sources_monitor_recheck_and_retain_review_audit() -> None:
    client = TestClient(create_app())
    production = client.post("/api/productions", json={"name": "Summer feature"}).json()
    script = client.post(
        f"/api/productions/{production['id']}/scripts",
        json={"name": "Opening scene", "script_text": "Nimbus Soda appears."},
    )
    asset = client.post(
        f"/api/productions/{production['id']}/assets",
        files={
            "file": (
                "music-cue.txt",
                b'The cue says "Time keeps the reel turning".',
                "text/plain",
            )
        },
    )

    assert script.status_code == 201
    assert asset.status_code == 201
    first_run = client.post(f"/api/productions/{production['id']}/runs")
    assert first_run.status_code == 201
    assert {item["kind"] for item in first_run.json()["source_snapshots"]} == {"script", "asset"}

    unchanged = client.post(f"/api/productions/{production['id']}/runs")
    assert unchanged.status_code == 409
    assert "Recheck all sources" in unchanged.json()["detail"]

    recheck = client.post(f"/api/productions/{production['id']}/rechecks")
    finding = recheck.json()["findings"][0]
    review = client.patch(
        f"/api/productions/{production['id']}/runs/{recheck.json()['id']}/findings/{finding['id']}",
        json={"reviewer_status": "dismissed"},
    )
    audit = client.get(f"/api/productions/{production['id']}/review-events")

    assert recheck.status_code == 201
    assert recheck.json()["trigger"] == "explicit_recheck"
    assert review.json()["finding"]["reviewer_status"] == "dismissed"
    assert audit.json()[0]["previous_status"] == "pending"
    assert audit.json()[0]["reviewer_status"] == "dismissed"


def test_production_asset_responses_never_expose_private_content_or_storage_fields() -> None:
    client = TestClient(create_app())
    production_id = client.post("/api/productions", json={"name": "Private asset test"}).json()["id"]

    response = client.post(
        f"/api/productions/{production_id}/assets",
        files={"file": ("notes.txt", b"Private note text", "text/plain")},
    )

    serialized = response.json()
    assert response.status_code == 201
    assert "case_id" not in serialized
    assert "asset_id" not in serialized
    assert "storage_reference" not in serialized
    assert "Private note text" not in str(serialized)
~~~

Add focused API tests for production list/detail summary counts, named script replacement, asset replacement, retirement producing one retired run snapshot, invalid production/script names, invalid upload media type/UTF-8/size, unknown production/source/run/finding 404s, safe 503 agent failure, and 409 revision conflict.

- [ ] **Step 2: Run the focused API tests to verify they fail**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_production_routes.py -q

Expected: FAIL because the production router, request models, dependencies, and route registration do not exist.

- [ ] **Step 3: Add request validation, shared upload validation, and dependency construction**

In app/models/requests.py add the exact request models:

~~~python
class CreateProductionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class CreateScriptRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    script_text: str = Field(min_length=1, max_length=20_000)


class UpdateScriptRequest(BaseModel):
    script_text: str = Field(min_length=1, max_length=20_000)


class UpdateProductionFindingRequest(BaseModel):
    reviewer_status: ReviewerStatus
~~~

Create read_text_asset_upload(file: UploadFile) -> AssetUpload in app/routes/asset_uploads.py. It must reject non-text/plain before reading, read at most MAX_ASSET_BYTES + 1, reject NUL bytes and invalid UTF-8, and return the normalized filename/content type/content. Replace the duplicated validation in routes/cases.py with this helper and keep the existing case response and cleanup semantics unchanged.

Extend ApplicationServices with required production_repository and production_monitoring_service fields. In build_repositories select InMemoryProductionRepository in mock mode and FirestoreProductionRepository(project, settings.firestore_collection) in real repository mode. In build_services instantiate ProductionMonitoringService(production_repository, asset_repository, agent_service). Update every direct ApplicationServices test fixture to provide matching in-memory production collaborators.

- [ ] **Step 4: Implement production routes and safe response mapping**

Use the exact route table below and explicit response models. Source mutation routes must generate production/source/version UUIDs and UTC timestamps in the route layer, fingerprint text with fingerprint_utf8, then delegate repository transitions. Asset routes store bytes with production_id as the existing AssetRepository owner key; if create_source or append_source_version fails after storage succeeds, call asset_repository.delete in the thread pool and preserve the original error.

~~~python
router = APIRouter(prefix="/api/productions", tags=["productions"])

@router.post("", response_model=ProductionDetail, status_code=status.HTTP_201_CREATED)
def create_production(payload: CreateProductionRequest, request: Request) -> ProductionDetail: ...

@router.get("", response_model=list[ProductionSummary])
def list_productions(request: Request, limit: int = Query(default=20, ge=1, le=50)) -> list[ProductionSummary]: ...

@router.get("/{production_id}", response_model=ProductionDetail)
def get_production(production_id: str, request: Request) -> ProductionDetail: ...

@router.post("/{production_id}/scripts", response_model=ProductionSourceView, status_code=201)
def create_script(production_id: str, payload: CreateScriptRequest, request: Request) -> ProductionSourceView: ...

@router.put("/{production_id}/scripts/{source_id}", response_model=ProductionSourceView)
def replace_script(..., payload: UpdateScriptRequest, request: Request) -> ProductionSourceView: ...

@router.delete("/{production_id}/sources/{source_id}", response_model=ProductionSourceView)
def retire_source(production_id: str, source_id: str, request: Request) -> ProductionSourceView: ...

@router.post("/{production_id}/assets", response_model=ProductionSourceView, status_code=201)
async def create_asset(production_id: str, file: Annotated[UploadFile, File(...)], request: Request) -> ProductionSourceView: ...

@router.post("/{production_id}/assets/{source_id}/versions", response_model=ProductionSourceView)
async def replace_asset(production_id: str, source_id: str, file: Annotated[UploadFile, File(...)], request: Request) -> ProductionSourceView: ...

@router.post("/{production_id}/runs", response_model=ProductionRun, status_code=201)
def monitor_changes(production_id: str, request: Request) -> ProductionRun: ...

@router.post("/{production_id}/rechecks", response_model=ProductionRun, status_code=201)
def recheck_all_sources(production_id: str, request: Request) -> ProductionRun: ...

@router.get("/{production_id}/runs", response_model=list[ProductionRunSummary])
def list_runs(production_id: str, request: Request, limit: int = Query(default=25, ge=1, le=100)) -> list[ProductionRunSummary]: ...

@router.get("/{production_id}/runs/{run_id}", response_model=ProductionRun)
def get_run(production_id: str, run_id: str, request: Request) -> ProductionRun: ...

@router.patch(
    "/{production_id}/runs/{run_id}/findings/{finding_id}",
    response_model=ReviewUpdate,
)
def update_production_finding(..., payload: UpdateProductionFindingRequest, request: Request) -> ReviewUpdate: ...

@router.get("/{production_id}/review-events", response_model=list[ReviewEvent])
def list_review_events(production_id: str, request: Request, limit: int = Query(default=50, ge=1, le=100)) -> list[ReviewEvent]: ...
~~~

Map ProductionNoChangesError to detail "No changed sources are available to monitor. Use Recheck all sources to run research again." Map ProductionRevisionConflict to detail "The production changed while monitoring. Review the latest sources and try again." Map AnalysisUnavailableError and ProductionContentUnavailableError to a generic 503 sentence without content, provider, storage, ID, or credential details. Include productions_router in app/routes/__init__.py and app/main.py, and add PUT and DELETE to CORS allow_methods.

- [ ] **Step 5: Add regression tests for the legacy case upload helper and mode selection**

~~~python
def test_build_repositories_uses_matching_production_repository_for_mock_mode() -> None:
    case_repository, asset_repository, production_repository = build_repositories(
        Settings(repository_mode="mock")
    )

    assert isinstance(case_repository, InMemoryCaseRepository)
    assert isinstance(asset_repository, InMemoryAssetRepository)
    assert isinstance(production_repository, InMemoryProductionRepository)
~~~

Update the existing real-mode dependency test to assert FirestoreProductionRepository is constructed with the same project and configured base collection. In test_case_routes.py, retain the current content-type, bounded-read, cleanup, and threadpool expectations after the shared helper extraction.

- [ ] **Step 6: Run focused API and dependency tests to verify they pass**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_production_routes.py tests/test_case_routes.py tests/test_dependencies.py tests/test_smoke_real.py -q

Expected: PASS; production and legacy case paths both validate and clean up correctly, and mock/real repositories remain isolated.

- [ ] **Step 7: Commit the HTTP and dependency wiring**

~~~bash
git add services/api/app/dependencies.py services/api/app/main.py services/api/app/models/requests.py services/api/app/routes services/api/tests/test_case_routes.py services/api/tests/test_dependencies.py services/api/tests/test_production_routes.py services/api/tests/test_smoke_real.py
git commit -m "feat: expose production monitoring API"
~~~

### Task 6: Generate typed production API helpers from the FastAPI contract

**Files:**
- Modify: scripts/generate_api_client.py
- Modify: services/api/tests/test_generate_api_client.py
- Modify: apps/web/tests/api-client.test.ts
- Regenerate: packages/api-client/src/generated.ts

**Interfaces:**
- Consumes: Task 5 OpenAPI operation IDs and response models.
- Produces: createProduction, listProductions, getProduction, createProductionScript, replaceProductionScript, retireProductionSource, createProductionAsset, replaceProductionAsset, monitorProductionChanges, recheckProductionSources, listProductionRuns, getProductionRun, updateProductionFindingStatus, and listProductionReviewEvents.

- [ ] **Step 1: Write failing generator and browser-client request-shape tests**

~~~python
def test_generate_emits_every_production_helper_from_the_openapi_contract() -> None:
    output = generate()

    for function_name in (
        "createProduction",
        "listProductions",
        "getProduction",
        "createProductionScript",
        "replaceProductionScript",
        "retireProductionSource",
        "createProductionAsset",
        "replaceProductionAsset",
        "monitorProductionChanges",
        "recheckProductionSources",
        "listProductionRuns",
        "getProductionRun",
        "updateProductionFindingStatus",
        "listProductionReviewEvents",
    ):
        assert f"export function {function_name}(" in output
~~~

~~~typescript
it('posts an explicit recheck and uploads a replacement asset with encoded identifiers', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'run-1', findings: [], source_snapshots: [] }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  );

  await recheckProductionSources('production/one', 'http://api.test', fetcher);
  await replaceProductionAsset(
    'production/one',
    'source two',
    new File(['note'], 'notes.txt', { type: 'text/plain' }),
    'http://api.test',
    fetcher
  );

  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    'http://api.test/api/productions/production%2Fone/rechecks',
    expect.objectContaining({ method: 'POST' })
  );
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    'http://api.test/api/productions/production%2Fone/assets/source%20two/versions',
    expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
  );
});
~~~

Add one TypeScript assertion for each JSON mutation and every GET/list URL, including default limit query strings. Assert multipart helpers do not set a JSON Content-Type header.

- [ ] **Step 2: Run focused client-generation tests to verify they fail**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_generate_api_client.py -q

Run: pnpm --filter @rightsrader/web test -- api-client.test.ts

Expected: FAIL because generated production helpers do not exist.

- [ ] **Step 3: Refactor the generator around declarative operation renderers and add production operations**

Keep the existing legacy helper signatures unchanged. Add generic render_json_operation, render_path_operation, render_query_operation, and render_multipart_operation functions that accept a function name and OperationSpec. Each renderer must use _render_path, encode path parameters, preserve query defaults, call request with the exact OpenAPI method, and return the OpenAPI response type.

Add the operation definitions in generate:

~~~python
production_operations = (
    ("createProduction", "create_production_api_productions_post", "json"),
    ("listProductions", "list_productions_api_productions_get", "query"),
    ("getProduction", "get_production_api_productions__production_id__get", "path"),
    ("createProductionScript", "create_script_api_productions__production_id__scripts_post", "json"),
    (
        "replaceProductionScript",
        "replace_script_api_productions__production_id__scripts__source_id__put",
        "json",
    ),
    (
        "retireProductionSource",
        "retire_source_api_productions__production_id__sources__source_id__delete",
        "path",
    ),
    (
        "createProductionAsset",
        "create_asset_api_productions__production_id__assets_post",
        "multipart",
    ),
    (
        "replaceProductionAsset",
        "replace_asset_api_productions__production_id__assets__source_id__versions_post",
        "multipart",
    ),
    (
        "monitorProductionChanges",
        "monitor_changes_api_productions__production_id__runs_post",
        "path",
    ),
    (
        "recheckProductionSources",
        "recheck_all_sources_api_productions__production_id__rechecks_post",
        "path",
    ),
    (
        "listProductionRuns",
        "list_runs_api_productions__production_id__runs_get",
        "query",
    ),
    (
        "getProductionRun",
        "get_run_api_productions__production_id__runs__run_id__get",
        "path",
    ),
    (
        "updateProductionFindingStatus",
        "update_production_finding_api_productions__production_id__runs__run_id__findings__finding_id__patch",
        "json",
    ),
    (
        "listProductionReviewEvents",
        "list_review_events_api_productions__production_id__review_events_get",
        "query",
    ),
)
~~~

Have the JSON renderer accept payload: RequestModel rather than flattening its fields. This keeps request-model evolution type-safe and leaves legacy updateFindingStatus unchanged. For multipart operations, require exactly one binary field named file and append it to FormData. Regenerate generated.ts only through make generate-client.

- [ ] **Step 4: Run focused generator/client tests and generated-file check**

Run: make generate-client

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_generate_api_client.py -q

Run: pnpm --filter @rightsrader/web test -- api-client.test.ts

Run: make check-client

Expected: PASS; the generated client is up to date and every production request shape is typed, encoded, and uses the correct body format.

- [ ] **Step 5: Commit the generated contract**

~~~bash
git add scripts/generate_api_client.py services/api/tests/test_generate_api_client.py apps/web/tests/api-client.test.ts packages/api-client/src/generated.ts
git commit -m "feat: generate production monitoring client"
~~~

### Task 7: Build the production monitoring workspace and browser acceptance flow

**Files:**
- Create: `apps/web/components/production-monitor.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/styles.css`
- Modify: `tests/e2e/review-workflow.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the generated production helpers and public types from Task 6.
- Produces: a production-first home experience that creates/opens productions, edits named
  scripts, uploads/replaces/retire plain-text assets, starts normal monitoring or explicit
  rechecks, selects chronological runs, updates finding review status, and displays the
  production summary plus audit timeline without exposing private fields.

- [ ] **Step 1: Write the failing component and browser assertions**

Add a component test or browser assertions for the following visible behavior:

```typescript
test('production workspace shows source inventory, monitoring summary, and audit history', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Production name').fill('Summer feature');
  await page.getByRole('button', { name: 'Create production' }).click();
  await page.getByLabel('Script name').fill('Opening scene');
  await page.getByLabel('Script text').fill('Nimbus Soda appears.');
  await page.getByRole('button', { name: 'Save script' }).click();
  await page.getByRole('button', { name: 'Monitor changes' }).click();
  await expect(page.getByRole('heading', { name: 'Monitoring summary' })).toBeVisible();
  await expect(page.getByText('1 script')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recheck all sources' })).toBeVisible();
});
```

Extend the mocked route fixture to cover production list/detail, scripts, runs, finding status,
and review events. Assert that an unchanged monitor response preserves the production selection
and offers the explicit recheck action; selecting an older run restores its findings; a dismissed
finding appears in the audit timeline; and asset rows show filename/type/size/timestamp but never
source fingerprints, private IDs, storage references, or bytes.

- [ ] **Step 2: Run the focused browser test to verify it fails**

Run: `pnpm exec playwright test tests/e2e/review-workflow.spec.ts --project=chromium`

Expected: FAIL because the home page still renders the one-off `ScriptReview` component and has no
production controls.

- [ ] **Step 3: Implement the production-first workspace**

Create `ProductionMonitor` with request-generation refs so a stale production/run/review response
cannot replace a newer selection. Keep script edits visible after recoverable failures. The layout
must be a horizontal two-pane grid above 760px and stack below it:

```text
left pane: production picker + source inventory/editor
right pane: Monitoring summary + Monitor changes/Recheck all sources + chronological runs
below summary: selected run findings grouped by source + human review controls + audit timeline
```

Use visible labels for every input and button, `aria-live="polite"` for progress/errors, and copy
that describes only possible research leads. The summary must show script count, asset count,
sources needing recheck, latest run timestamp, lead count, and reviewer-status counts. The run list
must show trigger, timestamp, source count, and changed-source count newest first. Source inventory
must show active/retired/change-state labels; scripts expose editable text, assets expose metadata
only. A retired source is shown in the next run snapshot but cannot be analyzed again.

Keep the existing legacy case UI available only through its API contract; the home page may replace
it with production monitoring. Do not add search, filters, tags, scheduler, notifications, legal
conclusions, clearance labels, or provider diagnostics.

- [ ] **Step 4: Add responsive styles and safe empty/error states**

Update `apps/web/app/styles.css` with the two-pane desktop grid, the sub-760px stacked layout,
source/run cards, summary counts, audit timeline, and keyboard-visible focus states. Include neutral
copy for no sources, no possible research leads, unchanged monitoring, and unavailable providers.
Never render fingerprints, private asset IDs, storage references, or raw asset text.

- [ ] **Step 5: Run focused browser and type checks**

Run: `pnpm exec playwright test tests/e2e/review-workflow.spec.ts --project=chromium`

Run: `pnpm --filter @rightsrader/web typecheck`

Expected: PASS with production creation, multi-source inventory, changed-source state, normal
monitoring, explicit recheck, chronological run selection, evidence review, and audit history.

- [ ] **Step 6: Document the operator workflow and commit the UI**

Update `README.md` with the production monitoring workflow, explicit recheck behavior, retained
run/audit history, and the research-assistance-only guardrail. Then run:

```bash
git add apps/web/components/production-monitor.tsx apps/web/app/page.tsx apps/web/app/styles.css tests/e2e/review-workflow.spec.ts README.md
git commit -m "feat: add production monitoring workspace"
```
