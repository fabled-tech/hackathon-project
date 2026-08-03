from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from app.integrations import GeminiClient, ParallelSearchClient
from app.models import Evidence, Finding, ReviewerStatus


class AgentService(Protocol):
    def analyze(self, case_id: str, script_text: str) -> list[Finding]: ...


class RightsClearanceAgentService:
    def __init__(self, gemini: GeminiClient, parallel_search: ParallelSearchClient) -> None:
        self._gemini = gemini
        self._parallel_search = parallel_search

    def analyze(self, case_id: str, script_text: str) -> list[Finding]:
        retrieved_at = datetime.now(UTC)
        findings: list[Finding] = []
        for signal in self._gemini.identify_material(script_text):
            search_results = self._parallel_search.search(
                signal.detected_item, signal.category, signal.context_excerpt
            )
            evidence = [
                Evidence(excerpt=result.excerpt, source=result.source) for result in search_results
            ]
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
                )
            )
        return findings
