import pytest
from pydantic import ValidationError

from app.agents.adk import AdkAnalysisResponse, AdkFindingResponse, ensure_research_assistance_text
from app.errors import ResearchBoundaryError


def test_adk_response_requires_a_rationale_for_a_primary_url() -> None:
    with pytest.raises(ValidationError):
        AdkFindingResponse.model_validate(
            {
                "research_id": "lead-1",
                "category": "brand_reference",
                "detected_item": "Example Brand",
                "explanation": "A possible research lead for human review.",
                "confidence": 0.8,
                "primary_url": "https://source.test/known",
                "rationale": "  ",
            }
        )


def test_adk_response_rejects_duplicate_research_ids() -> None:
    with pytest.raises(ValidationError):
        AdkAnalysisResponse.model_validate(
            {
                "findings": [
                    _finding_response("lead-1"),
                    _finding_response("lead-1"),
                ]
            }
        )


def test_adk_response_accepts_empty_findings() -> None:
    assert AdkAnalysisResponse().findings == []


def test_adk_finding_accepts_a_neutral_no_primary_response() -> None:
    response = AdkFindingResponse.model_validate(_finding_response("lead-1"))

    assert response.primary_url is None
    assert response.rationale is None


@pytest.mark.parametrize(
    "text",
    [
        "This use is infringing.",
        "The production is cleared to release it.",
        "You may legally use this quotation.",
        "The mark is registered.",
        "The studio owns the copyright.",
        "This is a valid trademark.",
        "The scene is fair use.",
        "Permission is required.",
        "Licensing is not needed.",
        "The work violates copyright.",
        "Registration is confirmed.",
        "Release is legally allowed.",
        "This is high legal risk.",
    ],
)
def test_research_assistance_validator_rejects_legal_conclusions(text: str) -> None:
    with pytest.raises(ResearchBoundaryError):
        ensure_research_assistance_text(text)


def _finding_response(research_id: str) -> dict[str, object]:
    return {
        "research_id": research_id,
        "category": "brand_reference",
        "detected_item": "Example Brand",
        "explanation": "A possible research lead for human review.",
        "confidence": 0.8,
    }
