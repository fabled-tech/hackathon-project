import asyncio

from app.agents.adjudicator import AdjudicatorAgent
from app.agents.trace import ToolCallRecorder
from app.integrations.adjudicator import MockAdjudicator
from app.models import EvidenceCurationDecision, ProductionMember, WorkspaceRole
from app.models.analysis import GeminiSignal


class ExplodingAdjudicator:
    async def adjudicate(self, *args: object, **kwargs: object):  # noqa: ANN201
        raise RuntimeError("boom")


ROSTER = [
    ProductionMember(id="j", name="Jordan", role=WorkspaceRole.CLEARANCE),
    ProductionMember(id="m", name="Maya", role=WorkspaceRole.LEGAL),
]


def test_contested_lead_gets_memo_thread_and_owner() -> None:
    agent = AdjudicatorAgent(MockAdjudicator(), below_confidence=0.75)
    recorder = ToolCallRecorder("case-1", fixture=True)
    signal = GeminiSignal(
        category="quotation",
        detected_item="There is no spoon",
        explanation="e",
        confidence=0.9,
    )
    memo, messages = asyncio.run(
        agent.adjudicate_lead(
            "case-1",
            0,
            signal,
            [],
            EvidenceCurationDecision(primary_url=None, rationale=None),
            ROSTER,
            recorder,
        )
    )
    assert memo is not None and memo.assigned_member_id == "m"
    assert [m.agent_name for m in messages] == ["Adjudicator"] * len(messages)
    assert "hypotheses" in messages[0].body.lower()
    assert "m" in messages[-1].mentions
    assert [e.method for e in recorder.events] == [
        "hypothesize",
        "search_authoritative",
        "search_authoritative",
        "judge_grounded",
    ]
    assert all(e.agent_name == "Adjudicator" and e.fixture for e in recorder.events)


def test_uncontested_lead_is_skipped() -> None:
    agent = AdjudicatorAgent(MockAdjudicator(), below_confidence=0.75)
    recorder = ToolCallRecorder("case-1", fixture=True)
    signal = GeminiSignal(
        category="brand_reference",
        detected_item="Nimbus Soda",
        explanation="e",
        confidence=0.95,
    )
    memo, messages = asyncio.run(
        agent.adjudicate_lead(
            "case-1",
            0,
            signal,
            [],
            EvidenceCurationDecision(primary_url=None, rationale=None),
            ROSTER,
            recorder,
        )
    )
    assert memo is None and messages == [] and recorder.events == []


def test_failure_falls_back_without_raising() -> None:
    agent = AdjudicatorAgent(ExplodingAdjudicator(), below_confidence=0.75)
    recorder = ToolCallRecorder("case-1", fixture=False)
    signal = GeminiSignal(
        category="quotation",
        detected_item="X",
        explanation="e",
        confidence=0.9,
    )
    memo, messages = asyncio.run(
        agent.adjudicate_lead(
            "case-1",
            0,
            signal,
            [],
            EvidenceCurationDecision(primary_url=None, rationale=None),
            ROSTER,
            recorder,
        )
    )
    assert memo is None
    assert len(messages) == 1 and "could not resolve" in messages[0].body
    assert recorder.events[-1].ok is False and recorder.events[-1].method == "adjudicate"
