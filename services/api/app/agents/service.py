import asyncio
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from app.errors import EvidenceCurationError
from app.integrations import GeminiClient, ParallelSearchClient
from app.models import (
    Evidence,
    EvidenceCurationDecision,
    EvidenceSelection,
    Finding,
    ReviewerStatus,
)
from app.models.analysis import GeminiSignal


class AgentService(Protocol):
    async def analyze(
        self, case_id: str, script_text: str, ignored_keywords: Sequence[str] = ()
    ) -> list[Finding]: ...

    async def analyze_file(
        self,
        case_id: str,
        filename: str,
        content_type: str,
        content: bytes,
        ignored_keywords: Sequence[str] = (),
    ) -> list[Finding]: ...


def _contains_ignored_phrase(detected_item: str, ignored_keywords: Sequence[str]) -> bool:
    normalized_item = detected_item.casefold()
    for keyword in ignored_keywords:
        words = keyword.casefold().split()
        if not words:
            continue
        pattern = r"(?<!\w)" + r"\s+".join(re.escape(word) for word in words) + r"(?!\w)"
        if re.search(pattern, normalized_item):
            return True
    return False


class LeadDetectionAgent:
    """Uses Gemini to turn creative material into structured clearance leads."""

    def __init__(self, gemini: GeminiClient) -> None:
        self._gemini = gemini

    async def analyze_text(self, text: str) -> list[GeminiSignal]:
        return await self._gemini.identify_material(text)

    async def analyze_file(
        self, filename: str, content_type: str, content: bytes
    ) -> list[GeminiSignal]:
        return await self._gemini.identify_material_from_file(
            filename, content_type, content
        )


class WebResearchAgent:
    """Uses one Parallel session to search and extract evidence for one lead."""

    def __init__(self, parallel_search: ParallelSearchClient) -> None:
        self._parallel_search = parallel_search

    async def research(
        self, signal: GeminiSignal, session_id: str
    ) -> list[SearchResult]:
        search_results = await self._parallel_search.search(signal, session_id)
        if not search_results:
            return []
        return await self._parallel_search.extract(signal, search_results, session_id)


@dataclass(frozen=True)
class CuratedEvidence:
    supporting_evidence: list[Evidence]
    source_urls: list[str]
    selection: EvidenceSelection


class EvidenceCurationAgent:
    """Uses Gemini to select grounded evidence without inventing citations."""

    def __init__(self, gemini: GeminiClient) -> None:
        self._gemini = gemini

    async def curate(
        self, signal: GeminiSignal, extracted_results: list[SearchResult]
    ) -> CuratedEvidence:
        decision = (
            await self._gemini.curate_evidence(signal, extracted_results)
            if extracted_results
            else EvidenceCurationDecision(primary_url=None, rationale=None)
        )
        evidence = [
            Evidence(excerpt=result.excerpt, source=result.source)
            for result in extracted_results
        ]
        by_url = {item.source.url: item for item in evidence}
        primary = by_url.get(decision.primary_url) if decision.primary_url else None
        if decision.primary_url is not None and primary is None:
            raise EvidenceCurationError("Gemini selected an unknown evidence URL")
        if (primary is None) != (decision.rationale is None):
            raise EvidenceCurationError("Gemini returned an incomplete evidence decision")
        return CuratedEvidence(
            supporting_evidence=evidence,
            source_urls=[result.source.url for result in extracted_results],
            selection=EvidenceSelection(
                primary=primary,
                rationale=decision.rationale,
                alternatives=[item for item in evidence if item is not primary],
            ),
        )


class RightsClearanceAgentService:
    def __init__(
        self,
        gemini: GeminiClient,
        parallel_search: ParallelSearchClient,
        *,
        max_concurrency: int = 4,
    ) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be at least 1")
        self._gemini = gemini
        self._parallel_search = parallel_search
        self.lead_detection_agent = LeadDetectionAgent(gemini)
        self.web_research_agent = WebResearchAgent(parallel_search)
        self.evidence_curation_agent = EvidenceCurationAgent(gemini)
        self._max_concurrency = max_concurrency

    async def aclose(self) -> None:
        for provider in (self._gemini, self._parallel_search):
            close = getattr(provider, "aclose", None)
            if close is not None:
                await close()

    async def analyze(
        self, case_id: str, script_text: str, ignored_keywords: Sequence[str] = ()
    ) -> list[Finding]:
        retrieved_at = datetime.now(UTC)
        signals = await self.lead_detection_agent.analyze_text(script_text)
        return await self._research_signals(
            case_id, signals, ignored_keywords, retrieved_at
        )

    async def analyze_file(
        self,
        case_id: str,
        filename: str,
        content_type: str,
        content: bytes,
        ignored_keywords: Sequence[str] = (),
    ) -> list[Finding]:
        retrieved_at = datetime.now(UTC)
        signals = await self.lead_detection_agent.analyze_file(
            filename, content_type, content
        )
        return await self._research_signals(
            case_id, signals, ignored_keywords, retrieved_at
        )

    async def _research_signals(
        self,
        case_id: str,
        signals: list[GeminiSignal],
        ignored_keywords: Sequence[str],
        retrieved_at: datetime,
    ) -> list[Finding]:
        indexed_signals = [
            (index, signal)
            for index, signal in enumerate(signals)
            if not _contains_ignored_phrase(signal.detected_item, ignored_keywords)
        ]
        semaphore = asyncio.Semaphore(self._max_concurrency)

        async def analyze_signal(index: int, signal: GeminiSignal) -> Finding:
            async with semaphore:
                return await self._analyze_signal(case_id, index, signal, retrieved_at)

        return list(
            await asyncio.gather(
                *(analyze_signal(index, signal) for index, signal in indexed_signals)
            )
        )

    async def _analyze_signal(
        self,
        case_id: str,
        index: int,
        signal: GeminiSignal,
        retrieved_at: datetime,
    ) -> Finding:
        session_id = f"rightsrader:{case_id}:{index}"
        extracted_results = await self.web_research_agent.research(
            signal, session_id
        )
        curated = await self.evidence_curation_agent.curate(
            signal, extracted_results
        )
        return Finding(
            id=str(uuid4()),
            case_id=case_id,
            category=signal.category,
            detected_item=signal.detected_item,
            explanation=signal.explanation,
            confidence=signal.confidence,
            supporting_evidence=curated.supporting_evidence,
            source_urls=curated.source_urls,
            retrieved_at=retrieved_at,
            reviewer_status=ReviewerStatus.PENDING,
            evidence=curated.selection,
        )
