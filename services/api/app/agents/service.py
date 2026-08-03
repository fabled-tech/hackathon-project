from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from app.integrations import GeminiClient, ParallelSearchClient
from app.models import (
    Evidence,
    EvidenceCurationDecision,
    EvidenceSelection,
    Finding,
    ReviewerStatus,
)


class AgentService(Protocol):
    async def analyze(self, case_id: str, script_text: str) -> list[Finding]: ...


class RightsClearanceAgentService:
    def __init__(self, gemini: GeminiClient, parallel_search: ParallelSearchClient) -> None:
        self._gemini = gemini
        self._parallel_search = parallel_search

    async def analyze(self, case_id: str, script_text: str) -> list[Finding]:
        retrieved_at = datetime.now(UTC)
        findings: list[Finding] = []
        for signal in await self._gemini.identify_material(script_text):
            session_id = f"rightsrader:{case_id}:{len(findings)}"
            search_results = await self._parallel_search.search(signal, session_id)
            search_results = await self._parallel_search.extract(
                signal, search_results, session_id
            )
            decision = (
                await self._gemini.curate_evidence(signal, search_results)
                if search_results
                else EvidenceCurationDecision(primary_url=None, rationale=None)
            )
            evidence = [
                Evidence(excerpt=result.excerpt, source=result.source) for result in search_results
            ]
            by_url = {item.source.url: item for item in evidence}
            primary = by_url.get(decision.primary_url) if decision.primary_url else None
            selection = EvidenceSelection(
                primary=primary,
                rationale=decision.rationale,
                alternatives=[item for item in evidence if item is not primary],
            )
            findings.append(
                Finding(
                    id=str(uuid4()),
                    case_id=case_id,
                    category=signal.category,
                    detected_item=signal.detected_item,
                    explanation=signal.explanation,
                    confidence=signal.confidence,
                    supporting_evidence=evidence,
                    source_urls=[result.source.url for result in search_results],
                    retrieved_at=retrieved_at,
                    reviewer_status=ReviewerStatus.PENDING,
                    evidence=selection,
                )
            )
        return findings
