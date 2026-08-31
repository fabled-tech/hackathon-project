import logging
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from app.models import ToolCallEvent, ToolCallProvider

logger = logging.getLogger("rightsrader.agents")


class ToolCallRecorder:
    """Structured tool-call log for judges: persisted on the case and written to stdout."""

    def __init__(self, case_id: str, *, fixture: bool) -> None:
        self.case_id = case_id
        self.fixture = fixture
        self.events: list[ToolCallEvent] = []

    def record(
        self,
        provider: ToolCallProvider,
        method: str,
        agent_name: str,
        summary: str,
        *,
        ok: bool = True,
        lead: str | None = None,
        duration_ms: int = 0,
        fixture: bool | None = None,
    ) -> ToolCallEvent:
        event = ToolCallEvent(
            id=str(uuid4()),
            case_id=self.case_id,
            provider=provider,
            method=method,
            agent_name=agent_name,
            ok=ok,
            fixture=self.fixture if fixture is None else fixture,
            summary=summary,
            lead=lead,
            duration_ms=duration_ms,
            started_at=datetime.now(UTC),
        )
        self.events.append(event)
        logger.info(
            "tool_call case_id=%s provider=%s method=%s agent=%s ok=%s fixture=%s "
            "duration_ms=%s lead=%s summary=%s",
            self.case_id,
            provider.value,
            method,
            agent_name,
            ok,
            self.fixture,
            duration_ms,
            lead or "-",
            summary,
        )
        return event


def elapsed_ms(started: float) -> int:
    return max(0, int((perf_counter() - started) * 1000))


def provider_is_fixture(provider: object) -> bool:
    return type(provider).__name__.startswith("Mock")
