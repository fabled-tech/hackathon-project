class AnalysisUnavailableError(RuntimeError):
    """The requested analysis could not be completed safely."""


class AnalysisProviderError(AnalysisUnavailableError):
    """An upstream analysis provider failed."""


class EvidenceCurationError(AnalysisUnavailableError):
    """Evidence curation returned unusable structured output."""
