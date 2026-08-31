from time import perf_counter

from app.agents.messages import agent_message
from app.agents.trace import ToolCallRecorder, elapsed_ms, provider_is_fixture
from app.integrations import GeminiClient
from app.models import CaseThreadMessage, ToolCallProvider
from app.models.analysis import GeminiSignal


class IntakeAgent:
    name = "Intake"

    def __init__(self, gemini: GeminiClient) -> None:
        self._gemini = gemini

    async def detect_text(
        self, script_text: str, recorder: ToolCallRecorder
    ) -> list[GeminiSignal]:
        started = perf_counter()
        signals = await self._gemini.identify_material(script_text)
        recorder.record(
            ToolCallProvider.VERTEX,
            "identify_material",
            self.name,
            f"Vertex Gemini detected {len(signals)} lead(s).",
            duration_ms=elapsed_ms(started),
            fixture=provider_is_fixture(self._gemini),
        )
        return signals

    async def detect_file(
        self,
        filename: str,
        content_type: str,
        content: bytes,
        recorder: ToolCallRecorder,
    ) -> list[GeminiSignal]:
        started = perf_counter()
        signals = await self._gemini.identify_material_from_file(
            filename, content_type, content
        )
        recorder.record(
            ToolCallProvider.VERTEX,
            "identify_material_from_file",
            self.name,
            (
                f"Vertex Gemini reviewed {filename} ({content_type}) "
                f"and detected {len(signals)} lead(s)."
            ),
            duration_ms=elapsed_ms(started),
            fixture=provider_is_fixture(self._gemini),
        )
        return signals

    def announce(self, case_id: str, signals: list[GeminiSignal]) -> CaseThreadMessage:
        if not signals:
            body = "No clearance leads detected. @Research has nothing to run."
        else:
            items = ", ".join(signal.detected_item for signal in signals)
            noun = "lead" if len(signals) == 1 else "leads"
            body = f"Detected {len(signals)} {noun}: {items}. @Research"
        return agent_message(case_id, self.name, body)
