import json
from typing import Protocol

from app.models.analysis import GeminiSignal


class GeminiClient(Protocol):
    def identify_material(self, script_text: str) -> list[GeminiSignal]: ...


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


class VertexGeminiClient:
    def __init__(self, project: str, location: str, model: str) -> None:
        self._project = project
        self._location = location
        self._model = model

    def identify_material(self, script_text: str) -> list[GeminiSignal]:
        from google import genai
        from google.genai import types

        client = genai.Client(
            vertexai=True,
            project=self._project,
            location=self._location,
            http_options=types.HttpOptions(api_version="v1"),
        )
        response = client.models.generate_content(
            model=self._model,
            contents=(
                "Identify possible rights-clearance research leads in this script. "
                "Do not give legal advice or make infringement conclusions. Return only a JSON "
                "array of objects with category, detected_item, explanation, and confidence "
                "(0 to 1).\n\nScript:\n" + script_text
            ),
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        payload = json.loads(response.text or "[]")
        if not isinstance(payload, list):
            raise ValueError("Gemini response was not a JSON list")
        return [GeminiSignal.model_validate(item) for item in payload]
