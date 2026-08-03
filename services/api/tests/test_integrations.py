import sys
from types import ModuleType, SimpleNamespace

import pytest

from app.errors import EvidenceCurationError
from app.integrations.gemini import MockGeminiClient, VertexGeminiClient
from app.models.analysis import GeminiSignal, SearchResult
from app.models.cases import Source


def test_mock_curator_selects_only_a_retrieved_candidate() -> None:
    candidate = SearchResult(
        source=Source(title="Official source", url="https://source.test/item"),
        excerpt="A relevant excerpt.",
    )

    decision = MockGeminiClient().curate_evidence(
        GeminiSignal(
            category="brand_reference",
            detected_item="Example Brand",
            explanation="A named brand.",
            confidence=0.8,
            context_excerpt="She holds an Example Brand can.",
        ),
        [candidate],
    )

    assert decision.primary_url == "https://source.test/item"
    assert decision.rationale


def test_mock_curator_returns_a_neutral_decision_without_candidates() -> None:
    decision = MockGeminiClient().curate_evidence(_signal(), [])

    assert decision.primary_url is None
    assert decision.rationale is None


def test_vertex_curator_accepts_a_neutral_model_decision(monkeypatch: pytest.MonkeyPatch) -> None:
    generated = _install_vertex_response(monkeypatch, '{"primary_url": null, "rationale": null}')
    candidate = _candidate()

    decision = VertexGeminiClient("project", "location", "model").curate_evidence(
        _signal(), [candidate]
    )

    assert decision.primary_url is None
    assert decision.rationale is None
    prompt = generated["contents"]
    assert candidate.source.title in prompt
    assert candidate.source.url in prompt
    assert candidate.excerpt in prompt
    assert "She holds an Example Brand can." in prompt


@pytest.mark.parametrize(
    "response",
    [
        "not json",
        '{"primary_url": null}',
        '{"primary_url": "https://unretrieved.test", "rationale": "Looks good"}',
    ],
)
def test_vertex_curator_rejects_malformed_or_ungrounded_model_output(
    monkeypatch: pytest.MonkeyPatch, response: str
) -> None:
    _install_vertex_response(monkeypatch, response)

    with pytest.raises(EvidenceCurationError):
        VertexGeminiClient("project", "location", "model").curate_evidence(
            _signal(), [_candidate()]
        )


def _signal() -> GeminiSignal:
    return GeminiSignal(
        category="brand_reference",
        detected_item="Example Brand",
        explanation="A named brand.",
        confidence=0.8,
        context_excerpt="She holds an Example Brand can.",
    )


def _candidate() -> SearchResult:
    return SearchResult(
        source=Source(title="Official source", url="https://source.test/item"),
        excerpt="A relevant excerpt.",
    )


def _install_vertex_response(monkeypatch: pytest.MonkeyPatch, response_text: str) -> dict[str, str]:
    generated: dict[str, str] = {}

    class FakeClient:
        def __init__(self, **kwargs: object) -> None:
            self.models = SimpleNamespace(generate_content=self.generate_content)

        def generate_content(self, **kwargs: object) -> SimpleNamespace:
            generated["contents"] = str(kwargs["contents"])
            return SimpleNamespace(text=response_text)

    google = ModuleType("google")
    genai = ModuleType("google.genai")
    types = ModuleType("google.genai.types")
    genai.Client = FakeClient  # type: ignore[attr-defined]
    types.HttpOptions = lambda **kwargs: kwargs  # type: ignore[attr-defined]
    types.GenerateContentConfig = lambda **kwargs: kwargs  # type: ignore[attr-defined]
    google.genai = genai  # type: ignore[attr-defined]
    genai.types = types  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "google", google)
    monkeypatch.setitem(sys.modules, "google.genai", genai)
    monkeypatch.setitem(sys.modules, "google.genai.types", types)
    return generated
