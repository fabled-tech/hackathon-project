from collections.abc import Mapping
from typing import Any, Protocol

import httpx

from app.errors import AnalysisProviderError
from app.models import Source
from app.models.analysis import GeminiSignal, SearchResult

_PARALLEL_API_ROOT = "https://api.parallel.ai/v1"
_MAX_CANDIDATES = 5
_MAX_CHARS_TOTAL = 8_000
_CATEGORY_TERMS = {
    "brand_reference": "brand trademark",
    "quotation": "quote origin",
    "character_reference": "character franchise",
    "likeness_reference": "person likeness",
    "music_reference": "music rights",
}


class ParallelSearchClient(Protocol):
    async def search(self, signal: GeminiSignal, session_id: str) -> list[SearchResult]: ...

    async def extract(
        self, signal: GeminiSignal, candidates: list[SearchResult], session_id: str
    ) -> list[SearchResult]: ...


class MockParallelSearchClient:
    _FIXTURES = {
        "Nimbus Soda": SearchResult(
            source=Source(
                title="Nimbus Soda brand reference archive (mock)",
                url="https://example.com/nimbus-soda-brand-reference",
            ),
            excerpt=(
                "Mock search fixture: Nimbus Soda appears in a fictional brand-reference archive "
                "used only for the RightsRadar local workflow."
            ),
        ),
        "Time keeps the reel turning": SearchResult(
            source=Source(
                title="Lena Quill interview archive (mock)",
                url="https://example.com/lena-quill-interview",
            ),
            excerpt=(
                "Mock search fixture: the phrase is attributed to fictional filmmaker Lena Quill "
                "in this deterministic local evidence record."
            ),
        ),
        "Captain Aurelia": SearchResult(
            source=Source(
                title="Captain Aurelia character reference archive (mock)",
                url="https://example.com/captain-aurelia-character-reference",
            ),
            excerpt=(
                "Mock search fixture: Captain Aurelia appears in a fictional character-reference "
                "archive used only for the RightsRadar local workflow."
            ),
        ),
        "The Copper Comet Chronicles": SearchResult(
            source=Source(
                title="The Copper Comet Chronicles franchise reference archive (mock)",
                url="https://example.com/copper-comet-chronicles-franchise-reference",
            ),
            excerpt=(
                "Mock search fixture: The Copper Comet Chronicles appears in a fictional franchise "
                "reference archive used only for the RightsRadar local workflow."
            ),
        ),
        "Rowan Voss": SearchResult(
            source=Source(
                title="Rowan Voss likeness reference archive (mock)",
                url="https://example.com/rowan-voss-likeness-reference",
            ),
            excerpt=(
                "Mock search fixture: Rowan Voss appears in a fictional likeness-reference archive "
                "used only for the RightsRadar local workflow."
            ),
        ),
    }

    async def search(self, signal: GeminiSignal, session_id: str) -> list[SearchResult]:
        del session_id
        result = self._FIXTURES.get(signal.detected_item)
        return [result] if result else []

    async def extract(
        self, signal: GeminiSignal, candidates: list[SearchResult], session_id: str
    ) -> list[SearchResult]:
        del signal
        del session_id
        return candidates


def _compact_words(value: str, limit: int) -> str:
    return " ".join(value.split()[:limit])


def _build_search_queries(signal: GeminiSignal) -> list[str]:
    item = _compact_words(signal.detected_item, 4)
    category = _CATEGORY_TERMS.get(signal.category, signal.category.replace("_", " "))
    category = _compact_words(category, 2)
    return [
        _compact_words(f"{item} {category}", 6),
        _compact_words(f"{item} origin attribution", 6),
        _compact_words(f"{item} official source", 6),
    ]


def _research_objective(signal: GeminiSignal) -> str:
    context = signal.context_excerpt.strip() or "No additional scene context was supplied."
    return (
        "Gather traceable sources that help a human reviewer identify the real-world origin, "
        f"identity, or attribution of this {signal.category.replace('_', ' ')} lead: "
        f"{signal.detected_item}. Scene context: {context[:2_000]} "
        "Prefer authoritative primary sources when available. Do not provide legal advice or "
        "make infringement conclusions."
    )


def _normalize_results(
    payload: Mapping[str, Any], *, allowed_urls: set[str] | None = None
) -> list[SearchResult]:
    raw_results = payload.get("results")
    if not isinstance(raw_results, list):
        raise AnalysisProviderError("Parallel returned an invalid result list")

    normalized: list[SearchResult] = []
    seen_urls: set[str] = set()
    for raw in raw_results:
        if not isinstance(raw, Mapping):
            continue
        url = raw.get("url")
        excerpts = raw.get("excerpts")
        if (
            not isinstance(url, str)
            or not url
            or url in seen_urls
            or (allowed_urls is not None and url not in allowed_urls)
            or not isinstance(excerpts, list)
        ):
            continue
        usable_excerpts = [
            item.strip() for item in excerpts if isinstance(item, str) and item.strip()
        ]
        if not usable_excerpts:
            continue
        title = raw.get("title")
        publish_date = raw.get("publish_date")
        normalized.append(
            SearchResult(
                source=Source(title=title if isinstance(title, str) and title else url, url=url),
                excerpt="\n\n".join(usable_excerpts),
                publish_date=publish_date if isinstance(publish_date, str) else None,
            )
        )
        seen_urls.add(url)
        if len(normalized) == _MAX_CANDIDATES:
            break
    return normalized


class ParallelSearchHttpClient:
    def __init__(
        self,
        api_key: str,
        client_model: str,
        *,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._client_model = client_model
        self._owns_http_client = http_client is None
        self._http_client = http_client or httpx.AsyncClient(timeout=20)

    async def _post(self, path: str, payload: dict[str, object]) -> Mapping[str, Any]:
        try:
            response = await self._http_client.post(
                f"{_PARALLEL_API_ROOT}/{path}",
                headers={"x-api-key": self._api_key},
                json=payload,
            )
            response.raise_for_status()
            parsed = response.json()
        except (httpx.HTTPError, ValueError, TypeError) as error:
            raise AnalysisProviderError(f"Parallel {path} request failed") from error
        if not isinstance(parsed, Mapping):
            raise AnalysisProviderError(f"Parallel {path} returned an invalid response")
        return parsed

    async def search(self, signal: GeminiSignal, session_id: str) -> list[SearchResult]:
        payload = await self._post(
            "search",
            {
                "objective": _research_objective(signal),
                "search_queries": _build_search_queries(signal),
                "mode": "advanced",
                "max_chars_total": _MAX_CHARS_TOTAL,
                "session_id": session_id,
                "client_model": self._client_model,
            },
        )
        return _normalize_results(payload)

    async def extract(
        self, signal: GeminiSignal, candidates: list[SearchResult], session_id: str
    ) -> list[SearchResult]:
        if not candidates:
            return []
        urls = [candidate.source.url for candidate in candidates]
        payload = await self._post(
            "extract",
            {
                "urls": urls,
                "objective": _research_objective(signal),
                "search_queries": _build_search_queries(signal),
                "max_chars_total": _MAX_CHARS_TOTAL,
                "session_id": session_id,
                "client_model": self._client_model,
            },
        )
        extracted = _normalize_results(payload, allowed_urls=set(urls))
        if not extracted:
            raise AnalysisProviderError("Parallel could not extract any shortlisted source")
        return extracted

    async def aclose(self) -> None:
        if self._owns_http_client:
            await self._http_client.aclose()
