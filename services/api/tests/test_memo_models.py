# services/api/tests/test_memo_models.py
import pytest

from app.errors import AdjudicationError
from app.models import Finding, WorkspaceRole
from app.models.memo import (
    AdvocateReport,
    ClearanceMemo,
    Hypothesis,
    HypothesisSet,
    MemoVerdict,
    validate_memo_urls,
)


def _memo(url: str | None) -> ClearanceMemo:
    return ClearanceMemo(
        verdict=MemoVerdict.LICENSE_REQUIRED,
        confidence=0.82,
        winning_hypothesis_id="h1",
        dispositive_url=url,
        rationale="The co-ownership filing names the franchise rights holders.",
        recommended_owner_role=WorkspaceRole.LEGAL,
        hypotheses=[
            Hypothesis(
                id="h1",
                claim="WB film franchise",
                likely_rights_holder="Warner Bros.",
                what_would_prove_it="Studio filing",
            ),
            Hypothesis(
                id="h2",
                claim="Unrelated software mark",
                likely_rights_holder="Matrix.org Foundation",
                what_would_prove_it="USPTO record",
            ),
        ],
        advocates=[
            AdvocateReport(
                hypothesis_id="h1",
                best_url="https://www.veritaglobal.net/doc",
                why="Names WB and Village Roadshow.",
                strength="strong",
                searched_urls=["https://www.veritaglobal.net/doc"],
            ),
            AdvocateReport(
                hypothesis_id="h2",
                best_url="https://www.trademarkia.com/matrix-79373974",
                why="Class 9 software mark.",
                strength="weak",
                searched_urls=["https://www.trademarkia.com/matrix-79373974"],
            ),
        ],
    )


def test_memo_url_must_come_from_allowed_set() -> None:
    memo = _memo("https://www.veritaglobal.net/doc")
    assert validate_memo_urls(memo, {"https://www.veritaglobal.net/doc"}) is memo
    with pytest.raises(AdjudicationError):
        validate_memo_urls(_memo("https://invented.example/x"), {"https://www.veritaglobal.net/doc"})


def test_memo_without_url_is_allowed_for_needs_human() -> None:
    memo = _memo(None).model_copy(update={"verdict": MemoVerdict.NEEDS_HUMAN})
    assert validate_memo_urls(memo, set()).dispositive_url is None


def test_hypothesis_set_requires_two_to_three() -> None:
    with pytest.raises(ValueError):
        HypothesisSet(
            hypotheses=[
                Hypothesis(
                    id="h1",
                    claim="x",
                    likely_rights_holder="y",
                    what_would_prove_it="z",
                ),
            ],
        )


def test_finding_memo_defaults_to_none_and_round_trips() -> None:
    finding = Finding(
        id="f1", case_id="c1", category="quotation", detected_item="There is no spoon",
        explanation="Quote", confidence=0.9, supporting_evidence=[], source_urls=[],
        retrieved_at="2026-09-01T00:00:00Z", reviewer_status="pending",
    )
    assert finding.memo is None
    with_memo = finding.model_copy(update={"memo": _memo(None)})
    assert Finding.model_validate(with_memo.model_dump(mode="json")).memo is not None
