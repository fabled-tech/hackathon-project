# Curated Evidence and Focused Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full-cloud RightsRadar demo produce focused, validated evidence and present each case in a horizontal review workspace with chronological reopening.

**Architecture:** Preserve the existing Gemini Enterprise Agent Platform, Parallel Search, Firestore, and Cloud Storage adapters. Extend the agent pipeline with contextual retrieval and a Gemini evidence-curation decision, validate every selected URL against retrieved candidates, and expose a structured evidence-selection object to a two-pane web workspace. The existing case repository remains the source for newest-first history.

**Tech Stack:** FastAPI, Pydantic, Google Gen AI Python SDK, Parallel Search HTTP API, Firestore, Cloud Storage, Next.js/React, TypeScript, generated OpenAPI client, Vitest, pytest, and Playwright.

## Global Constraints

- Run the live demo with `RIGHTSRADAR_MODE=cloud`; keep provider credentials server-only and never log or expose them.
- RightsRadar is research assistance only; copy and prompts must not give legal advice or final infringement conclusions.
- Keep Gemini and Parallel as separate providers; do not replace either integration.
- Default evidence view is one validated citation plus a concise relevance rationale; alternatives remain behind an explicit disclosure.
- A valid no-source result is saved as a neutral finding; provider, invalid-output, and persistence failures are retryable and must not return a partial case.
- Case history is chronological/newest-first only in this release; do not add titles, search, filters, tags, or chat transcripts.
- The desktop review surface is horizontal and must stack accessibly on narrow screens.
- Regenerate `packages/api-client/src/generated.ts` from the FastAPI schema; never hand-edit generated output.
- Use TDD for every implementation task and run the narrowest relevant test after each change.

---

## File map

| File | Responsibility in this plan |
| --- | --- |
| `services/api/app/models/analysis.py` | Evidence-selection and Gemini curation decision models; contextual lead field. |
| `services/api/app/models/cases.py` | Finding evidence field and legacy-document compatibility. |
| `services/api/app/models/__init__.py` | Public model exports. |
| `services/api/app/errors.py` | Shared analysis-provider and curation exceptions used by adapters, agent, and HTTP routes. |
| `services/api/app/integrations/gemini.py` | Gemini detection and structured evidence-curation calls, including deterministic mock behavior. |
| `services/api/app/integrations/parallel.py` | Contextual query construction, bounded candidate retrieval, normalization, and provider errors. |
| `services/api/app/agents/service.py` | Detection → retrieval → curation orchestration and candidate validation. |
| `services/api/app/routes/cases.py` | Generic retryable HTTP response for analysis-provider failures. |
| `services/api/tests/test_analysis.py` | Model, curation decision, and agent orchestration unit tests. |
| `services/api/tests/test_integrations.py` | Gemini and Parallel adapter tests. |
| `services/api/tests/test_cases.py` | API response/error and no-partial-case coverage. |
| `services/api/tests/test_repositories.py` | Legacy Firestore/in-memory finding fixtures updated for the new default field. |
| `scripts/generate_api_client.py` | Existing generator; run only, do not redesign. |
| `packages/api-client/src/generated.ts` | Regenerated TypeScript models/client. |
| `apps/web/components/script-review.tsx` | Focused Canvas, evidence disclosure, case drawer, and async state behavior. |
| `apps/web/app/styles.css` | Horizontal two-pane layout, drawer, evidence states, and responsive stacking. |
| `apps/web/tests/api-client.test.ts` | Generated-client request/response contract checks. |
| `tests/e2e/review-workflow.spec.ts` | Mocked browser flow for curated evidence, drawer history, reopening, and safe states. |
| `README.md` | Full-cloud launch and focused-evidence behavior documentation. |

---

### Task 1: Add the structured evidence-selection contract

**Files:**
- Modify: `services/api/app/models/analysis.py`
- Modify: `services/api/app/models/cases.py`
- Modify: `services/api/app/models/__init__.py`
- Create: `services/api/app/errors.py`
- Create: `services/api/tests/test_analysis.py`
- Modify: `services/api/tests/test_repositories.py` (only fixtures that construct `Finding` directly)

**Interfaces:**
- Produces `EvidenceSelection(primary: Evidence | None, rationale: str | None, alternatives: list[Evidence])`.
- Produces `EvidenceCurationDecision(primary_url: str | None, rationale: str | None)` for provider output before URL-to-evidence resolution.
- Extends `GeminiSignal` with optional `context_excerpt: str = ""`.
- Extends `Finding` with `evidence: EvidenceSelection` defaulting to no primary evidence and no alternatives while retaining `supporting_evidence` and `source_urls` for existing persisted documents and fixtures.

- [ ] **Step 1: Write failing model tests**

```python
from app.models import Evidence, EvidenceSelection, Finding, Source


def test_evidence_selection_defaults_to_neutral_no_source() -> None:
    selection = EvidenceSelection()
    assert selection.primary is None
    assert selection.rationale is None
    assert selection.alternatives == []


def test_legacy_finding_without_evidence_is_safe_to_read() -> None:
    finding = Finding.model_validate(
        {
            "id": "finding-1",
            "case_id": "case-1",
            "category": "brand_reference",
            "detected_item": "Old Brand",
            "explanation": "A legacy stored lead.",
            "confidence": 0.5,
            "supporting_evidence": [
                {"excerpt": "old source", "source": {"title": "Old", "url": "https://old.test"}}
            ],
            "source_urls": ["https://old.test"],
            "retrieved_at": "2026-08-02T00:00:00Z",
            "reviewer_status": "pending",
        }
    )
    assert finding.evidence.primary is None
    assert finding.evidence.alternatives[0].source.url == "https://old.test"
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_analysis.py -q`

Expected: FAIL because `EvidenceSelection` and `Finding.evidence` do not yet exist.

- [ ] **Step 3: Implement the models and compatibility defaults**

Add the two models in `analysis.py`, add `context_excerpt` to `GeminiSignal`, and add `evidence` to `Finding` with a `model_validator(mode="before")` that maps a legacy `supporting_evidence` list into `evidence.alternatives` only when no `evidence` object is present. Do not promote a legacy source to `primary`. Export the new models from `models/__init__.py` and keep existing fields so old repository fixtures and stored documents remain readable.

Create `app/errors.py` with the shared exception classes used by later tasks:

```python
class AnalysisUnavailableError(RuntimeError):
    """An analysis provider or its structured result cannot be used."""


class AnalysisProviderError(AnalysisUnavailableError):
    """An upstream retrieval or model call failed."""


class EvidenceCurationError(AnalysisUnavailableError):
    """Gemini returned malformed or ungrounded evidence curation output."""
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_analysis.py tests/test_repositories.py -q`

Expected: PASS, including existing repository fixture coverage.

- [ ] **Step 5: Commit the contract**

```bash
git add services/api/app/models/analysis.py services/api/app/models/cases.py services/api/app/models/__init__.py services/api/app/errors.py services/api/tests/test_analysis.py services/api/tests/test_repositories.py
git commit -m "feat: add structured evidence selection"
```

### Task 2: Add Gemini evidence curation with a deterministic mock

**Files:**
- Modify: `services/api/app/integrations/gemini.py`
- Modify: `services/api/tests/test_integrations.py`
- Modify: `services/api/tests/test_analysis.py`

**Interfaces:**
- Extends `GeminiClient` with `curate_evidence(signal: GeminiSignal, candidates: list[SearchResult]) -> EvidenceCurationDecision`.
- Uses the shared `EvidenceCurationError` from `app.errors` for malformed JSON, missing required fields, or an unknown selected URL.
- `MockGeminiClient.curate_evidence` selects the first candidate when candidates exist and returns a neutral decision when they do not.
- `VertexGeminiClient.curate_evidence` sends candidate titles, URLs, excerpts, and lead context to the configured Gemini model and parses only `{ "primary_url": string | null, "rationale": string | null }`.

- [ ] **Step 1: Write failing adapter tests**

```python
from app.integrations.gemini import MockGeminiClient
from app.models.analysis import GeminiSignal, SearchResult
from app.models.cases import Source


def test_mock_curator_selects_only_a_retrieved_candidate() -> None:
    candidate = SearchResult(
        source=Source(title="Official source", url="https://source.test/item"),
        excerpt="A relevant excerpt.",
    )
    decision = MockGeminiClient().curate_evidence(
        GeminiSignal(
            category="brand_reference",
            detected_item="Example Brand",
            explanation="A named brand.",
            confidence=0.8,
            context_excerpt="She holds an Example Brand can.",
        ),
        [candidate],
    )
    assert decision.primary_url == "https://source.test/item"
    assert decision.rationale
```

- [ ] **Step 2: Run the adapter test to verify it fails**

Run: `cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_integrations.py::test_mock_curator_selects_only_a_retrieved_candidate -q`

Expected: FAIL because the protocol and mock method do not exist.

- [ ] **Step 3: Implement mock and Vertex curation**

Keep the existing detection prompt, adding `context_excerpt` to the requested JSON fields. Implement the real curation prompt with explicit instructions to choose `null` when no candidate is reliable, copy no new URLs, and avoid legal conclusions. Parse the JSON through `EvidenceCurationDecision`; raise `EvidenceCurationError` for malformed output or a non-null URL that is not present in the candidate list. The mock must remain deterministic so normal tests never call Google.

- [ ] **Step 4: Add malformed and no-source tests, then run them**

Cover an empty candidate list, a valid `primary_url: null`, invalid JSON, and an unknown URL. Run: `cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_integrations.py tests/test_analysis.py -q`

Expected: PASS with no network calls from mock tests.

- [ ] **Step 5: Commit the Gemini adapter**

```bash
git add services/api/app/integrations/gemini.py services/api/tests/test_integrations.py services/api/tests/test_analysis.py
git commit -m "feat: curate evidence with Gemini"
```

### Task 3: Make Parallel retrieval contextual and bounded

**Files:**
- Modify: `services/api/app/integrations/parallel.py`
- Modify: `services/api/tests/test_integrations.py`

**Interfaces:**
- Changes `ParallelSearchClient.search` to `search(detected_item: str, category: str, context_excerpt: str = "") -> list[SearchResult]`.
- Adds a private `_build_search_queries(detected_item, category)` returning three concise keyword queries.
- Normalizes response results by URL, ignores malformed entries, and returns at most five candidates to the agent while preserving provider relevance order.
- Raises the shared `AnalysisProviderError` for HTTP, timeout, or malformed provider responses without including secrets or response bodies.

- [ ] **Step 1: Write failing query/normalization tests**

```python
import httpx


def test_parallel_query_objective_contains_context_and_returns_unique_bounded_results(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url, *, headers, json, timeout):
        captured.update(json)
        return httpx.Response(
            200,
            json={
                "results": [
                    {"url": "https://source.test/1", "title": "One", "excerpts": ["A"]},
                    {"url": "https://source.test/1", "title": "One duplicate", "excerpts": ["A2"]},
                ]
            },
        )

    monkeypatch.setattr("app.integrations.parallel.httpx.post", fake_post)
    results = ParallelSearchHttpClient("secret-test-key").search(
        "Example Brand", "brand_reference", "She holds the product in the scene."
    )
    assert len(results) == 1
    assert "She holds the product" in str(captured["objective"])
    assert len(captured["search_queries"]) == 3
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_integrations.py -q`

Expected: FAIL because the search signature, objective context, and deduplication are not implemented.

- [ ] **Step 3: Implement contextual retrieval**

Build three 3–6-word queries focused on the item/category and use a self-contained objective that includes the context excerpt and research-only boundary. Keep `max_chars_total=2000`, parse `url`, `title`, and the first excerpt, deduplicate by URL, and slice to five candidates. Wrap `httpx` and non-2xx failures in `AnalysisProviderError`; do not include response bodies or API keys in the exception message.

- [ ] **Step 4: Run the adapter and lint tests**

Run: `cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_integrations.py -q` and `cd services/api && UV_CACHE_DIR=../../.uv-cache uv run ruff check app/integrations/parallel.py tests/test_integrations.py`

Expected: PASS.

- [ ] **Step 5: Commit contextual retrieval**

```bash
git add services/api/app/integrations/parallel.py services/api/tests/test_integrations.py
git commit -m "feat: bound contextual evidence retrieval"
```

### Task 4: Orchestrate curation and return safe API failures

**Files:**
- Modify: `services/api/app/agents/service.py`
- Modify: `services/api/app/routes/cases.py`
- Modify: `services/api/tests/test_analysis.py`
- Modify: `services/api/tests/test_cases.py`

**Interfaces:**
- `RightsClearanceAgentService.analyze` calls detection, contextual retrieval, curation, candidate validation, and finding construction in that order.
- Imports the shared `AnalysisUnavailableError` boundary from `app.errors` and converts provider/curation failures into it.
- `POST /api/cases` returns status `503` with the fixed detail `RightsRadar analysis is temporarily unavailable. Please try again.` for `AnalysisUnavailableError`.

- [ ] **Step 1: Write failing orchestration tests**

```python
import pytest

from app.agents.service import RightsClearanceAgentService
from app.errors import AnalysisUnavailableError
from app.models.analysis import EvidenceCurationDecision, GeminiSignal, SearchResult
from app.models.cases import Source


class StubGemini:
    def __init__(self, decision: EvidenceCurationDecision) -> None:
        self.decision = decision

    def identify_material(self, script_text: str) -> list[GeminiSignal]:
        return [
            GeminiSignal(
                category="brand_reference",
                detected_item="Example Brand",
                explanation="A named brand.",
                confidence=0.8,
                context_excerpt=script_text,
            )
        ]

    def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        return self.decision


class StubParallel:
    def __init__(self, candidates: list[SearchResult]) -> None:
        self.candidates = candidates

    def search(
        self, detected_item: str, category: str, context_excerpt: str = ""
    ) -> list[SearchResult]:
        return self.candidates


def test_agent_puts_selected_source_in_primary_and_rest_in_alternatives() -> None:
    candidates = [
        SearchResult(
            source=Source(title="Best", url="https://source.test/best"), excerpt="Best excerpt"
        ),
        SearchResult(
            source=Source(title="Other", url="https://source.test/other"), excerpt="Other excerpt"
        ),
    ]
    service = RightsClearanceAgentService(
        StubGemini(EvidenceCurationDecision(primary_url="https://source.test/best", rationale="Best match.")),
        StubParallel(candidates),
    )
    findings = service.analyze("case-1", "A contextual excerpt.")
    assert findings[0].evidence.primary.source.url == "https://source.test/best"
    assert [item.source.url for item in findings[0].evidence.alternatives] == [
        "https://source.test/other"
    ]
    assert findings[0].supporting_evidence


def test_unknown_curated_url_fails_before_repository_create() -> None:
    candidate = SearchResult(
        source=Source(title="Known", url="https://source.test/known"), excerpt="Known excerpt"
    )
    service = RightsClearanceAgentService(
        StubGemini(
            EvidenceCurationDecision(
                primary_url="https://source.test/not-retrieved", rationale="Ungrounded."
            )
        ),
        StubParallel([candidate]),
    )
    with pytest.raises(AnalysisUnavailableError):
        service.analyze("case-1", "A contextual excerpt.")
```

- [ ] **Step 2: Run the orchestration tests to verify they fail**

Run: `cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_analysis.py -q`

Expected: FAIL because the agent still writes a flat evidence list and never calls curation.

- [ ] **Step 3: Implement orchestration and route mapping**

For each `GeminiSignal`, call Parallel with `signal.context_excerpt`, normalize candidates, call curation when candidates exist, validate `primary_url` against a URL map, and build `EvidenceSelection`. Preserve all candidates in `supporting_evidence`/`source_urls` for compatibility while exposing the structured object. Catch `EvidenceCurationError` and provider exceptions at the agent boundary and raise `AnalysisUnavailableError`. In `create_case`, catch only that shared error and raise the fixed 503 response before `case_repository.create` is reached.

- [ ] **Step 4: Add endpoint failure/no-source tests and run the API suite**

Cover a saved finding with `primary=None`, a 503 with the fixed message for a fake provider failure, and an assertion that the fake repository has no created case. Run: `cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_analysis.py tests/test_cases.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the agent boundary**

```bash
git add services/api/app/agents/service.py services/api/app/routes/cases.py services/api/tests/test_analysis.py services/api/tests/test_cases.py
git commit -m "feat: validate curated evidence before saving cases"
```

### Task 5: Regenerate and verify the API client contract

**Files:**
- Modify: `packages/api-client/src/generated.ts` (generated)
- Modify: `apps/web/tests/api-client.test.ts`

**Interfaces:**
- The generated `Finding` type exposes `evidence.primary`, `evidence.rationale`, and `evidence.alternatives` while retaining compatibility fields.

- [ ] **Step 1: Add a generated-response contract test**

Add a helper test that calls the generated `createCase` helper with a mocked `fetch` response and asserts the nested fields are available to TypeScript:

```ts
const response = await createCase(
  { script_text: 'A focused excerpt.' },
  'http://api.test',
  vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: 'case-1',
        script_text: 'A focused excerpt.',
        created_at: '2026-08-02T00:00:00Z',
        asset_count: 0,
        findings: [
          {
            id: 'finding-1',
            case_id: 'case-1',
            category: 'brand_reference',
            detected_item: 'Example Brand',
            explanation: 'A named brand.',
            confidence: 0.8,
            reviewer_status: 'pending',
            retrieved_at: '2026-08-02T00:00:00Z',
            evidence: {
              primary: {
                excerpt: 'Official excerpt.',
                source: { title: 'Official source', url: 'https://source.test/best' }
              },
              rationale: 'Confirms the brand named in the scene.',
              alternatives: []
            },
            supporting_evidence: [],
            source_urls: []
          }
        ]
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    )
  )
);
expect(response.findings[0].evidence.primary?.source.url).toBe('https://source.test/best');
expect(response.findings[0].evidence.rationale).toContain('Confirms');
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `pnpm exec vitest run apps/web/tests/api-client.test.ts`

Expected: FAIL to type-check until the generated model contains `evidence`.

- [ ] **Step 3: Regenerate from FastAPI OpenAPI**

Run: `make generate-client` and inspect `packages/api-client/src/generated.ts`; do not edit the generated file manually.

- [ ] **Step 4: Run client freshness and tests**

Run: `make check-client` and `pnpm exec vitest run apps/web/tests/api-client.test.ts`

Expected: PASS with no generated diff and nested evidence types available.

- [ ] **Step 5: Commit the API contract**

```bash
git add packages/api-client/src/generated.ts apps/web/tests/api-client.test.ts
git commit -m "feat: expose curated evidence in client contract"
```

### Task 6: Implement the Focused Canvas and chronological drawer

**Files:**
- Modify: `apps/web/components/script-review.tsx`
- Modify: `apps/web/app/styles.css`
- Modify: `tests/e2e/review-workflow.spec.ts`

**Interfaces:**
- The existing `createCase`, `getCase`, `listCases`, `listAssets`, and reviewer-status helpers remain the only browser API calls.
- New UI state includes `isHistoryOpen` and a per-finding evidence-disclosure state; existing generation refs continue to guard stale case, asset, and submission responses.
- Adds stable `data-testid`/accessible labels for `focused-workspace`, `review-queue`, `past-cases`, `evidence-primary`, `evidence-alternatives`, and `no-source-state`.

- [ ] **Step 1: Add failing Playwright assertions for the new interaction**

Extend the mocked workflow with assertions equivalent to:

```ts
await expect(page.getByTestId('focused-workspace')).toBeVisible();
await expect(page.getByTestId('evidence-primary')).toContainText('Official source');
await expect(page.getByTestId('evidence-alternatives')).toBeHidden();
await page.getByRole('button', { name: /More evidence/ }).click();
await expect(page.getByTestId('evidence-alternatives')).toBeVisible();
await page.getByRole('button', { name: 'Past cases' }).click();
await expect(page.getByTestId('past-cases')).toBeVisible();
```

- [ ] **Step 2: Run the focused browser test to verify it fails**

Run: `pnpm e2e tests/e2e/review-workflow.spec.ts`

Expected: FAIL because the current page is vertically stacked and has no structured evidence or drawer controls.

- [ ] **Step 3: Implement the two-pane workspace**

Refactor the rendered sections into a `focused-workspace` grid with the script editor on the left and `review-queue` on the right. Render `finding.evidence.primary` and `finding.evidence.rationale` by default. Render a native `<details>`/`<summary>` or equivalent accessible disclosure for `finding.evidence.alternatives`; keep alternatives hidden until opened. Render `no-source-state` when `primary` is null. Keep the existing Dismiss/Escalate actions and generic error copy.

- [ ] **Step 4: Implement the chronological drawer and responsive CSS**

Move the existing recent-case list behind `Past cases`, load it when the drawer opens, keep newest-first order from the API, and reuse `reopenCase` to restore script/findings/assets. Add keyboard-close behavior and an accessible dialog/drawer label. Update `styles.css` for a desktop grid, compact queue cards, drawer overlay, and a media query that stacks the panes below the desktop breakpoint.

- [ ] **Step 5: Run focused UI checks and existing workflow tests**

Run: `pnpm e2e tests/e2e/review-workflow.spec.ts` and `pnpm --filter @rightsrader/web typecheck`

Expected: PASS, including stale reopen/upload protections, reviewer status changes, asset reopening, primary evidence disclosure, no-source state, and chronological case reopening.

- [ ] **Step 6: Commit the Focused Canvas**

```bash
git add apps/web/components/script-review.tsx apps/web/app/styles.css tests/e2e/review-workflow.spec.ts
git commit -m "feat: add focused case review workspace"
```

### Task 7: Update documentation and run the complete verification matrix

**Files:**
- Modify: `README.md`
- Modify: `tests/e2e/review-workflow.spec.ts` (only if final acceptance coverage needs a missing state)

- [ ] **Step 1: Document the live mode and review behavior**

Update the setup section to state that `RIGHTSRADAR_MODE=cloud` uses Gemini Enterprise Agent Platform, Parallel Search, Firestore, and Cloud Storage; describe the primary/alternatives evidence view, no-source state, chronological `Past cases` drawer, and the opt-in real-cloud smoke requirement. Keep all credential values server-side.

- [ ] **Step 2: Run static checks**

Run: `make lint`, `make typecheck`, and `make check-client`.

Expected: PASS with no generated-client drift.

- [ ] **Step 3: Run unit and mocked browser checks**

Run: `make test` and `make e2e`.

Expected: PASS without requiring cloud credentials.

- [ ] **Step 4: Run the opt-in real-cloud smoke**

With the configured `.env` and ADC active, restart the API/web processes and submit one controlled excerpt containing a recognizable brand and quotation. Verify the response contains curated evidence or an explicit no-source state, confirm the case appears newest-first in `Past cases`, reopen it, and confirm reviewer status persistence. Do not print response bodies containing secrets or provider diagnostics.

- [ ] **Step 5: Commit documentation and final verification notes**

```bash
git add README.md tests/e2e/review-workflow.spec.ts
git commit -m "docs: describe curated cloud review workflow"
```

## Final handoff

After all tasks pass, report the exact test commands and outcomes, the real-cloud smoke case behavior, and any provider limitations. Leave unrelated untracked files (`mcp.json` and `.superpowers/`) untouched.
