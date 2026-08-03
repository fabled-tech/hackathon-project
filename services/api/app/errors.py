class AnalysisUnavailableError(RuntimeError):
    """An analysis provider or its structured result cannot be used."""


class AnalysisProviderError(AnalysisUnavailableError):
    """An upstream retrieval or model call failed."""


class EvidenceCurationError(AnalysisUnavailableError):
    """Gemini returned malformed or ungrounded evidence curation output."""
