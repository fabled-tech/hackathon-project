class AnalysisUnavailableError(RuntimeError):
    """An analysis provider or its structured result cannot be used."""


class AnalysisProviderError(AnalysisUnavailableError):
    """An upstream retrieval or model call failed."""


class EvidenceCurationError(AnalysisUnavailableError):
    """Gemini returned malformed or ungrounded evidence curation output."""


class ResearchBoundaryError(AnalysisUnavailableError):
    """Agent output exceeded RightsRadar's research-assistance boundary."""


class ProductionNoChangesError(RuntimeError):
    """A normal monitoring run was requested without production changes."""

    def __init__(self, production_id: str) -> None:
        super().__init__("Production content has not changed.")


class ProductionContentUnavailableError(RuntimeError):
    """Production source content cannot be safely loaded for analysis."""

    def __init__(self) -> None:
        super().__init__("Production source content is unavailable.")
