import json
from typing import Any, Protocol

from pydantic import ValidationError

from app.errors import AnalysisProviderError, EvidenceCurationError
from app.models.analysis import EvidenceCurationDecision, GeminiSignal, SearchResult


class GeminiClient(Protocol):
    async def identify_material(self, script_text: str) -> list[GeminiSignal]: ...

    async def identify_material_from_file(
        self,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> list[GeminiSignal]: ...

    async def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision: ...


class MockGeminiClient:
    """Deterministic fixture detector and curator for local development and tests."""

    async def identify_material(self, script_text: str) -> list[GeminiSignal]:
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
                    context_excerpt=script_text,
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
                    context_excerpt=script_text,
                )
            )
        if "captain aurelia" in normalized:
            signals.append(
                GeminiSignal(
                    category="character_reference",
                    detected_item="Captain Aurelia",
                    explanation=(
                        "The script names a fictional character reference; a reviewer should "
                        "research whether it merits follow-up before release."
                    ),
                    confidence=0.78,
                )
            )
        if "the copper comet chronicles" in normalized:
            signals.append(
                GeminiSignal(
                    category="franchise_reference",
                    detected_item="The Copper Comet Chronicles",
                    explanation=(
                        "The script names a fictional franchise-style reference; a reviewer "
                        "should research its creative source before release."
                    ),
                    confidence=0.74,
                )
            )
        if "rowan voss" in normalized:
            signals.append(
                GeminiSignal(
                    category="likeness_reference",
                    detected_item="Rowan Voss",
                    explanation=(
                        "The script names a fictional likeness reference; a reviewer should "
                        "research whether it merits follow-up before release."
                    ),
                    confidence=0.71,
                )
            )
        return signals

    async def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        del signal
        if not candidates:
            return EvidenceCurationDecision(primary_url=None, rationale=None)
        return EvidenceCurationDecision(
            primary_url=candidates[0].source.url,
            rationale="The retrieved source directly matches the detected research lead.",
        )

    async def identify_material_from_file(
        self,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> list[GeminiSignal]:
        del content
        return [
            GeminiSignal(
                category="production_asset",
                detected_item=filename,
                explanation=(
                    f"The uploaded {content_type} production asset should be reviewed for "
                    "brands, artwork, characters, quotations, music, and likenesses."
                ),
                confidence=0.65,
                context_excerpt=f"Uploaded production asset: {filename}",
            )
        ]


class VertexGeminiClient:
    def __init__(
        self,
        project: str,
        location: str,
        model: str,
        *,
        client: Any | None = None,
    ) -> None:
        self._project = project
        self._location = location
        self._model = model
        self._client = client or self._build_client()

    async def aclose(self) -> None:
        await self._client.aio.aclose()

    def _build_client(self) -> Any:
        from google import genai
        from google.genai import types

        return genai.Client(
            vertexai=True,
            project=self._project,
            location=self._location,
            http_options=types.HttpOptions(api_version="v1"),
        )

    async def identify_material(self, script_text: str) -> list[GeminiSignal]:
        from google.genai import types

        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=(
                    "Identify distinct possible rights-clearance research leads in this script. "
                    "Include enough local scene context to distinguish the reference. Do not give "
                    "legal advice or make infringement conclusions.\n\nScript:\n" + script_text
                ),
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=list[GeminiSignal],
                    temperature=0,
                ),
            )
        except Exception as error:
            raise AnalysisProviderError(
                "Gemini lead detection failed", operation="gemini_lead_detection"
            ) from error

        try:
            payload = json.loads(response.text or "[]")
            if not isinstance(payload, list):
                raise ValueError("Gemini response was not a JSON list")
            return [GeminiSignal.model_validate(item) for item in payload]
        except (json.JSONDecodeError, TypeError, ValueError, ValidationError) as error:
            raise AnalysisProviderError(
                "Gemini lead detection returned invalid output",
                operation="gemini_lead_detection",
            ) from error

    async def identify_material_from_file(
        self,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> list[GeminiSignal]:
        from google.genai import types

        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=[
                    (
                        "Identify distinct possible rights-clearance research leads in this "
                        f"production file named {filename}. Inspect visible text, imagery, logos, "
                        "artwork, products, people, characters, quotations, music references, and "
                        "other potentially protectable material. Include enough local context to "
                        "distinguish each lead. Do not give legal advice or make infringement "
                        "conclusions."
                    ),
                    types.Part.from_bytes(data=content, mime_type=content_type),
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=list[GeminiSignal],
                    temperature=0,
                ),
            )
        except Exception as error:
            raise AnalysisProviderError(
                "Gemini file lead detection failed",
                operation="gemini_file_lead_detection",
            ) from error

        try:
            payload = json.loads(response.text or "[]")
            if not isinstance(payload, list):
                raise ValueError("Gemini response was not a JSON list")
            return [GeminiSignal.model_validate(item) for item in payload]
        except (json.JSONDecodeError, TypeError, ValueError, ValidationError) as error:
            raise AnalysisProviderError(
                "Gemini file lead detection returned invalid output",
                operation="gemini_file_lead_detection",
            ) from error

    async def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        from google.genai import types

        if not candidates:
            return EvidenceCurationDecision(primary_url=None, rationale=None)

        candidate_payload = [candidate.model_dump(mode="json") for candidate in candidates]
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=(
                    "Select at most one supplied source that is directly relevant to this "
                    "rights-clearance research lead. Select no source when the candidates are "
                    "ambiguous or unreliable. Do not make legal conclusions, create citations, "
                    "invent URLs, or quote text not present in the candidates. When selecting no "
                    "source, return null for both primary_url and rationale.\n\nLead:\n"
                    + signal.model_dump_json()
                    + "\n\nExtracted candidates:\n"
                    + json.dumps(candidate_payload)
                ),
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=EvidenceCurationDecision,
                    temperature=0,
                ),
            )
        except Exception as error:
            raise AnalysisProviderError(
                "Gemini evidence curation failed", operation="gemini_evidence_curation"
            ) from error

        try:
            decision = EvidenceCurationDecision.model_validate_json(response.text or "{}")
        except (ValidationError, ValueError) as error:
            raise EvidenceCurationError(
                "Gemini evidence curation returned invalid output"
            ) from error

        candidate_urls = {candidate.source.url for candidate in candidates}
        if decision.primary_url is not None and decision.primary_url not in candidate_urls:
            raise EvidenceCurationError("Gemini selected an unknown evidence URL")
        if decision.primary_url is None or not decision.rationale:
            return EvidenceCurationDecision(primary_url=None, rationale=None)
        return decision
