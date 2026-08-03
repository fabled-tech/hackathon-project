from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal, Protocol, Self
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator

from app.errors import AnalysisUnavailableError, ResearchBoundaryError
from app.integrations import ParallelSearchClient
from app.models import Evidence, EvidenceSelection, Finding, ReviewerStatus, SearchResult

if TYPE_CHECKING:
    from google.adk.agents import LlmAgent


_RESEARCH_AGENT_INSTRUCTION = (
    "You are RightsRadar's single research-assistance agent. Identify possible research "
    "leads only.\n"
    "Use search_parallel before citing a source. Return JSON only with a findings array.\n"
    "Each finding must reference exactly one research_id produced by search_parallel.\n"
    "category must be brand_reference or quotation; detected_item must be an exact substring "
    "of the submitted script.\n"
    "primary_url may only be a URL returned for that research_id; otherwise use null.\n"
    "Do not give legal advice or state conclusions about infringement, ownership, registration,\n"
    "validity, permission, licensing, fair use, clearance, legal risk, or what anyone may release."
)


class AdkInvocation(Protocol):
    def run(self, script_text: str) -> str: ...


SearchParallelTool = Callable[[str, str, str, str], dict[str, object]]
InvocationFactory = Callable[[str, str, str, SearchParallelTool], AdkInvocation]
ResearchCategory = Literal["brand_reference", "quotation"]
_RESEARCH_CATEGORIES = frozenset({"brand_reference", "quotation"})
_SAFE_EXPLANATIONS: dict[ResearchCategory, str] = {
    "brand_reference": "Possible brand reference for human research review.",
    "quotation": "Possible quotation for human research review.",
}
_SAFE_PRIMARY_RATIONALE = "Retrieved source selected for human research review."


class AdkFindingResponse(BaseModel):
    research_id: str = Field(min_length=1)
    category: ResearchCategory
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


_PROHIBITED_RESEARCH_CONCLUSIONS = (
    re.compile(
        r"\b(?:infring\w*|violat\w*|clearance|permission|authorization|approval|"
        r"licen[cs]\w*|ownership|owners?|held)\b",
        re.I,
    ),
    re.compile(
        r"\b(?:holds?|controls?)\s+(?:the\s+)?(?:copyright|trademark|rights?)\b",
        re.I,
    ),
    re.compile(r"\b(?:is|are|was|were)\s+(?:an?\s+)?(?:infringement|infringing)\b", re.I),
    re.compile(r"\binfring(?:es?|ed)\s+(?:copyright|trademark)\b", re.I),
    re.compile(r"\b(?:violates?|violation of)\s+(?:copyright|trademark)\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:not\s+)?(?:cleared|licensed|permitted)\b", re.I),
    re.compile(
        r"\b(?:permission|authorization|licen[cs](?:e|ing))\s+(?:is\s+)?"
        r"(?:not\s+)?(?:required|needed|granted|denied)\b",
        re.I,
    ),
    re.compile(
        r"\bclearance\s+(?:is\s+)?(?:not\s+)?(?:required|needed|granted|denied)\b",
        re.I,
    ),
    re.compile(
        r"\b(?:you|the production)\s+(?:need|needs|require|requires)\s+"
        r"(?:permission|authorization|clearance|licen[cs](?:e|ing))\b",
        re.I,
    ),
    re.compile(
        r"\b(?:you|the production)\s+(?:may|can|cannot|should)\s+"
        r"(?:legally\s+)?(?:use|publish|release|distribute)\b",
        re.I,
    ),
    re.compile(r"\b(?:is|are|was|were)\s+(?:un)?registered\b", re.I),
    re.compile(
        r"\bregistration\s+(?:is\s+)?(?:confirmed|unconfirmed|complete|incomplete|pending)\b",
        re.I,
    ),
    re.compile(r"\b(?:owns?|owned by|has rights to)\b", re.I),
    re.compile(r"\b(?:copyright|trademark|rights?)\s+belongs?\s+to\b", re.I),
    re.compile(r"\b(?:qualifies?|does not qualify)\s+as\s+fair use\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:a\s+)?fair use\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:a\s+)?(?:valid|invalid)\s+trademark\b", re.I),
    re.compile(
        r"\b(?:release|publication|distribution)\s+(?:is\s+)?"
        r"(?:legally\s+)?(?:allowed|permitted|prohibited)\b",
        re.I,
    ),
    re.compile(r"\b(?:no|low|high)\s+legal risk\b", re.I),
)
_URL_LIKE = re.compile(
    r"(?<![\w@])(?:"
    r"[a-z][a-z0-9+.-]*:[^\s<>\"']+"
    r"|//[^\s<>\"']+"
    r"|www\.[^\s<>\"']+"
    r"|(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:/[^\s<>\"']*)?"
    r"|\[[0-9a-f:.]+\](?::\d{1,5})?(?:/[^\s<>\"']*)?"
    r"|(?:\w(?:[\w-]{0,61}\w)?\.)+[\w-]{2,63}(?:/[^\s<>\"']*)?"
    r")",
    re.I,
)
_URL_TRAILING_PUNCTUATION = ".,;:!?)]}"

_PRIVATE_DEPENDENCY_LOGGER_PREFIXES = ("google_adk", "google_genai", "google.genai")


def _suppress_dependency_diagnostic_logging() -> None:
    disabled_level = logging.CRITICAL + 1
    for prefix in _PRIVATE_DEPENDENCY_LOGGER_PREFIXES:
        logging.getLogger(prefix).setLevel(disabled_level)


def ensure_research_assistance_text(*texts: str | None) -> None:
    if any(
        pattern.search(text or "")
        for pattern in _PROHIBITED_RESEARCH_CONCLUSIONS
        for text in texts
    ):
        raise ResearchBoundaryError("Agent output did not remain within research assistance.")


def _ensure_supported_research_category(category: str) -> None:
    if category not in _RESEARCH_CATEGORIES:
        raise ResearchBoundaryError("Agent output used an unsupported research category.")


def _ensure_detected_item_is_grounded(script_text: str, detected_item: str) -> None:
    if detected_item not in script_text:
        raise ResearchBoundaryError("Agent output was not grounded in the submitted script.")


def _ensure_provenance_backed_urls(allowed_urls: set[str], *texts: str | None) -> None:
    for text in texts:
        for match in _URL_LIKE.finditer(text or ""):
            candidate = match.group(0).rstrip(_URL_TRAILING_PUNCTUATION)
            if candidate not in allowed_urls:
                raise ResearchBoundaryError(
                    "Agent output referenced a source that was not retrieved."
                )


def _final_response_text(events: Iterable[object]) -> str:
    for event in events:
        is_final_response = getattr(event, "is_final_response", None)
        if not callable(is_final_response) or not is_final_response():
            continue
        content = getattr(event, "content", None)
        parts = getattr(content, "parts", None)
        if not parts:
            continue
        text = "".join(
            part_text
            for part in parts
            if not getattr(part, "thought", False)
            and isinstance((part_text := getattr(part, "text", None)), str)
        )
        if text.strip():
            return text
    raise AnalysisUnavailableError("ADK did not return a final response.")


class NativeAdkInvocation:
    def __init__(
        self,
        project: str,
        location: str,
        model: str,
        search_parallel: SearchParallelTool,
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

    @property
    def agent(self) -> LlmAgent:
        return self._agent

    def run(self, script_text: str) -> str:
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService
        from google.genai import types

        app_name = "rights_radar"
        user_id = str(uuid4())
        session_id = str(uuid4())

        async def run_async() -> str:
            session_service = InMemorySessionService()  # type: ignore[no-untyped-call]
            await session_service.create_session(
                app_name=app_name,
                user_id=user_id,
                session_id=session_id,
            )
            runner = Runner(
                app_name=app_name,
                agent=self._agent,
                session_service=session_service,
            )
            events = [
                event
                async for event in runner.run_async(
                    user_id=user_id,
                    session_id=session_id,
                    new_message=types.Content(
                        role="user",
                        parts=[types.Part(text=script_text)],
                    ),
                )
            ]
            return _final_response_text(events)

        _suppress_dependency_diagnostic_logging()
        return asyncio.run(run_async())


class AdkRightsResearchAgentService:
    def __init__(
        self,
        project: str,
        location: str,
        model: str,
        parallel_search: ParallelSearchClient,
        invocation_factory: InvocationFactory = NativeAdkInvocation,
    ) -> None:
        self._project = project
        self._location = location
        self._model = model
        self._parallel_search = parallel_search
        self._invocation_factory = invocation_factory

    def analyze(self, case_id: str, script_text: str) -> list[Finding]:
        results_by_research_id: dict[str, list[SearchResult]] = {}
        identity_by_research_id: dict[str, tuple[str, str]] = {}

        def search_parallel(
            research_id: str,
            detected_item: str,
            category: str,
            context_excerpt: str,
        ) -> dict[str, object]:
            """Retrieve traceable research sources for one possible rights research lead."""
            if research_id in results_by_research_id:
                raise AnalysisUnavailableError("Agent reused a research identifier.")
            _ensure_supported_research_category(category)
            ensure_research_assistance_text(category, detected_item)
            _ensure_detected_item_is_grounded(script_text, detected_item)
            results = self._parallel_search.search(detected_item, category, context_excerpt)
            results_by_research_id[research_id] = results
            identity_by_research_id[research_id] = (detected_item, category)
            return {
                "research_id": research_id,
                "candidates": [
                    {
                        "title": item.source.title,
                        "url": item.source.url,
                        "excerpt": item.excerpt,
                    }
                    for item in results
                ],
            }

        try:
            invocation = self._invocation_factory(
                self._project,
                self._location,
                self._model,
                search_parallel,
            )
            response = AdkAnalysisResponse.model_validate_json(invocation.run(script_text))
            retrieved_at = datetime.now(UTC)
            findings: list[Finding] = []
            for item in response.findings:
                ensure_research_assistance_text(
                    item.category,
                    item.detected_item,
                    item.explanation,
                    item.rationale,
                )
                _ensure_detected_item_is_grounded(script_text, item.detected_item)
                search_results = results_by_research_id.get(item.research_id)
                if search_results is None:
                    raise AnalysisUnavailableError(
                        "Agent referenced an unknown research identifier."
                    )
                if identity_by_research_id[item.research_id] != (
                    item.detected_item,
                    item.category,
                ):
                    raise AnalysisUnavailableError(
                        "Agent changed the identity of a researched item."
                    )
                _ensure_provenance_backed_urls(
                    {result.source.url for result in search_results},
                    item.explanation,
                    item.rationale,
                )
                evidence = [
                    Evidence(excerpt=result.excerpt, source=result.source)
                    for result in search_results
                ]
                primary = None
                if item.primary_url is not None:
                    primary = next(
                        (
                            candidate
                            for candidate in evidence
                            if candidate.source.url == item.primary_url
                        ),
                        None,
                    )
                    if primary is None:
                        raise AnalysisUnavailableError(
                            "Agent selected an evidence URL that was not retrieved."
                        )
                selection = EvidenceSelection(
                    primary=primary,
                    rationale=_SAFE_PRIMARY_RATIONALE if primary is not None else None,
                    alternatives=[
                        candidate
                        for candidate in evidence
                        if primary is None or candidate.source.url != primary.source.url
                    ],
                )
                findings.append(
                    Finding(
                        id=str(uuid4()),
                        case_id=case_id,
                        category=item.category,
                        detected_item=item.detected_item,
                        explanation=_SAFE_EXPLANATIONS[item.category],
                        confidence=item.confidence,
                        supporting_evidence=evidence,
                        source_urls=[result.source.url for result in search_results],
                        retrieved_at=retrieved_at,
                        reviewer_status=ReviewerStatus.PENDING,
                        evidence=selection,
                    )
                )
            return findings
        except Exception:
            raise AnalysisUnavailableError("RightsRadar analysis failed.") from None
