import asyncio
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from app.agents.adjudicator import AdjudicatorAgent
from app.agents.curation import CurationAgent
from app.agents.intake import IntakeAgent
from app.agents.research import ResearchAgent
from app.agents.trace import ToolCallRecorder
from app.integrations import AdjudicatorClient, GeminiClient, ParallelSearchClient
from app.models import (
    Case,
    CaseThreadMessage,
    Finding,
    PipelineStage,
    ProductionMember,
    ToolCallEvent,
)
from app.models.analysis import GeminiSignal


@dataclass(frozen=True)
class AnalysisDeskResult:
    findings: list[Finding]
    thread: list[CaseThreadMessage]
    tool_calls: list[ToolCallEvent]


class AgentService(Protocol):
    async def analyze(
        self,
        case_id: str,
        script_text: str,
        ignored_keywords: Sequence[str] = (),
        roster: Sequence[ProductionMember] = (),
    ) -> list[Finding]: ...

    async def analyze_file(
        self,
        case_id: str,
        filename: str,
        content_type: str,
        content: bytes,
        ignored_keywords: Sequence[str] = (),
        roster: Sequence[ProductionMember] = (),
    ) -> list[Finding]: ...

    async def analyze_desk(
        self,
        case_id: str,
        script_text: str,
        ignored_keywords: Sequence[str] = (),
        roster: Sequence[ProductionMember] = (),
    ) -> AnalysisDeskResult: ...

    async def analyze_file_desk(
        self,
        case_id: str,
        filename: str,
        content_type: str,
        content: bytes,
        ignored_keywords: Sequence[str] = (),
        roster: Sequence[ProductionMember] = (),
    ) -> AnalysisDeskResult: ...

    async def advance_pipeline(
        self,
        case: Case,
        ignored_keywords: Sequence[str] = (),
        roster: Sequence[ProductionMember] = (),
    ) -> Case: ...


def _contains_ignored_phrase(detected_item: str, ignored_keywords: Sequence[str]) -> bool:
    normalized_item = detected_item.casefold()
    for keyword in ignored_keywords:
        words = keyword.casefold().split()
        if not words:
            continue
        pattern = r"(?<!\w)" + r"\s+".join(re.escape(word) for word in words) + r"(?!\w)"
        if re.search(pattern, normalized_item):
            return True
    return False


class RightsClearanceAgentService:
    def __init__(
        self,
        gemini: GeminiClient,
        parallel_search: ParallelSearchClient,
        *,
        max_concurrency: int = 4,
        adjudicator: AdjudicatorClient | None = None,
        adjudicate_below_confidence: float = 0.75,
    ) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be at least 1")
        self._gemini = gemini
        self._parallel_search = parallel_search
        self._max_concurrency = max_concurrency
        self._intake = IntakeAgent(gemini)
        self._curation = CurationAgent(gemini)
        self._adjudicator_client = adjudicator
        adjudicator_agent = (
            AdjudicatorAgent(adjudicator, below_confidence=adjudicate_below_confidence)
            if adjudicator is not None
            else None
        )
        self._research = ResearchAgent(
            gemini, parallel_search, self._curation, adjudicator=adjudicator_agent
        )

    async def aclose(self) -> None:
        for provider in (self._gemini, self._parallel_search, self._adjudicator_client):
            if provider is None:
                continue
            close = getattr(provider, "aclose", None)
            if close is not None:
                await close()

    async def analyze(
        self,
        case_id: str,
        script_text: str,
        ignored_keywords: Sequence[str] = (),
        roster: Sequence[ProductionMember] = (),
    ) -> list[Finding]:
        result = await self.analyze_desk(case_id, script_text, ignored_keywords, roster)
        return result.findings

    async def analyze_file(
        self,
        case_id: str,
        filename: str,
        content_type: str,
        content: bytes,
        ignored_keywords: Sequence[str] = (),
        roster: Sequence[ProductionMember] = (),
    ) -> list[Finding]:
        result = await self.analyze_file_desk(
            case_id, filename, content_type, content, ignored_keywords, roster
        )
        return result.findings

    async def analyze_desk(
        self,
        case_id: str,
        script_text: str,
        ignored_keywords: Sequence[str] = (),
        roster: Sequence[ProductionMember] = (),
    ) -> AnalysisDeskResult:
        recorder = ToolCallRecorder(case_id, fixture=_is_fixture(self._gemini))
        signals = await self._intake.detect_text(script_text, recorder)
        return await self._research_signals(
            case_id, signals, ignored_keywords, roster, recorder
        )

    async def analyze_file_desk(
        self,
        case_id: str,
        filename: str,
        content_type: str,
        content: bytes,
        ignored_keywords: Sequence[str] = (),
        roster: Sequence[ProductionMember] = (),
    ) -> AnalysisDeskResult:
        recorder = ToolCallRecorder(case_id, fixture=_is_fixture(self._gemini))
        signals = await self._intake.detect_file(
            filename, content_type, content, recorder
        )
        return await self._research_signals(
            case_id, signals, ignored_keywords, roster, recorder
        )

    async def _research_signals(
        self,
        case_id: str,
        signals: list[GeminiSignal],
        ignored_keywords: Sequence[str],
        roster: Sequence[ProductionMember],
        recorder: ToolCallRecorder,
    ) -> AnalysisDeskResult:
        retrieved_at = datetime.now(UTC)
        thread = [self._intake.announce(case_id, signals)]
        indexed_signals = [
            (index, signal)
            for index, signal in enumerate(signals)
            if not _contains_ignored_phrase(signal.detected_item, ignored_keywords)
        ]
        semaphore = asyncio.Semaphore(self._max_concurrency)

        async def analyze_signal(
            index: int, signal: GeminiSignal
        ) -> tuple[Finding, list[CaseThreadMessage]]:
            async with semaphore:
                return await self._research.research_lead(
                    case_id, index, signal, retrieved_at, roster, recorder
                )

        researched = await asyncio.gather(
            *(analyze_signal(index, signal) for index, signal in indexed_signals)
        )
        findings = [finding for finding, _messages in researched]
        for _finding, messages in researched:
            thread.extend(messages)
        return AnalysisDeskResult(
            findings=findings, thread=thread, tool_calls=list(recorder.events)
        )

    async def advance_pipeline(
        self,
        case: Case,
        ignored_keywords: Sequence[str] = (),
        roster: Sequence[ProductionMember] = (),
    ) -> Case:
        recorder = ToolCallRecorder(case.id, fixture=_is_fixture(self._gemini))
        stage = case.pipeline_stage
        if stage is PipelineStage.FILED:
            signals = await self._intake.detect_text(case.script_text, recorder)
            return case.model_copy(
                update={
                    "pipeline_stage": PipelineStage.INTAKE,
                    "intake_signals": signals,
                    "thread": [*case.thread, self._intake.announce(case.id, signals)],
                    "tool_calls": [*case.tool_calls, *recorder.events],
                }
            )
        if stage is PipelineStage.INTAKE:
            indexed = [
                (index, signal)
                for index, signal in enumerate(case.intake_signals)
                if not _contains_ignored_phrase(signal.detected_item, ignored_keywords)
            ]
            semaphore = asyncio.Semaphore(self._max_concurrency)

            async def collect(index: int, signal: GeminiSignal):
                async with semaphore:
                    return await self._research.collect_evidence(
                        case.id, index, signal, roster, recorder
                    )

            collected = await asyncio.gather(
                *(collect(index, signal) for index, signal in indexed)
            )
            scratches = []
            thread = list(case.thread)
            for scratch, messages in collected:
                scratches.append(scratch)
                thread.extend(messages)
            return case.model_copy(
                update={
                    "pipeline_stage": PipelineStage.RESEARCH,
                    "research_scratch": scratches,
                    "thread": thread,
                    "tool_calls": [*case.tool_calls, *recorder.events],
                }
            )
        if stage is PipelineStage.RESEARCH:
            retrieved_at = datetime.now(UTC)
            findings: list[Finding] = []
            thread = list(case.thread)
            for scratch in case.research_scratch:
                finding, messages = await self._research.compose_finding(
                    case.id,
                    scratch,
                    retrieved_at,
                    roster,
                    recorder,
                    adjudicate=False,
                )
                findings.append(finding)
                thread.extend(messages)
            return case.model_copy(
                update={
                    "pipeline_stage": PipelineStage.CURATION,
                    "findings": findings,
                    "thread": thread,
                    "tool_calls": [*case.tool_calls, *recorder.events],
                }
            )
        if stage is PipelineStage.CURATION:
            by_item = {item.signal.detected_item: item for item in case.research_scratch}
            findings = []
            thread = list(case.thread)
            for finding in case.findings:
                scratch = by_item.get(finding.detected_item)
                if scratch is None:
                    findings.append(finding)
                    continue
                updated, messages = await self._research.adjudicate_finding(
                    case.id, finding, scratch, roster, recorder
                )
                findings.append(updated)
                thread.extend(messages)
            return case.model_copy(
                update={
                    "pipeline_stage": PipelineStage.ADJUDICATION,
                    "findings": findings,
                    "thread": thread,
                    "tool_calls": [*case.tool_calls, *recorder.events],
                    "research_scratch": [],
                }
            )
        raise ValueError("pipeline already complete")


def _is_fixture(provider: object) -> bool:
    return type(provider).__name__.startswith("Mock")
