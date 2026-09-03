class AnalysisUnavailableError(RuntimeError):
    """The requested analysis could not be completed safely."""

    operation = "analysis"


class AnalysisProviderError(AnalysisUnavailableError):
    """An upstream analysis provider failed."""

    def __init__(self, message: str, *, operation: str = "analysis_provider") -> None:
        super().__init__(message)
        self.operation = operation


class EvidenceCurationError(AnalysisUnavailableError):
    """Evidence curation returned unusable structured output."""

    operation = "evidence_curation"


class AdjudicationError(AnalysisUnavailableError):
    """The Clearance Adjudicator could not produce a grounded memo."""

    operation = "adjudication"
