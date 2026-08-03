import pytest
from pydantic import ValidationError

from app.agents.adk import AdkFindingResponse, ensure_research_assistance_text
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
    ],
)
def test_research_assistance_validator_rejects_legal_conclusions(text: str) -> None:
    with pytest.raises(ResearchBoundaryError):
        ensure_research_assistance_text(text)
