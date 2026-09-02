from urllib.parse import urlparse

from app.models.analysis import GeminiSignal, SearchResult

REGISTRY_HOSTS = frozenset(
    {"uspto.gov", "copyright.gov", "trademarkia.com", "wipo.int", "sec.gov", "justia.com"}
)
_AMBIGUOUS_CATEGORY_TOKENS = ("franchise", "title", "character", "quot", "likeness")


def host_of(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _is_registry(host: str) -> bool:
    return any(host == root or host.endswith("." + root) for root in REGISTRY_HOSTS)


def is_contested(
    signal: GeminiSignal, extracted: list[SearchResult], *, below_confidence: float
) -> bool:
    category = signal.category.lower()
    if any(token in category for token in _AMBIGUOUS_CATEGORY_TOKENS):
        return True
    if signal.confidence < below_confidence:
        return True
    hosts = {host_of(item.source.url) for item in extracted}
    registry = {host for host in hosts if _is_registry(host)}
    return bool(registry) and bool(hosts - registry)
