import json
import logging
from collections.abc import Callable
from types import SimpleNamespace

import pytest
from google.adk.models.base_llm import BaseLlm
from pydantic import PrivateAttr, ValidationError

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

    findings = service.analyze(
        "case-1", "Example Brand appears and Example Quote is spoken."
    )

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
        service.analyze("case-1", "Example Brand appears in this script.")


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
        service.analyze(
            "case-1", "Example Brand and Different Brand appear in this script."
        )


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
        service.analyze("case-1", "Example Brand appears in this script.")


@pytest.mark.parametrize(
    ("field", "unsafe_text"),
    [
        ("category", "definitely_infringing"),
        ("detected_item", "This use infringes copyright."),
        ("explanation", "Clearance is required before release."),
        ("rationale", "You need permission to use this quotation."),
        ("detected_item", "The copyright belongs to the studio."),
        ("explanation", "Permission must be obtained before release."),
        ("rationale", "The studio holds the copyright."),
        ("detected_item", "This likely infringes the studio's copyright."),
        ("explanation", "Clearance must be secured before distribution."),
        ("detected_item", "The studio is the copyright owner."),
        ("rationale", "The copyright is held by the studio."),
        ("explanation", "Approval must be obtained before release."),
        ("detected_item", "This violates the studio's IP rights."),
    ],
)
def test_adk_service_rejects_legal_conclusions_in_every_displayed_field(
    field: str, unsafe_text: str
) -> None:
    finding = {
        "research_id": "lead-1",
        "category": "brand_reference",
        "detected_item": "Example Brand",
        "explanation": "A possible research lead for human review.",
        "confidence": 0.8,
        "primary_url": None,
        "rationale": None,
    }
    finding[field] = unsafe_text
    service = _service(
        json.dumps({"findings": [finding]}),
        [
            (
                "lead-1",
                str(finding["detected_item"]),
                str(finding["category"]),
                "A scene excerpt.",
            )
        ],
        StubParallel(),
    )

    with pytest.raises(AnalysisUnavailableError):
        service.analyze(
            "case-1", f"The submitted script contains {finding['detected_item']}"
        )


@pytest.mark.parametrize("field", ["explanation", "rationale"])
@pytest.mark.parametrize(
    "unretrieved_url",
    [
        "https://invented.test/claim",
        "invented.test/claim",
        "//invented.test/claim",
        "ftp://invented.test/claim",
        "203.0.113.10/claim",
        "8.8.8.8/claim",
        "1.1.1.1",
        "[2001:db8::1]/claim",
        "[::1]/claim",
        "invented.测试/claim",
    ],
)
def test_adk_service_rejects_unretrieved_urls_in_model_authored_text(
    field: str, unretrieved_url: str
) -> None:
    finding = {
        "research_id": "lead-1",
        "category": "brand_reference",
        "detected_item": "Example Brand",
        "explanation": "A possible research lead for human review.",
        "confidence": 0.8,
        "primary_url": None,
        "rationale": None,
    }
    finding[field] = f"Review the invented source at {unretrieved_url}."
    service = _service(
        json.dumps({"findings": [finding]}),
        [("lead-1", "Example Brand", "brand_reference", "A scene excerpt.")],
        StubParallel(),
    )

    with pytest.raises(AnalysisUnavailableError):
        service.analyze("case-1", "Example Brand appears in this script.")


def test_adk_service_allows_a_retrieved_url_in_model_authored_text() -> None:
    service = _service(
        json.dumps(
            {
                "findings": [
                    {
                        "research_id": "lead-1",
                        "category": "brand_reference",
                        "detected_item": "Example Brand",
                        "explanation": (
                            "A research lead backed by "
                            "https://source.test/example-brand for human review."
                        ),
                        "confidence": 0.8,
                        "primary_url": None,
                        "rationale": None,
                    }
                ]
            }
        ),
        [("lead-1", "Example Brand", "brand_reference", "A scene excerpt.")],
        StubParallel(),
    )

    findings = service.analyze("case-1", "Example Brand appears in this script.")

    assert len(findings) == 1


def test_adk_service_rejects_a_detected_item_not_grounded_in_the_script() -> None:
    service = _service(
        json.dumps(
            {
                "findings": [
                    {
                        "research_id": "lead-1",
                        "category": "brand_reference",
                        "detected_item": "Invented Brand",
                        "explanation": "A possible research lead for human review.",
                        "confidence": 0.8,
                        "primary_url": None,
                        "rationale": None,
                    }
                ]
            }
        ),
        [("lead-1", "Invented Brand", "brand_reference", "A scene excerpt.")],
        StubParallel(),
    )

    with pytest.raises(AnalysisUnavailableError):
        service.analyze("case-1", "Only Example Brand appears in this script.")


def test_adk_service_persists_only_server_authored_neutral_descriptions() -> None:
    service = _service(
        json.dumps(
            {
                "findings": [
                    {
                        "research_id": "lead-1",
                        "category": "brand_reference",
                        "detected_item": "Example Brand",
                        "explanation": "Model-authored research wording.",
                        "confidence": 0.8,
                        "primary_url": "https://source.test/example-brand",
                        "rationale": "Model-authored source wording.",
                    }
                ]
            }
        ),
        [("lead-1", "Example Brand", "brand_reference", "A scene excerpt.")],
        StubParallel(),
    )

    findings = service.analyze("case-1", "Example Brand appears in this script.")

    assert findings[0].explanation == "Possible brand reference for human research review."
    assert findings[0].evidence.rationale == (
        "Retrieved source selected for human research review."
    )


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
        service.analyze("case-1", "Example Brand appears in this script.")


class FakeEvent:
    def __init__(
        self,
        final: bool,
        text: str | None = None,
        *,
        parts: list[object] | None = None,
    ) -> None:
        self._final = final
        self.content = SimpleNamespace(
            parts=([] if text is None else [SimpleNamespace(text=text)])
            if parts is None
            else parts
        )

    def is_final_response(self) -> bool:
        return self._final


def test_final_response_text_rejects_a_runner_without_final_text() -> None:
    with pytest.raises(AnalysisUnavailableError):
        _final_response_text([FakeEvent(final=False, text="intermediate")])


def test_final_response_text_joins_non_thought_text_parts_in_order() -> None:
    event = FakeEvent(
        final=True,
        parts=[
            SimpleNamespace(text="private reasoning", thought=True),
            SimpleNamespace(text='{"find', thought=False),
            SimpleNamespace(text='ings": []}', thought=False),
        ],
    )

    assert _final_response_text([event]) == '{"findings": []}'


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


class CountingHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.emitted_records = 0

    def emit(self, record: logging.LogRecord) -> None:
        del record
        self.emitted_records += 1


class FailingProviderModel(BaseLlm):
    _diagnostic_handler: CountingHandler = PrivateAttr(default_factory=CountingHandler)

    @property
    def emitted_diagnostics(self) -> int:
        return self._diagnostic_handler.emitted_records

    async def generate_content_async(self, llm_request: object, stream: bool = False):
        del llm_request, stream
        logger = logging.getLogger("google_genai.synthetic_provider")
        previous_level = logger.level
        previous_propagate = logger.propagate
        logger.setLevel(logging.ERROR)
        logger.propagate = False
        logger.addHandler(self._diagnostic_handler)
        try:
            logger.error("SENSITIVE_SYNTHETIC_PROVIDER_DIAGNOSTIC")
        finally:
            logger.removeHandler(self._diagnostic_handler)
            logger.setLevel(previous_level)
            logger.propagate = previous_propagate
        raise RuntimeError("SENSITIVE_SYNTHETIC_PROVIDER_DIAGNOSTIC")
        yield


def test_native_provider_failure_is_generic_and_does_not_leak_diagnostics(
    capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
) -> None:
    provider_model = FailingProviderModel(model="failing-provider")

    def invocation_factory(
        project: str,
        location: str,
        model: str,
        tool: Callable[[str, str, str, str], dict[str, object]],
    ) -> NativeAdkInvocation:
        invocation = NativeAdkInvocation(project, location, model, tool)
        invocation.agent.model = provider_model
        return invocation

    service = AdkRightsResearchAgentService(
        project="project",
        location="global",
        model="gemini-2.5-flash",
        parallel_search=StubParallel(),
        invocation_factory=invocation_factory,
    )

    with pytest.raises(AnalysisUnavailableError) as caught:
        service.analyze("case-1", "A script.")

    captured = capsys.readouterr()
    assert provider_model.emitted_diagnostics == 0
    assert "SENSITIVE_SYNTHETIC_PROVIDER_DIAGNOSTIC" not in captured.out
    assert "SENSITIVE_SYNTHETIC_PROVIDER_DIAGNOSTIC" not in captured.err
    assert "SENSITIVE_SYNTHETIC_PROVIDER_DIAGNOSTIC" not in caplog.text
    assert str(caught.value) == "RightsRadar analysis failed."
    assert caught.value.__cause__ is None
    context_is_cleared = caught.value.__context__ is None
    assert context_is_cleared

    caplog.clear()
    try:
        raise caught.value
    except AnalysisUnavailableError:
        logging.getLogger("app.public_boundary").exception("Generic analysis failure")
    assert "SENSITIVE_SYNTHETIC_PROVIDER_DIAGNOSTIC" not in caplog.text


def _failing_native_invocation() -> NativeAdkInvocation:
    def search_parallel(
        research_id: str, detected_item: str, category: str, context_excerpt: str
    ) -> dict[str, object]:
        del detected_item, category, context_excerpt
        return {"research_id": research_id, "candidates": []}

    invocation = NativeAdkInvocation(
        "project", "global", "gemini-2.5-flash", search_parallel
    )
    invocation.agent.model = FailingProviderModel(model="failing-provider")
    return invocation


def test_dependency_logger_resumes_after_native_invocation() -> None:
    parent_logger = logging.getLogger("google_genai")
    child_logger = logging.getLogger("google_genai.post_invocation")
    previous_parent_level = parent_logger.level
    previous_child_level = child_logger.level
    previous_propagate = child_logger.propagate
    handler = CountingHandler()
    parent_logger.setLevel(logging.WARNING)
    child_logger.setLevel(logging.NOTSET)
    child_logger.propagate = False
    try:
        with pytest.raises(RuntimeError):
            _failing_native_invocation().run("A script.")

        child_logger.addHandler(handler)
        child_logger.error("Benign post-invocation dependency diagnostic")
        assert handler.emitted_records == 1
    finally:
        child_logger.removeHandler(handler)
        parent_logger.setLevel(previous_parent_level)
        child_logger.setLevel(previous_child_level)
        child_logger.propagate = previous_propagate


def test_native_invocation_does_not_mutate_dependency_loggers() -> None:
    loggers = [
        logging.getLogger("google_adk"),
        logging.getLogger("google_genai"),
        logging.getLogger("google.genai"),
    ]
    original_state = [(logger.level, tuple(logger.handlers)) for logger in loggers]
    configured_levels = [logging.INFO, logging.WARNING, logging.ERROR]
    for logger, level in zip(loggers, configured_levels, strict=True):
        logger.setLevel(level)
    configured_state = [(logger.level, tuple(logger.handlers)) for logger in loggers]

    try:
        with pytest.raises(RuntimeError):
            _failing_native_invocation().run("A script.")

        assert [(logger.level, tuple(logger.handlers)) for logger in loggers] == configured_state
    finally:
        for logger, (level, handlers) in zip(loggers, original_state, strict=True):
            logger.setLevel(level)
            logger.handlers[:] = handlers


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
