import logging
from collections.abc import Mapping
from typing import Any, Protocol

from app.errors import AnalysisProviderError
from app.models import Source
from app.models.analysis import GeminiSignal, SearchResult

logger = logging.getLogger("rightsrader.integrations")
_MAX_CANDIDATES = 5
_MAX_CHARS_TOTAL = 8_000
_REQUEST_TIMEOUT_SECONDS = 90.0  # Extract live fetch can take up to 60 s per Parallel docs.
_CATEGORY_TERMS = {
    "brand_reference": "brand trademark",
    "quotation": "quote origin",
    "character_reference": "character franchise",
    "likeness_reference": "person likeness",
    "music_reference": "music rights",
}


class ParallelSearchClient(Protocol):
    async def search(
        self,
        signal: GeminiSignal,
        session_id: str,
        objective: str | None = None,
    ) -> list[SearchResult]: ...

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
        "The Matrix": SearchResult(
            source=Source(
                title="The Matrix franchise reference archive (mock)",
                url="https://example.com/the-matrix-franchise-reference",
            ),
            excerpt=(
                "Mock search fixture: The Matrix appears in a franchise-reference archive "
                "used only for the RightsRadar local workflow."
            ),
        ),
        "There is no spoon": SearchResult(
            source=Source(
                title="There is no spoon quotation archive (mock)",
                url="https://example.com/there-is-no-spoon-quotation",
            ),
            excerpt=(
                "Mock search fixture: the phrase is a well-known film quotation recorded "
                "here as deterministic local evidence, not a legal conclusion."
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

    async def search(
        self,
        signal: GeminiSignal,
        session_id: str,
        objective: str | None = None,
    ) -> list[SearchResult]:
        del session_id, objective
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


def _build_search_queries(
    signal: GeminiSignal, objective: str | None = None
) -> list[str]:
    item = _compact_words(signal.detected_item, 4)
    if objective:
        planned = _compact_words(objective, 6)
        return [
            planned,
            _compact_words(f"{item} official source", 6),
            _compact_words(f"{item} origin", 6),
        ]
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


def parallel_search_kwargs(
    signal: GeminiSignal, session_id: str, objective: str | None, client_model: str
) -> dict[str, Any]:
    if objective:
        context = (signal.context_excerpt or "").strip()[:2_000]
        research_objective = f"{objective} Scene context: {context}" if context else objective
    else:
        research_objective = _research_objective(signal)
    return {
        "objective": research_objective,
        "search_queries": _build_search_queries(signal, objective),
        "mode": "advanced",
        "max_chars_total": _MAX_CHARS_TOTAL,
        "session_id": session_id,
        "client_model": client_model,
    }


def parallel_extract_kwargs(
    signal: GeminiSignal, urls: list[str], session_id: str, client_model: str
) -> dict[str, Any]:
    return {
        "urls": urls,
        "objective": _research_objective(signal),
        "search_queries": _build_search_queries(signal),
        "max_chars_total": _MAX_CHARS_TOTAL,
        "session_id": session_id,
        "client_model": client_model,
    }


def _sdk_results_to_payload(response: Any) -> Mapping[str, Any]:
    results = []
    for item in getattr(response, "results", None) or []:
        results.append(
            {
                "url": getattr(item, "url", None),
                "title": getattr(item, "title", None),
                "publish_date": getattr(item, "publish_date", None),
                "excerpts": list(getattr(item, "excerpts", None) or []),
            }
        )
    return {"results": results}


class ParallelSdkClient:
    """Parallel Search and Extract through the official parallel-web SDK."""

    def __init__(self, api_key: str, client_model: str, *, client: Any | None = None) -> None:
        self._client_model = client_model
        self._owns_client = client is None
        self._client = client or self._build_client(api_key)

    @staticmethod
    def _build_client(api_key: str) -> Any:
        from parallel import AsyncParallel

        return AsyncParallel(api_key=api_key, timeout=_REQUEST_TIMEOUT_SECONDS)

    @property
    def sdk(self) -> Any:
        return self._client

    async def _call(self, path: str, **kwargs: Any) -> Mapping[str, Any]:
        logger.info("parallel request path=%s session_id=%s", path, kwargs.get("session_id", "-"))
        try:
            response = await getattr(self._client, path)(**kwargs)
        except Exception as error:
            logger.warning("parallel request failed path=%s error=%s", path, type(error).__name__)
            raise AnalysisProviderError(
                f"Parallel {path} request failed", operation=f"parallel_{path}"
            ) from error
        return _sdk_results_to_payload(response)

    async def search(
        self, signal: GeminiSignal, session_id: str, objective: str | None = None
    ) -> list[SearchResult]:
        payload = await self._call(
            "search", **parallel_search_kwargs(signal, session_id, objective, self._client_model)
        )
        return _normalize_results(payload)

    async def extract(
        self, signal: GeminiSignal, candidates: list[SearchResult], session_id: str
    ) -> list[SearchResult]:
        if not candidates:
            return []
        urls = [candidate.source.url for candidate in candidates]
        payload = await self._call(
            "extract", **parallel_extract_kwargs(signal, urls, session_id, self._client_model)
        )
        extracted = _normalize_results(payload, allowed_urls=set(urls))
        if not extracted:
            raise AnalysisProviderError(
                "Parallel could not extract any shortlisted source", operation="parallel_extract"
            )
        return extracted

    async def aclose(self) -> None:
        if self._owns_client:
            close = getattr(self._client, "close", None)
            if close is not None:
                await close()
