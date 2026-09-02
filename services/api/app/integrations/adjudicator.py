from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from app.models import (
    EvidenceCurationDecision,
    ProductionMember,
    ToolCallProvider,
    WorkspaceRole,
)
from app.models.analysis import GeminiSignal, SearchResult
from app.models.memo import AdvocateReport, ClearanceMemo, Hypothesis, MemoVerdict


@dataclass(frozen=True)
class AdjudicationCall:
    provider: ToolCallProvider
    method: str
    summary: str
    ok: bool = True
    duration_ms: int = 0


@dataclass(frozen=True)
class AdjudicationResult:
    memo: ClearanceMemo
    calls: list[AdjudicationCall] = field(default_factory=list)


class AdjudicatorClient(Protocol):
    async def adjudicate(
        self,
        signal: GeminiSignal,
        extracted: list[SearchResult],
        decision: EvidenceCurationDecision,
        session_id: str,
    ) -> AdjudicationResult: ...


def owner_for_role(
    role: WorkspaceRole, roster: Sequence[ProductionMember]
) -> ProductionMember | None:
    for member in roster:
        if member.role is role:
            return member
    return None


_FIXTURE_MEMOS: dict[str, tuple[MemoVerdict, WorkspaceRole, str, str | None]] = {
    "The Matrix": (
        MemoVerdict.LICENSE_REQUIRED,
        WorkspaceRole.LEGAL,
        "The franchise reading wins; a one-sheet on camera needs a studio license.",
        "https://example.com/the-matrix-franchise-reference",
    ),
    "There is no spoon": (
        MemoVerdict.REWRITE_RECOMMENDED,
        WorkspaceRole.LEGAL,
        "The line is film dialogue, not a common phrase; suggest a paraphrase.",
        "https://example.com/there-is-no-spoon-quotation",
    ),
    "Nimbus Soda": (
        MemoVerdict.CLEARED,
        WorkspaceRole.CLEARANCE,
        "No live registry conflict; incidental placement is cleared.",
        "https://example.com/nimbus-soda-brand-reference",
    ),
}


class MockAdjudicator:
    """Deterministic fixture for mock mode and e2e. Never touches the network."""

    async def adjudicate(
        self,
        signal: GeminiSignal,
        extracted: list[SearchResult],
        decision: EvidenceCurationDecision,
        session_id: str,
    ) -> AdjudicationResult:
        del extracted, decision, session_id
        verdict, role, rationale, url = _FIXTURE_MEMOS.get(
            signal.detected_item,
            (
                MemoVerdict.NEEDS_HUMAN,
                WorkspaceRole.CLEARANCE,
                "Hypotheses are balanced; a human should decide.",
                None,
            ),
        )
        hypotheses = [
            Hypothesis(
                id="h1",
                claim=f"{signal.detected_item} is controlled by a studio or publisher",
                likely_rights_holder="Studio or publisher",
                what_would_prove_it="An official filing or press page",
            ),
            Hypothesis(
                id="h2",
                claim=f"{signal.detected_item} is generic or independently registered",
                likely_rights_holder="Unrelated registrant",
                what_would_prove_it="A registry record with a different owner",
            ),
        ]
        advocates = [
            AdvocateReport(
                hypothesis_id="h1",
                best_url=url,
                why="Authoritative source found.",
                strength="strong" if url else "none",
                searched_urls=[url] if url else [],
            ),
            AdvocateReport(
                hypothesis_id="h2",
                best_url=None,
                why="Nothing dispositive found.",
                strength="none",
                searched_urls=[],
            ),
        ]
        memo = ClearanceMemo(
            verdict=verdict,
            confidence=0.8 if url else 0.5,
            winning_hypothesis_id="h1",
            dispositive_url=url,
            rationale=rationale,
            recommended_owner_role=role,
            hypotheses=hypotheses,
            advocates=advocates,
        )
        item = signal.detected_item
        calls = [
            AdjudicationCall(
                ToolCallProvider.VERTEX,
                "hypothesize",
                f"Fixture: 2 hypotheses for {item}.",
            ),
            AdjudicationCall(
                ToolCallProvider.PARALLEL,
                "search_authoritative",
                f"Fixture: advocate h1 searched registries for {item}.",
            ),
            AdjudicationCall(
                ToolCallProvider.PARALLEL,
                "search_authoritative",
                f"Fixture: advocate h2 searched registries for {item}.",
            ),
            AdjudicationCall(
                ToolCallProvider.VERTEX,
                "judge_grounded",
                f"Fixture: judge wrote a {verdict.value} memo for {item}.",
            ),
        ]
        return AdjudicationResult(memo=memo, calls=calls)
