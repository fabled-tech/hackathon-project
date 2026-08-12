from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from app.errors import AnalysisUnavailableError, EvidenceCurationError
from app.integrations import GeminiClient, ParallelSearchClient
from app.models import (
    Evidence,
    EvidenceSelection,
    Finding,
    GeminiSignal,
    ReviewerStatus,
    SearchResult,
)


class AgentService(Protocol):
    def analyze(self, case_id: str, script_text: str) -> list[Finding]: ...


class RightsClearanceAgentService:
    def __init__(self, gemini: GeminiClient, parallel_search: ParallelSearchClient) -> None:
        self._gemini = gemini
        self._parallel_search = parallel_search

    def analyze(self, case_id: str, script_text: str) -> list[Finding]:
        try:
            retrieved_at = datetime.now(UTC)
            findings: list[Finding] = []
            for signal in self._gemini.identify_material(script_text):
                search_results = self._parallel_search.search(
                    signal.detected_item, signal.category, signal.context_excerpt
                )
                evidence = [
                    Evidence(excerpt=result.excerpt, source=result.source)
                    for result in search_results
                ]
                selection = self._curate_evidence(signal, search_results, evidence)
                findings.append(
                    Finding(
                        id=str(uuid4()),
                        case_id=case_id,
                        category=signal.category,
                        detected_item=signal.detected_item,
                        explanation=signal.explanation,
                        confidence=signal.confidence,
                        evidence=selection,
                        supporting_evidence=evidence,
                        source_urls=[result.source.url for result in search_results],
                        retrieved_at=retrieved_at,
                        reviewer_status=ReviewerStatus.PENDING,
                    )
                )
            return findings
        except AnalysisUnavailableError:
            raise
        except Exception as error:
            raise AnalysisUnavailableError("RightsRadar analysis failed.") from error

    def _curate_evidence(
        self, signal: GeminiSignal, search_results: list[SearchResult], evidence: list[Evidence]
    ) -> EvidenceSelection:
        if not search_results:
            return EvidenceSelection()

        decision = self._gemini.curate_evidence(signal, search_results)
        evidence_by_url = {item.source.url: item for item in evidence}
        if decision.primary_url is None:
            return EvidenceSelection(rationale=decision.rationale, alternatives=evidence)

        primary = evidence_by_url.get(decision.primary_url)
        if primary is None:
            raise EvidenceCurationError("Gemini selected an evidence URL that was not retrieved")
        return EvidenceSelection(
            primary=primary,
            rationale=decision.rationale,
            alternatives=[item for item in evidence if item.source.url != decision.primary_url],
        )
