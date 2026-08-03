import pytest
from pydantic import ValidationError


def test_evidence_selection_defaults_to_neutral_no_source() -> None:
    from app.models import EvidenceSelection

    selection = EvidenceSelection()

    assert selection.primary is None
    assert selection.rationale is None
    assert selection.alternatives == []


def test_legacy_finding_maps_old_evidence_to_neutral_alternatives() -> None:
    from app.models import Finding

    finding = Finding.model_validate(
        {
            "id": "finding-1",
            "case_id": "case-1",
            "category": "brand_reference",
            "detected_item": "Example Brand",
            "explanation": "A legacy finding.",
            "confidence": 0.5,
            "supporting_evidence": [
                {
                    "excerpt": "Archived evidence.",
                    "source": {
                        "title": "Archive",
                        "url": "https://source.test/archive",
                    },
                }
            ],
            "source_urls": ["https://source.test/archive"],
            "retrieved_at": "2026-08-02T00:00:00Z",
            "reviewer_status": "pending",
        }
    )

    assert finding.evidence.primary is None
    assert finding.evidence.rationale is None
    assert finding.evidence.alternatives == finding.supporting_evidence


@pytest.mark.parametrize(
    ("primary", "rationale"),
    [
        (
            {
                "excerpt": "Evidence.",
                "source": {"title": "Source", "url": "https://source.test"},
            },
            None,
        ),
        (None, "A rationale without selected evidence."),
    ],
)
def test_evidence_selection_rejects_incomplete_primary_rationale_pairs(
    primary: dict[str, object] | None, rationale: str | None
) -> None:
    from app.models import EvidenceSelection

    with pytest.raises(ValidationError):
        EvidenceSelection(primary=primary, rationale=rationale)
