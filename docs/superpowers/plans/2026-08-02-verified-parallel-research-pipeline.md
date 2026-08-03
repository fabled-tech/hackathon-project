# Verified Parallel Research Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Research independent rights-clearance leads concurrently, verify shortlisted Parallel Search results with Parallel Extract, and expose one Gemini-curated citation or a neutral no-source result.

**Architecture:** Convert the analysis providers and case-creation route to async interfaces. Gemini detection remains the single prerequisite; each detected lead then runs through a semaphore-bounded `Search -> Extract -> Gemini curation` coroutine. Results are gathered in detector order and the case is persisted only after every coroutine succeeds.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, `httpx.AsyncClient`, Google Gen AI SDK on Vertex AI, Parallel Search and Extract APIs, pytest, TypeScript, and the existing OpenAPI client generator.

## Global Constraints

- Default/mock mode must remain deterministic and make no network calls.
- RightsRadar remains research assistance and must not give legal advice or infringement conclusions.
- Parallel credentials and provider diagnostics remain server-only.
- `RIGHTSRADAR_PARALLEL_MAX_CONCURRENCY` defaults to `4` and accepts values from `1` through `16`.
- Search returns at most five unique URLs; Extract receives those URLs in one request and cannot introduce a new URL.
- An empty Search result is a valid no-source result; complete Extract failure and malformed/provider output are retryable failures.
- Preserve legacy `supporting_evidence` and `source_urls` fields while adding structured evidence.
- Use test-first red/green cycles and run the narrowest relevant test for every behavior.
- Do not provision Parallel Task API, Task Groups, webhooks, Cloud Tasks, or deployment resources in this milestone.

---

### Task 1: Structured evidence and provider errors

**Files:**
- Modify: `services/api/app/models/analysis.py`
- Modify: `services/api/app/models/cases.py`
- Modify: `services/api/app/models/__init__.py`
- Create: `services/api/app/errors.py`
- Create: `services/api/tests/test_analysis.py`

**Interfaces:**
- `EvidenceSelection(primary: Evidence | None = None, rationale: str | None = None, alternatives: list[Evidence] = [])`
- `EvidenceCurationDecision(primary_url: str | None, rationale: str | None)`
- `GeminiSignal.context_excerpt: str = ""`
- `SearchResult.publish_date: str | None = None`
- `Finding.evidence: EvidenceSelection`

- [ ] Write tests proving a new selection is neutral and a legacy finding maps old supporting evidence to alternatives without promoting a primary source.

```python
def test_legacy_finding_maps_old_evidence_to_neutral_alternatives() -> None:
    finding = Finding.model_validate(
        {
            "id": "finding-1",
            "case_id": "case-1",
            "category": "brand_reference",
            "detected_item": "Example Brand",
            "explanation": "A legacy finding.",
            "confidence": 0.5,
            "supporting_evidence": [
                {
                    "excerpt": "Archived evidence.",
                    "source": {"title": "Archive", "url": "https://source.test/archive"},
                }
            ],
            "source_urls": ["https://source.test/archive"],
            "retrieved_at": "2026-08-02T00:00:00Z",
            "reviewer_status": "pending",
        }
    )
    assert finding.evidence.primary is None
    assert finding.evidence.rationale is None
    assert finding.evidence.alternatives == finding.supporting_evidence
```

- [ ] Run `cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_analysis.py -q`; verify import/model failures.
- [ ] Add the models, compatibility validator, exports, and `AnalysisUnavailableError`, `AnalysisProviderError`, and `EvidenceCurationError`.

```python
class AnalysisUnavailableError(RuntimeError):
    """The requested analysis could not be completed safely."""


class AnalysisProviderError(AnalysisUnavailableError):
    """An upstream analysis provider failed."""


class EvidenceCurationError(AnalysisUnavailableError):
    """Evidence curation returned unusable structured output."""
```

- [ ] Re-run the focused tests and `tests/test_repositories.py`; verify green.

### Task 2: Async provider contracts and deterministic mocks

**Files:**
- Modify: `services/api/app/integrations/gemini.py`
- Modify: `services/api/app/integrations/parallel.py`
- Modify: `services/api/app/agents/service.py`
- Modify: `services/api/app/routes/cases.py`
- Modify: `services/api/tests/test_cases.py`

**Interfaces:**
- `GeminiClient.identify_material(...)` and `GeminiClient.curate_evidence(...)` become async.
- `ParallelSearchClient.search(...)` and `ParallelSearchClient.extract(...)` are async.
- `AgentService.analyze(...)` is async; `POST /api/cases` awaits it and thread-pools only synchronous repository persistence.

- [ ] Update the deterministic case-creation test to assert the returned mock evidence has a primary citation.

```python
assert all(finding["evidence"]["primary"] is not None for finding in case["findings"])
assert all(finding["evidence"]["rationale"] for finding in case["findings"])
```

- [ ] Run the focused case test and verify it fails because the existing route/provider path is synchronous and lacks structured evidence.
- [ ] Convert protocols, mocks, agent entry point, and route to async without changing real-provider behavior yet.

```python
class AgentService(Protocol):
    async def analyze(self, case_id: str, script_text: str) -> list[Finding]: ...


@router.post("", response_model=Case, status_code=status.HTTP_201_CREATED)
async def create_case(payload: CreateCaseRequest, request: Request) -> Case:
    case_id = str(uuid4())
    services = _services(request)
    findings = await services.agent_service.analyze(case_id, payload.script_text)
    case = Case(
        id=case_id,
        script_text=payload.script_text,
        created_at=datetime.now(UTC),
        findings=findings,
    )
    return await run_in_threadpool(services.case_repository.create, case)
```

- [ ] Re-run `tests/test_cases.py`, `tests/test_assets.py`, and `tests/test_case_routes.py`; verify green.

### Task 3: Contextual Parallel Search and batched Extract

**Files:**
- Modify: `services/api/app/config.py`
- Modify: `services/api/app/dependencies.py`
- Modify: `services/api/app/integrations/parallel.py`
- Create: `services/api/tests/test_integrations.py`

**Interfaces:**
- `ParallelSearchHttpClient(api_key, client_model, http_client=None)` reuses an injected or owned `httpx.AsyncClient`.
- `search(signal, session_id)` sends `mode="advanced"`, three concise queries, scene context, `client_model`, and `max_chars_total=8000`.
- `extract(signal, candidates, session_id)` sends all shortlisted URLs in one request using the same session and returns only successful shortlisted URLs.

- [ ] Add an `httpx.MockTransport` test whose Search response contains a duplicate URL and whose Extract response contains successful, failed, and unknown URLs; assert the outgoing payloads and final normalized result.

```python
def test_search_then_extract_reuses_session_and_restricts_urls() -> None:
    requests: list[dict[str, object]] = []

    async def scenario() -> tuple[list[SearchResult], list[SearchResult]]:
        async def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            requests.append(payload)
            if request.url.path.endswith("/search"):
                return httpx.Response(
                    200,
                    json={
                        "results": [
                            {"url": "https://source.test/a", "title": "A", "excerpts": ["A"]},
                            {"url": "https://source.test/a", "title": "A2", "excerpts": ["A2"]},
                            {"url": "https://source.test/b", "title": "B", "excerpts": ["B"]},
                        ]
                    },
                )
            return httpx.Response(
                200,
                json={
                    "results": [
                        {"url": "https://source.test/a", "title": "A", "excerpts": ["Verified A"]},
                        {"url": "https://unknown.test", "title": "Unknown", "excerpts": ["No"]},
                    ],
                    "errors": [{"url": "https://source.test/b", "error_type": "fetch_error"}],
                },
            )

        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = ParallelSearchHttpClient("secret", "gemini-2.5-flash", http_client=http)
        signal = GeminiSignal(
            category="brand_reference",
            detected_item="Example Brand",
            explanation="A named brand.",
            confidence=0.8,
            context_excerpt="An Example Brand can is visible.",
        )
        searched = await client.search(signal, "rightsrader:case-1:0")
        extracted = await client.extract(signal, searched, "rightsrader:case-1:0")
        await http.aclose()
        return searched, extracted

    searched, extracted = asyncio.run(scenario())
    assert [item.source.url for item in searched] == [
        "https://source.test/a",
        "https://source.test/b",
    ]
    assert [item.excerpt for item in extracted] == ["Verified A"]
    assert requests[0]["session_id"] == requests[1]["session_id"]
    assert requests[1]["urls"] == ["https://source.test/a", "https://source.test/b"]
```

- [ ] Run `tests/test_integrations.py`; verify failures for the missing async Search/Extract behavior.
- [ ] Implement query construction, safe JSON parsing, URL deduplication, five-result bounding, batched extraction, partial-success handling, and sanitized provider exceptions.
- [ ] Add and verify a test that all requested Extract URLs failing raises `AnalysisProviderError` without exposing response bodies or the API key.
- [ ] Run the integration tests and Ruff for the adapter.

### Task 4: Schema-constrained Vertex Gemini curation

**Files:**
- Modify: `services/api/app/integrations/gemini.py`
- Modify: `services/api/tests/test_integrations.py`

**Interfaces:**
- `VertexGeminiClient` accepts an optional injected Gen AI client for tests and uses `client.aio.models.generate_content`.
- Detection supplies `response_schema=list[GeminiSignal]`; curation supplies `response_schema=EvidenceCurationDecision`, both with `response_mime_type="application/json"`.
- Curation rejects any non-null URL outside the extracted candidate list.

- [ ] Add fake-client tests proving both calls use a response schema and curation rejects malformed JSON and unknown URLs.

```python
def test_vertex_curation_uses_schema_and_rejects_unknown_url() -> None:
    fake = FakeGenAIClient('{"primary_url":"https://unknown.test","rationale":"No."}')
    client = VertexGeminiClient("project", "global", "gemini-2.5-flash", client=fake)
    signal = GeminiSignal(
        category="quotation",
        detected_item="Example quote",
        explanation="A quotation.",
        confidence=0.7,
    )
    candidate = SearchResult(
        source=Source(title="Known", url="https://source.test/known"),
        excerpt="Known excerpt.",
    )
    with pytest.raises(EvidenceCurationError):
        asyncio.run(client.curate_evidence(signal, [candidate]))
    assert fake.last_config.response_schema is EvidenceCurationDecision
```

- [ ] Run the focused tests and verify missing async/schema behavior.
- [ ] Implement async Vertex calls, structured schemas, deterministic generation settings, sanitized provider errors, and curation validation.
- [ ] Re-run integration tests and type checking for the adapter.

### Task 5: Bounded concurrent lead pipelines

**Files:**
- Modify: `services/api/app/agents/service.py`
- Modify: `services/api/app/dependencies.py`
- Modify: `services/api/app/config.py`
- Modify: `services/api/tests/test_analysis.py`

**Interfaces:**
- `RightsClearanceAgentService(..., max_concurrency: int = 4)`.
- Each lead receives `rightsrader:{case_id}:{detector_index}` as its Search/Extract session ID.
- `asyncio.gather` preserves detector order while a semaphore bounds whole lead pipelines.

- [ ] Add a deterministic barrier-based test with three leads and concurrency `2`; assert observed concurrency is `2`, session IDs are distinct, and returned findings retain detector order.

```python
def test_lead_research_is_bounded_and_preserves_detector_order() -> None:
    parallel = BarrierParallel(expected_parallelism=2)
    service = RightsClearanceAgentService(ThreeLeadGemini(), parallel, max_concurrency=2)
    findings = asyncio.run(service.analyze("case-1", "A scene with three leads."))
    assert parallel.max_active == 2
    assert parallel.sessions == {
        "rightsrader:case-1:0",
        "rightsrader:case-1:1",
        "rightsrader:case-1:2",
    }
    assert [finding.detected_item for finding in findings] == ["Lead 1", "Lead 2", "Lead 3"]
```

- [ ] Run the focused test and verify the sequential implementation fails.
- [ ] Implement `Search -> Extract -> curation`, exact selected-URL validation, primary/alternatives construction, and no-source behavior inside the semaphore.
- [ ] Add tests proving one provider failure yields no partial case and the HTTP route returns the fixed safe `503` response.
- [ ] Run analysis and case-route tests.

### Task 6: Generated API contract and documentation

**Files:**
- Modify: `apps/web/tests/api-client.test.ts`
- Generate: `packages/api-client/src/generated.ts`
- Modify: `README.md`
- Modify: `.env.example`

- [ ] Add a client test that reads `finding.evidence.primary`, `rationale`, and `alternatives` from a mocked create-case response.

```typescript
const result = await createCase(
  { script_text: 'An Example Brand can appears.' },
  'http://api.test',
  fetcher
);
expect(result.findings[0].evidence.primary?.source.url).toBe('https://source.test/a');
expect(result.findings[0].evidence.rationale).toContain('relevant');
expect(result.findings[0].evidence.alternatives).toEqual([]);
```

- [ ] Run `pnpm exec vitest run apps/web/tests/api-client.test.ts`; verify the generated type lacks `evidence`.
- [ ] Run `make generate-client`; inspect the generated type and re-run the client test plus `make check-client`.
- [ ] Document Search, Extract, bounded concurrency, no-source behavior, and the new environment setting without exposing credentials.

### Task 7: Full verification

- [ ] Run `make lint`.
- [ ] Run `make typecheck`.
- [ ] Run `make check-client`.
- [ ] Run `make test`.
- [ ] Run `make e2e`.
- [ ] Inspect `git diff --check`, `git status --short`, and the final branch diff; leave unrelated files untouched.
