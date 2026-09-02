import logging
from collections.abc import Sequence

from app.agents.contested import is_contested
from app.agents.messages import agent_message
from app.agents.trace import ToolCallRecorder, provider_is_fixture
from app.integrations.adjudicator import AdjudicatorClient, owner_for_role
from app.models import (
    CaseThreadMessage,
    EvidenceCurationDecision,
    ProductionMember,
    ToolCallProvider,
)
from app.models.analysis import GeminiSignal, SearchResult
from app.models.memo import ClearanceMemo, MemoVerdict

logger = logging.getLogger("rightsrader.agents")

VERDICT_LABEL = {
    MemoVerdict.CLEARED: "Cleared",
    MemoVerdict.LICENSE_REQUIRED: "License required",
    MemoVerdict.REWRITE_RECOMMENDED: "Rewrite recommended",
    MemoVerdict.NEEDS_HUMAN: "Needs a human",
}


class AdjudicatorAgent:
    name = "Adjudicator"

    def __init__(self, client: AdjudicatorClient, *, below_confidence: float) -> None:
        self._client = client
        self._below_confidence = below_confidence

    async def adjudicate_lead(
        self,
        case_id: str,
        index: int,
        signal: GeminiSignal,
        extracted: list[SearchResult],
        decision: EvidenceCurationDecision,
        roster: Sequence[ProductionMember],
        recorder: ToolCallRecorder,
    ) -> tuple[ClearanceMemo | None, list[CaseThreadMessage]]:
        if not is_contested(signal, extracted, below_confidence=self._below_confidence):
            return None, []
        fixture = provider_is_fixture(self._client)
        session_id = f"rightsrader:{case_id}:{index}:adjudicate"
        try:
            result = await self._client.adjudicate(signal, extracted, decision, session_id)
        except Exception as error:
            logger.warning(
                "adjudication failed lead=%s error=%s",
                signal.detected_item,
                type(error).__name__,
            )
            recorder.record(
                ToolCallProvider.VERTEX,
                "adjudicate",
                self.name,
                f"Adjudicator could not resolve {signal.detected_item}; kept Curation's pick.",
                ok=False,
                lead=signal.detected_item,
                fixture=fixture,
            )
            return None, [
                agent_message(
                    case_id,
                    self.name,
                    f"Adjudicator could not resolve {signal.detected_item}; "
                    "leaving it with Curation's pick.",
                )
            ]

        for call in result.calls:
            recorder.record(
                call.provider,
                call.method,
                self.name,
                call.summary,
                ok=call.ok,
                lead=signal.detected_item,
                duration_ms=call.duration_ms,
                fixture=fixture,
            )

        memo = result.memo
        owner = owner_for_role(memo.recommended_owner_role, roster)
        if owner is not None:
            memo = memo.model_copy(update={"assigned_member_id": owner.id})

        messages = [
            agent_message(
                case_id,
                self.name,
                f"Two readings of {signal.detected_item} are in play. Hypotheses: "
                + "; ".join(f"{h.id} — {h.claim}" for h in memo.hypotheses)
                + ". Sending an advocate after each.",
            )
        ]
        for report in memo.advocates:
            cite = (
                f" Best source: {report.best_url}."
                if report.best_url
                else " No dispositive source found."
            )
            messages.append(
                agent_message(
                    case_id,
                    self.name,
                    (
                        f"Advocate {report.hypothesis_id} ({report.strength}): "
                        f"{report.why}{cite}"
                    ),
                )
            )
        mention = f" @{owner.name} ({owner.role.value})" if owner else ""
        messages.append(
            agent_message(
                case_id,
                self.name,
                f"Verdict on {signal.detected_item}: {VERDICT_LABEL[memo.verdict]} "
                f"({round(memo.confidence * 100)}%). {memo.rationale}"
                + (f" Dispositive: {memo.dispositive_url}." if memo.dispositive_url else "")
                + mention,
                mentions=[owner.id] if owner else [],
            )
        )
        return memo, messages
