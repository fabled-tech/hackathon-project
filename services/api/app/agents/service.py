import asyncio
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
    async def analyze(self, case_id: str, script_text: str) -> list[Finding]: ...


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
        self._max_concurrency = max_concurrency

    async def aclose(self) -> None:
        for provider in (self._gemini, self._parallel_search):
            close = getattr(provider, "aclose", None)
            if close is not None:
                await close()

    async def analyze(self, case_id: str, script_text: str) -> list[Finding]:
        retrieved_at = datetime.now(UTC)
        signals = await self._gemini.identify_material(script_text)
        semaphore = asyncio.Semaphore(self._max_concurrency)

        async def analyze_signal(index: int, signal: GeminiSignal) -> Finding:
            async with semaphore:
                return await self._analyze_signal(case_id, index, signal, retrieved_at)

        return list(
            await asyncio.gather(
                *(analyze_signal(index, signal) for index, signal in enumerate(signals))
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
        search_results = await self._parallel_search.search(signal, session_id)
        extracted_results = (
            await self._parallel_search.extract(signal, search_results, session_id)
            if search_results
            else []
        )
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
        selection = EvidenceSelection(
            primary=primary,
            rationale=decision.rationale,
            alternatives=[item for item in evidence if item is not primary],
        )
        return Finding(
            id=str(uuid4()),
            case_id=case_id,
            category=signal.category,
            detected_item=signal.detected_item,
            explanation=signal.explanation,
            confidence=signal.confidence,
            supporting_evidence=evidence,
            source_urls=[result.source.url for result in extracted_results],
            retrieved_at=retrieved_at,
            reviewer_status=ReviewerStatus.PENDING,
            evidence=selection,
        )
