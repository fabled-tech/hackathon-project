from __future__ import annotations

import asyncio
import re
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol, Self
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
    "primary_url may only be a URL returned for that research_id; otherwise use null.\n"
    "Do not give legal advice or state conclusions about infringement, ownership, registration,\n"
    "validity, permission, licensing, fair use, clearance, legal risk, or what anyone may release."
)


class AdkInvocation(Protocol):
    def run(self, script_text: str) -> str: ...


SearchParallelTool = Callable[[str, str, str, str], dict[str, object]]
InvocationFactory = Callable[[str, str, str, SearchParallelTool], AdkInvocation]


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


_PROHIBITED_RESEARCH_CONCLUSIONS = (
    re.compile(r"\b(?:is|are|was|were)\s+(?:an?\s+)?(?:infringement|infringing)\b", re.I),
    re.compile(r"\b(?:violates?|violation of)\s+(?:copyright|trademark)\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:not\s+)?(?:cleared|licensed|permitted)\b", re.I),
    re.compile(
        r"\b(?:permission|authorization|licen[cs](?:e|ing))\s+(?:is\s+)?"
        r"(?:not\s+)?(?:required|needed|granted|denied)\b",
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


def ensure_research_assistance_text(*texts: str | None) -> None:
    if any(
        pattern.search(text or "")
        for pattern in _PROHIBITED_RESEARCH_CONCLUSIONS
        for text in texts
    ):
        raise ResearchBoundaryError("Agent output did not remain within research assistance.")


def _final_response_text(events: Iterable[object]) -> str:
    for event in events:
        is_final_response = getattr(event, "is_final_response", None)
        if not callable(is_final_response) or not is_final_response():
            continue
        content = getattr(event, "content", None)
        parts = getattr(content, "parts", None)
        if not parts:
            continue
        text = getattr(parts[0], "text", None)
        if isinstance(text, str) and text.strip():
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
        session_service = InMemorySessionService()  # type: ignore[no-untyped-call]
        asyncio.run(
            session_service.create_session(
                app_name=app_name,
                user_id=user_id,
                session_id=session_id,
            )
        )
        runner = Runner(
            app_name=app_name,
            agent=self._agent,
            session_service=session_service,
        )
        events = runner.run(
            user_id=user_id,
            session_id=session_id,
            new_message=types.Content(
                role="user",
                parts=[types.Part(text=script_text)],
            ),
        )
        return _final_response_text(events)


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
                ensure_research_assistance_text(item.explanation, item.rationale)
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
                    rationale=item.rationale,
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
                        explanation=item.explanation,
                        confidence=item.confidence,
                        supporting_evidence=evidence,
                        source_urls=[result.source.url for result in search_results],
                        retrieved_at=retrieved_at,
                        reviewer_status=ReviewerStatus.PENDING,
                        evidence=selection,
                    )
                )
            return findings
        except AnalysisUnavailableError:
            raise
        except Exception as error:
            raise AnalysisUnavailableError("RightsRadar analysis failed.") from error
