from typing import Protocol

from app.models.analysis import EvidenceCurationDecision, GeminiSignal, SearchResult


class GeminiClient(Protocol):
    def identify_material(self, script_text: str) -> list[GeminiSignal]: ...

    def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision: ...


class MockGeminiClient:
    """Deterministic fixture detector for local development and tests."""

    def identify_material(self, script_text: str) -> list[GeminiSignal]:
        normalized = script_text.casefold()
        signals: list[GeminiSignal] = []
        if "nimbus soda" in normalized:
            signals.append(
                GeminiSignal(
                    category="brand_reference",
                    detected_item="Nimbus Soda",
                    explanation=(
                        "The script names a fictional beverage brand; a reviewer should determine "
                        "whether it could be confused with a real mark in the final production."
                    ),
                    confidence=0.84,
                )
            )
        if "time keeps the reel turning" in normalized:
            signals.append(
                GeminiSignal(
                    category="quotation",
                    detected_item="Time keeps the reel turning",
                    explanation=(
                        "The script includes a distinctive fictional quotation; a reviewer should "
                        "confirm its origin before release."
                    ),
                    confidence=0.76,
                )
            )
        return signals

    def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        if not candidates:
            return EvidenceCurationDecision()
        return EvidenceCurationDecision(
            primary_url=candidates[0].source.url,
            rationale="Deterministically selected the first retrieved candidate for local review.",
        )
