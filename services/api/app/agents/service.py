import asyncio
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from app.agents.curation import CurationAgent
from app.agents.intake import IntakeAgent
from app.agents.research import ResearchAgent
from app.agents.trace import ToolCallRecorder
from app.integrations import GeminiClient, ParallelSearchClient
from app.models import CaseThreadMessage, Finding, ProductionMember, ToolCallEvent
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
    ) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be at least 1")
        self._gemini = gemini
        self._parallel_search = parallel_search
        self._max_concurrency = max_concurrency
        self._intake = IntakeAgent(gemini)
        self._curation = CurationAgent(gemini)
        self._research = ResearchAgent(gemini, parallel_search, self._curation)

    async def aclose(self) -> None:
        for provider in (self._gemini, self._parallel_search):
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


def _is_fixture(provider: object) -> bool:
    return type(provider).__name__.startswith("Mock")
