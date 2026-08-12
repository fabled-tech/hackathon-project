import httpx
import pytest

from app.agents import RightsClearanceAgentService
from app.errors import AnalysisProviderError
from app.integrations.gemini import MockGeminiClient
from app.integrations.parallel import ParallelSearchHttpClient
from app.models.analysis import EvidenceCurationDecision, GeminiSignal, SearchResult
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
    assert all(3 <= len(query.split()) <= 6 for query in search_queries)


def test_parallel_search_queries_stay_within_word_limit_for_long_inputs() -> None:
    queries = ParallelSearchHttpClient("secret-test-key")._build_search_queries(
        "The Very Long Example Product Name", "extremely_specific_brand_reference_category"
    )

    assert len(queries) == 3
    assert all(3 <= len(query.split()) <= 6 for query in queries)


def test_agent_passes_signal_context_to_parallel_search() -> None:
    signal = _signal()
    parallel = ContextCapturingParallelClient()

    RightsClearanceAgentService(ContextGeminiClient(signal), parallel).analyze("case-1", "Script")

    assert parallel.context_excerpts == [signal.context_excerpt]


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


def _signal() -> GeminiSignal:
    return GeminiSignal(
        category="brand_reference",
        detected_item="Example Brand",
        explanation="A named brand.",
        confidence=0.8,
        context_excerpt="She holds an Example Brand can.",
    )


class ContextGeminiClient:
    def __init__(self, signal: GeminiSignal) -> None:
        self._signal = signal

    def identify_material(self, script_text: str) -> list[GeminiSignal]:
        del script_text
        return [self._signal]

    def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        del signal, candidates
        return EvidenceCurationDecision()


class ContextCapturingParallelClient:
    def __init__(self) -> None:
        self.context_excerpts: list[str] = []

    def search(
        self, detected_item: str, category: str, context_excerpt: str = ""
    ) -> list[SearchResult]:
        del detected_item, category
        self.context_excerpts.append(context_excerpt)
        return []
