from app.models import (
    Evidence,
    EvidenceCurationDecision,
    EvidenceSelection,
    Finding,
    GeminiSignal,
    Source,
)


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
