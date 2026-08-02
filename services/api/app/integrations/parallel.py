from typing import Protocol

import httpx

from app.models import Source
from app.models.analysis import SearchResult


class ParallelSearchClient(Protocol):
    def search(self, detected_item: str, category: str) -> list[SearchResult]: ...


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

    def search(self, detected_item: str, category: str) -> list[SearchResult]:
        del category
        result = self._FIXTURES.get(detected_item)
        return [result] if result else []


class ParallelSearchHttpClient:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def search(self, detected_item: str, category: str) -> list[SearchResult]:
        response = httpx.post(
            "https://api.parallel.ai/v1/search",
            headers={"x-api-key": self._api_key},
            json={
                "objective": (
                    "Gather current, traceable research sources for a human rights-clearance "
                    f"review of this {category}: {detected_item}. Do not provide legal advice."
                ),
                "search_queries": [detected_item, f"{detected_item} {category}"],
                "max_chars_total": 2_000,
            },
            timeout=20,
        )
        response.raise_for_status()
        results: list[SearchResult] = []
        for item in response.json().get("results", []):
            excerpts = item.get("excerpts") or []
            results.append(
                SearchResult(
                    source=Source(title=item.get("title") or item["url"], url=item["url"]),
                    excerpt=(
                        excerpts[0]
                        if excerpts
                        else "No excerpt was returned by Parallel Search."
                    ),
                )
            )
        return results
