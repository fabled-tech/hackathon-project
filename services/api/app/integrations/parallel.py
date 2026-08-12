from typing import Protocol

import httpx

from app.errors import AnalysisProviderError
from app.models import Source
from app.models.analysis import SearchResult


class ParallelSearchClient(Protocol):
    def search(
        self, detected_item: str, category: str, context_excerpt: str = ""
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
    }

    def search(
        self, detected_item: str, category: str, context_excerpt: str = ""
    ) -> list[SearchResult]:
        del category, context_excerpt
        result = self._FIXTURES.get(detected_item)
        return [result] if result else []


class ParallelSearchHttpClient:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def search(
        self, detected_item: str, category: str, context_excerpt: str = ""
    ) -> list[SearchResult]:
        try:
            response = httpx.post(
                "https://api.parallel.ai/v1/search",
                headers={"x-api-key": self._api_key},
                json={
                    "objective": (
                        "Gather current, traceable research sources for a human rights-clearance "
                        f"review of this {category}: {detected_item}. Scene context: "
                        f"{context_excerpt or 'No scene context provided.'} "
                        "Use results solely for research; do not provide legal advice."
                    ),
                    "search_queries": self._build_search_queries(detected_item, category),
                    "max_chars_total": 2_000,
                },
                timeout=20,
            )
        except httpx.HTTPError as error:
            raise AnalysisProviderError("Parallel Search request failed.") from error

        if not 200 <= response.status_code < 300:
            raise AnalysisProviderError("Parallel Search request failed.")

        try:
            payload = response.json()
            raw_results = payload["results"]
        except (KeyError, TypeError, ValueError) as error:
            raise AnalysisProviderError("Parallel Search returned a malformed response.") from error

        if not isinstance(raw_results, list):
            raise AnalysisProviderError("Parallel Search returned a malformed response.")

        results: list[SearchResult] = []
        seen_urls: set[str] = set()
        for item in raw_results:
            if not isinstance(item, dict):
                continue
            url = item.get("url")
            if not isinstance(url, str) or not url or url in seen_urls:
                continue
            title = item.get("title")
            excerpts = item.get("excerpts")
            excerpt = excerpts[0] if isinstance(excerpts, list) and excerpts else None
            if not isinstance(excerpt, str):
                excerpt = "No excerpt was returned by Parallel Search."
            results.append(
                SearchResult(
                    source=Source(
                        title=title if isinstance(title, str) and title else url, url=url
                    ),
                    excerpt=excerpt,
                )
            )
            seen_urls.add(url)
            if len(results) == 5:
                break
        return results

    def _build_search_queries(self, detected_item: str, category: str) -> list[str]:
        item_keywords = self._normalized_keywords(detected_item, ("item",), maximum=3)
        category_keywords = self._normalized_keywords(category, ("reference",), maximum=2)
        base_keywords = [*item_keywords, *category_keywords]
        return [
            " ".join([*base_keywords, "details"]),
            " ".join([*item_keywords, "official", *category_keywords]),
            " ".join([*base_keywords, "source"]),
        ]

    @staticmethod
    def _normalized_keywords(value: str, fallback: tuple[str, ...], maximum: int) -> list[str]:
        keywords = value.replace("_", " ").split()
        return keywords[:maximum] or list(fallback)
