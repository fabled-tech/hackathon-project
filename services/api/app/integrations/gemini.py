import json
from typing import Protocol

from pydantic import ValidationError

from app.errors import EvidenceCurationError
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
                "array of objects with category, detected_item, explanation, confidence "
                "(0 to 1), and context_excerpt.\n\nScript:\n" + script_text
            ),
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        payload = json.loads(response.text or "[]")
        if not isinstance(payload, list):
            raise ValueError("Gemini response was not a JSON list")
        return [GeminiSignal.model_validate(item) for item in payload]

    def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        from google import genai
        from google.genai import types

        client = genai.Client(
            vertexai=True,
            project=self._project,
            location=self._location,
            http_options=types.HttpOptions(api_version="v1"),
        )
        candidate_details = [
            {
                "title": candidate.source.title,
                "url": candidate.source.url,
                "excerpt": candidate.excerpt,
            }
            for candidate in candidates
        ]
        response = client.models.generate_content(
            model=self._model,
            contents=(
                "Select at most one retrieved source as a research lead for this possible "
                "rights-clearance issue. Do not give legal advice or make infringement "
                "conclusions. Select null when no candidate is reliable. You may choose only "
                "a candidate URL provided below; never copy, infer, or create another URL. "
                "Return only a JSON object with exactly primary_url (string or null) and "
                "rationale (string or null).\n\n"
                f"Signal:\n{json.dumps(signal.model_dump())}\n\n"
                f"Retrieved candidates:\n{json.dumps(candidate_details)}"
            ),
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        return _parse_curation_decision(response.text, candidates)


def _parse_curation_decision(
    response_text: str | None, candidates: list[SearchResult]
) -> EvidenceCurationDecision:
    try:
        payload = json.loads(response_text or "")
    except json.JSONDecodeError as exc:
        raise EvidenceCurationError("Gemini returned invalid evidence curation JSON") from exc

    if not isinstance(payload, dict) or set(payload) != {"primary_url", "rationale"}:
        raise EvidenceCurationError("Gemini returned an incomplete evidence curation decision")

    try:
        decision = EvidenceCurationDecision.model_validate(payload)
    except ValidationError as exc:
        raise EvidenceCurationError(
            "Gemini returned an invalid evidence curation decision"
        ) from exc

    candidate_urls = {candidate.source.url for candidate in candidates}
    if decision.primary_url is not None and decision.primary_url not in candidate_urls:
        raise EvidenceCurationError("Gemini selected an evidence URL that was not retrieved")
    return decision
