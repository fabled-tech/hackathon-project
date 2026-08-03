# FAB-9: Single ADK-powered rights research agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace real direct Gemini orchestration with one Google ADK Gemini agent that uses Parallel Search as its function tool, while preserving mock mode and research-only output.

**Architecture:** AdkRightsResearchAgentService implements the existing synchronous AgentService protocol. For each real-Gemini analysis it creates one native ADK LlmAgent and one in-memory session, exposes the existing ParallelSearchClient through a single search_parallel function tool, validates final JSON text, and derives every saved citation from recorded tool results. The existing deterministic Gemini/Parallel service remains the mock-Gemini implementation.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic 2, Google ADK 2.x, Google Gen AI SDK / Vertex AI, Parallel Search HTTP API, pytest, Ruff, mypy, pnpm/Vitest.

## Global Constraints

- Build from codex/curated-evidence-focused-workspace on branch patrick/fab-9-add-a-single-adk-powered-rights-research-agent.
- Preserve AgentService.analyze(case_id: str, script_text: str) -> list[Finding] and the existing API/OpenAPI schema.
- A real-Gemini invocation uses exactly one ADK LlmAgent, one search_parallel function tool, and no subagents, transfers, persistent sessions, memory service, or chat history.
- Reuse the configured Gemini Enterprise Agent Platform (Vertex AI) project, location, and Gemini model; do not introduce browser-visible credentials or new environment variables.
- Keep mock mode deterministic and independent of ADK, Gemini, cloud credentials, and network access.
- Make every persisted source title, URL, excerpt, primary citation, alternative, timestamp, ID, and reviewer status server-derived from a matching Parallel tool result.
- Never persist legal advice or conclusions about infringement, ownership, registration, trademark validity, permission, licensing, fair use, clearance, legal risk, or what may legally be released.
- Do not use ADK output_schema for this function-tool workflow. Require JSON-only final text and validate it with Pydantic after the final ADK event.
- Wrap provider, tool, parsing, provenance, and safety failures in AnalysisUnavailableError; do not expose raw provider diagnostics, script content, API keys, or credentials.
- Keep case creation all-or-nothing: no partially analyzed case is saved.

---

## File structure

| File | Responsibility |
| --- | --- |
| services/api/app/agents/adk.py | New real-Gemini AgentService, transient Pydantic response models, research-boundary validator, Parallel tool closure, and native ADK invocation adapter. |
| services/api/app/agents/service.py | Existing deterministic Gemini/Parallel orchestration retained for mock-Gemini mode only. |
| services/api/app/agents/__init__.py | Publicly export both services and AgentService. |
| services/api/app/dependencies.py | Select ADK service whenever Gemini is real; retain deterministic service whenever Gemini is mock. |
| services/api/app/integrations/gemini.py | Keep mock detector/curator protocol; remove direct Vertex request implementation. |
| services/api/app/integrations/__init__.py | Stop exporting VertexGeminiClient. |
| services/api/app/errors.py | Add a safe analysis-unavailable subtype for research-boundary failures. |
| services/api/pyproject.toml and uv.lock | Add Google ADK to cloud dependencies and resolve lockfile. |
| services/api/tests/test_adk_agent.py | ADK response, single-agent/tool shape, provenance, guardrail, and multi-finding tests. |
| services/api/tests/test_dependencies.py | Cloud, hybrid, and mock mode-selection tests. |
| services/api/tests/test_integrations.py | Remove direct Vertex tests; retain mock Gemini and Parallel coverage. |
| .env.example and README.md | Describe the ADK + Parallel workflow without changing credentials or legal boundaries. |

## Interfaces introduced by this plan

~~~python
class AdkInvocation(Protocol):
    def run(self, script_text: str) -> str: ...


class AdkRightsResearchAgentService:
    def __init__(
        self,
        *,
        project: str,
        location: str,
        model: str,
        parallel_search: ParallelSearchClient,
        invocation_factory: Callable[
            [str, str, str, Callable[[str, str, str, str], dict[str, object]]],
            AdkInvocation,
        ] = NativeAdkInvocation,
    ) -> None: ...

    def analyze(self, case_id: str, script_text: str) -> list[Finding]: ...


class AdkFindingResponse(BaseModel):
    research_id: str
    category: str
    detected_item: str
    context_excerpt: str = ""
    explanation: str
    confidence: float
    primary_url: str | None = None
    rationale: str | None = None


class AdkAnalysisResponse(BaseModel):
    findings: list[AdkFindingResponse]


def _final_response_text(events: Iterable[object]) -> str: ...
~~~

NativeAdkInvocation receives the tool closure during construction. Its run method creates InMemorySessionService, one LlmAgent, and a Runner; it creates UUID session data and returns final-response text. The service records tool results outside model text and maps a validated AdkAnalysisResponse to the current Finding model.

### Task 1: Define the transient response contract and research-assistance safety boundary

**Files:**
- Create: services/api/app/agents/adk.py
- Modify: services/api/app/errors.py
- Test: services/api/tests/test_adk_agent.py

**Interfaces:**
- Consumes: Evidence, EvidenceSelection, Finding, ReviewerStatus, SearchResult, and AnalysisUnavailableError.
- Produces: AdkAnalysisResponse, AdkFindingResponse, ResearchBoundaryError, and ensure_research_assistance_text for Task 2.

- [ ] **Step 1: Write the failing response-contract and safety tests**

~~~python
def test_adk_response_requires_a_rationale_for_a_primary_url() -> None:
    with pytest.raises(ValidationError):
        AdkFindingResponse.model_validate(
            {
                "research_id": "lead-1",
                "category": "brand_reference",
                "detected_item": "Example Brand",
                "explanation": "A possible research lead for human review.",
                "confidence": 0.8,
                "primary_url": "https://source.test/known",
                "rationale": "  ",
            }
        )


@pytest.mark.parametrize(
    "text",
    [
        "This use is infringing.",
        "The production is cleared to release it.",
        "You may legally use this quotation.",
        "The mark is registered.",
        "The studio owns the copyright.",
        "This is a valid trademark.",
        "The scene is fair use.",
    ],
)
def test_research_assistance_validator_rejects_legal_conclusions(text: str) -> None:
    with pytest.raises(ResearchBoundaryError):
        ensure_research_assistance_text(text)
~~~

- [ ] **Step 2: Run the focused test to verify it fails**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_adk_agent.py -q

Expected: FAIL because the response models, validator, and error do not exist.

- [ ] **Step 3: Add the minimal models and safe error type**

In app/errors.py add:

~~~python
class ResearchBoundaryError(AnalysisUnavailableError):
    """Agent output exceeded RightsRadar's research-assistance boundary."""
~~~

In app/agents/adk.py add the response models. A primary URL requires a nonblank rationale, and duplicate research IDs are invalid:

~~~python
class AdkFindingResponse(BaseModel):
    research_id: str = Field(min_length=1)
    category: str = Field(min_length=1)
    detected_item: str = Field(min_length=1)
    context_excerpt: str = ""
    explanation: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    primary_url: str | None = None
    rationale: str | None = None

    @model_validator(mode="after")
    def require_rationale_for_primary(self) -> Self:
        if self.primary_url is not None and not (self.rationale or "").strip():
            raise ValueError("rationale is required when primary_url is selected")
        return self


class AdkAnalysisResponse(BaseModel):
    findings: list[AdkFindingResponse] = Field(default_factory=list)

    @model_validator(mode="after")
    def reject_duplicate_research_ids(self) -> Self:
        research_ids = [item.research_id for item in self.findings]
        if len(research_ids) != len(set(research_ids)):
            raise ValueError("research_id values must be unique")
        return self
~~~

Add a small explicit case-insensitive pattern list. Reject output rather than rewriting it:

~~~python
_PROHIBITED_RESEARCH_CONCLUSIONS = (
    re.compile(r"\b(?:is|are|was|were)\s+(?:an?\s+)?(?:infringement|infringing)\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:not\s+)?(?:cleared|licensed|permitted)\b", re.I),
    re.compile(
        r"\b(?:you|the production)\s+(?:may|can|cannot|should)\s+"
        r"(?:legally\s+)?(?:use|publish|release|distribute)\b",
        re.I,
    ),
    re.compile(r"\b(?:is|are|was|were)\s+(?:un)?registered\b", re.I),
    re.compile(r"\b(?:owns?|owned by|has rights to)\b", re.I),
    re.compile(r"\b(?:qualifies?|does not qualify)\s+as\s+fair use\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:a\s+)?fair use\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:a\s+)?(?:valid|invalid)\s+trademark\b", re.I),
    re.compile(r"\b(?:no|low|high)\s+legal risk\b", re.I),
)


def ensure_research_assistance_text(*texts: str | None) -> None:
    if any(pattern.search(text or "") for pattern in _PROHIBITED_RESEARCH_CONCLUSIONS for text in texts):
        raise ResearchBoundaryError("Agent output did not remain within research assistance.")
~~~

- [ ] **Step 4: Run the focused test to verify it passes**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_adk_agent.py -q

Expected: PASS; empty/no-source output remains valid while blank primary rationales and legal conclusions are rejected.

- [ ] **Step 5: Commit the tested boundary**

~~~bash
git add services/api/app/agents/adk.py services/api/app/errors.py services/api/tests/test_adk_agent.py
git commit -m "test: define ADK research response guardrails"
~~~

### Task 2: Implement one native ADK invocation and the Parallel Search function tool

**Files:**
- Modify: services/api/app/agents/adk.py
- Modify: services/api/pyproject.toml
- Modify: uv.lock
- Test: services/api/tests/test_adk_agent.py

**Interfaces:**
- Consumes: Task 1 models/validator, ParallelSearchClient.search(), and server-only Vertex configuration.
- Produces: NativeAdkInvocation, AdkRightsResearchAgentService, and one automatic ADK function tool named search_parallel.

- [ ] **Step 1: Add failing service tests using a fake invocation**

Use a fake invocation so output and provenance tests never call Gemini. Define the complete fixtures in the new test module:

~~~python
import json
from collections.abc import Callable
from types import SimpleNamespace


def _candidate(detected_item: str) -> SearchResult:
    slug = detected_item.casefold().replace(" ", "-")
    return SearchResult(
        source=Source(title=detected_item, url=f"https://source.test/{slug}"),
        excerpt=f"Traceable research excerpt for {detected_item}.",
    )


class StubParallel:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def search(
        self, detected_item: str, category: str, context_excerpt: str = ""
    ) -> list[SearchResult]:
        self.calls.append((detected_item, category, context_excerpt))
        return [_candidate(detected_item)]


class ToolCallingFakeInvocation:
    def __init__(
        self,
        tool: Callable[[str, str, str, str], dict[str, object]],
        calls: list[tuple[str, str, str, str]],
        response_text: str,
    ) -> None:
        self._tool = tool
        self._calls = calls
        self._response_text = response_text

    def run(self, script_text: str) -> str:
        del script_text
        for call in self._calls:
            self._tool(*call)
        return self._response_text


def _service(
    response_text: str,
    calls: list[tuple[str, str, str, str]],
    parallel: StubParallel,
) -> AdkRightsResearchAgentService:
    return AdkRightsResearchAgentService(
        project="project",
        location="global",
        model="gemini-2.5-flash",
        parallel_search=parallel,
        invocation_factory=lambda _project, _location, _model, tool: ToolCallingFakeInvocation(
            tool, calls, response_text
        ),
    )


def test_adk_service_builds_multiple_findings_from_matching_tool_results() -> None:
    parallel = StubParallel()
    service = _service(
        json.dumps(
            {
                "findings": [
                    {
                        "research_id": "lead-1",
                        "category": "brand_reference",
                        "detected_item": "Example Brand",
                        "explanation": "A named item for human research review.",
                        "confidence": 0.8,
                        "primary_url": "https://source.test/example-brand",
                        "rationale": "This retrieved source directly names the item.",
                    },
                    {
                        "research_id": "lead-2",
                        "category": "quotation",
                        "detected_item": "Example Quote",
                        "explanation": "A distinctive phrase for human research review.",
                        "confidence": 0.7,
                        "primary_url": None,
                        "rationale": None,
                    },
                ]
            }
        ),
        [
            ("lead-1", "Example Brand", "brand_reference", "The can is visible."),
            ("lead-2", "Example Quote", "quotation", "The phrase is spoken."),
        ],
        parallel,
    )

    findings = service.analyze("case-1", "A script.")

    assert len(findings) == 2
    assert all(item.case_id == "case-1" for item in findings)
    assert findings[0].evidence.primary is not None
    assert findings[1].evidence.primary is None
    assert parallel.calls == [
        ("Example Brand", "brand_reference", "The can is visible."),
        ("Example Quote", "quotation", "The phrase is spoken."),
    ]


def test_adk_service_rejects_a_url_not_returned_by_that_research_id() -> None:
    service = _service(
        json.dumps(
            {
                "findings": [
                    {
                        "research_id": "lead-1",
                        "category": "brand_reference",
                        "detected_item": "Example Brand",
                        "explanation": "A research lead.",
                        "confidence": 0.8,
                        "primary_url": "https://invented.test",
                        "rationale": "This is not a retrieved result.",
                    }
                ]
            }
        ),
        [("lead-1", "Example Brand", "brand_reference", "The can is visible.")],
        StubParallel(),
    )

    with pytest.raises(AnalysisUnavailableError):
        service.analyze("case-1", "A script.")
~~~

Add these concrete tests in the same module:

~~~python
@pytest.mark.parametrize(
    "response_text",
    [
        "not json",
        json.dumps(
            {
                "findings": [
                    {
                        "research_id": "unknown",
                        "category": "brand_reference",
                        "detected_item": "Example Brand",
                        "explanation": "A research lead.",
                        "confidence": 0.8,
                        "primary_url": None,
                        "rationale": None,
                    }
                ]
            }
        ),
        json.dumps(
            {
                "findings": [
                    {
                        "research_id": "lead-1",
                        "category": "brand_reference",
                        "detected_item": "Example Brand",
                        "explanation": "This use is infringing.",
                        "confidence": 0.8,
                        "primary_url": None,
                        "rationale": None,
                    }
                ]
            }
        ),
    ],
)
def test_adk_service_rejects_invalid_or_non_research_output(response_text: str) -> None:
    service = _service(
        response_text,
        [("lead-1", "Example Brand", "brand_reference", "The can is visible.")],
        StubParallel(),
    )

    with pytest.raises(AnalysisUnavailableError):
        service.analyze("case-1", "A script.")


def test_adk_service_rejects_duplicate_tool_research_ids() -> None:
    service = _service(
        json.dumps({"findings": []}),
        [
            ("lead-1", "Example Brand", "brand_reference", "One."),
            ("lead-1", "Example Brand", "brand_reference", "Two."),
        ],
        StubParallel(),
    )

    with pytest.raises(AnalysisUnavailableError):
        service.analyze("case-1", "A script.")
~~~

Also make final-event extraction independently testable rather than attempting a provider call:

~~~python
class FakeEvent:
    def __init__(self, final: bool, text: str | None) -> None:
        self._final = final
        self.content = SimpleNamespace(
            parts=[] if text is None else [SimpleNamespace(text=text)]
        )

    def is_final_response(self) -> bool:
        return self._final


def test_final_response_text_rejects_a_runner_without_final_text() -> None:
    with pytest.raises(AnalysisUnavailableError):
        _final_response_text([FakeEvent(final=False, text="intermediate")])
~~~

- [ ] **Step 2: Run focused service tests to verify they fail**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run python -m pytest tests/test_adk_agent.py -q

Expected: FAIL because the ADK service and invocation seam do not exist.

- [ ] **Step 3: Add ADK to the cloud-only dependency group and resolve**

Update services/api/pyproject.toml without adding ADK to base dependencies:

~~~toml
[dependency-groups]
cloud = [
  "google-adk>=2.6,<3",
  "google-cloud-firestore>=2.20,<3",
  "google-cloud-storage>=2.19,<4",
  "google-genai>=2.9,<3",
]
~~~

Run: UV_CACHE_DIR=.uv-cache uv lock

Expected: uv.lock records google-adk and the ADK-required Google Gen AI SDK 2.x range. The mock-only dependency set stays free of Google ADK.

- [ ] **Step 4: Implement NativeAdkInvocation**

Keep Google ADK imports inside the real invocation constructor so importing mock-mode services does not require the cloud package. Construct exactly one LlmAgent, no sub_agents, and a Vertex-backed Gemini model:

~~~python
class NativeAdkInvocation:
    def __init__(
        self,
        project: str,
        location: str,
        model: str,
        search_parallel: Callable[[str, str, str, str], dict[str, object]],
    ) -> None:
        from google.adk.agents import LlmAgent
        from google.adk.models.google_llm import Gemini

        self._agent = LlmAgent(
            name="rights_research_agent",
            model=Gemini(
                model=model,
                client_kwargs={"vertexai": True, "project": project, "location": location},
            ),
            instruction=_RESEARCH_AGENT_INSTRUCTION,
            tools=[search_parallel],
            disallow_transfer_to_parent=True,
            disallow_transfer_to_peers=True,
        )
~~~

In run(), import InMemorySessionService, Runner, and google.genai.types locally. Create UUID user/session IDs, create the session, call synchronous Runner.run(), scan event.is_final_response(), and return final text. Raise AnalysisUnavailableError if no final response has text. Synchronous Runner.run() matches the current synchronous AgentService and FastAPI route.

Implement a small _final_response_text(events) helper that accepts the yielded event iterable, selects the final event whose first content part has nonblank text, and otherwise raises AnalysisUnavailableError. NativeAdkInvocation.run() delegates to this helper. Add a read-only agent property solely to support the no-network shape test.

The instruction must include these exact operational constraints:

~~~text
You are RightsRadar's single research-assistance agent. Identify possible research leads only.
Use search_parallel before citing a source. Return JSON only with a findings array.
Each finding must reference exactly one research_id produced by search_parallel.
primary_url may only be a URL returned for that research_id; otherwise use null.
Do not give legal advice or state conclusions about infringement, ownership, registration,
validity, permission, licensing, fair use, clearance, legal risk, or what anyone may release.
~~~

- [ ] **Step 5: Implement the tool ledger and server-side Finding construction**

Create a fresh result map in each analyze call. The function given to ADK must retain this narrow schema and docstring:

~~~python
def search_parallel(
    research_id: str,
    detected_item: str,
    category: str,
    context_excerpt: str,
) -> dict[str, object]:
    """Retrieve traceable research sources for one possible rights research lead."""
    if research_id in results_by_research_id:
        raise AnalysisUnavailableError("Agent reused a research identifier.")
    results = self._parallel_search.search(detected_item, category, context_excerpt)
    results_by_research_id[research_id] = results
    return {
        "research_id": research_id,
        "candidates": [
            {"title": item.source.title, "url": item.source.url, "excerpt": item.excerpt}
            for item in results
        ],
    }
~~~

After AdkAnalysisResponse.model_validate_json(final_text), validate every explanation/rationale with ensure_research_assistance_text. For every response, require its research ID in the ledger; create Evidence from only that list of SearchResult; resolve a non-null primary URL from only that list; set alternatives to the remaining evidence; generate UUID IDs, UTC retrieval time, ReviewerStatus.PENDING, and source_urls server-side. Catch unexpected exceptions and raise AnalysisUnavailableError("RightsRadar analysis failed.").

- [ ] **Step 6: Add a no-network native-shape test**

Use installed ADK classes only for construction, never run():

~~~python
def test_native_adk_invocation_has_one_agent_and_one_parallel_tool() -> None:
    def search_parallel(
        research_id: str, detected_item: str, category: str, context_excerpt: str
    ) -> dict[str, object]:
        """Retrieve traceable research sources for one possible rights research lead."""
        del research_id, detected_item, category, context_excerpt
        return {"research_id": "lead-1", "candidates": []}

    invocation = NativeAdkInvocation(
        "project", "global", "gemini-2.5-flash", search_parallel
    )

    assert invocation.agent.name == "rights_research_agent"
    assert invocation.agent.sub_agents == []
    assert [tool.__name__ for tool in invocation.agent.tools] == ["search_parallel"]
~~~

Expose agent through a read-only test-only property if needed; do not add it to AgentService.

- [ ] **Step 7: Run focused ADK tests to verify they pass**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run --group cloud python -m pytest tests/test_adk_agent.py -q

Expected: PASS without credentials, network calls, or direct Vertex generate_content mocks.

- [ ] **Step 8: Commit the native service**

~~~bash
git add services/api/app/agents/adk.py services/api/pyproject.toml uv.lock services/api/tests/test_adk_agent.py
git commit -m "feat: add single ADK rights research agent"
~~~

### Task 3: Wire the service behind AgentService and remove real direct Gemini orchestration

**Files:**
- Modify: services/api/app/dependencies.py
- Modify: services/api/app/agents/__init__.py
- Modify: services/api/app/integrations/gemini.py
- Modify: services/api/app/integrations/__init__.py
- Create: services/api/tests/test_dependencies.py
- Modify: services/api/tests/test_integrations.py

**Interfaces:**
- Consumes: Settings.selected_mode(), IntegrationMode, AdkRightsResearchAgentService, RightsClearanceAgentService, MockGeminiClient, and ParallelSearchClient.
- Produces: mode-specific ApplicationServices.agent_service without a VertexGeminiClient real path.

- [ ] **Step 1: Write failing dependency-selection tests**

~~~python
def test_cloud_mode_uses_the_single_adk_agent_service() -> None:
    services = build_services(
        Settings(
            mode=EnvironmentMode.CLOUD,
            google_cloud_project="project",
            cloud_storage_bucket="bucket",
            parallel_api_key="parallel-key",
        )
    )

    assert isinstance(services.agent_service, AdkRightsResearchAgentService)


def test_hybrid_real_gemini_uses_adk_with_mock_parallel() -> None:
    services = build_services(
        Settings(
            mode=EnvironmentMode.HYBRID,
            gemini_mode=IntegrationMode.REAL,
            parallel_mode=IntegrationMode.MOCK,
            google_cloud_project="project",
        )
    )

    assert isinstance(services.agent_service, AdkRightsResearchAgentService)


def test_mock_gemini_keeps_the_deterministic_service() -> None:
    services = build_services(Settings())

    assert isinstance(services.agent_service, RightsClearanceAgentService)
~~~

- [ ] **Step 2: Run wiring tests to verify they fail**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run --group cloud python -m pytest tests/test_dependencies.py -q

Expected: FAIL because dependencies still instantiate VertexGeminiClient and have no ADK service selection.

- [ ] **Step 3: Change wiring without changing repository-mode behavior**

Build the configured Parallel adapter first. Select the service from the selected Gemini mode:

~~~python
parallel = (
    ParallelSearchHttpClient(
        api_key=_require(settings.parallel_api_key, "RIGHTSRADAR_PARALLEL_API_KEY")
    )
    if settings.selected_mode(settings.parallel_mode) is IntegrationMode.REAL
    else MockParallelSearchClient()
)

if settings.selected_mode(settings.gemini_mode) is IntegrationMode.REAL:
    agent_service: AgentService = AdkRightsResearchAgentService(
        project=_require(settings.google_cloud_project, "RIGHTSRADAR_GOOGLE_CLOUD_PROJECT"),
        location=settings.google_cloud_location,
        model=settings.gemini_model,
        parallel_search=parallel,
    )
else:
    agent_service = RightsClearanceAgentService(MockGeminiClient(), parallel)
~~~

Leave build_repositories unchanged.

- [ ] **Step 4: Remove only obsolete real direct Gemini code**

Delete VertexGeminiClient and its direct google.genai JSON request code from integrations/gemini.py. Keep GeminiClient and MockGeminiClient for the deterministic service. Remove the Vertex export from integrations/__init__.py, export AdkRightsResearchAgentService from agents/__init__.py, and remove direct Vertex tests/imports from test_integrations.py.

Do not remove GeminiSignal, EvidenceCurationDecision, or mock-curator tests; they preserve mock behavior.

- [ ] **Step 5: Run affected test groups to verify they pass**

Run: cd services/api && UV_CACHE_DIR=../../.uv-cache uv run --group cloud python -m pytest tests/test_dependencies.py tests/test_integrations.py tests/test_analysis.py tests/test_cases.py -q

Expected: PASS; no application/test source references VertexGeminiClient and mock case creation remains deterministic.

- [ ] **Step 6: Commit the mode wiring migration**

~~~bash
git add services/api/app/dependencies.py services/api/app/agents/__init__.py services/api/app/integrations/gemini.py services/api/app/integrations/__init__.py services/api/tests/test_dependencies.py services/api/tests/test_integrations.py
git commit -m "feat: route real Gemini analysis through ADK"
~~~

### Task 4: Document and verify the completed contract

**Files:**
- Modify: .env.example
- Modify: README.md
- Modify: docs/superpowers/specs/2026-08-02-fab-9-single-adk-rights-research-agent-design.md only if implementation uncovers a material approved-design correction
- Test: all API, web, generated-client, build, and mocked e2e checks

**Interfaces:**
- Consumes: completed mode wiring and public runtime guidance.
- Produces: accurate cloud-mode documentation and verified unchanged public API behavior.

- [ ] **Step 1: Update cloud-mode prose**

In .env.example and README.md, retain existing environment variables and state:

~~~text
Cloud mode uses one native Google ADK Gemini research agent on Vertex AI.
Parallel Search is that agent's traceable research tool. The agent returns research leads for
human review only; it does not provide legal advice or make infringement or clearance determinations.
Mock mode remains deterministic and makes no cloud or network request.
~~~

Remove language that says direct Gemini requests separately identify and curate leads. Do not claim a citation proves rights status.

- [ ] **Step 2: Run source, lint, and type checks**

Run:

~~~bash
rg -n "VertexGeminiClient|generate_content\(" services/api/app services/api/tests
make lint
make typecheck
~~~

Expected: the search has no direct-Vertex application/test reference; lint and mypy pass.

- [ ] **Step 3: Run full mock-safe automated verification**

Run:

~~~bash
make test
make check-client
make build
make e2e
~~~

Expected: API tests, Vitest, generated-client freshness, production builds, and mocked Playwright pass. Do not call real cloud analysis automatically.

- [ ] **Step 4: Perform an opt-in cloud smoke only with configured server-side credentials**

Restart the API in cloud mode, submit a controlled excerpt with a recognizable brand and quotation, and confirm any saved finding is a research lead with only Parallel-derived evidence. Confirm neutral no-source is allowed and no UI copy makes legal conclusions. Do not paste prompts, provider payloads, credentials, or provider errors into logs, commits, or tickets.

- [ ] **Step 5: Commit documentation changes**

~~~bash
git add .env.example README.md
git commit -m "docs: describe ADK research workflow"
~~~

If no documentation changes remain, skip this commit rather than creating an empty one.

## Final review checklist

- [ ] git diff codex/curated-evidence-focused-workspace...HEAD --check has no whitespace errors.
- [ ] git status --short is clean.
- [ ] rg -n "VertexGeminiClient" services/api has no application or test reference.
- [ ] Cloud and hybrid real-Gemini wiring select AdkRightsResearchAgentService; mock Gemini remains deterministic.
- [ ] One native LlmAgent has one search_parallel function tool and no subagents.
- [ ] Every selected URL is rejected unless it comes from the matching recorded Parallel tool result.
- [ ] Blank-primary rationales, malformed JSON, duplicate/unknown research IDs, missing final response, and legal-conclusion language fail safely before persistence.
- [ ] The full mock-safe quality suite passes; a real smoke is explicit and credentials remain private.
