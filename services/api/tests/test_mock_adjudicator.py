import asyncio

from app.integrations.adjudicator import MockAdjudicator, owner_for_role
from app.models import EvidenceCurationDecision, ProductionMember, WorkspaceRole
from app.models.analysis import GeminiSignal
from app.models.memo import MemoVerdict


def _signal(item: str, category: str = "quotation") -> GeminiSignal:
    return GeminiSignal(category=category, detected_item=item, explanation="e", confidence=0.9)


def test_mock_adjudicator_returns_deterministic_memos_for_featured_leads() -> None:
    client = MockAdjudicator()
    decision = EvidenceCurationDecision(primary_url=None, rationale=None)
    matrix = asyncio.run(
        client.adjudicate(_signal("The Matrix", "franchise_reference"), [], decision, "s")
    )
    spoon = asyncio.run(client.adjudicate(_signal("There is no spoon"), [], decision, "s"))
    nimbus = asyncio.run(
        client.adjudicate(_signal("Nimbus Soda", "brand_reference"), [], decision, "s")
    )
    other = asyncio.run(client.adjudicate(_signal("Something else"), [], decision, "s"))

    assert matrix.memo.verdict is MemoVerdict.LICENSE_REQUIRED
    assert matrix.memo.recommended_owner_role is WorkspaceRole.LEGAL
    assert spoon.memo.verdict is MemoVerdict.REWRITE_RECOMMENDED
    assert nimbus.memo.verdict is MemoVerdict.CLEARED
    assert nimbus.memo.recommended_owner_role is WorkspaceRole.CLEARANCE
    assert other.memo.verdict is MemoVerdict.NEEDS_HUMAN
    assert len(matrix.memo.hypotheses) == 2
    assert [call.method for call in matrix.calls] == [
        "hypothesize", "search_authoritative", "search_authoritative", "judge_grounded",
    ]
    assert all(call.summary for call in matrix.calls)


def test_owner_for_role_skips_missing_roles() -> None:
    roster = [ProductionMember(id="j", name="Jordan", role=WorkspaceRole.CLEARANCE)]
    assert owner_for_role(WorkspaceRole.CLEARANCE, roster).id == "j"
    assert owner_for_role(WorkspaceRole.LEGAL, roster) is None
