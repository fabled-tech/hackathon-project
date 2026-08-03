import sys
from types import ModuleType, SimpleNamespace

import httpx
import pytest

from app.errors import AnalysisProviderError, EvidenceCurationError
from app.integrations.gemini import MockGeminiClient, VertexGeminiClient
from app.integrations.parallel import ParallelSearchHttpClient
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


def test_parallel_search_includes_context_and_returns_unique_bounded_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_post(
        url: str, *, headers: dict[str, str], json: dict[str, object], timeout: int
    ) -> httpx.Response:
        del url, headers, timeout
        captured.update(json)
        return httpx.Response(
            200,
            json={
                "results": [
                    {"url": "https://source.test/1", "title": "One", "excerpts": ["A"]},
                    {
                        "url": "https://source.test/1",
                        "title": "One duplicate",
                        "excerpts": ["A2"],
                    },
                    {"url": "https://source.test/2", "title": "Two", "excerpts": ["B"]},
                    {"url": "https://source.test/3", "title": "Three", "excerpts": ["C"]},
                    {"url": "https://source.test/4", "title": "Four", "excerpts": ["D"]},
                    {"url": "https://source.test/5", "title": "Five", "excerpts": ["E"]},
                    {"url": "https://source.test/6", "title": "Six", "excerpts": ["F"]},
                    {"title": "Missing URL", "excerpts": ["ignored"]},
                ]
            },
        )

    monkeypatch.setattr("app.integrations.parallel.httpx.post", fake_post)

    results = ParallelSearchHttpClient("secret-test-key").search(
        "Example Brand", "brand_reference", "She holds the product in the scene."
    )

    assert [result.source.url for result in results] == [
        "https://source.test/1",
        "https://source.test/2",
        "https://source.test/3",
        "https://source.test/4",
        "https://source.test/5",
    ]
    assert results[0].source.title == "One"
    assert results[0].excerpt == "A"
    objective = captured["objective"]
    search_queries = captured["search_queries"]
    assert isinstance(objective, str)
    assert isinstance(search_queries, list)
    assert "She holds the product" in objective
    assert len(search_queries) == 3


@pytest.mark.parametrize(
    "post_error",
    [httpx.TimeoutException("connection timed out"), httpx.HTTPError("request failed")],
)
def test_parallel_search_converts_http_client_errors_without_exposing_credentials(
    monkeypatch: pytest.MonkeyPatch, post_error: httpx.HTTPError
) -> None:
    def fake_post(url: str, **kwargs: object) -> httpx.Response:
        del url, kwargs
        raise post_error

    monkeypatch.setattr("app.integrations.parallel.httpx.post", fake_post)

    with pytest.raises(AnalysisProviderError) as error:
        ParallelSearchHttpClient("secret-test-key").search("Example Brand", "brand_reference")

    assert "secret-test-key" not in str(error.value)


def test_parallel_search_converts_non_success_responses(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_post(url: str, **kwargs: object) -> httpx.Response:
        del url, kwargs
        return httpx.Response(503, json={"error": "provider details"})

    monkeypatch.setattr("app.integrations.parallel.httpx.post", fake_post)

    with pytest.raises(AnalysisProviderError) as error:
        ParallelSearchHttpClient("secret-test-key").search("Example Brand", "brand_reference")

    assert "malformed" not in str(error.value)
    assert "provider details" not in str(error.value)
    assert "secret-test-key" not in str(error.value)


def test_parallel_search_rejects_malformed_provider_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_post(url: str, **kwargs: object) -> httpx.Response:
        del url, kwargs
        return httpx.Response(200, json={"results": "not a list"})

    monkeypatch.setattr("app.integrations.parallel.httpx.post", fake_post)

    with pytest.raises(AnalysisProviderError, match="malformed"):
        ParallelSearchHttpClient("secret-test-key").search("Example Brand", "brand_reference")


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
