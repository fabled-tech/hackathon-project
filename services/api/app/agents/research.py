from collections.abc import Sequence
from datetime import datetime
from time import perf_counter
from uuid import uuid4

from app.agents.adjudicator import AdjudicatorAgent
from app.agents.curation import CurationAgent
from app.agents.messages import agent_message
from app.agents.stakeholders import stakeholders_for_lead
from app.agents.trace import ToolCallRecorder, elapsed_ms, provider_is_fixture
from app.errors import EvidenceCurationError
from app.integrations import GeminiClient, ParallelSearchClient
from app.models import (
    CaseThreadMessage,
    Evidence,
    EvidenceSelection,
    Finding,
    ProductionMember,
    ReviewerStatus,
    ToolCallProvider,
)
from app.models.analysis import GeminiSignal, SearchResult

_MAX_OBJECTIVES = 3
_MAX_EXTRACT_URLS = 8


class ResearchAgent:
    name = "Research"

    def __init__(
        self,
        gemini: GeminiClient,
        parallel_search: ParallelSearchClient,
        curation: CurationAgent,
        adjudicator: AdjudicatorAgent | None = None,
    ) -> None:
        self._gemini = gemini
        self._parallel_search = parallel_search
        self._curation = curation
        self._adjudicator = adjudicator

    async def research_lead(
        self,
        case_id: str,
        index: int,
        signal: GeminiSignal,
        retrieved_at: datetime,
        roster: Sequence[ProductionMember],
        recorder: ToolCallRecorder,
    ) -> tuple[Finding, list[CaseThreadMessage]]:
        stakeholders = stakeholders_for_lead(signal.category, roster)
        mention_ids = [member.id for member in stakeholders]
        mention_text = _mention_line(stakeholders)
        messages: list[CaseThreadMessage] = [
            agent_message(
                case_id,
                self.name,
                (
                    f"Researching {signal.detected_item} "
                    f"({signal.category.replace('_', ' ')})."
                    f"{mention_text} Planning search objectives."
                ),
                mentions=mention_ids,
            )
        ]

        session_id = f"rightsrader:{case_id}:{index}"
        objectives = await self._plan_objectives(signal, recorder)
        messages.append(
            agent_message(
                case_id,
                self.name,
                (
                    f"Planned {len(objectives)} search "
                    f"{_noun(len(objectives), 'objective')} for "
                    f"{signal.detected_item}: {'; '.join(objectives)}."
                ),
                mentions=mention_ids,
            )
        )

        batches: list[list[SearchResult]] = []
        for objective in objectives:
            batches.append(
                await self._search_objective(signal, session_id, objective, recorder)
            )
        search_results = _merge_search_results(batches, cap=_MAX_EXTRACT_URLS)
        messages.append(
            agent_message(
                case_id,
                self.name,
                (
                    f"Ran {len(objectives)} Parallel Search "
                    f"{_noun(len(objectives), 'call')} for "
                    f"{signal.detected_item}; "
                    f"{len(search_results)} unique "
                    f"{_noun(len(search_results), 'URL')} after de-dupe."
                    + (
                        " Running Extract."
                        if search_results
                        else " Extract will not run. @Curation"
                    )
                ),
                mentions=mention_ids,
            )
        )

        extracted_results = await self._extract_if_needed(
            signal, search_results, session_id, recorder
        )
        brief = ""
        if extracted_results:
            messages.append(
                agent_message(
                    case_id,
                    self.name,
                    (
                        f"Extracted {len(extracted_results)} "
                        f"{_noun(len(extracted_results), 'page')} for "
                        f"{signal.detected_item}."
                    ),
                    mentions=mention_ids,
                )
            )
            brief = await self._brief_stakeholders(signal, extracted_results, recorder)
            messages.append(
                agent_message(
                    case_id,
                    self.name,
                    (
                        f"Stakeholder brief for {signal.detected_item}: {brief} "
                        f"@Curation — sources are ready.{mention_text}"
                    ),
                    mentions=mention_ids,
                )
            )

        finding_id = str(uuid4())
        decision = await self._curation.decide(signal, extracted_results, recorder)
        evidence = [
            Evidence(excerpt=result.excerpt, source=result.source)
            for result in extracted_results
        ]
        by_url = {item.source.url: item for item in evidence}
        primary = by_url.get(decision.primary_url) if decision.primary_url else None
        if decision.primary_url is not None and primary is None:
            raise EvidenceCurationError("Gemini selected an unknown evidence URL")
        if (primary is None) != (decision.rationale is None):
            raise EvidenceCurationError("Gemini returned an incomplete evidence decision")
        selection = EvidenceSelection(
            primary=primary,
            rationale=decision.rationale,
            alternatives=[item for item in evidence if item is not primary],
        )
        memo = None
        adjudicator_messages: list[CaseThreadMessage] = []
        if self._adjudicator is not None:
            memo, adjudicator_messages = await self._adjudicator.adjudicate_lead(
                case_id, index, signal, extracted_results, decision, roster, recorder
            )
        adjudicator_messages = [
            m.model_copy(update={"finding_id": finding_id}) for m in adjudicator_messages
        ]
        assignee = memo.assigned_member_id if memo is not None else None
        if assignee is not None and assignee not in mention_ids:
            mention_ids = [*mention_ids, assignee]
        finding = Finding(
            id=finding_id,
            case_id=case_id,
            category=signal.category,
            detected_item=signal.detected_item,
            explanation=signal.explanation,
            confidence=signal.confidence,
            supporting_evidence=evidence,
            source_urls=[result.source.url for result in extracted_results],
            retrieved_at=retrieved_at,
            reviewer_status=ReviewerStatus.PENDING,
            evidence=selection,
            stakeholder_ids=mention_ids,
            memo=memo,
            assignee=assignee,
        )
        messages.append(
            self._curation.announce(
                case_id, signal, decision, stakeholders, finding_id=finding_id
            )
        )
        messages.extend(adjudicator_messages)
        return finding, messages

    async def _plan_objectives(
        self, signal: GeminiSignal, recorder: ToolCallRecorder
    ) -> list[str]:
        started = perf_counter()
        planned = await self._gemini.plan_queries(signal)
        objectives = [item.strip() for item in planned if item.strip()][:_MAX_OBJECTIVES]
        if len(objectives) < 2:
            objectives = [
                f"{signal.detected_item} official source",
                f"{signal.detected_item} origin attribution",
            ]
        recorder.record(
            ToolCallProvider.VERTEX,
            "plan_queries",
            self.name,
            (
                f"Vertex Gemini planned {len(objectives)} search objectives "
                f"for {signal.detected_item}."
            ),
            lead=signal.detected_item,
            duration_ms=elapsed_ms(started),
            fixture=provider_is_fixture(self._gemini),
        )
        return objectives

    async def _search_objective(
        self,
        signal: GeminiSignal,
        session_id: str,
        objective: str,
        recorder: ToolCallRecorder,
    ) -> list[SearchResult]:
        started = perf_counter()
        results = await self._parallel_search.search(signal, session_id, objective)
        recorder.record(
            ToolCallProvider.PARALLEL,
            "search",
            self.name,
            (
                f"Parallel Search returned {len(results)} URL(s) "
                f"for {signal.detected_item} ({objective}; session {session_id})."
            ),
            lead=signal.detected_item,
            duration_ms=elapsed_ms(started),
            fixture=provider_is_fixture(self._parallel_search),
        )
        return results

    async def _extract_if_needed(
        self,
        signal: GeminiSignal,
        search_results: list[SearchResult],
        session_id: str,
        recorder: ToolCallRecorder,
    ) -> list[SearchResult]:
        if not search_results:
            return []
        started = perf_counter()
        extracted = await self._parallel_search.extract(
            signal, search_results, session_id
        )
        recorder.record(
            ToolCallProvider.PARALLEL,
            "extract",
            self.name,
            (
                f"Parallel Extract verified {len(extracted)} page(s) "
                f"for {signal.detected_item}."
            ),
            lead=signal.detected_item,
            duration_ms=elapsed_ms(started),
            fixture=provider_is_fixture(self._parallel_search),
        )
        return extracted

    async def _brief_stakeholders(
        self,
        signal: GeminiSignal,
        extracted_results: list[SearchResult],
        recorder: ToolCallRecorder,
    ) -> str:
        started = perf_counter()
        brief = await self._gemini.brief_stakeholders(signal, extracted_results)
        recorder.record(
            ToolCallProvider.VERTEX,
            "brief_stakeholders",
            self.name,
            f"Vertex Gemini wrote a stakeholder brief for {signal.detected_item}.",
            lead=signal.detected_item,
            duration_ms=elapsed_ms(started),
            fixture=provider_is_fixture(self._gemini),
        )
        return brief


def _merge_search_results(
    batches: Sequence[Sequence[SearchResult]], *, cap: int
) -> list[SearchResult]:
    merged: list[SearchResult] = []
    seen: set[str] = set()
    for batch in batches:
        for item in batch:
            url = item.source.url
            if url in seen:
                continue
            seen.add(url)
            merged.append(item)
            if len(merged) == cap:
                return merged
    return merged


def _mention_line(stakeholders: Sequence[ProductionMember]) -> str:
    if not stakeholders:
        return ""
    names = ", ".join(f"@{member.name} ({member.role.value})" for member in stakeholders)
    return f" Pulling in {names}."


def _noun(count: int, word: str) -> str:
    return word if count == 1 else f"{word}s"
