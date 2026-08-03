import json
from collections.abc import Callable
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.agents.adk import (
    AdkAnalysisResponse,
    AdkFindingResponse,
    AdkRightsResearchAgentService,
    NativeAdkInvocation,
    _final_response_text,
    ensure_research_assistance_text,
)
from app.errors import AnalysisUnavailableError, ResearchBoundaryError
from app.models import Source
from app.models.analysis import SearchResult


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


@pytest.mark.parametrize(
    ("category", "detected_item"),
    [
        ("quotation", "Example Brand"),
        ("brand_reference", "Different Brand"),
    ],
)
def test_adk_service_rejects_identity_not_matching_the_tool_call(
    category: str, detected_item: str
) -> None:
    service = _service(
        json.dumps(
            {
                "findings": [
                    {
                        "research_id": "lead-1",
                        "category": category,
                        "detected_item": detected_item,
                        "explanation": "A research lead.",
                        "confidence": 0.8,
                        "primary_url": None,
                        "rationale": None,
                    }
                ]
            }
        ),
        [("lead-1", "Example Brand", "brand_reference", "The can is visible.")],
        StubParallel(),
    )

    with pytest.raises(AnalysisUnavailableError):
        service.analyze("case-1", "A script.")


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
    assert [getattr(tool, "__name__", None) for tool in invocation.agent.tools] == [
        "search_parallel"
    ]


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


def test_adk_response_rejects_duplicate_research_ids() -> None:
    with pytest.raises(ValidationError):
        AdkAnalysisResponse.model_validate(
            {
                "findings": [
                    _finding_response("lead-1"),
                    _finding_response("lead-1"),
                ]
            }
        )


def test_adk_response_accepts_empty_findings() -> None:
    assert AdkAnalysisResponse().findings == []


def test_adk_finding_accepts_a_neutral_no_primary_response() -> None:
    response = AdkFindingResponse.model_validate(_finding_response("lead-1"))

    assert response.primary_url is None
    assert response.rationale is None


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
        "Permission is required.",
        "Licensing is not needed.",
        "The work violates copyright.",
        "Registration is confirmed.",
        "Release is legally allowed.",
        "This is high legal risk.",
    ],
)
def test_research_assistance_validator_rejects_legal_conclusions(text: str) -> None:
    with pytest.raises(ResearchBoundaryError):
        ensure_research_assistance_text(text)


def _finding_response(research_id: str) -> dict[str, object]:
    return {
        "research_id": research_id,
        "category": "brand_reference",
        "detected_item": "Example Brand",
        "explanation": "A possible research lead for human review.",
        "confidence": 0.8,
    }
