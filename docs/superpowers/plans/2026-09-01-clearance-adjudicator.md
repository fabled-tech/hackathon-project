# Clearance Adjudicator and Submission Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RightsRadar a Stage-One-compliant Parallel-track submission with a public, cost-capped Cloud Run API, the official `parallel-web` SDK, and a new ADK-based Clearance Adjudicator that fans out competing hypotheses to Parallel-backed advocate agents and returns a grounded Clearance Memo into the user's Inbox.

**Architecture:** FastAPI (`services/api`) keeps the Intake → Research → Curation pipeline; a new `AdjudicatorAgent` runs only on contested leads, orchestrating an ADK `LlmAgent` (hypotheses) + `ParallelAgent` (advocates with a `parallel-web` search tool) and a `google-genai` Judge call grounded with `parallel_ai_search`. Results land as `Finding.memo` and route to a roster member via `stakeholder_ids`/`assignee`. Next.js (`apps/web`) renders a fourth pipeline node, memo cards, Inbox verdict chips, and one unified "Acting as" identity control.

**Tech Stack:** Python 3.11+, FastAPI, pydantic v2, `google-genai`, `google-adk` (1.x), `parallel-web` (>=1.0.1), Firestore; Next.js 16 / React 19, Vitest, Playwright; Cloud Run, Secret Manager, Vercel.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-01-clearance-adjudicator-design.md`. Read it once before starting.
- Branch: `feat/clearance-adjudicator` (already exists, tracks `origin/feat/clearance-adjudicator`). Commit after every task; push at the end of each phase.
- Allowed AI/agent libraries only: `google-genai`, `google-adk`. **No LangChain/LangGraph or other agent frameworks.** Parallel only via `parallel-web` (Python SDK) after Task 4.
- Repo root commands: `make lint`, `make typecheck`, `make test`, `make generate-client`, `make check-client`, `make e2e`. API-only: `cd services/api && uv run python -m pytest -q`. Web-only: `pnpm test:web`, `pnpm --filter @rightsrader/web lint`, `pnpm typecheck`.
- On Windows PowerShell the `cd services/api && ...` form does not work; use `uv run --directory services/api python -m pytest -q`.
- Ruff line length 100; mypy strict; `google.*` imports are `ignore_missing_imports`. Add `parallel.*` to that override in Task 4.
- Never log or return secrets or provider response bodies. Summaries in `ToolCallEvent` are short strings.
- Every new Vertex/Parallel call must be recorded via `ToolCallRecorder.record(...)` with `agent_name="Adjudicator"`.
- Mock mode must keep working offline with `fixture=True` events. E2E runs in mock.
- Copy rules: no "judge", "dev", or "fixture" wording in product UI outside the tool-log toggle; agent name is `Adjudicator`; verdict labels are `Cleared`, `License required`, `Rewrite recommended`, `Needs a human`.
- Dependencies: add `google-adk>=1.0,<2` and `parallel-web>=1.0.1,<2` to `[dependency-groups].cloud` in `services/api/pyproject.toml`; run `uv lock --directory services/api` (from repo root: `uv lock --directory services/api`) and commit `uv.lock`.

---

## Phase A — Compliance, cost guard, public API

### Task 1: LICENSE, repo visibility, judges section

**Files:**
- Create: `LICENSE`
- Modify: `README.md:1-10`

**Interfaces:** none.

- [ ] **Step 1: Add Apache-2.0 license**

Create `LICENSE` with the full Apache License 2.0 text from https://www.apache.org/licenses/LICENSE-2.0.txt. Append at the end:

```text
Copyright 2026 Fabled Tech RightsRadar contributors
```

- [ ] **Step 2: Add the judges' 90-second tour to the top of README**

Insert immediately after the H1 title line in `README.md`:

```markdown
> **Judges: 90-second tour.** Live app: <https://hackathon-project-web-five.vercel.app> ·
> API health: <https://RIGHTSRADAR_API_URL/health> (shows `mode: cloud`, `adjudicator: adk`).
> Click **Walk The Matrix homage**, then press **Run next stage** five times:
> Intake (Vertex Gemini) → Research (Parallel Search ×N + Extract) → Curation → **Adjudicator**
> (ADK multi-agent: hypotheses → parallel advocates on Parallel Search → grounded Clearance Memo)
> → your turn. Open **Show agent tool log** to count live Vertex and Parallel calls.
> Track: **Parallel**. Google Cloud: Vertex AI Gemini via `google-genai`, ADK via `google-adk`,
> Firestore, Cloud Storage, Cloud Run. Parallel: `parallel-web` Search + Extract, and
> Parallel Web Search as a Gemini grounding provider.
```

(`RIGHTSRADAR_API_URL` is replaced with the real Cloud Run URL in Task 6.)

- [ ] **Step 3: Verify GitHub detects the license**

Run: `git add LICENSE README.md && git commit -m "docs: add Apache-2.0 license and judges tour" && git push`
Then: `gh api repos/fabled-tech/hackathon-project --jq .license.spdx_id`
Expected: `Apache-2.0` (GitHub may take a minute).

- [ ] **Step 4: Make the repository public (owner action)**

Run: `gh repo edit fabled-tech/hackathon-project --visibility public --accept-visibility-change-consequences`
Expected: no error. Confirm: `gh repo view fabled-tech/hackathon-project --json visibility --jq .visibility` → `public`.
If the org blocks this, the repo owner must do it in Settings → General → Danger Zone before 2026-09-09.

---

### Task 2: Settings for CORS origins, quota, adjudication threshold; `/health` reports adjudicator

**Files:**
- Modify: `services/api/app/config.py`
- Modify: `services/api/app/main.py`
- Modify: `.env.example`
- Test: `services/api/tests/test_config_and_health.py` (new)

**Interfaces:**
- Produces: `Settings.allowed_origins: list[str]`, `Settings.daily_analysis_cap: int`, `Settings.adjudicate_below_confidence: float`, `Settings.adjudicator_mode -> Literal["adk","fixture"]` (property). `/health` JSON gains `"adjudicator"`.

- [ ] **Step 1: Write the failing tests**

```python
# services/api/tests/test_config_and_health.py
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_allowed_origins_parses_comma_separated_env(monkeypatch) -> None:
    monkeypatch.setenv(
        "RIGHTSRADAR_ALLOWED_ORIGINS",
        "https://a.example, https://b.example",
    )
    settings = Settings(_env_file=None)
    assert settings.allowed_origins == ["https://a.example", "https://b.example"]


def test_allowed_origins_default_to_localhost() -> None:
    settings = Settings(_env_file=None)
    assert settings.allowed_origins == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_health_reports_mode_and_adjudicator() -> None:
    client = TestClient(create_app(Settings(_env_file=None)))
    body = client.get("/health").json()
    assert body == {"status": "ok", "mode": "mock", "adjudicator": "fixture"}


def test_cors_allows_configured_origin() -> None:
    settings = Settings(_env_file=None, allowed_origins=["https://desk.example"])
    client = TestClient(create_app(settings))
    response = client.options(
        "/api/productions",
        headers={
            "Origin": "https://desk.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "https://desk.example"
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --directory services/api python -m pytest tests/test_config_and_health.py -q`
Expected: FAIL (`allowed_origins` attribute missing; health body mismatch).

- [ ] **Step 3: Implement settings**

Replace the `Settings` class body in `services/api/app/config.py` with:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"), env_prefix="RIGHTSRADAR_", extra="ignore"
    )

    mode: EnvironmentMode = EnvironmentMode.MOCK
    gemini_mode: IntegrationMode = IntegrationMode.MOCK
    parallel_mode: IntegrationMode = IntegrationMode.MOCK
    repository_mode: IntegrationMode = IntegrationMode.MOCK
    google_cloud_project: str | None = None
    google_cloud_location: str = "global"
    gemini_model: str = "gemini-3.7-flash"
    parallel_api_key: str | None = None
    parallel_max_concurrency: int = Field(default=4, ge=1, le=16)
    firestore_collection: str = "rightsrader_cases"
    firestore_productions_collection: str = "rightsrader_productions"
    cloud_storage_bucket: str | None = None
    enable_real_smoke: bool = False
    enable_reconciliation: bool = False
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )
    daily_analysis_cap: int = Field(default=25, ge=1, le=10_000)
    adjudicate_below_confidence: float = Field(default=0.75, ge=0, le=1)

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    def selected_mode(self, integration_mode: IntegrationMode) -> IntegrationMode:
        if self.mode is EnvironmentMode.MOCK:
            return IntegrationMode.MOCK
        if self.mode is EnvironmentMode.CLOUD:
            return IntegrationMode.REAL
        return integration_mode

    @property
    def adjudicator_mode(self) -> str:
        gemini_real = self.selected_mode(self.gemini_mode) is IntegrationMode.REAL
        parallel_real = self.selected_mode(self.parallel_mode) is IntegrationMode.REAL
        return "adk" if gemini_real and parallel_real else "fixture"
```

Update the import line to `from pydantic import Field, field_validator`.

pydantic-settings parses list fields from env as JSON by default; the `mode="before"` validator handles the comma form, but JSON decoding runs first. Add to `model_config`: `env_parse_none_str=None` is not needed; instead set `SettingsConfigDict(..., env_ignore_empty=True)` and add a `NoDecode` annotation:

```python
from typing import Annotated
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )
```

- [ ] **Step 4: Wire CORS and health**

In `services/api/app/main.py` replace the middleware and health route:

```python
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.allowed_origins,
        allow_methods=["DELETE", "GET", "POST", "PATCH"],
        allow_headers=["Content-Type"],
    )
    app.include_router(cases_router)
    app.include_router(productions_router)

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "mode": app_settings.mode.value,
            "adjudicator": app_settings.adjudicator_mode,
        }
```

- [ ] **Step 5: Document env**

Append to `.env.example`:

```bash
# Comma-separated browser origins allowed to call the API. Defaults to localhost dev ports.
# RIGHTSRADAR_ALLOWED_ORIGINS=https://hackathon-project-web-five.vercel.app
# Maximum new analyses per UTC day in cloud mode; pre-analyzed cases stay readable.
RIGHTSRADAR_DAILY_ANALYSIS_CAP=25
# Leads with Intake confidence below this run through the ADK Clearance Adjudicator.
RIGHTSRADAR_ADJUDICATE_BELOW_CONFIDENCE=0.75
```

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `uv run --directory services/api python -m pytest tests/test_config_and_health.py tests/test_cases.py -q`
Expected: PASS.
Run: `uv run --directory services/api ruff check app tests && uv run --directory services/api mypy app`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add services/api/app/config.py services/api/app/main.py .env.example services/api/tests/test_config_and_health.py
git commit -m "feat(api): configurable CORS origins, analysis cap setting, adjudicator health flag"
```

---

### Task 3: Daily analysis quota (in-memory + Firestore) with 429 on new analyses

**Files:**
- Create: `services/api/app/repositories/quota.py`
- Modify: `services/api/app/repositories/__init__.py`
- Modify: `services/api/app/dependencies.py`
- Modify: `services/api/app/routes/cases.py:121-157` and `:159-250`
- Test: `services/api/tests/test_quota.py` (new)

**Interfaces:**
- Produces: `class AnalysisQuota(Protocol): def try_consume(self, day: str) -> bool`, `InMemoryAnalysisQuota(cap: int)`, `FirestoreAnalysisQuota(project: str, collection: str, cap: int)`, `ApplicationServices.analysis_quota: AnalysisQuota`, `today_key() -> str` (UTC `YYYY-MM-DD`).
- Consumes: `Settings.daily_analysis_cap` (Task 2).

- [ ] **Step 1: Write failing tests**

```python
# services/api/tests/test_quota.py
import asyncio
from collections.abc import Sequence

from fastapi import FastAPI, HTTPException
from starlette.requests import Request

from app.dependencies import ApplicationServices
from app.models import Finding
from app.models.requests import CreateCaseRequest
from app.repositories.assets import InMemoryAssetRepository
from app.repositories.cases import InMemoryCaseRepository
from app.repositories.quota import InMemoryAnalysisQuota, today_key
from app.routes.cases import create_case


class CountingAgentService:
    def __init__(self) -> None:
        self.calls = 0

    async def analyze_desk(self, case_id: str, script_text: str, ignored_keywords: Sequence[str] = (), roster: Sequence[object] = ()):  # noqa: E501
        from app.agents.service import AnalysisDeskResult

        self.calls += 1
        return AnalysisDeskResult(findings=[], thread=[], tool_calls=[])

    async def analyze(self, *args: object, **kwargs: object) -> list[Finding]:
        return []


def _request(agent: CountingAgentService, quota: InMemoryAnalysisQuota) -> Request:
    app = FastAPI()
    app.state.services = ApplicationServices(
        case_repository=InMemoryCaseRepository(),
        asset_repository=InMemoryAssetRepository(),
        agent_service=agent,  # type: ignore[arg-type]
        analysis_quota=quota,
    )
    return Request({"type": "http", "app": app, "headers": []})


def test_in_memory_quota_counts_per_day() -> None:
    quota = InMemoryAnalysisQuota(cap=2)
    assert quota.try_consume("2026-09-01") is True
    assert quota.try_consume("2026-09-01") is True
    assert quota.try_consume("2026-09-01") is False
    assert quota.try_consume("2026-09-02") is True


def test_today_key_is_utc_date() -> None:
    assert len(today_key()) == 10 and today_key()[4] == "-"


def test_create_case_returns_429_when_cap_reached_without_calling_agents() -> None:
    agent = CountingAgentService()
    quota = InMemoryAnalysisQuota(cap=1)
    payload = CreateCaseRequest(script_text="A scene with Nimbus Soda.", production_id=None)

    asyncio.run(create_case(payload, _request(agent, quota)))
    assert agent.calls == 1

    try:
        asyncio.run(create_case(payload, _request(agent, quota)))
    except HTTPException as error:
        assert error.status_code == 429
        assert "budget" in str(error.detail)
    else:
        raise AssertionError("expected 429")
    assert agent.calls == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --directory services/api python -m pytest tests/test_quota.py -q`
Expected: FAIL (`app.repositories.quota` missing).

- [ ] **Step 3: Implement quota repositories**

```python
# services/api/app/repositories/quota.py
from datetime import UTC, datetime
from threading import Lock
from typing import Protocol


def today_key() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


class AnalysisQuota(Protocol):
    def try_consume(self, day: str) -> bool:
        """Reserve one analysis for `day`. Return False when the cap is already reached."""
        ...


class InMemoryAnalysisQuota:
    def __init__(self, cap: int) -> None:
        self._cap = cap
        self._used: dict[str, int] = {}
        self._lock = Lock()

    def try_consume(self, day: str) -> bool:
        with self._lock:
            used = self._used.get(day, 0)
            if used >= self._cap:
                return False
            self._used[day] = used + 1
            return True


class FirestoreAnalysisQuota:
    def __init__(self, project: str, collection: str, cap: int) -> None:
        from google.cloud import firestore

        self._cap = cap
        self._client = firestore.Client(project=project)
        self._collection = self._client.collection(collection)
        self._transactional = firestore.transactional

    def try_consume(self, day: str) -> bool:
        document = self._collection.document(day)
        transaction = self._client.transaction()

        @self._transactional
        def reserve(txn: object) -> bool:
            snapshot = document.get(transaction=txn)
            used = int((snapshot.to_dict() or {}).get("used", 0)) if snapshot.exists else 0
            if used >= self._cap:
                return False
            txn.set(document, {"used": used + 1, "cap": self._cap}, merge=True)  # type: ignore[attr-defined]
            return True

        return bool(reserve(transaction))
```

Export in `services/api/app/repositories/__init__.py`: add `from .quota import AnalysisQuota, FirestoreAnalysisQuota, InMemoryAnalysisQuota` and the three names to `__all__`.

- [ ] **Step 4: Wire into services**

In `services/api/app/dependencies.py`:

```python
from app.repositories import (
    AnalysisQuota,
    ...
    FirestoreAnalysisQuota,
    InMemoryAnalysisQuota,
    ...
)

@dataclass(frozen=True)
class ApplicationServices:
    case_repository: CaseRepository
    asset_repository: AssetRepository
    agent_service: AgentService
    production_repository: ProductionRepository = field(default_factory=InMemoryProductionRepository)
    production_icon_repository: ProductionIconRepository = field(default_factory=InMemoryProductionIconRepository)
    analysis_quota: AnalysisQuota = field(default_factory=lambda: InMemoryAnalysisQuota(cap=25))
```

In `build_services`, after repositories are built:

```python
    analysis_quota: AnalysisQuota
    if settings.selected_mode(settings.repository_mode) is IntegrationMode.REAL:
        analysis_quota = FirestoreAnalysisQuota(
            project=_require(settings.google_cloud_project, "RIGHTSRADAR_GOOGLE_CLOUD_PROJECT"),
            collection="rightsrader_quota",
            cap=settings.daily_analysis_cap,
        )
    else:
        analysis_quota = InMemoryAnalysisQuota(cap=settings.daily_analysis_cap)
```

and pass `analysis_quota=analysis_quota` to `ApplicationServices(...)`.

- [ ] **Step 5: Enforce in routes**

In `services/api/app/routes/cases.py` add a helper below `_services`:

```python
QUOTA_MESSAGE = (
    "Daily live-analysis budget reached. Pre-analyzed demo cases remain open; "
    "try a new analysis tomorrow."
)


async def _reserve_analysis(services: ApplicationServices) -> None:
    allowed = await run_in_threadpool(services.analysis_quota.try_consume, today_key())
    if not allowed:
        raise HTTPException(status_code=429, detail=QUOTA_MESSAGE)
```

Import `from app.repositories.quota import today_key`. In `create_case`, call `await _reserve_analysis(services)` immediately after `services = _services(request)` and before production lookup. In `create_case_from_file`, call it right after the production lookup succeeds (so a 404 is still a 404) and before reading the file.

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `uv run --directory services/api python -m pytest -q`
Expected: PASS (existing route tests construct `ApplicationServices` without `analysis_quota`; the default keeps them green).
Run: `uv run --directory services/api ruff check app tests && uv run --directory services/api mypy app`

- [ ] **Step 7: Web shows the 429 message**

In `apps/web/components/script-review.tsx` the `submitScript` catch (line ~914) sets a generic error. Change both `submitScript` and `submitAnalysisFile` catches to surface a 429:

```ts
    } catch (caught) {
      if (caseOperationGeneration.current === operationGeneration) {
        setAgentWorkflowStatus('failed');
        setError(
          isQuotaError(caught)
            ? 'Daily live-analysis budget reached. Open a pre-analyzed demo case or try again tomorrow.'
            : 'RightsRadar could not analyze this script right now. Please try again.'
        );
      }
    }
```

Add near `statusLabel`:

```ts
function isQuotaError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: number }).status === 429;
}
```

Check how `createCase` in `packages/api-client` throws (open `packages/api-client/src/index.ts`): if it throws `ApiError` with `.status`, the guard above works; if it throws a plain `Error`, add `status` to that error class in the same file and re-run `pnpm test:web`.

- [ ] **Step 8: Commit**

```bash
git add services/api/app/repositories/quota.py services/api/app/repositories/__init__.py services/api/app/dependencies.py services/api/app/routes/cases.py services/api/tests/test_quota.py apps/web/components/script-review.tsx packages/api-client/src
git commit -m "feat(api): daily analysis quota with 429 and friendly web message"
```

---

### Task 4: Replace raw REST with the official `parallel-web` SDK

**Files:**
- Modify: `services/api/pyproject.toml` (deps + mypy override), `uv.lock`
- Modify: `services/api/app/integrations/parallel.py:205-296`
- Modify: `services/api/app/integrations/__init__.py`
- Modify: `services/api/app/dependencies.py:9-12,79-84`
- Modify: `services/api/tests/test_integrations.py:43-171`

**Interfaces:**
- Produces: `class ParallelSdkClient(api_key: str, client_model: str, *, client: Any | None = None)` implementing `ParallelSearchClient` (`search`, `extract`, `aclose`). Exposes `self._client` (an `AsyncParallel`) so Task 10 can reuse it. Module-level `parallel_search_kwargs(signal, session_id, objective, client_model) -> dict` and `parallel_extract_kwargs(signal, urls, session_id, client_model) -> dict` for testability.

- [ ] **Step 1: Add dependencies**

In `services/api/pyproject.toml` `cloud` group add `"parallel-web>=1.0.1,<2",` and `"google-adk>=1.0,<2",`. Add a mypy override:

```toml
[[tool.mypy.overrides]]
module = ["google.*", "parallel.*"]
ignore_missing_imports = true
```

Run: `uv lock --directory services/api && uv sync --directory services/api --all-groups`
Expected: lock updated, packages installed. Verify: `uv run --directory services/api python -c "from parallel import AsyncParallel; import google.adk; print('ok')"` → `ok`.

- [ ] **Step 2: Rewrite the two SDK tests to fake the SDK client**

Replace `test_search_then_extract_reuses_session_and_restricts_urls` and `test_extract_fails_safely_when_no_shortlisted_page_can_be_verified` in `services/api/tests/test_integrations.py` with:

```python
from types import SimpleNamespace

from app.integrations.parallel import ParallelSdkClient


class FakeParallelSdk:
    def __init__(self, search_payload: dict, extract_payload: dict) -> None:
        self.search_calls: list[dict] = []
        self.extract_calls: list[dict] = []
        self._search_payload = search_payload
        self._extract_payload = extract_payload

    async def search(self, **kwargs: object) -> SimpleNamespace:
        self.search_calls.append(kwargs)
        return _to_ns(self._search_payload)

    async def extract(self, **kwargs: object) -> SimpleNamespace:
        self.extract_calls.append(kwargs)
        return _to_ns(self._extract_payload)

    async def close(self) -> None:
        return None


def _to_ns(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(
        results=[SimpleNamespace(**item) for item in payload.get("results", [])],
        errors=[SimpleNamespace(**item) for item in payload.get("errors", [])],
    )


def test_search_then_extract_reuses_session_and_restricts_urls() -> None:
    fake = FakeParallelSdk(
        search_payload={
            "results": [
                {"url": "https://source.test/a", "title": "A", "publish_date": "2026-07-01", "excerpts": ["A"]},
                {"url": "https://source.test/a", "title": "A duplicate", "publish_date": None, "excerpts": ["A2"]},
                {"url": "https://source.test/b", "title": "B", "publish_date": None, "excerpts": ["B"]},
            ]
        },
        extract_payload={
            "results": [
                {"url": "https://source.test/a", "title": "A", "publish_date": "2026-07-01", "excerpts": ["Verified A", "More A"]},
                {"url": "https://unknown.test", "title": "Unknown", "publish_date": None, "excerpts": ["Must be ignored"]},
            ],
            "errors": [{"url": "https://source.test/b", "error_type": "fetch_error"}],
        },
    )
    client = ParallelSdkClient("secret-test-key", "gemini-2.5-flash", client=fake)
    signal = GeminiSignal(
        category="brand_reference",
        detected_item="Example Brand",
        explanation="A named brand.",
        confidence=0.8,
        context_excerpt="An Example Brand can is visible in the scene.",
    )

    async def scenario() -> tuple[list[SearchResult], list[SearchResult]]:
        searched = await client.search(signal, "rightsrader:case-1:0")
        extracted = await client.extract(signal, searched, "rightsrader:case-1:0")
        return searched, extracted

    searched, extracted = asyncio.run(scenario())

    assert [item.source.url for item in searched] == ["https://source.test/a", "https://source.test/b"]
    assert searched[0].publish_date == "2026-07-01"
    assert [item.source.url for item in extracted] == ["https://source.test/a"]
    assert extracted[0].excerpt == "Verified A\n\nMore A"
    assert fake.search_calls[0]["session_id"] == fake.extract_calls[0]["session_id"]
    assert fake.search_calls[0]["client_model"] == "gemini-2.5-flash"
    assert fake.search_calls[0]["mode"] == "advanced"
    assert len(fake.search_calls[0]["search_queries"]) == 3
    assert "Example Brand can is visible" in str(fake.search_calls[0]["objective"])
    assert fake.extract_calls[0]["urls"] == ["https://source.test/a", "https://source.test/b"]


def test_extract_fails_safely_when_no_shortlisted_page_can_be_verified() -> None:
    fake = FakeParallelSdk(
        search_payload={"results": []},
        extract_payload={
            "results": [],
            "errors": [{"url": "https://source.test/a", "error_type": "fetch_error", "content": "secret-test-key must not escape"}],
        },
    )
    client = ParallelSdkClient("secret-test-key", "gemini-2.5-flash", client=fake)
    signal = GeminiSignal(category="brand_reference", detected_item="Example Brand", explanation="A named brand.", confidence=0.8)
    candidates = [SearchResult(source=Source(title="A", url="https://source.test/a"), excerpt="Search excerpt.")]

    with pytest.raises(AnalysisProviderError) as error:
        asyncio.run(client.extract(signal, candidates, "rightsrader:case-1:0"))
    assert "secret-test-key" not in str(error.value)
    assert "https://source.test/a" not in str(error.value)
```

Remove the now-unused `httpx` and `json` imports from the test file if nothing else uses them (check with ruff).

- [ ] **Step 3: Run to verify failure**

Run: `uv run --directory services/api python -m pytest tests/test_integrations.py -q`
Expected: FAIL (`ParallelSdkClient` missing).

- [ ] **Step 4: Implement `ParallelSdkClient`**

In `services/api/app/integrations/parallel.py`, delete `ParallelSearchHttpClient` and the `httpx` import, keep `_normalize_results`, and add:

```python
_REQUEST_TIMEOUT_SECONDS = 90.0  # Extract live fetch can take up to 60 s per Parallel docs.


def parallel_search_kwargs(
    signal: GeminiSignal, session_id: str, objective: str | None, client_model: str
) -> dict[str, Any]:
    if objective:
        context = (signal.context_excerpt or "").strip()[:2_000]
        research_objective = f"{objective} Scene context: {context}" if context else objective
    else:
        research_objective = _research_objective(signal)
    return {
        "objective": research_objective,
        "search_queries": _build_search_queries(signal, objective),
        "mode": "advanced",
        "max_chars_total": _MAX_CHARS_TOTAL,
        "session_id": session_id,
        "client_model": client_model,
    }


def parallel_extract_kwargs(
    signal: GeminiSignal, urls: list[str], session_id: str, client_model: str
) -> dict[str, Any]:
    return {
        "urls": urls,
        "objective": _research_objective(signal),
        "search_queries": _build_search_queries(signal),
        "max_chars_total": _MAX_CHARS_TOTAL,
        "session_id": session_id,
        "client_model": client_model,
    }


def _sdk_results_to_payload(response: Any) -> Mapping[str, Any]:
    results = []
    for item in getattr(response, "results", None) or []:
        results.append(
            {
                "url": getattr(item, "url", None),
                "title": getattr(item, "title", None),
                "publish_date": getattr(item, "publish_date", None),
                "excerpts": list(getattr(item, "excerpts", None) or []),
            }
        )
    return {"results": results}


class ParallelSdkClient:
    """Parallel Search and Extract through the official parallel-web SDK."""

    def __init__(self, api_key: str, client_model: str, *, client: Any | None = None) -> None:
        self._client_model = client_model
        self._owns_client = client is None
        self._client = client or self._build_client(api_key)

    @staticmethod
    def _build_client(api_key: str) -> Any:
        from parallel import AsyncParallel

        return AsyncParallel(api_key=api_key, timeout=_REQUEST_TIMEOUT_SECONDS)

    @property
    def sdk(self) -> Any:
        return self._client

    async def _call(self, path: str, **kwargs: Any) -> Mapping[str, Any]:
        logger.info("parallel request path=%s session_id=%s", path, kwargs.get("session_id", "-"))
        try:
            response = await getattr(self._client, path)(**kwargs)
        except Exception as error:
            logger.warning("parallel request failed path=%s error=%s", path, type(error).__name__)
            raise AnalysisProviderError(
                f"Parallel {path} request failed", operation=f"parallel_{path}"
            ) from error
        return _sdk_results_to_payload(response)

    async def search(
        self, signal: GeminiSignal, session_id: str, objective: str | None = None
    ) -> list[SearchResult]:
        payload = await self._call(
            "search", **parallel_search_kwargs(signal, session_id, objective, self._client_model)
        )
        return _normalize_results(payload)

    async def extract(
        self, signal: GeminiSignal, candidates: list[SearchResult], session_id: str
    ) -> list[SearchResult]:
        if not candidates:
            return []
        urls = [candidate.source.url for candidate in candidates]
        payload = await self._call(
            "extract", **parallel_extract_kwargs(signal, urls, session_id, self._client_model)
        )
        extracted = _normalize_results(payload, allowed_urls=set(urls))
        if not extracted:
            raise AnalysisProviderError(
                "Parallel could not extract any shortlisted source", operation="parallel_extract"
            )
        return extracted

    async def aclose(self) -> None:
        if self._owns_client:
            close = getattr(self._client, "close", None)
            if close is not None:
                await close()
```

Update `services/api/app/integrations/__init__.py` to export `ParallelSdkClient` instead of `ParallelSearchHttpClient`, and `services/api/app/dependencies.py` to construct `ParallelSdkClient(api_key=..., client_model=settings.gemini_model)`.

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `uv run --directory services/api python -m pytest -q && uv run --directory services/api ruff check app tests && uv run --directory services/api mypy app`
Expected: all PASS/clean. `grep -rn "ParallelSearchHttpClient" services/api` → no matches.

- [ ] **Step 6: Commit**

```bash
git add services/api/pyproject.toml uv.lock services/api/app/integrations services/api/app/dependencies.py services/api/tests/test_integrations.py
git commit -m "feat(api): use official parallel-web SDK for Search and Extract; add google-adk dependency"
```

---

### Task 5: Make CI e2e green again

**Files:**
- Modify: `tests/e2e/review-workflow.spec.ts` (lines 28, 65, 126, 189, 205, 238, 288, 333 per the failing run)
- Possibly modify: `apps/web/components/script-review.tsx` (copy)
- Modify: `playwright.config.ts` (timeouts)

**Interfaces:** none.

- [ ] **Step 1: Reproduce locally**

Run: `pnpm exec playwright test tests/e2e/review-workflow.spec.ts --workers=1 --reporter=list`
Expected: some failures. Save the list of failing test titles.

- [ ] **Step 2: Fix the copy assertion**

Line ~238 asserts text `Potential research leads`. Run `rg -n "research leads" apps/web/components/script-review.tsx`. If the heading is now different (e.g. "Findings"), update the assertion to match the current on-screen heading text exactly. Do not change product copy to satisfy the test.

- [ ] **Step 3: Fix the textarea timeouts**

Lines ~28, 65, 126, 189, 205 time out on `page.getByLabel('Script text').fill(...)` because the demo gate is open on first visit. Add to the top of `review-workflow.spec.ts`:

```ts
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('rightsrader.demo.choice', 'self-serve');
  });
});
```

If a `beforeEach` already exists, merge the `setItem` line into it.

- [ ] **Step 4: Fix the error-banner tests**

Lines ~288 and ~333 mock a failing API and expect a banner. After Task 3, `submitScript` distinguishes 429 from other errors; the mocked failure must not be 429. Verify the `page.route` in those tests returns 503 or 500; if the assertion text differs from `RightsRadar could not analyze this script right now. Please try again.` or `Could not load recent cases`, align the assertion to the current copy in `script-review.tsx`.

- [ ] **Step 5: Raise the global timeout modestly**

In `playwright.config.ts` set `timeout: 60_000` and `expect: { timeout: 10_000 }` at the top-level config (the analysis flow in mock takes several seconds on CI runners).

- [ ] **Step 6: Run the full e2e locally**

Run: `make e2e` (PowerShell: `pnpm e2e`)
Expected: all tests pass.

- [ ] **Step 7: Commit and push; confirm CI**

```bash
git add tests/e2e/review-workflow.spec.ts playwright.config.ts apps/web/components/script-review.tsx
git commit -m "test(e2e): stabilize review workflow specs behind demo gate and current copy"
git push
```

Run: `gh run list --branch feat/clearance-adjudicator --limit 1` then `gh run watch <id> --exit-status`
Expected: all jobs including `e2e` succeed.

---

### Task 6: Deploy the API to Cloud Run and point Vercel at it

**Files:**
- Create: `scripts/deploy-api.sh`
- Modify: `README.md` (replace `RIGHTSRADAR_API_URL`, add a "Deploy" subsection)

**Interfaces:**
- Produces: a public HTTPS API URL used by Vercel `NEXT_PUBLIC_API_BASE_URL`.

- [ ] **Step 1: Write the deploy script**

```bash
#!/usr/bin/env bash
# Deploy the RightsRadar API to Cloud Run in cloud mode.
# Usage: PROJECT=<gcp-project> REGION=us-central1 BUCKET=<bucket> WEB_ORIGIN=https://hackathon-project-web-five.vercel.app ./scripts/deploy-api.sh
set -euo pipefail

: "${PROJECT:?set PROJECT}"
: "${REGION:=us-central1}"
: "${BUCKET:?set BUCKET}"
: "${WEB_ORIGIN:?set WEB_ORIGIN}"
SERVICE=rightsrader-api
SA="rightsrader-api@${PROJECT}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com aiplatform.googleapis.com firestore.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com >/dev/null

if ! gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create rightsrader-api --display-name "RightsRadar API"
fi
for role in roles/aiplatform.user roles/datastore.user roles/storage.objectAdmin roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role "$role" --quiet >/dev/null
done

if ! gcloud secrets describe rightsrader-parallel-api-key >/dev/null 2>&1; then
  echo "Create the secret first:  printf '%s' \"\$RIGHTSRADAR_PARALLEL_API_KEY\" | gcloud secrets create rightsrader-parallel-api-key --data-file=-" >&2
  exit 1
fi

# The Dockerfile lives in services/api but needs the repo root as build context (root uv.lock),
# so build with an explicit Cloud Build config instead of `gcloud run deploy --source`.
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/rightsrader/api:$(git rev-parse --short HEAD)"
gcloud artifacts repositories describe rightsrader --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create rightsrader --repository-format docker --location "$REGION"
gcloud builds submit --config - . <<EOF
steps:
- name: gcr.io/cloud-builders/docker
  args: ['build', '-f', 'services/api/Dockerfile', '-t', '${IMAGE}', '.']
images: ['${IMAGE}']
EOF

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --service-account "$SA" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 3 --concurrency 8 --memory 1Gi --timeout 300 \
  --set-env-vars "RIGHTSRADAR_MODE=cloud,RIGHTSRADAR_GOOGLE_CLOUD_PROJECT=${PROJECT},RIGHTSRADAR_GOOGLE_CLOUD_LOCATION=global,RIGHTSRADAR_GEMINI_MODEL=gemini-3.7-flash,RIGHTSRADAR_CLOUD_STORAGE_BUCKET=${BUCKET},RIGHTSRADAR_FIRESTORE_COLLECTION=rightsrader_cases,RIGHTSRADAR_ALLOWED_ORIGINS=${WEB_ORIGIN},RIGHTSRADAR_DAILY_ANALYSIS_CAP=25,GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=global" \
  --set-secrets "RIGHTSRADAR_PARALLEL_API_KEY=rightsrader-parallel-api-key:latest"

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')
echo "API URL: $URL"
curl -fsS "$URL/health"; echo
```

Make it executable: `git update-index --chmod=+x scripts/deploy-api.sh` after `git add`. The `.dockerignore` at the repo root already exists; confirm it does not exclude `uv.lock` or `services/api/app` (`rg -n "uv.lock|services" .dockerignore`).

- [ ] **Step 2: Run the deploy (owner with gcloud auth)**

Read `PROJECT` and `BUCKET` from the values in the worktree `.env` (do not commit them). Run:

```bash
printf '%s' "$RIGHTSRADAR_PARALLEL_API_KEY" | gcloud secrets create rightsrader-parallel-api-key --data-file=-
PROJECT=<project> BUCKET=<bucket> WEB_ORIGIN=https://hackathon-project-web-five.vercel.app bash scripts/deploy-api.sh
```

Expected: last line prints `{"status":"ok","mode":"cloud","adjudicator":"adk"}` (before Task 11 lands, `adjudicator` is `adk` already because both providers are real; the code path arrives in Phase B).

- [ ] **Step 3: Smoke the public API**

Run: `curl -s "$URL/api/productions" | head -c 300`
Expected: JSON list (may be `[]` or existing productions).

- [ ] **Step 4: Vercel**

In the Vercel project `hackathon-project-web`: Settings → Environment Variables → add `NEXT_PUBLIC_API_BASE_URL=<URL>` for Production and Preview. Settings → Git → confirm Production Branch is `main`. Settings → Deployment Protection → set Production to "Only Preview Deployments" (or disable) so judges are not prompted to log in. Trigger a redeploy of `main`.

Verify: open <https://hackathon-project-web-five.vercel.app>, choose **I'll work the desk myself**, confirm productions load (no "Could not load productions").

- [ ] **Step 5: README**

Replace `RIGHTSRADAR_API_URL` in the judges block with the real URL. Add under "Setup and development":

```markdown
### Deploy (Cloud Run + Vercel)

`scripts/deploy-api.sh` builds `services/api/Dockerfile` with Cloud Build and deploys
`rightsrader-api` to Cloud Run in `RIGHTSRADAR_MODE=cloud` with the Parallel key from Secret
Manager. Set `NEXT_PUBLIC_API_BASE_URL` on the Vercel project to the printed URL. The API caps new
analyses at `RIGHTSRADAR_DAILY_ANALYSIS_CAP` per UTC day; existing cases stay readable.
```

- [ ] **Step 6: Commit and push**

```bash
git add scripts/deploy-api.sh README.md
git commit -m "chore: Cloud Run deploy script and public API docs"
git push
```

---

## Phase B — Adjudicator backend

### Task 7: Memo models and `Finding.memo`

**Files:**
- Create: `services/api/app/models/memo.py`
- Modify: `services/api/app/models/__init__.py`
- Modify: `services/api/app/models/cases.py:60-76`
- Modify: `packages/api-client/src/generated.ts` (regenerated)
- Test: `services/api/tests/test_memo_models.py` (new)

**Interfaces:**
- Produces:
  - `class MemoVerdict(StrEnum)`: `CLEARED="cleared"`, `LICENSE_REQUIRED="license_required"`, `REWRITE_RECOMMENDED="rewrite_recommended"`, `NEEDS_HUMAN="needs_human"`.
  - `class Hypothesis(BaseModel)`: `id: str`, `claim: str`, `likely_rights_holder: str`, `what_would_prove_it: str`.
  - `class HypothesisSet(BaseModel)`: `hypotheses: list[Hypothesis]` (2–3 items).
  - `class AdvocateReport(BaseModel)`: `hypothesis_id: str`, `best_url: str | None`, `why: str`, `strength: Literal["strong","weak","none"]`, `searched_urls: list[str]`.
  - `class ClearanceMemo(BaseModel)`: `verdict: MemoVerdict`, `confidence: float`, `winning_hypothesis_id: str`, `dispositive_url: str | None`, `rationale: str`, `recommended_owner_role: WorkspaceRole`, `hypotheses: list[Hypothesis]`, `advocates: list[AdvocateReport]`, `assigned_member_id: str | None = None`.
  - `def validate_memo_urls(memo: ClearanceMemo, allowed: set[str]) -> ClearanceMemo` raises `AdjudicationError` when `dispositive_url` is set and not in `allowed`.
  - `class AdjudicationError(AnalysisUnavailableError)` with `operation = "adjudication"` in `services/api/app/errors.py`.
  - `Finding.memo: ClearanceMemo | None = None`.

- [ ] **Step 1: Write failing tests**

```python
# services/api/tests/test_memo_models.py
import pytest

from app.errors import AdjudicationError
from app.models import Finding, WorkspaceRole
from app.models.memo import (
    AdvocateReport,
    ClearanceMemo,
    Hypothesis,
    HypothesisSet,
    MemoVerdict,
    validate_memo_urls,
)


def _memo(url: str | None) -> ClearanceMemo:
    return ClearanceMemo(
        verdict=MemoVerdict.LICENSE_REQUIRED,
        confidence=0.82,
        winning_hypothesis_id="h1",
        dispositive_url=url,
        rationale="The co-ownership filing names the franchise rights holders.",
        recommended_owner_role=WorkspaceRole.LEGAL,
        hypotheses=[
            Hypothesis(id="h1", claim="WB film franchise", likely_rights_holder="Warner Bros.", what_would_prove_it="Studio filing"),
            Hypothesis(id="h2", claim="Unrelated software mark", likely_rights_holder="Matrix.org Foundation", what_would_prove_it="USPTO record"),
        ],
        advocates=[
            AdvocateReport(hypothesis_id="h1", best_url="https://www.veritaglobal.net/doc", why="Names WB and Village Roadshow.", strength="strong", searched_urls=["https://www.veritaglobal.net/doc"]),
            AdvocateReport(hypothesis_id="h2", best_url="https://www.trademarkia.com/matrix-79373974", why="Class 9 software mark.", strength="weak", searched_urls=["https://www.trademarkia.com/matrix-79373974"]),
        ],
    )


def test_memo_url_must_come_from_allowed_set() -> None:
    memo = _memo("https://www.veritaglobal.net/doc")
    assert validate_memo_urls(memo, {"https://www.veritaglobal.net/doc"}) is memo
    with pytest.raises(AdjudicationError):
        validate_memo_urls(_memo("https://invented.example/x"), {"https://www.veritaglobal.net/doc"})


def test_memo_without_url_is_allowed_for_needs_human() -> None:
    memo = _memo(None).model_copy(update={"verdict": MemoVerdict.NEEDS_HUMAN})
    assert validate_memo_urls(memo, set()).dispositive_url is None


def test_hypothesis_set_requires_two_to_three() -> None:
    with pytest.raises(ValueError):
        HypothesisSet(hypotheses=[Hypothesis(id="h1", claim="x", likely_rights_holder="y", what_would_prove_it="z")])


def test_finding_memo_defaults_to_none_and_round_trips() -> None:
    finding = Finding(
        id="f1", case_id="c1", category="quotation", detected_item="There is no spoon",
        explanation="Quote", confidence=0.9, supporting_evidence=[], source_urls=[],
        retrieved_at="2026-09-01T00:00:00Z", reviewer_status="pending",
    )
    assert finding.memo is None
    with_memo = finding.model_copy(update={"memo": _memo(None)})
    assert Finding.model_validate(with_memo.model_dump(mode="json")).memo is not None
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --directory services/api python -m pytest tests/test_memo_models.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`services/api/app/errors.py` — append:

```python
class AdjudicationError(AnalysisUnavailableError):
    """The Clearance Adjudicator could not produce a grounded memo."""

    operation = "adjudication"
```

`services/api/app/models/memo.py`:

```python
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from app.errors import AdjudicationError

from .productions import WorkspaceRole


class MemoVerdict(StrEnum):
    CLEARED = "cleared"
    LICENSE_REQUIRED = "license_required"
    REWRITE_RECOMMENDED = "rewrite_recommended"
    NEEDS_HUMAN = "needs_human"


class Hypothesis(BaseModel):
    id: str = Field(min_length=1, max_length=16)
    claim: str = Field(min_length=1, max_length=400)
    likely_rights_holder: str = Field(min_length=1, max_length=200)
    what_would_prove_it: str = Field(min_length=1, max_length=400)


class HypothesisSet(BaseModel):
    hypotheses: list[Hypothesis] = Field(min_length=2, max_length=3)


class AdvocateReport(BaseModel):
    hypothesis_id: str
    best_url: str | None = None
    why: str = Field(default="", max_length=1_000)
    strength: Literal["strong", "weak", "none"] = "none"
    searched_urls: list[str] = Field(default_factory=list)


class ClearanceMemo(BaseModel):
    verdict: MemoVerdict
    confidence: float = Field(ge=0, le=1)
    winning_hypothesis_id: str
    dispositive_url: str | None = None
    rationale: str = Field(min_length=1, max_length=2_000)
    recommended_owner_role: WorkspaceRole
    hypotheses: list[Hypothesis] = Field(default_factory=list)
    advocates: list[AdvocateReport] = Field(default_factory=list)
    assigned_member_id: str | None = None


def validate_memo_urls(memo: ClearanceMemo, allowed: set[str]) -> ClearanceMemo:
    if memo.dispositive_url is not None and memo.dispositive_url not in allowed:
        raise AdjudicationError("Judge cited a URL no advocate or grounding source returned")
    return memo
```

`services/api/app/models/cases.py`: import `from .memo import ClearanceMemo` and add `memo: ClearanceMemo | None = None` after `stakeholder_ids` in `Finding`.

`services/api/app/models/__init__.py`: import and export `AdvocateReport, ClearanceMemo, Hypothesis, HypothesisSet, MemoVerdict`.

- [ ] **Step 4: Run tests, regenerate client**

Run: `uv run --directory services/api python -m pytest -q`
Run: `make generate-client` (PowerShell: `uv run --directory services/api python ../../scripts/generate_api_client.py`)
Expected: `packages/api-client/src/generated.ts` now has `memo?: ClearanceMemo | null` on `Finding` and the `ClearanceMemo`, `MemoVerdict` types.
Run: `pnpm typecheck && pnpm test:web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/errors.py services/api/app/models packages/api-client/src/generated.ts services/api/tests/test_memo_models.py
git commit -m "feat(api): ClearanceMemo models and Finding.memo"
```

---

### Task 8: Contested-lead detector

**Files:**
- Create: `services/api/app/agents/contested.py`
- Test: `services/api/tests/test_contested.py` (new)

**Interfaces:**
- Produces: `REGISTRY_HOSTS: frozenset[str]`, `is_contested(signal: GeminiSignal, extracted: list[SearchResult], *, below_confidence: float) -> bool`, `host_of(url: str) -> str`.

- [ ] **Step 1: Write failing tests**

```python
# services/api/tests/test_contested.py
from app.agents.contested import is_contested
from app.models import Source
from app.models.analysis import GeminiSignal, SearchResult


def _signal(category: str, confidence: float = 0.95) -> GeminiSignal:
    return GeminiSignal(category=category, detected_item="X", explanation="e", confidence=confidence)


def _result(url: str) -> SearchResult:
    return SearchResult(source=Source(title=url, url=url), excerpt="text")


def test_franchise_and_quote_categories_are_contested_regardless_of_evidence() -> None:
    assert is_contested(_signal("Film Title/Franchise"), [], below_confidence=0.75)
    assert is_contested(_signal("quotation"), [], below_confidence=0.75)
    assert is_contested(_signal("character_reference"), [], below_confidence=0.75)
    assert is_contested(_signal("likeness_reference"), [], below_confidence=0.75)


def test_low_confidence_brand_is_contested() -> None:
    assert is_contested(_signal("brand_reference", 0.6), [], below_confidence=0.75)


def test_confident_brand_with_only_commercial_sources_is_not_contested() -> None:
    extracted = [_result("https://nimbus.example/brand"), _result("https://news.example/story")]
    assert not is_contested(_signal("brand_reference", 0.9), extracted, below_confidence=0.75)


def test_registry_plus_claimant_is_contested() -> None:
    extracted = [_result("https://www.uspto.gov/trademarks/search"), _result("https://studio.example/press")]
    assert is_contested(_signal("brand_reference", 0.9), extracted, below_confidence=0.75)
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --directory services/api python -m pytest tests/test_contested.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

```python
# services/api/app/agents/contested.py
from urllib.parse import urlparse

from app.models.analysis import GeminiSignal, SearchResult

REGISTRY_HOSTS = frozenset(
    {"uspto.gov", "copyright.gov", "trademarkia.com", "wipo.int", "sec.gov", "justia.com"}
)
_AMBIGUOUS_CATEGORY_TOKENS = ("franchise", "title", "character", "quot", "likeness")


def host_of(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _is_registry(host: str) -> bool:
    return any(host == root or host.endswith("." + root) for root in REGISTRY_HOSTS)


def is_contested(
    signal: GeminiSignal, extracted: list[SearchResult], *, below_confidence: float
) -> bool:
    category = signal.category.lower()
    if any(token in category for token in _AMBIGUOUS_CATEGORY_TOKENS):
        return True
    if signal.confidence < below_confidence:
        return True
    hosts = {host_of(item.source.url) for item in extracted}
    registry = {host for host in hosts if _is_registry(host)}
    return bool(registry) and bool(hosts - registry)
```

- [ ] **Step 4: Run tests, lint**

Run: `uv run --directory services/api python -m pytest tests/test_contested.py -q && uv run --directory services/api ruff check app tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/agents/contested.py services/api/tests/test_contested.py
git commit -m "feat(api): deterministic contested-lead detector"
```

---

### Task 9: Adjudicator client protocol, fixture adjudicator, owner mapping

**Files:**
- Create: `services/api/app/integrations/adjudicator.py`
- Modify: `services/api/app/integrations/__init__.py`
- Test: `services/api/tests/test_mock_adjudicator.py` (new)

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class AdjudicationCall`: `provider: ToolCallProvider`, `method: str`, `summary: str`, `ok: bool = True`, `duration_ms: int = 0`.
  - `@dataclass(frozen=True) class AdjudicationResult`: `memo: ClearanceMemo`, `calls: list[AdjudicationCall]`.
  - `class AdjudicatorClient(Protocol)`: `async def adjudicate(self, signal: GeminiSignal, extracted: list[SearchResult], decision: EvidenceCurationDecision, session_id: str) -> AdjudicationResult`.
  - `class MockAdjudicator` (fixture; name starts with `Mock` so `provider_is_fixture` is true).
  - `def owner_for_role(role: WorkspaceRole, roster: Sequence[ProductionMember]) -> ProductionMember | None`.

- [ ] **Step 1: Write failing tests**

```python
# services/api/tests/test_mock_adjudicator.py
import asyncio

from app.integrations.adjudicator import MockAdjudicator, owner_for_role
from app.models import EvidenceCurationDecision, ProductionMember, WorkspaceRole
from app.models.analysis import GeminiSignal
from app.models.memo import MemoVerdict


def _signal(item: str, category: str = "quotation") -> GeminiSignal:
    return GeminiSignal(category=category, detected_item=item, explanation="e", confidence=0.9)


def test_mock_adjudicator_returns_deterministic_memos_for_featured_leads() -> None:
    client = MockAdjudicator()
    decision = EvidenceCurationDecision(primary_url=None, rationale=None)
    matrix = asyncio.run(client.adjudicate(_signal("The Matrix", "franchise_reference"), [], decision, "s"))
    spoon = asyncio.run(client.adjudicate(_signal("There is no spoon"), [], decision, "s"))
    nimbus = asyncio.run(client.adjudicate(_signal("Nimbus Soda", "brand_reference"), [], decision, "s"))
    other = asyncio.run(client.adjudicate(_signal("Something else"), [], decision, "s"))

    assert matrix.memo.verdict is MemoVerdict.LICENSE_REQUIRED
    assert matrix.memo.recommended_owner_role is WorkspaceRole.LEGAL
    assert spoon.memo.verdict is MemoVerdict.REWRITE_RECOMMENDED
    assert nimbus.memo.verdict is MemoVerdict.CLEARED
    assert nimbus.memo.recommended_owner_role is WorkspaceRole.CLEARANCE
    assert other.memo.verdict is MemoVerdict.NEEDS_HUMAN
    assert len(matrix.memo.hypotheses) == 2
    assert [call.method for call in matrix.calls] == [
        "hypothesize", "search_authoritative", "search_authoritative", "judge_grounded",
    ]
    assert all(call.summary for call in matrix.calls)


def test_owner_for_role_skips_missing_roles() -> None:
    roster = [ProductionMember(id="j", name="Jordan", role=WorkspaceRole.CLEARANCE)]
    assert owner_for_role(WorkspaceRole.CLEARANCE, roster).id == "j"
    assert owner_for_role(WorkspaceRole.LEGAL, roster) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --directory services/api python -m pytest tests/test_mock_adjudicator.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

```python
# services/api/app/integrations/adjudicator.py
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from app.models import (
    EvidenceCurationDecision,
    ProductionMember,
    ToolCallProvider,
    WorkspaceRole,
)
from app.models.analysis import GeminiSignal, SearchResult
from app.models.memo import AdvocateReport, ClearanceMemo, Hypothesis, MemoVerdict


@dataclass(frozen=True)
class AdjudicationCall:
    provider: ToolCallProvider
    method: str
    summary: str
    ok: bool = True
    duration_ms: int = 0


@dataclass(frozen=True)
class AdjudicationResult:
    memo: ClearanceMemo
    calls: list[AdjudicationCall] = field(default_factory=list)


class AdjudicatorClient(Protocol):
    async def adjudicate(
        self,
        signal: GeminiSignal,
        extracted: list[SearchResult],
        decision: EvidenceCurationDecision,
        session_id: str,
    ) -> AdjudicationResult: ...


def owner_for_role(
    role: WorkspaceRole, roster: Sequence[ProductionMember]
) -> ProductionMember | None:
    for member in roster:
        if member.role is role:
            return member
    return None


_FIXTURE_MEMOS: dict[str, tuple[MemoVerdict, WorkspaceRole, str, str | None]] = {
    "The Matrix": (
        MemoVerdict.LICENSE_REQUIRED,
        WorkspaceRole.LEGAL,
        "Fixture memo: the franchise reading wins; a one-sheet on camera needs a studio license.",
        "https://example.com/the-matrix-franchise-reference",
    ),
    "There is no spoon": (
        MemoVerdict.REWRITE_RECOMMENDED,
        WorkspaceRole.LEGAL,
        "Fixture memo: the line is film dialogue, not a common phrase; suggest a paraphrase.",
        "https://example.com/there-is-no-spoon-quotation",
    ),
    "Nimbus Soda": (
        MemoVerdict.CLEARED,
        WorkspaceRole.CLEARANCE,
        "Fixture memo: no live registry conflict; incidental placement is cleared.",
        "https://example.com/nimbus-soda-brand-reference",
    ),
}


class MockAdjudicator:
    """Deterministic fixture for mock mode and e2e. Never touches the network."""

    async def adjudicate(
        self,
        signal: GeminiSignal,
        extracted: list[SearchResult],
        decision: EvidenceCurationDecision,
        session_id: str,
    ) -> AdjudicationResult:
        del extracted, decision, session_id
        verdict, role, rationale, url = _FIXTURE_MEMOS.get(
            signal.detected_item,
            (
                MemoVerdict.NEEDS_HUMAN,
                WorkspaceRole.CLEARANCE,
                "Fixture memo: hypotheses are balanced; a human should decide.",
                None,
            ),
        )
        hypotheses = [
            Hypothesis(
                id="h1",
                claim=f"{signal.detected_item} is controlled by a studio or publisher",
                likely_rights_holder="Studio (fixture)",
                what_would_prove_it="An official filing or press page",
            ),
            Hypothesis(
                id="h2",
                claim=f"{signal.detected_item} is generic or independently registered",
                likely_rights_holder="Unrelated registrant (fixture)",
                what_would_prove_it="A registry record with a different owner",
            ),
        ]
        advocates = [
            AdvocateReport(hypothesis_id="h1", best_url=url, why="Fixture evidence.", strength="strong" if url else "none", searched_urls=[url] if url else []),
            AdvocateReport(hypothesis_id="h2", best_url=None, why="Fixture: nothing dispositive.", strength="none", searched_urls=[]),
        ]
        memo = ClearanceMemo(
            verdict=verdict,
            confidence=0.8 if url else 0.5,
            winning_hypothesis_id="h1",
            dispositive_url=url,
            rationale=rationale,
            recommended_owner_role=role,
            hypotheses=hypotheses,
            advocates=advocates,
        )
        item = signal.detected_item
        calls = [
            AdjudicationCall(ToolCallProvider.VERTEX, "hypothesize", f"Fixture: 2 hypotheses for {item}."),
            AdjudicationCall(ToolCallProvider.PARALLEL, "search_authoritative", f"Fixture: advocate h1 searched registries for {item}."),
            AdjudicationCall(ToolCallProvider.PARALLEL, "search_authoritative", f"Fixture: advocate h2 searched registries for {item}."),
            AdjudicationCall(ToolCallProvider.VERTEX, "judge_grounded", f"Fixture: judge wrote a {verdict.value} memo for {item}."),
        ]
        return AdjudicationResult(memo=memo, calls=calls)
```

Export `AdjudicationCall, AdjudicationResult, AdjudicatorClient, MockAdjudicator, owner_for_role` from `services/api/app/integrations/__init__.py`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `uv run --directory services/api python -m pytest tests/test_mock_adjudicator.py -q && uv run --directory services/api ruff check app tests && uv run --directory services/api mypy app`
Expected: PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/integrations/adjudicator.py services/api/app/integrations/__init__.py services/api/tests/test_mock_adjudicator.py
git commit -m "feat(api): adjudicator client protocol, fixture adjudicator, owner mapping"
```

---

### Task 10: ADK adjudicator (Vertex Gemini + parallel-web + grounded Judge)

**Files:**
- Create: `services/api/app/integrations/adk_adjudicator.py`
- Modify: `services/api/app/integrations/__init__.py`
- Test: `services/api/tests/test_adk_adjudicator.py` (new; network-free)

**Interfaces:**
- Consumes: `ParallelSdkClient.sdk` (Task 4), memo models (Task 7), `AdjudicationCall/Result` (Task 9).
- Produces: `class AdkAdjudicator(project: str, location: str, model: str, parallel_api_key: str, parallel_sdk: Any, *, genai_client: Any | None = None, runner_factory: Callable[..., Any] | None = None)` implementing `AdjudicatorClient`. Helpers: `extract_json_object(text: str) -> dict`, `build_advocate_agents(hypotheses, model, tool) -> list[LlmAgent]`, `authoritative_domains_for(signal) -> list[str]`, `AUTHORITATIVE_DOMAINS`.

- [ ] **Step 1: Write failing tests for the pure helpers**

```python
# services/api/tests/test_adk_adjudicator.py
import asyncio
from types import SimpleNamespace

import pytest

from app.errors import AdjudicationError
from app.integrations.adk_adjudicator import (
    AdkAdjudicator,
    authoritative_domains_for,
    build_advocate_agents,
    extract_json_object,
)
from app.models import EvidenceCurationDecision, Source
from app.models.analysis import GeminiSignal, SearchResult
from app.models.memo import Hypothesis


def test_extract_json_object_tolerates_fences_and_prose() -> None:
    text = 'Here you go:\n```json\n{"best_url": "https://a.test", "why": "x", "strength": "strong"}\n```'
    assert extract_json_object(text)["best_url"] == "https://a.test"
    with pytest.raises(AdjudicationError):
        extract_json_object("no json here")


def test_authoritative_domains_always_include_registries() -> None:
    signal = GeminiSignal(category="Film Title/Franchise", detected_item="The Matrix", explanation="e", confidence=0.9)
    domains = authoritative_domains_for(signal)
    assert "uspto.gov" in domains and "copyright.gov" in domains and "wikipedia.org" in domains


def test_build_advocate_agents_one_per_hypothesis_with_state_keys() -> None:
    hypotheses = [
        Hypothesis(id="h1", claim="a", likely_rights_holder="A", what_would_prove_it="x"),
        Hypothesis(id="h2", claim="b", likely_rights_holder="B", what_would_prove_it="y"),
    ]

    def tool(search_queries: list[str], include_domains: list[str]) -> list[dict]:
        return []

    agents = build_advocate_agents(hypotheses, "gemini-3.7-flash", tool)
    assert [agent.name for agent in agents] == ["advocate_h1", "advocate_h2"]
    assert [agent.output_key for agent in agents] == ["advocate_h1", "advocate_h2"]


def test_judge_rejects_url_not_returned_by_any_advocate() -> None:
    class FakeModels:
        async def generate_content(self, **kwargs: object) -> SimpleNamespace:
            text = '{"verdict":"license_required","confidence":0.9,"winning_hypothesis_id":"h1","dispositive_url":"https://invented.test","rationale":"r","recommended_owner_role":"legal"}'
            return SimpleNamespace(text=text, candidates=[SimpleNamespace(grounding_metadata=None)])

    fake_genai = SimpleNamespace(aio=SimpleNamespace(models=FakeModels()))
    client = AdkAdjudicator("p", "global", "gemini-3.7-flash", "key", parallel_sdk=None, genai_client=fake_genai)
    hypotheses = [Hypothesis(id="h1", claim="a", likely_rights_holder="A", what_would_prove_it="x")]
    reports = [SimpleNamespace(hypothesis_id="h1", best_url="https://real.test", why="w", strength="strong", searched_urls=["https://real.test"])]
    signal = GeminiSignal(category="quotation", detected_item="X", explanation="e", confidence=0.9)
    decision = EvidenceCurationDecision(primary_url=None, rationale=None)

    with pytest.raises(AdjudicationError):
        asyncio.run(client._judge(signal, decision, hypotheses, reports, allowed={"https://real.test"}))  # noqa: SLF001
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --directory services/api python -m pytest tests/test_adk_adjudicator.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```python
# services/api/app/integrations/adk_adjudicator.py
"""Clearance Adjudicator: ADK hypotheses + parallel advocates, grounded Gemini judge."""
from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Callable
from time import perf_counter
from typing import Any

from app.errors import AdjudicationError
from app.integrations.adjudicator import AdjudicationCall, AdjudicationResult
from app.models import EvidenceCurationDecision, ToolCallProvider
from app.models.analysis import GeminiSignal, SearchResult
from app.models.memo import (
    AdvocateReport,
    ClearanceMemo,
    Hypothesis,
    HypothesisSet,
    validate_memo_urls,
)

logger = logging.getLogger("rightsrader.integrations")

AUTHORITATIVE_DOMAINS = (
    "uspto.gov",
    "copyright.gov",
    "wipo.int",
    "sec.gov",
    "justia.com",
    "trademarkia.com",
    "wikipedia.org",
)
_APP_NAME = "rightsrader"
_USER_ID = "adjudicator"
_MAX_ADVOCATE_SEARCHES = 2
_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)


def extract_json_object(text: str) -> dict[str, Any]:
    match = _JSON_BLOCK.search(text or "")
    if not match:
        raise AdjudicationError("Agent reply did not contain a JSON object")
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise AdjudicationError("Agent reply contained invalid JSON") from error
    if not isinstance(parsed, dict):
        raise AdjudicationError("Agent reply JSON was not an object")
    return parsed


def authoritative_domains_for(signal: GeminiSignal) -> list[str]:
    del signal  # category-specific additions are a follow-up; registries cover every lead.
    return list(AUTHORITATIVE_DOMAINS)


def _elapsed(started: float) -> int:
    return max(0, int((perf_counter() - started) * 1000))


def build_advocate_agents(
    hypotheses: list[Hypothesis], model: str, tool: Callable[..., Any]
) -> list[Any]:
    from google.adk.agents import LlmAgent

    agents = []
    for hypothesis in hypotheses:
        agents.append(
            LlmAgent(
                name=f"advocate_{hypothesis.id}",
                model=model,
                description=f"Argues hypothesis {hypothesis.id}",
                instruction=(
                    "You are an advocate on a film rights-clearance desk. Your job is to prove ONE "
                    f"hypothesis using authoritative web sources.\n\nHypothesis {hypothesis.id}: "
                    f"{hypothesis.claim}\nLikely rights holder: {hypothesis.likely_rights_holder}\n"
                    f"What would prove it: {hypothesis.what_would_prove_it}\n\n"
                    f"Call search_authoritative at most {_MAX_ADVOCATE_SEARCHES} times with 2-3 "
                    "keyword queries (3-6 words each) and the include_domains you were given. "
                    "Only cite URLs the tool returned. Then reply with ONLY a JSON object: "
                    '{"best_url": string|null, "why": string, "strength": "strong"|"weak"|"none"}. '
                    "Never give legal advice."
                ),
                tools=[tool],
                output_key=f"advocate_{hypothesis.id}",
            )
        )
    return agents


class AdkAdjudicator:
    def __init__(
        self,
        project: str,
        location: str,
        model: str,
        parallel_api_key: str,
        parallel_sdk: Any,
        *,
        genai_client: Any | None = None,
        runner_factory: Callable[..., Any] | None = None,
    ) -> None:
        self._project = project
        self._location = location
        self._model = model
        self._parallel_api_key = parallel_api_key
        self._parallel_sdk = parallel_sdk
        self._genai = genai_client or self._build_genai()
        self._runner_factory = runner_factory
        os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "true")
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", project)
        os.environ.setdefault("GOOGLE_CLOUD_LOCATION", location)

    def _build_genai(self) -> Any:
        from google import genai
        from google.genai import types

        return genai.Client(
            vertexai=True,
            project=self._project,
            location=self._location,
            http_options=types.HttpOptions(api_version="v1"),
        )

    async def adjudicate(
        self,
        signal: GeminiSignal,
        extracted: list[SearchResult],
        decision: EvidenceCurationDecision,
        session_id: str,
    ) -> AdjudicationResult:
        from google.adk.agents import ParallelAgent
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService
        from google.genai import types

        calls: list[AdjudicationCall] = []
        allowed: set[str] = {item.source.url for item in extracted}
        session_service = InMemorySessionService()
        await session_service.create_session(
            app_name=_APP_NAME, user_id=_USER_ID, session_id=session_id
        )

        def make_runner(agent: Any) -> Any:
            if self._runner_factory is not None:
                return self._runner_factory(agent=agent, session_service=session_service)
            return Runner(agent=agent, app_name=_APP_NAME, session_service=session_service)

        async def run(agent: Any, prompt: str) -> None:
            runner = make_runner(agent)
            message = types.Content(role="user", parts=[types.Part(text=prompt)])
            async for _event in runner.run_async(
                user_id=_USER_ID, session_id=session_id, new_message=message
            ):
                pass

        async def state() -> dict[str, Any]:
            session = await session_service.get_session(
                app_name=_APP_NAME, user_id=_USER_ID, session_id=session_id
            )
            return dict(session.state) if session is not None else {}

        # 1. Hypotheses (ADK LlmAgent with output_schema).
        started = perf_counter()
        hypotheses = await self._hypothesize(signal, extracted, run, state)
        calls.append(
            AdjudicationCall(
                ToolCallProvider.VERTEX,
                "hypothesize",
                f"ADK HypothesisAgent framed {len(hypotheses)} competing readings of "
                f"{signal.detected_item}.",
                duration_ms=_elapsed(started),
            )
        )

        # 2. Advocates fan out (ADK ParallelAgent) with a parallel-web search tool.
        searched: dict[str, list[str]] = {}
        include_domains = authoritative_domains_for(signal)

        async def search_authoritative(
            search_queries: list[str], include_domains: list[str]
        ) -> list[dict[str, Any]]:
            """Search authoritative sources (registries, official sites) for this hypothesis.

            Args:
                search_queries: 2-3 keyword queries, 3-6 words each.
                include_domains: domains to restrict results to.
            """
            started_tool = perf_counter()
            ok = True
            urls: list[str] = []
            try:
                response = await self._parallel_sdk.search(
                    objective=f"Find authoritative evidence about {signal.detected_item}.",
                    search_queries=search_queries[:3],
                    mode="fast",
                    max_chars_total=6_000,
                    session_id=session_id,
                    advanced_settings={
                        "source_policy": {"include_domains": include_domains[:10]},
                        "max_results": 5,
                    },
                )
                results = [
                    {
                        "url": item.url,
                        "title": getattr(item, "title", None) or item.url,
                        "excerpt": "\n".join(getattr(item, "excerpts", None) or [])[:1_200],
                        "publish_date": getattr(item, "publish_date", None),
                    }
                    for item in (getattr(response, "results", None) or [])
                ]
                urls = [item["url"] for item in results]
            except Exception as error:  # tool errors are reported, not raised
                ok = False
                logger.warning("advocate search failed error=%s", type(error).__name__)
                results = []
            allowed.update(urls)
            searched.setdefault("all", []).extend(urls)
            calls.append(
                AdjudicationCall(
                    ToolCallProvider.PARALLEL,
                    "search_authoritative",
                    f"Advocate ran Parallel Search ({len(urls)} URL(s)) on registries for "
                    f"{signal.detected_item}.",
                    ok=ok,
                    duration_ms=_elapsed(started_tool),
                )
            )
            return results

        advocates = build_advocate_agents(hypotheses, self._model, search_authoritative)
        fan_out = ParallelAgent(
            name="advocates", sub_agents=advocates, description="Argue each hypothesis in parallel"
        )
        await run(
            fan_out,
            f"Lead: {signal.detected_item}. Scene: {signal.context_excerpt[:800]}. "
            f"include_domains: {', '.join(include_domains)}",
        )
        final_state = await state()
        reports: list[AdvocateReport] = []
        for hypothesis in hypotheses:
            raw = final_state.get(f"advocate_{hypothesis.id}", "")
            try:
                parsed = extract_json_object(str(raw))
            except AdjudicationError:
                parsed = {"best_url": None, "why": "Advocate returned no usable evidence.", "strength": "none"}
            best_url = parsed.get("best_url")
            if best_url not in allowed:
                best_url = None
            reports.append(
                AdvocateReport(
                    hypothesis_id=hypothesis.id,
                    best_url=best_url,
                    why=str(parsed.get("why", ""))[:1_000],
                    strength=parsed.get("strength") if parsed.get("strength") in ("strong", "weak", "none") else "none",
                    searched_urls=list(dict.fromkeys(searched.get("all", []))),
                )
            )

        # 3. Judge: Gemini grounded with Parallel Web Search.
        started = perf_counter()
        memo = await self._judge(signal, decision, hypotheses, reports, allowed=allowed)
        calls.append(
            AdjudicationCall(
                ToolCallProvider.VERTEX,
                "judge_grounded",
                f"Gemini judge (grounded with Parallel Web Search) ruled {memo.verdict.value} "
                f"on {signal.detected_item}.",
                duration_ms=_elapsed(started),
            )
        )
        return AdjudicationResult(memo=memo, calls=calls)

    async def _hypothesize(
        self,
        signal: GeminiSignal,
        extracted: list[SearchResult],
        run: Callable[[Any, str], Any],
        state: Callable[[], Any],
    ) -> list[Hypothesis]:
        from google.adk.agents import LlmAgent

        agent = LlmAgent(
            name="hypothesis_agent",
            model=self._model,
            description="Frames competing rights-holder hypotheses",
            instruction=(
                "You are the hypothesis framer on a film rights-clearance desk. Given a lead and "
                "extracted web excerpts, list 2 or 3 mutually exclusive hypotheses about WHO "
                "controls the rights and WHAT the reference actually is. Give each an id h1..h3. "
                "Do not decide; do not give legal advice."
            ),
            output_schema=HypothesisSet,
            output_key="hypotheses",
        )
        excerpts = "\n\n".join(
            f"[{item.source.url}] {item.excerpt[:600]}" for item in extracted[:5]
        ) or "(no extracted excerpts)"
        await run(
            agent,
            f"Lead: {signal.detected_item} ({signal.category})\nScene: {signal.context_excerpt[:800]}\n"
            f"Explanation: {signal.explanation}\n\nExcerpts:\n{excerpts}",
        )
        raw = (await state()).get("hypotheses")
        try:
            payload = raw if isinstance(raw, dict) else extract_json_object(str(raw))
            return HypothesisSet.model_validate(payload).hypotheses
        except Exception as error:
            raise AdjudicationError("HypothesisAgent returned invalid hypotheses") from error

    async def _judge(
        self,
        signal: GeminiSignal,
        decision: EvidenceCurationDecision,
        hypotheses: list[Hypothesis],
        reports: list[Any],
        *,
        allowed: set[str],
    ) -> ClearanceMemo:
        from google.genai import types

        briefs = "\n".join(
            f"- {r.hypothesis_id}: strength={r.strength} best_url={r.best_url} why={r.why}"
            for r in reports
        )
        prompt = (
            "You are the judge on a film rights-clearance desk. Advocates argued these hypotheses "
            f"about the lead '{signal.detected_item}':\n"
            + "\n".join(f"- {h.id}: {h.claim} (holder: {h.likely_rights_holder})" for h in hypotheses)
            + f"\n\nAdvocate briefs:\n{briefs}\n\nCuration's earlier pick: {decision.primary_url}\n\n"
            "Use grounding only to confirm, not to introduce new claims. Reply with ONLY a JSON "
            'object: {"verdict": "cleared"|"license_required"|"rewrite_recommended"|"needs_human", '
            '"confidence": 0..1, "winning_hypothesis_id": string, "dispositive_url": string|null, '
            '"rationale": string, "recommended_owner_role": "clearance"|"legal"|"production"}. '
            "dispositive_url must be one of the advocate URLs. No legal advice."
        )
        try:
            response = await self._genai.aio.models.generate_content(
                model=self._model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0,
                    tools=[
                        types.Tool(
                            parallel_ai_search=types.ToolParallelAiSearch(
                                api_key=self._parallel_api_key,
                                custom_configs={"mode": "fast", "max_results": 5},
                            )
                        )
                    ],
                ),
            )
        except Exception as error:
            raise AdjudicationError("Judge call failed") from error

        grounded_urls: set[str] = set()
        for candidate in getattr(response, "candidates", None) or []:
            metadata = getattr(candidate, "grounding_metadata", None)
            for chunk in getattr(metadata, "grounding_chunks", None) or []:
                web = getattr(chunk, "web", None)
                uri = getattr(web, "uri", None)
                if isinstance(uri, str):
                    grounded_urls.add(uri)

        payload = extract_json_object(getattr(response, "text", "") or "")
        payload.setdefault("hypotheses", [h.model_dump() for h in hypotheses])
        payload.setdefault(
            "advocates",
            [r.model_dump() if hasattr(r, "model_dump") else dict(vars(r)) for r in reports],
        )
        try:
            memo = ClearanceMemo.model_validate(payload)
        except Exception as error:
            raise AdjudicationError("Judge returned an invalid memo") from error
        return validate_memo_urls(memo, allowed | grounded_urls)
```

Export `AdkAdjudicator` from `services/api/app/integrations/__init__.py`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `uv run --directory services/api python -m pytest tests/test_adk_adjudicator.py -q && uv run --directory services/api ruff check app tests && uv run --directory services/api mypy app`
Expected: PASS/clean. If mypy complains about `google.adk` types, the `google.*` override already ignores missing imports; use `Any` for ADK objects as shown.

- [ ] **Step 5: Live smoke (owner, cloud creds present)**

Create `/tmp/adjudicate_smoke.py` outside the repo:

```python
import asyncio, os
from app.integrations.parallel import ParallelSdkClient
from app.integrations.adk_adjudicator import AdkAdjudicator
from app.models import EvidenceCurationDecision, Source
from app.models.analysis import GeminiSignal, SearchResult

sdk = ParallelSdkClient(os.environ["RIGHTSRADAR_PARALLEL_API_KEY"], "gemini-3.7-flash")
adj = AdkAdjudicator(os.environ["RIGHTSRADAR_GOOGLE_CLOUD_PROJECT"], "global", "gemini-3.7-flash", os.environ["RIGHTSRADAR_PARALLEL_API_KEY"], parallel_sdk=sdk.sdk)
signal = GeminiSignal(category="Film Title/Franchise", detected_item="The Matrix", explanation="One-sheet on set", confidence=0.95, context_excerpt="Second unit hangs a forty-foot The Matrix one-sheet behind the hero.")
extracted = [SearchResult(source=Source(title="Wikipedia", url="https://en.wikipedia.org/wiki/The_Matrix"), excerpt="The Matrix is a 1999 film...")]
result = asyncio.run(adj.adjudicate(signal, extracted, EvidenceCurationDecision(primary_url=None, rationale=None), "smoke:1"))
print(result.memo.model_dump_json(indent=2)); print([c.method for c in result.calls])
```

Run from `services/api` with the cloud `.env` loaded: `uv run --directory services/api python /tmp/adjudicate_smoke.py`
Expected: a memo with a real `dispositive_url`, and calls `hypothesize`, ≥2 `search_authoritative`, `judge_grounded`. Fix prompt wording if the JSON parse fails; do not loosen URL validation.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/integrations/adk_adjudicator.py services/api/app/integrations/__init__.py services/api/tests/test_adk_adjudicator.py
git commit -m "feat(api): ADK Clearance Adjudicator with parallel advocates and grounded judge"
```

---

### Task 11: Wire the Adjudicator into Research, thread, findings, and DI

**Files:**
- Create: `services/api/app/agents/adjudicator.py`
- Modify: `services/api/app/agents/research.py:27-38,136-172`
- Modify: `services/api/app/agents/service.py:74-89`
- Modify: `services/api/app/dependencies.py`
- Test: `services/api/tests/test_adjudicator_agent.py` (new), extend `services/api/tests/test_desk.py`

**Interfaces:**
- Produces: `class AdjudicatorAgent(client: AdjudicatorClient, *, below_confidence: float)` with `name = "Adjudicator"` and `async def adjudicate_lead(self, case_id, index, signal, extracted, decision, roster, recorder) -> tuple[ClearanceMemo | None, list[CaseThreadMessage]]`.
- `ResearchAgent.__init__(..., adjudicator: AdjudicatorAgent | None = None)`.
- `RightsClearanceAgentService.__init__(gemini, parallel_search, *, max_concurrency=4, adjudicator: AdjudicatorClient | None = None, adjudicate_below_confidence: float = 0.75)`.

- [ ] **Step 1: Write failing tests**

```python
# services/api/tests/test_adjudicator_agent.py
import asyncio

from app.agents.adjudicator import AdjudicatorAgent
from app.agents.trace import ToolCallRecorder
from app.integrations.adjudicator import MockAdjudicator
from app.models import EvidenceCurationDecision, ProductionMember, WorkspaceRole
from app.models.analysis import GeminiSignal


class ExplodingAdjudicator:
    async def adjudicate(self, *args: object, **kwargs: object):  # noqa: ANN201
        raise RuntimeError("boom")


ROSTER = [
    ProductionMember(id="j", name="Jordan", role=WorkspaceRole.CLEARANCE),
    ProductionMember(id="m", name="Maya", role=WorkspaceRole.LEGAL),
]


def test_contested_lead_gets_memo_thread_and_owner() -> None:
    agent = AdjudicatorAgent(MockAdjudicator(), below_confidence=0.75)
    recorder = ToolCallRecorder("case-1", fixture=True)
    signal = GeminiSignal(category="quotation", detected_item="There is no spoon", explanation="e", confidence=0.9)
    memo, messages = asyncio.run(
        agent.adjudicate_lead("case-1", 0, signal, [], EvidenceCurationDecision(primary_url=None, rationale=None), ROSTER, recorder)
    )
    assert memo is not None and memo.assigned_member_id == "m"
    assert [m.agent_name for m in messages] == ["Adjudicator"] * len(messages)
    assert "hypotheses" in messages[0].body.lower()
    assert "m" in messages[-1].mentions
    assert [e.method for e in recorder.events] == ["hypothesize", "search_authoritative", "search_authoritative", "judge_grounded"]
    assert all(e.agent_name == "Adjudicator" and e.fixture for e in recorder.events)


def test_uncontested_lead_is_skipped() -> None:
    agent = AdjudicatorAgent(MockAdjudicator(), below_confidence=0.75)
    recorder = ToolCallRecorder("case-1", fixture=True)
    signal = GeminiSignal(category="brand_reference", detected_item="Nimbus Soda", explanation="e", confidence=0.95)
    memo, messages = asyncio.run(
        agent.adjudicate_lead("case-1", 0, signal, [], EvidenceCurationDecision(primary_url=None, rationale=None), ROSTER, recorder)
    )
    assert memo is None and messages == [] and recorder.events == []


def test_failure_falls_back_without_raising() -> None:
    agent = AdjudicatorAgent(ExplodingAdjudicator(), below_confidence=0.75)
    recorder = ToolCallRecorder("case-1", fixture=False)
    signal = GeminiSignal(category="quotation", detected_item="X", explanation="e", confidence=0.9)
    memo, messages = asyncio.run(
        agent.adjudicate_lead("case-1", 0, signal, [], EvidenceCurationDecision(primary_url=None, rationale=None), ROSTER, recorder)
    )
    assert memo is None
    assert len(messages) == 1 and "could not resolve" in messages[0].body
    assert recorder.events[-1].ok is False and recorder.events[-1].method == "adjudicate"
```

Append to `services/api/tests/test_desk.py`:

```python
def test_mock_case_carries_adjudicator_memo_and_routes_to_legal() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    production = client.post(
        "/api/productions",
        json={"title": "Matrix", "roster": [
            {"name": "Jordan", "role": "clearance"},
            {"name": "Alex", "role": "production"},
            {"name": "Maya", "role": "legal"},
        ]},
    ).json()
    maya = next(m["id"] for m in production["roster"] if m["name"] == "Maya")
    case = client.post(
        "/api/cases",
        json={"production_id": production["id"], "script_text": 'A The Matrix one-sheet. "There is no spoon," she says.'},
    ).json()

    spoon = next(f for f in case["findings"] if f["detected_item"] == "There is no spoon")
    assert spoon["memo"]["verdict"] == "rewrite_recommended"
    assert spoon["assignee"] == maya and maya in spoon["stakeholder_ids"]
    assert any(m["agent_name"] == "Adjudicator" for m in case["thread"])
    methods = [c["method"] for c in case["tool_calls"] if c["agent_name"] == "Adjudicator"]
    assert methods.count("search_authoritative") >= 2 and "judge_grounded" in methods
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --directory services/api python -m pytest tests/test_adjudicator_agent.py tests/test_desk.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement the agent**

```python
# services/api/app/agents/adjudicator.py
import logging
from collections.abc import Sequence

from app.agents.contested import is_contested
from app.agents.messages import agent_message
from app.agents.trace import ToolCallRecorder, provider_is_fixture
from app.integrations.adjudicator import AdjudicatorClient, owner_for_role
from app.models import (
    CaseThreadMessage,
    EvidenceCurationDecision,
    ProductionMember,
    ToolCallProvider,
)
from app.models.analysis import GeminiSignal, SearchResult
from app.models.memo import ClearanceMemo, MemoVerdict

logger = logging.getLogger("rightsrader.agents")

VERDICT_LABEL = {
    MemoVerdict.CLEARED: "Cleared",
    MemoVerdict.LICENSE_REQUIRED: "License required",
    MemoVerdict.REWRITE_RECOMMENDED: "Rewrite recommended",
    MemoVerdict.NEEDS_HUMAN: "Needs a human",
}


class AdjudicatorAgent:
    name = "Adjudicator"

    def __init__(self, client: AdjudicatorClient, *, below_confidence: float) -> None:
        self._client = client
        self._below_confidence = below_confidence

    async def adjudicate_lead(
        self,
        case_id: str,
        index: int,
        signal: GeminiSignal,
        extracted: list[SearchResult],
        decision: EvidenceCurationDecision,
        roster: Sequence[ProductionMember],
        recorder: ToolCallRecorder,
    ) -> tuple[ClearanceMemo | None, list[CaseThreadMessage]]:
        if not is_contested(signal, extracted, below_confidence=self._below_confidence):
            return None, []
        fixture = provider_is_fixture(self._client)
        session_id = f"rightsrader:{case_id}:{index}:adjudicate"
        try:
            result = await self._client.adjudicate(signal, extracted, decision, session_id)
        except Exception as error:
            logger.warning("adjudication failed lead=%s error=%s", signal.detected_item, type(error).__name__)
            recorder.record(
                ToolCallProvider.VERTEX,
                "adjudicate",
                self.name,
                f"Adjudicator could not resolve {signal.detected_item}; kept Curation's pick.",
                ok=False,
                lead=signal.detected_item,
                fixture=fixture,
            )
            return None, [
                agent_message(
                    case_id,
                    self.name,
                    f"Adjudicator could not resolve {signal.detected_item}; "
                    "leaving it with Curation's pick.",
                )
            ]

        for call in result.calls:
            recorder.record(
                call.provider,
                call.method,
                self.name,
                call.summary,
                ok=call.ok,
                lead=signal.detected_item,
                duration_ms=call.duration_ms,
                fixture=fixture,
            )

        memo = result.memo
        owner = owner_for_role(memo.recommended_owner_role, roster)
        if owner is not None:
            memo = memo.model_copy(update={"assigned_member_id": owner.id})

        messages = [
            agent_message(
                case_id,
                self.name,
                f"Two readings of {signal.detected_item} are in play. Hypotheses: "
                + "; ".join(f"{h.id} — {h.claim}" for h in memo.hypotheses)
                + ". Sending an advocate after each.",
            )
        ]
        for report in memo.advocates:
            cite = f" Best source: {report.best_url}." if report.best_url else " No dispositive source found."
            messages.append(
                agent_message(
                    case_id,
                    self.name,
                    f"Advocate {report.hypothesis_id} ({report.strength}): {report.why}{cite}",
                )
            )
        mention = f" @{owner.name} ({owner.role.value})" if owner else ""
        messages.append(
            agent_message(
                case_id,
                self.name,
                f"Verdict on {signal.detected_item}: {VERDICT_LABEL[memo.verdict]} "
                f"({round(memo.confidence * 100)}%). {memo.rationale}"
                + (f" Dispositive: {memo.dispositive_url}." if memo.dispositive_url else "")
                + mention,
                mentions=[owner.id] if owner else [],
            )
        )
        return memo, messages
```

- [ ] **Step 4: Wire into Research**

In `services/api/app/agents/research.py`:

- Import `from app.agents.adjudicator import AdjudicatorAgent`.
- `__init__` gains `adjudicator: AdjudicatorAgent | None = None` and stores `self._adjudicator = adjudicator`.
- After `selection = EvidenceSelection(...)` and before `finding = Finding(...)`, insert:

```python
        memo = None
        adjudicator_messages: list[CaseThreadMessage] = []
        if self._adjudicator is not None:
            memo, adjudicator_messages = await self._adjudicator.adjudicate_lead(
                case_id, index, signal, extracted_results, decision, roster, recorder
            )
        assignee = memo.assigned_member_id if memo is not None else None
        if assignee is not None and assignee not in mention_ids:
            mention_ids = [*mention_ids, assignee]
```

- Pass `memo=memo, assignee=assignee` into `Finding(...)` (keep `stakeholder_ids=mention_ids`).
- After `messages.append(self._curation.announce(...))` add `messages.extend(adjudicator_messages)`.

Add `finding_id=finding_id` to the Adjudicator verdict message? Yes: in `AdjudicatorAgent.adjudicate_lead` we don't know `finding_id`. Instead, in `research.py`, after computing `finding_id`, patch the returned messages: `adjudicator_messages = [m.model_copy(update={"finding_id": finding_id}) for m in adjudicator_messages]`. Move the adjudicate call to after `finding_id = str(uuid4())` so this works.

- [ ] **Step 5: Wire into the service and DI**

`services/api/app/agents/service.py` `__init__`:

```python
    def __init__(
        self,
        gemini: GeminiClient,
        parallel_search: ParallelSearchClient,
        *,
        max_concurrency: int = 4,
        adjudicator: AdjudicatorClient | None = None,
        adjudicate_below_confidence: float = 0.75,
    ) -> None:
        ...
        self._adjudicator_client = adjudicator
        adjudicator_agent = (
            AdjudicatorAgent(adjudicator, below_confidence=adjudicate_below_confidence)
            if adjudicator is not None
            else None
        )
        self._research = ResearchAgent(gemini, parallel_search, self._curation, adjudicator=adjudicator_agent)
```

Imports: `from app.agents.adjudicator import AdjudicatorAgent`, `from app.integrations import AdjudicatorClient`. In `aclose`, also close `self._adjudicator_client` if it has `aclose`.

`services/api/app/dependencies.py` `build_services`, after `parallel` is built:

```python
    adjudicator: AdjudicatorClient
    if settings.adjudicator_mode == "adk":
        assert isinstance(parallel, ParallelSdkClient)
        adjudicator = AdkAdjudicator(
            project=_require(settings.google_cloud_project, "RIGHTSRADAR_GOOGLE_CLOUD_PROJECT"),
            location=settings.google_cloud_location,
            model=settings.gemini_model,
            parallel_api_key=_require(settings.parallel_api_key, "RIGHTSRADAR_PARALLEL_API_KEY"),
            parallel_sdk=parallel.sdk,
        )
    else:
        adjudicator = MockAdjudicator()
```

and pass `adjudicator=adjudicator, adjudicate_below_confidence=settings.adjudicate_below_confidence` to `RightsClearanceAgentService(...)`.

- [ ] **Step 6: Run the whole API suite, lint, typecheck**

Run: `uv run --directory services/api python -m pytest -q && uv run --directory services/api ruff check app tests && uv run --directory services/api mypy app`
Expected: PASS/clean. Existing tests asserting exact thread agent sets (`{"Intake","Research","Curation"} <= agent_names`) still hold because they use `<=`. If a test asserts exact tool-call counts on the two-lane script, extend the expected list with the four Adjudicator methods for the quotation lead only (`Nimbus Soda` is uncontested in mock: brand, confidence ≥ 0.75, `example.com` hosts).

- [ ] **Step 7: Commit and push**

```bash
git add services/api/app/agents services/api/app/dependencies.py services/api/tests
git commit -m "feat(api): run Clearance Adjudicator on contested leads and route memos to roster owners"
git push
```

---

## Phase C — Web

### Task 12: Walkthrough gains an Adjudication stage

**Files:**
- Modify: `apps/web/lib/demo-reveal.ts`
- Modify: `apps/web/tests/demo-reveal.test.ts`
- Modify: `apps/web/components/demo-coach.tsx:11-37`
- Modify: `scripts/show-walkthrough.cjs:36`

**Interfaces:**
- Produces: `DemoRevealStage = 'ready' | 'intake' | 'research' | 'curation' | 'adjudication' | 'human'`; `DEMO_REVEAL_BY_STEP` has 6 entries; `caseForDemoReveal` hides `Adjudicator` messages/tool calls and `finding.memo` before `adjudication`.

- [ ] **Step 1: Write failing tests**

Append to `apps/web/tests/demo-reveal.test.ts` (reuse the file's existing `fullCase` fixture builder; if none exists, build a minimal `Case` with one finding that has `memo: { verdict: 'rewrite_recommended', ... }`, an `Adjudicator` thread message, and an `Adjudicator` tool call):

```ts
import { caseForDemoReveal, DEMO_REVEAL_BY_STEP } from '@/lib/demo-reveal';

it('has six reveal stages with adjudication before human', () => {
  expect(DEMO_REVEAL_BY_STEP).toEqual(['ready', 'intake', 'research', 'curation', 'adjudication', 'human']);
});

it('hides adjudicator output and memos until the adjudication stage', () => {
  const curation = caseForDemoReveal(fullCase, 'curation')!;
  expect(curation.thread.some((m) => m.agent_name === 'Adjudicator')).toBe(false);
  expect(curation.tool_calls.some((c) => c.agent_name === 'Adjudicator')).toBe(false);
  expect(curation.findings.every((f) => f.memo == null)).toBe(true);

  const adjudication = caseForDemoReveal(fullCase, 'adjudication')!;
  expect(adjudication.thread.some((m) => m.agent_name === 'Adjudicator')).toBe(true);
  expect(adjudication.findings.some((f) => f.memo != null)).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @rightsrader/web test -- demo-reveal`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/web/lib/demo-reveal.ts`:

```ts
export type DemoRevealStage = 'ready' | 'intake' | 'research' | 'curation' | 'adjudication' | 'human';

export const DEMO_REVEAL_BY_STEP: readonly DemoRevealStage[] = [
  'ready', 'intake', 'research', 'curation', 'adjudication', 'human'
] as const;

const AGENTS_BY_STAGE: Record<DemoRevealStage, ReadonlySet<string>> = {
  ready: new Set(),
  intake: new Set(['Intake']),
  research: new Set(['Intake', 'Research']),
  curation: new Set(['Intake', 'Research', 'Curation']),
  adjudication: new Set(['Intake', 'Research', 'Curation', 'Adjudicator']),
  human: new Set(['Intake', 'Research', 'Curation', 'Adjudicator'])
};

function keepToolCall(call: ToolCallEvent, stage: DemoRevealStage): boolean {
  if (stage === 'ready' || stage === 'intake') return false;
  if (stage === 'research') return call.agent_name === 'Intake' || call.agent_name === 'Research';
  if (stage === 'curation') return call.agent_name !== 'Adjudicator';
  return true;
}

export function caseForDemoReveal(full: Case, stage: DemoRevealStage): Case | null {
  if (stage === 'ready') return null;
  const agents = AGENTS_BY_STAGE[stage];
  const thread = (full.thread ?? []).filter((message) => keepAgentMessage(message, agents));
  const tool_calls = (full.tool_calls ?? []).filter((call) => keepToolCall(call, stage));
  const showFindings = stage === 'curation' || stage === 'adjudication' || stage === 'human';
  const showMemo = stage === 'adjudication' || stage === 'human';
  return {
    ...full,
    thread,
    tool_calls,
    findings: showFindings
      ? full.findings.map((finding) => (showMemo ? finding : { ...finding, memo: null }))
      : []
  };
}
```

`workflowStatusForDemoReveal` is unchanged (`adjudication` → `'running'`).

`apps/web/components/demo-coach.tsx` — insert a step between "Gemini Curation" and "Your turn":

```ts
  {
    target: 'demo-coach-findings',
    title: 'Clearance Adjudicator',
    body: 'Two readings of “The Matrix” conflict. An ADK agent frames the hypotheses, one advocate per reading searches registries through Parallel, and a grounded judge writes the memo and assigns it.'
  },
```

Also change the last step body to: `'Act as Jordan, Alex, or Maya. Dismiss what the memo cleared or escalate anything that still needs a human call.'`

`scripts/show-walkthrough.cjs` line 36: `const labels = ['Intake', 'Research', 'Curation', 'Adjudication', 'Your turn'];`

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test:web && pnpm typecheck && pnpm --filter @rightsrader/web lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/demo-reveal.ts apps/web/tests/demo-reveal.test.ts apps/web/components/demo-coach.tsx scripts/show-walkthrough.cjs
git commit -m "feat(web): add adjudication stage to the staged walkthrough"
```

---

### Task 13: Pipeline node for the Adjudicator and product copy

**Files:**
- Modify: `apps/web/components/script-review.tsx:199-349` (AgentPipeline), `:265-273` (blurb), `:1116-1126` (desk intro copy)

**Interfaces:**
- Consumes: `DemoRevealStage` incl. `'adjudication'` (Task 12); `Finding.memo` (Task 7 client).

- [ ] **Step 1: Update `AgentPipeline`**

Replace the `revealIndex` computation and `stages` array:

```tsx
  const memos = findings.filter((finding) => finding.memo != null).length;
  const hasAdjudicator =
    memos > 0 ||
    threadHasAgent(thread, 'Adjudicator') ||
    (result?.tool_calls ?? []).some((call) => call.agent_name === 'Adjudicator') ||
    revealStage === 'adjudication';
  const revealIndex =
    revealStage === 'intake' ? 0
    : revealStage === 'research' ? 1
    : revealStage === 'curation' ? 2
    : revealStage === 'adjudication' ? 3
    : revealStage === 'human' ? (hasAdjudicator ? 3 : 2)
    : -1;
  const stages = [
    { name: 'Gemini Intake', description: 'Vertex Gemini detects clearance leads.', icon: <Sparkles className="size-3.5" aria-hidden />, output: `${findings.length} ${findings.length === 1 ? 'lead' : 'leads'} detected`, done: revealStage != null ? revealIndex >= 0 : threadHasAgent(thread, 'Intake') || status === 'complete' },
    { name: 'Parallel Research', description: 'Vertex plan/brief plus Parallel Search xN and Extract.', icon: <Globe2 className="size-3.5" aria-hidden />, output: `${citedSources} ${citedSources === 1 ? 'source' : 'sources'} verified`, done: revealStage != null ? revealIndex >= 1 : threadHasAgent(thread, 'Research') || status === 'complete' },
    { name: 'Gemini Curation', description: 'Vertex Gemini cites only extracted URLs.', icon: <FileSearch className="size-3.5" aria-hidden />, output: `${curatedSources} primary ${curatedSources === 1 ? 'source' : 'sources'} selected`, done: revealStage != null ? revealIndex >= 2 : threadHasAgent(thread, 'Curation') || status === 'complete' },
    ...(hasAdjudicator
      ? [{
          name: 'Clearance Adjudicator',
          description: 'ADK agents argue competing readings on Parallel; a grounded judge rules.',
          icon: <Scale className="size-3.5" aria-hidden />,
          output: `${memos} ${memos === 1 ? 'memo' : 'memos'} issued`,
          done: revealStage != null ? revealIndex >= 3 : threadHasAgent(thread, 'Adjudicator') || status === 'complete'
        }]
      : [])
  ];
```

Import `Scale` from `lucide-react`. Change the `<ol>` grid class to adapt to 3 or 4 columns:

```tsx
      <ol className={`mt-4 grid gap-2 lg:items-stretch ${stages.length === 4 ? 'lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]' : 'lg:grid-cols-[1fr_auto_1fr_auto_1fr]'}`}>
```

- [ ] **Step 2: Product copy**

Replace the pipeline blurb (lines ~270-273) with:

```tsx
          <p className="mt-1 text-[10.5px] leading-4 text-lavender-soft">
            Intake → Research (Parallel Search ×N + Extract) → Curation → Adjudicator (ADK
            multi-agent) → your call. Every model and search call is logged under the message
            that made it.
          </p>
```

Replace the desk intro copy (lines ~1116-1126):

```tsx
            {focusTour || showWalkthroughChrome ? (
              <p className="mt-1 max-w-2xl text-[11px] leading-4 text-paper">
                Walkthrough: press <strong>Run next stage</strong> to advance Intake → Research →
                Curation → Adjudicator. The highlighted panel is the current beat.
              </p>
            ) : (
              <p className="mt-1 max-w-2xl text-[11px] leading-4 text-lavender-soft">
                Left: file the scene and work the desk thread. Center: findings and clearance
                memos. Right: recent cases, plus the agent tool log when you need it.
              </p>
            )}
```

Also change the "Findings unlock after Gemini Curation" string (line ~1354) condition to include `'adjudication'`:

```tsx
                            demoWalkthrough.stage !== 'curation' &&
                            demoWalkthrough.stage !== 'adjudication' &&
                            demoWalkthrough.stage !== 'human'
```

- [ ] **Step 3: Typecheck, lint, run e2e demo spec locally**

Run: `pnpm typecheck && pnpm --filter @rightsrader/web lint`
Run: `pnpm exec playwright test tests/e2e/demo-mode.spec.ts --workers=1` — expected to FAIL on `STEP 1 / 5` (fixed in Task 17); confirm no other errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/script-review.tsx
git commit -m "feat(web): Clearance Adjudicator pipeline node and product copy"
```

---

### Task 14: Clearance Memo card and Inbox verdict chip

**Files:**
- Create: `apps/web/lib/memo.ts`
- Create: `apps/web/tests/memo.test.ts`
- Modify: `apps/web/components/script-review.tsx:1408-1428` (finding card evidence block)
- Modify: `apps/web/components/dashboard.tsx:1007-1016` (inbox chips)

**Interfaces:**
- Produces: `verdictLabel(verdict: MemoVerdict): string`, `verdictTone(verdict): 'cleared' | 'warn' | 'danger' | 'neutral'`, `memoOwnerName(memo, roster): string | null`.

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/tests/memo.test.ts
import { describe, expect, it } from 'vitest';
import { memoOwnerName, verdictLabel, verdictTone } from '@/lib/memo';

describe('memo helpers', () => {
  it('labels verdicts in product language', () => {
    expect(verdictLabel('cleared')).toBe('Cleared');
    expect(verdictLabel('license_required')).toBe('License required');
    expect(verdictLabel('rewrite_recommended')).toBe('Rewrite recommended');
    expect(verdictLabel('needs_human')).toBe('Needs a human');
  });
  it('maps tones', () => {
    expect(verdictTone('cleared')).toBe('cleared');
    expect(verdictTone('license_required')).toBe('danger');
    expect(verdictTone('rewrite_recommended')).toBe('warn');
    expect(verdictTone('needs_human')).toBe('neutral');
  });
  it('resolves the owner name from the roster', () => {
    const roster = [{ id: 'm', name: 'Maya', role: 'legal' as const }];
    expect(memoOwnerName({ assigned_member_id: 'm' }, roster)).toBe('Maya');
    expect(memoOwnerName({ assigned_member_id: 'zzz' }, roster)).toBeNull();
    expect(memoOwnerName({ assigned_member_id: null }, roster)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @rightsrader/web test -- memo`
Expected: FAIL.

- [ ] **Step 3: Implement helpers**

```ts
// apps/web/lib/memo.ts
import type { MemoVerdict, ProductionMember } from '@rightsrader/api-client';

export function verdictLabel(verdict: MemoVerdict): string {
  switch (verdict) {
    case 'cleared': return 'Cleared';
    case 'license_required': return 'License required';
    case 'rewrite_recommended': return 'Rewrite recommended';
    case 'needs_human': return 'Needs a human';
  }
}

export function verdictTone(verdict: MemoVerdict): 'cleared' | 'warn' | 'danger' | 'neutral' {
  switch (verdict) {
    case 'cleared': return 'cleared';
    case 'license_required': return 'danger';
    case 'rewrite_recommended': return 'warn';
    case 'needs_human': return 'neutral';
  }
}

export function memoOwnerName(
  memo: { assigned_member_id?: string | null },
  roster: readonly Pick<ProductionMember, 'id' | 'name'>[]
): string | null {
  if (!memo.assigned_member_id) return null;
  return roster.find((member) => member.id === memo.assigned_member_id)?.name ?? null;
}
```

If `MemoVerdict` is not exported from `@rightsrader/api-client`, add a re-export in `packages/api-client/src/index.ts` (`export type { MemoVerdict, ClearanceMemo } from './generated';`).

- [ ] **Step 4: Memo card in the finding**

In `script-review.tsx`, inside the finding `<article>`, immediately after the "Evidence / liner notes" `<div>` (ends around line 1428), add:

```tsx
                              {finding.memo ? (
                                <div
                                  className="mt-3 border-2 border-ink bg-white p-3"
                                  data-testid="clearance-memo"
                                  data-verdict={finding.memo.verdict}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h4 className="font-pixel text-[8px] uppercase tracking-[0.16px] text-line-strong">
                                      Clearance memo · Adjudicator
                                    </h4>
                                    <span
                                      className={`rotate-1 border-2 px-2 py-0.5 font-display text-[9px] ${
                                        verdictTone(finding.memo.verdict) === 'cleared'
                                          ? 'border-brand-strong text-brand-strong'
                                          : verdictTone(finding.memo.verdict) === 'danger'
                                            ? 'border-accent text-accent'
                                            : verdictTone(finding.memo.verdict) === 'warn'
                                              ? 'border-[#c77d00] text-[#c77d00]'
                                              : 'border-ink text-ink'
                                      }`}
                                      data-testid="memo-verdict"
                                    >
                                      {verdictLabel(finding.memo.verdict)} · {Math.round(finding.memo.confidence * 100)}%
                                    </span>
                                  </div>
                                  <p className="mt-2 text-[11px] leading-[16.5px] text-ink-soft">
                                    {finding.memo.rationale}
                                  </p>
                                  {finding.memo.dispositive_url ? (
                                    <a
                                      href={finding.memo.dispositive_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-ink underline-offset-2 hover:text-accent hover:underline"
                                    >
                                      Dispositive source <ArrowUpRight className="size-3" aria-hidden />
                                    </a>
                                  ) : null}
                                  <p className="mt-2 font-pixel text-[7px] text-line-strong">
                                    {memoOwnerName(finding.memo, roster)
                                      ? `Assigned to ${memoOwnerName(finding.memo, roster)} (${finding.memo.recommended_owner_role})`
                                      : `Recommended owner: ${finding.memo.recommended_owner_role}`}
                                    {' · '}
                                    {finding.memo.hypotheses.length} hypotheses argued
                                  </p>
                                </div>
                              ) : null}
```

Import `{ memoOwnerName, verdictLabel, verdictTone } from '@/lib/memo'`.

- [ ] **Step 5: Inbox verdict chip**

In `dashboard.tsx` the `mine.map((finding) => ...)` chip list (lines ~1007-1016) becomes:

```tsx
                          {mine.map((finding) => (
                            <li
                              key={finding.id}
                              className="border border-cyan-pop px-2 py-1 font-pixel text-[7px] text-cyan-pop"
                              data-testid="inbox-finding-chip"
                            >
                              {finding.detected_item}
                              {finding.memo ? (
                                <span className="ml-1 text-brand" data-testid="inbox-verdict">
                                  · {verdictLabel(finding.memo.verdict)}
                                </span>
                              ) : null}
                            </li>
                          ))}
```

Import `{ verdictLabel } from '@/lib/memo'`.

- [ ] **Step 6: Tests, typecheck, lint**

Run: `pnpm test:web && pnpm typecheck && pnpm --filter @rightsrader/web lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/memo.ts apps/web/tests/memo.test.ts apps/web/components/script-review.tsx apps/web/components/dashboard.tsx packages/api-client/src/index.ts
git commit -m "feat(web): clearance memo card on findings and verdict chip in Inbox"
```

---

### Task 15: One "Acting as" identity control

**Files:**
- Modify: `apps/web/components/dashboard.tsx:921-940` and the `<ScriptReview ...>` props (~line 820-850)
- Modify: `apps/web/components/script-review.tsx:809-880` (props/state), `:736-763` (composer select), `:635-638` (copy)

**Interfaces:**
- `ScriptReview` gains prop `onActiveMemberChange?: (memberId: string) => void`. The desk select writes `writeActiveMemberId(window.localStorage, id)` and calls `onActiveMemberChange(id)`; `speakAsOverride` state is removed.

- [ ] **Step 1: Dashboard label and handler**

In `dashboard.tsx` change the label text `SIGNED IN AS` → `ACTING AS` and keep `data-testid="signed-in-as"` (e2e depends on it). Pass to `<ScriptReview>`:

```tsx
            onActiveMemberChange={(next) => {
              setMemberPick(next);
            }}
```

- [ ] **Step 2: ScriptReview uses the shared identity**

In `script-review.tsx`:
- Add `onActiveMemberChange` to the props type and destructure it.
- Delete `const [speakAsOverride, setSpeakAsOverride] = useState<string | null>(null);` and the `speakAsOverride` branch in `actingMemberId`, so:

```ts
  const actingMemberId =
    (activeMemberId && roster.some((member) => member.id === activeMemberId) ? activeMemberId : null) ??
    rosterDefaultId;
  const setActingMemberId = (memberId: string) => {
    writeActiveMemberId(window.localStorage, memberId);
    onActiveMemberChange?.(memberId);
  };
```

Import `writeActiveMemberId` from `@/lib/inbox`.
- Composer label text `Speak as` → `Acting as`; copy at line ~636: `Dismiss / Escalate posts as whoever you are acting as — same thread, not a separate queue.`
- Error string line ~1045: `'Pick who you are acting as before dismissing or escalating in the desk thread.'`

- [ ] **Step 3: Update tests that reference "Speak as"**

Run: `rg -n "Speak as" apps tests`
Update any e2e or unit assertion to `Acting as`.

- [ ] **Step 4: Typecheck, lint, unit tests**

Run: `pnpm typecheck && pnpm --filter @rightsrader/web lint && pnpm test:web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/dashboard.tsx apps/web/components/script-review.tsx tests
git commit -m "feat(web): single Acting-as identity shared by Inbox and desk"
```

---

### Task 16: Tool log toggle, live-mode badge, one-click sample chips

**Files:**
- Modify: `apps/web/components/script-review.tsx:536-595` (JudgeLogRail), `:1605-1614` (rail mount), form area where `SAMPLE_SCRIPT` is used (~line 1180-1230)
- Create: `apps/web/lib/health.ts`
- Create: `apps/web/tests/health.test.ts`

**Interfaces:**
- Produces: `fetchHealth(baseUrl: string, fetchImpl = fetch): Promise<{ mode: 'mock' | 'hybrid' | 'cloud'; adjudicator: 'adk' | 'fixture' } | null>`; `modeBadgeLabel(health): string`.

- [ ] **Step 1: Write failing test**

```ts
// apps/web/tests/health.test.ts
import { describe, expect, it } from 'vitest';
import { fetchHealth, modeBadgeLabel } from '@/lib/health';

describe('health', () => {
  it('parses the health payload', async () => {
    const fake = (async () => new Response(JSON.stringify({ status: 'ok', mode: 'cloud', adjudicator: 'adk' }))) as unknown as typeof fetch;
    expect(await fetchHealth('http://api.test', fake)).toEqual({ mode: 'cloud', adjudicator: 'adk' });
  });
  it('returns null on failure', async () => {
    const fake = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await fetchHealth('http://api.test', fake)).toBeNull();
  });
  it('labels modes', () => {
    expect(modeBadgeLabel({ mode: 'cloud', adjudicator: 'adk' })).toBe('LIVE · Vertex + Parallel + ADK');
    expect(modeBadgeLabel({ mode: 'mock', adjudicator: 'fixture' })).toBe('OFFLINE FIXTURES');
    expect(modeBadgeLabel(null)).toBe('API UNREACHABLE');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @rightsrader/web test -- health`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/health.ts
export type ApiHealth = { mode: 'mock' | 'hybrid' | 'cloud'; adjudicator: 'adk' | 'fixture' };

export async function fetchHealth(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<ApiHealth | null> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/health`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<ApiHealth>;
    if (body.mode !== 'mock' && body.mode !== 'hybrid' && body.mode !== 'cloud') return null;
    return { mode: body.mode, adjudicator: body.adjudicator === 'adk' ? 'adk' : 'fixture' };
  } catch {
    return null;
  }
}

export function modeBadgeLabel(health: ApiHealth | null): string {
  if (!health) return 'API UNREACHABLE';
  if (health.mode === 'cloud') return 'LIVE · Vertex + Parallel + ADK';
  if (health.mode === 'hybrid') return `HYBRID · adjudicator ${health.adjudicator}`;
  return 'OFFLINE FIXTURES';
}
```

- [ ] **Step 4: Badge next to the pipeline status**

In `AgentPipeline` add a prop `health: ApiHealth | null` and render, next to the status `<span>`:

```tsx
        <span className={`border px-2 py-1 font-pixel text-[7px] ${health?.mode === 'cloud' ? 'border-brand text-brand' : 'border-line-strong text-lavender'}`} data-testid="mode-badge">
          {modeBadgeLabel(health)}
        </span>
```

In `ScriptReview` add state `const [health, setHealth] = useState<ApiHealth | null>(null);` and an effect that runs once: `useEffect(() => { let alive = true; fetchHealth(API_BASE_URL).then((h) => { if (alive) setHealth(h); }); return () => { alive = false; }; }, []);` Pass `health={health}` into `<AgentPipeline>`.

- [ ] **Step 5: Tool log toggle**

Replace the rail mount block (lines ~1605-1614) with a toggle that defaults closed:

```tsx
          {displayCase && !focusTour && !showWalkthroughChrome ? (
            <div className="animate-fade-up xl:sticky xl:top-2 xl:max-h-[calc(100vh-1.25rem)] xl:self-start">
              <button
                type="button"
                data-testid="toggle-tool-log"
                onClick={() => setShowToolLog((value) => !value)}
                className="border-2 border-ink bg-white px-3 py-2 font-display text-[9px] text-ink shadow-press"
                aria-expanded={showToolLog}
              >
                {showToolLog ? 'Hide agent tool log' : 'Show agent tool log'} · {(displayCase.tool_calls ?? []).length}
              </button>
              {showToolLog ? (
                <div className="mt-2 h-[calc(100vh-8rem)] min-h-[24rem]">
                  <JudgeLogRail calls={displayCase.tool_calls ?? []} />
                </div>
              ) : null}
            </div>
          ) : ...
```

Add `const [showToolLog, setShowToolLog] = useState(false);`. In `JudgeLogRail` change the header copy:

```tsx
        <p className="font-mono text-[10px] font-semibold tracking-wide text-[#ffb454]">AGENT TOOL LOG</p>
        <p className="mt-1 font-mono text-[10px] leading-4 text-[#8b949e]">
          Every Vertex Gemini, ADK, and Parallel call this case made, in order. No secrets or
          response bodies. Offline runs are marked <span className="text-[#d2a8ff]">fixture</span>;
          live runs are marked <span className="text-[#7ee787]">live</span>.
        </p>
```

and in the row, replace `{call.fixture ? <span ...>fixture</span> : null}` with `<span className={call.fixture ? 'text-[#d2a8ff]' : 'text-[#7ee787]'}>{call.fixture ? 'fixture' : 'live'}</span>`. Same in `ToolCallChips`: `{call.fixture ? ' · fixture' : ' · live'}`. Update `aria-label` to `"Agent tool-call log"` and keep `data-testid="judge-log"`.

Check e2e for assertions on `judge-log` visibility (`rg -n "judge-log" tests`): where a test expects the rail visible, click `toggle-tool-log` first.

- [ ] **Step 6: Sample chips on the blank case form**

Where the script `<textarea>` is rendered (search `SAMPLE_SCRIPT`), add above it:

```tsx
                        <div className="mb-2 flex flex-wrap gap-2" data-testid="sample-chips">
                          {FEATURED_DEMO_SCRIPTS.map((sample) => (
                            <button
                              key={sample.id}
                              type="button"
                              onClick={() => setScriptText(sample.script)}
                              className="border border-ink bg-white px-2 py-1 font-display text-[8px] text-ink shadow-press hover:bg-exhibit"
                            >
                              {sample.title}
                            </button>
                          ))}
                        </div>
```

Import `FEATURED_DEMO_SCRIPTS` from `@/lib/demo-mode`. Remove the `SAMPLE_SCRIPT` constant if it is no longer referenced.

- [ ] **Step 7: Tests, typecheck, lint**

Run: `pnpm test:web && pnpm typecheck && pnpm --filter @rightsrader/web lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/health.ts apps/web/tests/health.test.ts apps/web/components/script-review.tsx tests
git commit -m "feat(web): live-mode badge, collapsible agent tool log, one-click sample scripts"
```

---

### Task 17: E2E, README, Devpost text, recorded cloud run

**Files:**
- Modify: `tests/e2e/demo-mode.spec.ts:50-86`
- Modify: `README.md` (Judges section, tool-count table, Architecture mermaid)
- Create: `docs/devpost-submission.md`

**Interfaces:** none.

- [ ] **Step 1: Update the walkthrough e2e**

In `tests/e2e/demo-mode.spec.ts`, change `STEP 1 / 5` → `STEP 1 / 6`, `STEP 2 / 5` → `STEP 2 / 6`, and insert after the curation assertions:

```ts
  await page.getByTestId('demo-coach-next').click();
  await expect(page.getByTestId('agent-pipeline')).toHaveAttribute('data-reveal-stage', 'adjudication');
  await expect(page.getByTestId('demo-coach')).toContainText('Clearance Adjudicator');
  await expect(page.getByTestId('tool-call-chip').filter({ hasText: 'search_authoritative' }).first()).toBeVisible();
  await expect(page.getByTestId('clearance-memo').filter({ hasText: 'Rewrite recommended' })).toBeVisible();
```

Also assert at the `curation` stage: `await expect(page.getByTestId('clearance-memo')).toHaveCount(0);`

Add a new test:

```ts
test('inbox shows the adjudicator verdict for the assigned user', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByTestId('demo-walkthrough').click();
  await expect(page.getByTestId('demo-coach')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('demo-coach-dismiss').click();
  await page.getByRole('button', { name: /All productions|Overview/ }).first().click();
  await page.getByTestId('signed-in-as').selectOption({ label: /Maya/ });
  await expect(page.getByTestId('inbox-verdict').filter({ hasText: 'Rewrite recommended' }).first()).toBeVisible();
});
```

Adjust the overview navigation click to whatever control returns to the production overview (check `dashboard.tsx` for the button that sets `view.kind === 'overview'`; use its accessible name).

- [ ] **Step 2: Run e2e**

Run: `pnpm e2e`
Expected: all pass. Fix selectors, not product behavior.

- [ ] **Step 3: README**

- Architecture mermaid: add `Adjudicator[Adjudicator (ADK)]` with edges `Curation -->|"contested lead"| Adjudicator`, `Adjudicator -->|"hypotheses + parallel advocates"| Parallel`, `Adjudicator -->|"grounded judge"| Vertex`, `Adjudicator -->|"memo + owner"| Legal`.
- "Judges: start here": add a paragraph: *Contested leads (franchise, quote, character, likeness, low confidence, or registry-vs-claimant evidence) go to the Clearance Adjudicator: an ADK `LlmAgent` frames 2–3 hypotheses, an ADK `ParallelAgent` runs one advocate per hypothesis with a `parallel-web` Search tool pinned to registries, and Gemini (grounded with Parallel Web Search) writes a Clearance Memo that is assigned to a roster member and lands in their Inbox. The memo may only cite a URL an advocate or the grounding step returned.*
- Tool-count table: add rows `hypothesize ≥1`, `search_authoritative ≥2`, `judge_grounded ≥1` (Matrix script).
- Demo clicks: step 4 mentions Adjudicator; step 6 says **Show agent tool log**.
- Replace "JUDGE LOG" wording with "agent tool log".

- [ ] **Step 4: Devpost text**

Create `docs/devpost-submission.md` with these headings and fill each from the README and spec (no placeholders): **Inspiration** (clearance desks argue about who owns what; the Matrix one-sheet vs the MATRIX software mark), **What it does** (pipeline + Adjudicator + Inbox), **How we built it** (Vertex Gemini via `google-genai`, ADK `LlmAgent`/`ParallelAgent`, `parallel-web` Search + Extract, Parallel Web Search as Gemini grounding, Firestore/GCS, Cloud Run, Next.js on Vercel), **Challenges** (URL discipline: no agent may cite a URL a tool did not return; Extract live-fetch latency; cost cap), **Accomplishments**, **What we learned**, **What's next** (Parallel Task API for deep dossiers, Monitor for re-checks), **Built with** tag list: `google-adk, google-genai, vertex-ai, gemini, parallel-web, parallel-search, firestore, cloud-run, fastapi, nextjs, vercel`.

- [ ] **Step 5: Recorded cloud run**

With the Cloud Run API and Vercel env live: run `RIGHTSRADAR_WEB_URL=https://hackathon-project-web-five.vercel.app node scripts/show-walkthrough.cjs` while recording the screen. Confirm in the browser: mode badge `LIVE · Vertex + Parallel + ADK`, Adjudicator chips without `fixture`, memo `Dispositive source` opens a real page. Keep the recording as the backup for the 3-minute video.

- [ ] **Step 6: Commit, push, open PR**

```bash
git add tests/e2e/demo-mode.spec.ts README.md docs/devpost-submission.md
git commit -m "docs/test: adjudicator walkthrough e2e, judges tour, Devpost text"
git push
gh pr create --title "Clearance Adjudicator (ADK) + submission readiness" --body-file docs/devpost-submission.md
```

Watch CI: `gh pr checks --watch`. Merge to `main` once green so Vercel Production picks it up.
