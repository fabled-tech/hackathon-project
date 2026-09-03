from app.agents.contested import is_contested
from app.models import Source
from app.models.analysis import GeminiSignal, SearchResult


def _signal(category: str, confidence: float = 0.95) -> GeminiSignal:
    return GeminiSignal(
        category=category, detected_item="X", explanation="e", confidence=confidence
    )


def _result(url: str) -> SearchResult:
    return SearchResult(source=Source(title=url, url=url), excerpt="text")


def test_franchise_and_quote_categories_are_contested_regardless_of_evidence() -> None:
    assert is_contested(_signal("Film Title/Franchise"), [], below_confidence=0.75)
    assert is_contested(_signal("quotation"), [], below_confidence=0.75)
    assert is_contested(_signal("character_reference"), [], below_confidence=0.75)
    assert is_contested(_signal("likeness_reference"), [], below_confidence=0.75)


def test_low_confidence_brand_is_contested() -> None:
    assert is_contested(_signal("brand_reference", 0.6), [], below_confidence=0.75)


def test_confident_brand_with_only_commercial_sources_is_not_contested() -> None:
    extracted = [_result("https://nimbus.example/brand"), _result("https://news.example/story")]
    assert not is_contested(_signal("brand_reference", 0.9), extracted, below_confidence=0.75)


def test_registry_plus_claimant_is_contested() -> None:
    extracted = [_result("https://www.uspto.gov/trademarks/search"), _result("https://studio.example/press")]
    assert is_contested(_signal("brand_reference", 0.9), extracted, below_confidence=0.75)
