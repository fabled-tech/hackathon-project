import asyncio
from types import SimpleNamespace

import pytest

from app.errors import AnalysisProviderError, EvidenceCurationError
from app.integrations.gemini import VertexGeminiClient
from app.integrations.parallel import ParallelSdkClient
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


class FakeGenAio:
    def __init__(self, response_text: str) -> None:
        self.models = FakeGenAIModels(response_text)
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class FakeGenAIClient:
    def __init__(self, response_text: str) -> None:
        self.aio = FakeGenAio(response_text)


class FakeParallelSdk:
    def __init__(self, search_payload: dict, extract_payload: dict) -> None:
        self.search_calls: list[dict] = []
        self.extract_calls: list[dict] = []
        self._search_payload = search_payload
        self._extract_payload = extract_payload

    async def search(self, **kwargs: object) -> SimpleNamespace:
        self.search_calls.append(kwargs)
        return _to_ns(self._search_payload)

    async def extract(self, **kwargs: object) -> SimpleNamespace:
        self.extract_calls.append(kwargs)
        return _to_ns(self._extract_payload)

    async def close(self) -> None:
        return None


def _to_ns(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(
        results=[SimpleNamespace(**item) for item in payload.get("results", [])],
        errors=[SimpleNamespace(**item) for item in payload.get("errors", [])],
    )


def test_search_then_extract_reuses_session_and_restricts_urls() -> None:
    fake = FakeParallelSdk(
        search_payload={
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
                    "publish_date": None,
                    "excerpts": ["A2"],
                },
                {
                    "url": "https://source.test/b",
                    "title": "B",
                    "publish_date": None,
                    "excerpts": ["B"],
                },
            ]
        },
        extract_payload={
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
                    "publish_date": None,
                    "excerpts": ["Must be ignored"],
                },
            ],
            "errors": [{"url": "https://source.test/b", "error_type": "fetch_error"}],
        },
    )
    client = ParallelSdkClient("secret-test-key", "gemini-2.5-flash", client=fake)
    signal = GeminiSignal(
        category="brand_reference",
        detected_item="Example Brand",
        explanation="A named brand.",
        confidence=0.8,
        context_excerpt="An Example Brand can is visible in the scene.",
    )

    async def scenario() -> tuple[list[SearchResult], list[SearchResult]]:
        searched = await client.search(signal, "rightsrader:case-1:0")
        extracted = await client.extract(signal, searched, "rightsrader:case-1:0")
        return searched, extracted

    searched, extracted = asyncio.run(scenario())

    assert [item.source.url for item in searched] == ["https://source.test/a", "https://source.test/b"]
    assert searched[0].publish_date == "2026-07-01"
    assert [item.source.url for item in extracted] == ["https://source.test/a"]
    assert extracted[0].excerpt == "Verified A\n\nMore A"
    assert fake.search_calls[0]["session_id"] == fake.extract_calls[0]["session_id"]
    assert fake.search_calls[0]["client_model"] == "gemini-2.5-flash"
    assert fake.search_calls[0]["mode"] == "advanced"
    assert len(fake.search_calls[0]["search_queries"]) == 3
    assert "Example Brand can is visible" in str(fake.search_calls[0]["objective"])
    assert fake.extract_calls[0]["urls"] == ["https://source.test/a", "https://source.test/b"]


def test_extract_fails_safely_when_no_shortlisted_page_can_be_verified() -> None:
    fake = FakeParallelSdk(
        search_payload={"results": []},
        extract_payload={
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
    client = ParallelSdkClient("secret-test-key", "gemini-2.5-flash", client=fake)
    signal = GeminiSignal(
        category="brand_reference",
        detected_item="Example Brand",
        explanation="A named brand.",
        confidence=0.8,
    )
    candidates = [
        SearchResult(
            source=Source(title="A", url="https://source.test/a"), excerpt="Search excerpt."
        )
    ]

    with pytest.raises(AnalysisProviderError) as error:
        asyncio.run(client.extract(signal, candidates, "rightsrader:case-1:0"))
    assert "secret-test-key" not in str(error.value)
    assert "https://source.test/a" not in str(error.value)


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


@pytest.mark.parametrize(
    "response_text",
    [
        '{"primary_url":null,"rationale":"No candidate is reliable enough."}',
        '{"primary_url":"https://source.test/known","rationale":null}',
    ],
)
def test_vertex_curation_normalizes_incomplete_decisions_to_no_source(
    response_text: str,
) -> None:
    fake = FakeGenAIClient(response_text)
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

    decision = asyncio.run(client.curate_evidence(signal, [candidate]))

    assert decision.primary_url is None
    assert decision.rationale is None


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


def test_vertex_file_detection_sends_multimodal_content_with_schema() -> None:
    fake = FakeGenAIClient(
        "["
        '{"category":"visual_brand","detected_item":"Example Logo",'
        '"explanation":"A visible logo.","confidence":0.8,'
        '"context_excerpt":"Logo on wardrobe."}'
        "]"
    )
    client = VertexGeminiClient(
        "project", "global", "gemini-2.5-flash", client=fake
    )

    signals = asyncio.run(
        client.identify_material_from_file(
            "wardrobe.png",
            "image/png",
            b"\x89PNG\r\n\x1a\nimage",
        )
    )

    assert signals[0].detected_item == "Example Logo"
    call = fake.aio.models.calls[0]
    assert "wardrobe.png" in str(call["contents"][0])  # type: ignore[index]
    assert call["config"].response_schema == list[GeminiSignal]


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


def test_vertex_plan_queries_uses_schema_and_temperature_zero() -> None:
    from app.models.analysis import SearchObjectivePlan

    fake = FakeGenAIClient(
        '{"objectives":["Example Brand trademark register","Example Brand official site"]}'
    )
    client = VertexGeminiClient(
        "project", "global", "gemini-2.5-flash", client=fake
    )
    signal = GeminiSignal(
        category="brand_reference",
        detected_item="Example Brand",
        explanation="A named brand.",
        confidence=0.8,
    )

    objectives = asyncio.run(client.plan_queries(signal))

    assert objectives == [
        "Example Brand trademark register",
        "Example Brand official site",
    ]
    config = fake.aio.models.calls[0]["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_schema is SearchObjectivePlan
    assert config.temperature == 0


def test_vertex_brief_stakeholders_uses_extracted_text_only() -> None:
    from app.models.analysis import StakeholderBrief

    fake = FakeGenAIClient(
        '{"brief":"The official page describes Example Brand as a beverage. '
        'No other origin is stated in the excerpt."}'
    )
    client = VertexGeminiClient(
        "project", "global", "gemini-2.5-flash", client=fake
    )
    signal = GeminiSignal(
        category="brand_reference",
        detected_item="Example Brand",
        explanation="A named brand.",
        confidence=0.8,
    )
    extracted = [
        SearchResult(
            source=Source(title="Official", url="https://source.test/known"),
            excerpt="Example Brand is a beverage sold at kiosks.",
        )
    ]

    brief = asyncio.run(client.brief_stakeholders(signal, extracted))

    assert "beverage" in brief
    prompt = str(fake.aio.models.calls[0]["contents"])
    assert "Example Brand is a beverage sold at kiosks." in prompt
    assert "https://invented.test" not in prompt
    config = fake.aio.models.calls[0]["config"]
    assert config.response_schema is StakeholderBrief
    assert config.temperature == 0


def test_parallel_search_sends_planned_objective() -> None:
    fake = FakeParallelSdk(
        search_payload={
            "results": [
                {
                    "url": "https://source.test/a",
                    "title": "A",
                    "publish_date": None,
                    "excerpts": ["A"],
                }
            ]
        },
        extract_payload={"results": []},
    )
    client = ParallelSdkClient("secret-test-key", "gemini-2.5-flash", client=fake)
    signal = GeminiSignal(
        category="brand_reference",
        detected_item="Example Brand",
        explanation="A named brand.",
        confidence=0.8,
        context_excerpt="An Example Brand can is visible in the scene.",
    )

    results = asyncio.run(
        client.search(signal, "rightsrader:case-1:0", "Example Brand trademark register")
    )

    assert [item.source.url for item in results] == ["https://source.test/a"]
    assert "Example Brand trademark register" in str(fake.search_calls[0]["objective"])
    assert fake.search_calls[0]["session_id"] == "rightsrader:case-1:0"


def test_vertex_client_closes_its_async_transport() -> None:
    fake = FakeGenAIClient("[]")
    client = VertexGeminiClient(
        "project", "global", "gemini-2.5-flash", client=fake
    )

    asyncio.run(client.aclose())

    assert fake.aio.closed is True
