from time import perf_counter

from app.agents.messages import agent_message
from app.agents.trace import ToolCallRecorder, elapsed_ms, provider_is_fixture
from app.integrations import GeminiClient
from app.models import (
    CaseThreadMessage,
    EvidenceCurationDecision,
    ProductionMember,
    ToolCallProvider,
)
from app.models.analysis import GeminiSignal, SearchResult


class CurationAgent:
    name = "Curation"

    def __init__(self, gemini: GeminiClient) -> None:
        self._gemini = gemini

    async def decide(
        self,
        signal: GeminiSignal,
        extracted_results: list[SearchResult],
        recorder: ToolCallRecorder,
    ) -> EvidenceCurationDecision:
        if not extracted_results:
            recorder.record(
                ToolCallProvider.VERTEX,
                "curate_evidence",
                self.name,
                f"Skipped curation for {signal.detected_item}; Extract returned no pages.",
                lead=signal.detected_item,
                fixture=provider_is_fixture(self._gemini),
            )
            return EvidenceCurationDecision(primary_url=None, rationale=None)
        started = perf_counter()
        decision = await self._gemini.curate_evidence(signal, extracted_results)
        cited = "cited" if decision.primary_url else "refused a cite for"
        recorder.record(
            ToolCallProvider.VERTEX,
            "curate_evidence",
            self.name,
            f"Vertex Gemini {cited} {signal.detected_item}.",
            lead=signal.detected_item,
            duration_ms=elapsed_ms(started),
            fixture=provider_is_fixture(self._gemini),
        )
        return decision

    def announce(
        self,
        case_id: str,
        signal: GeminiSignal,
        decision: EvidenceCurationDecision,
        stakeholders: list[ProductionMember],
        *,
        finding_id: str,
    ) -> CaseThreadMessage:
        mentions = [member.id for member in stakeholders]
        mention_text = _mention_line(stakeholders)
        if decision.primary_url is None:
            body = (
                f"No grounded primary source for {signal.detected_item}. "
                f"Curation refused to cite an unverified URL.{mention_text}"
            )
        else:
            rationale = decision.rationale or "Selected a grounded extracted source."
            body = (
                f"Primary source for {signal.detected_item}: {decision.primary_url}. "
                f"{rationale}{mention_text}"
            )
        return agent_message(
            case_id,
            self.name,
            body,
            finding_id=finding_id,
            mentions=mentions,
        )


def _mention_line(stakeholders: list[ProductionMember]) -> str:
    if not stakeholders:
        return ""
    names = ", ".join(f"@{member.name} ({member.role.value})" for member in stakeholders)
    return f" {names}"
