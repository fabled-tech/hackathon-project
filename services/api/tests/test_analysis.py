import pytest

from app.agents.service import RightsClearanceAgentService
from app.errors import AnalysisUnavailableError
from app.models import (
    Evidence,
    EvidenceCurationDecision,
    EvidenceSelection,
    Finding,
    GeminiSignal,
    Source,
)
from app.models.analysis import SearchResult


class StubGemini:
    def __init__(self, decision: EvidenceCurationDecision) -> None:
        self.decision = decision

    def identify_material(self, script_text: str) -> list[GeminiSignal]:
        return [
            GeminiSignal(
                category="brand_reference",
                detected_item="Example Brand",
                explanation="A named brand.",
                confidence=0.8,
                context_excerpt=script_text,
            )
        ]

    def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        return self.decision


class StubParallel:
    def __init__(self, candidates: list[SearchResult]) -> None:
        self.candidates = candidates

    def search(
        self, detected_item: str, category: str, context_excerpt: str = ""
    ) -> list[SearchResult]:
        return self.candidates


def test_agent_puts_selected_source_in_primary_and_rest_in_alternatives() -> None:
    candidates = [
        SearchResult(
            source=Source(title="Best", url="https://source.test/best"), excerpt="Best excerpt"
        ),
        SearchResult(
            source=Source(title="Other", url="https://source.test/other"), excerpt="Other excerpt"
        ),
    ]
    service = RightsClearanceAgentService(
        StubGemini(
            EvidenceCurationDecision(
                primary_url="https://source.test/best", rationale="Best match."
            )
        ),
        StubParallel(candidates),
    )

    findings = service.analyze("case-1", "A contextual excerpt.")

    assert findings[0].evidence.primary is not None
    assert findings[0].evidence.primary.source.url == "https://source.test/best"
    assert [item.source.url for item in findings[0].evidence.alternatives] == [
        "https://source.test/other"
    ]
    assert findings[0].supporting_evidence


def test_agent_saves_a_neutral_evidence_selection_when_search_finds_no_sources() -> None:
    service = RightsClearanceAgentService(
        StubGemini(EvidenceCurationDecision()), StubParallel([])
    )

    findings = service.analyze("case-1", "A contextual excerpt.")

    assert findings[0].evidence.primary is None
    assert findings[0].evidence.alternatives == []
    assert findings[0].supporting_evidence == []


def test_unknown_curated_url_fails_before_repository_create() -> None:
    candidate = SearchResult(
        source=Source(title="Known", url="https://source.test/known"), excerpt="Known excerpt"
    )
    service = RightsClearanceAgentService(
        StubGemini(
            EvidenceCurationDecision(
                primary_url="https://source.test/not-retrieved", rationale="Ungrounded."
            )
        ),
        StubParallel([candidate]),
    )

    with pytest.raises(AnalysisUnavailableError):
        service.analyze("case-1", "A contextual excerpt.")


def test_evidence_selection_defaults_to_neutral_no_source() -> None:
    selection = EvidenceSelection()

    assert selection.primary is None
    assert selection.rationale is None
    assert selection.alternatives == []


def test_legacy_finding_without_evidence_is_safe_to_read() -> None:
    finding = Finding.model_validate(
        {
            "id": "finding-1",
            "case_id": "case-1",
            "category": "brand_reference",
            "detected_item": "Old Brand",
            "explanation": "A legacy stored lead.",
            "confidence": 0.5,
            "supporting_evidence": [
                {
                    "excerpt": "old source",
                    "source": {"title": "Old", "url": "https://old.test"},
                }
            ],
            "source_urls": ["https://old.test"],
            "retrieved_at": "2026-08-02T00:00:00Z",
            "reviewer_status": "pending",
        }
    )

    assert finding.evidence.primary is None
    assert finding.evidence.alternatives[0].source.url == "https://old.test"


def test_explicit_evidence_selection_is_not_replaced_by_legacy_sources() -> None:
    primary = Evidence(
        excerpt="curated source",
        source=Source(title="Curated", url="https://curated.test"),
    )
    finding = Finding.model_validate(
        {
            "id": "finding-1",
            "case_id": "case-1",
            "category": "brand_reference",
            "detected_item": "New Brand",
            "explanation": "A curated lead.",
            "confidence": 0.5,
            "evidence": {"primary": primary, "rationale": "Direct match"},
            "supporting_evidence": [
                {
                    "excerpt": "legacy source",
                    "source": {"title": "Old", "url": "https://old.test"},
                }
            ],
            "source_urls": ["https://old.test"],
            "retrieved_at": "2026-08-02T00:00:00Z",
            "reviewer_status": "pending",
        }
    )

    assert finding.evidence.primary == primary
    assert finding.evidence.alternatives == []


def test_curation_models_expose_optional_provider_decision_and_context() -> None:
    decision = EvidenceCurationDecision()
    signal = GeminiSignal(
        category="brand_reference",
        detected_item="Nimbus Soda",
        explanation="Product placement.",
        confidence=0.8,
    )

    assert decision.primary_url is None
    assert decision.rationale is None
    assert signal.context_excerpt == ""
