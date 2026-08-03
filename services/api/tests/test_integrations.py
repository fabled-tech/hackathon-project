import asyncio
import json

import httpx
import pytest

from app.errors import AnalysisProviderError, EvidenceCurationError
from app.integrations.gemini import VertexGeminiClient
from app.integrations.parallel import ParallelSearchHttpClient
from app.models import EvidenceCurationDecision, Source
from app.models.analysis import GeminiSignal, SearchResult


class FakeGenerateContentResponse:
    def __init__(self, text: str) -> None:
        self.text = text


class FakeGenAIModels:
    def __init__(self, response_text: str) -> None:
        self._response_text = response_text
        self.calls: list[dict[str, object]] = []

    async def generate_content(self, **kwargs: object) -> FakeGenerateContentResponse:
        self.calls.append(kwargs)
        return FakeGenerateContentResponse(self._response_text)


class FakeGenAIClient:
    def __init__(self, response_text: str) -> None:
        self.aio = type("FakeAio", (), {"models": FakeGenAIModels(response_text)})()


def test_search_then_extract_reuses_session_and_restricts_urls() -> None:
    requests: list[dict[str, object]] = []

    async def scenario() -> tuple[list[SearchResult], list[SearchResult]]:
        async def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            requests.append(payload)
            if request.url.path.endswith("/search"):
                return httpx.Response(
                    200,
                    json={
                        "results": [
                            {
                                "url": "https://source.test/a",
                                "title": "A",
                                "publish_date": "2026-07-01",
                                "excerpts": ["A"],
                            },
                            {
                                "url": "https://source.test/a",
                                "title": "A duplicate",
                                "excerpts": ["A2"],
                            },
                            {
                                "url": "https://source.test/b",
                                "title": "B",
                                "excerpts": ["B"],
                            },
                        ]
                    },
                )
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "url": "https://source.test/a",
                            "title": "A",
                            "publish_date": "2026-07-01",
                            "excerpts": ["Verified A", "More A"],
                        },
                        {
                            "url": "https://unknown.test",
                            "title": "Unknown",
                            "excerpts": ["Must be ignored"],
                        },
                    ],
                    "errors": [
                        {"url": "https://source.test/b", "error_type": "fetch_error"}
                    ],
                },
            )

        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = ParallelSearchHttpClient(
            "secret-test-key", "gemini-2.5-flash", http_client=http
        )
        signal = GeminiSignal(
            category="brand_reference",
            detected_item="Example Brand",
            explanation="A named brand.",
            confidence=0.8,
            context_excerpt="An Example Brand can is visible in the scene.",
        )
        searched = await client.search(signal, "rightsrader:case-1:0")
        extracted = await client.extract(signal, searched, "rightsrader:case-1:0")
        await http.aclose()
        return searched, extracted

    searched, extracted = asyncio.run(scenario())

    assert [item.source.url for item in searched] == [
        "https://source.test/a",
        "https://source.test/b",
    ]
    assert searched[0].publish_date == "2026-07-01"
    assert [item.source.url for item in extracted] == ["https://source.test/a"]
    assert extracted[0].excerpt == "Verified A\n\nMore A"
    assert requests[0]["session_id"] == requests[1]["session_id"]
    assert requests[0]["client_model"] == "gemini-2.5-flash"
    assert requests[0]["mode"] == "advanced"
    assert len(requests[0]["search_queries"]) == 3  # type: ignore[arg-type]
    assert "Example Brand can is visible" in str(requests[0]["objective"])
    assert requests[1]["urls"] == ["https://source.test/a", "https://source.test/b"]


def test_extract_fails_safely_when_no_shortlisted_page_can_be_verified() -> None:
    async def scenario() -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(
                200,
                json={
                    "results": [],
                    "errors": [
                        {
                            "url": "https://source.test/a",
                            "error_type": "fetch_error",
                            "content": "secret-test-key must not escape",
                        }
                    ],
                },
            )

        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = ParallelSearchHttpClient(
            "secret-test-key", "gemini-2.5-flash", http_client=http
        )
        signal = GeminiSignal(
            category="brand_reference",
            detected_item="Example Brand",
            explanation="A named brand.",
            confidence=0.8,
        )
        candidates = [
            SearchResult(
                source=Source(title="A", url="https://source.test/a"),
                excerpt="Search excerpt.",
            )
        ]
        try:
            with pytest.raises(AnalysisProviderError) as error:
                await client.extract(signal, candidates, "rightsrader:case-1:0")
            assert "secret-test-key" not in str(error.value)
            assert "https://source.test/a" not in str(error.value)
        finally:
            await http.aclose()

    asyncio.run(scenario())


def test_vertex_curation_uses_schema_and_rejects_unknown_url() -> None:
    fake = FakeGenAIClient(
        '{"primary_url":"https://unknown.test","rationale":"Not grounded."}'
    )
    client = VertexGeminiClient(
        "project", "global", "gemini-2.5-flash", client=fake
    )
    signal = GeminiSignal(
        category="quotation",
        detected_item="Example quote",
        explanation="A quotation.",
        confidence=0.7,
    )
    candidate = SearchResult(
        source=Source(title="Known", url="https://source.test/known"),
        excerpt="Known excerpt.",
    )

    with pytest.raises(EvidenceCurationError):
        asyncio.run(client.curate_evidence(signal, [candidate]))

    config = fake.aio.models.calls[0]["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_schema is EvidenceCurationDecision


def test_vertex_detection_uses_schema_and_returns_contextual_signals() -> None:
    fake = FakeGenAIClient(
        "["
        '{"category":"brand_reference","detected_item":"Example Brand",'
        '"explanation":"A named brand.","confidence":0.8,'
        '"context_excerpt":"An Example Brand can appears."}'
        "]"
    )
    client = VertexGeminiClient(
        "project", "global", "gemini-2.5-flash", client=fake
    )

    signals = asyncio.run(client.identify_material("An Example Brand can appears."))

    assert signals[0].context_excerpt == "An Example Brand can appears."
    config = fake.aio.models.calls[0]["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_schema == list[GeminiSignal]


def test_vertex_curation_wraps_malformed_json_without_exposing_it() -> None:
    fake = FakeGenAIClient("secret malformed provider output")
    client = VertexGeminiClient(
        "project", "global", "gemini-2.5-flash", client=fake
    )
    signal = GeminiSignal(
        category="brand_reference",
        detected_item="Example Brand",
        explanation="A named brand.",
        confidence=0.8,
    )
    candidates = [
        SearchResult(
            source=Source(title="Known", url="https://source.test/known"),
            excerpt="Known excerpt.",
        )
    ]

    with pytest.raises(EvidenceCurationError) as error:
        asyncio.run(client.curate_evidence(signal, candidates))

    assert "secret malformed provider output" not in str(error.value)
