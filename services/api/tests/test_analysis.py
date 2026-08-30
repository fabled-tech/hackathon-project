import asyncio

import pytest
from pydantic import ValidationError

from app.agents.service import RightsClearanceAgentService
from app.config import Settings
from app.errors import EvidenceCurationError
from app.models import EvidenceCurationDecision, Source
from app.models.analysis import GeminiSignal, SearchResult


class ThreeLeadGemini:
    async def identify_material(self, script_text: str) -> list[GeminiSignal]:
        return [
            GeminiSignal(
                category="brand_reference",
                detected_item=f"Lead {index}",
                explanation=f"Detected lead {index}.",
                confidence=0.8,
                context_excerpt=script_text,
            )
            for index in range(1, 4)
        ]

    async def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        return EvidenceCurationDecision(
            primary_url=candidates[0].source.url,
            rationale=f"Verified evidence for {signal.detected_item}.",
        )


class YieldingParallel:
    def __init__(self) -> None:
        self.active = 0
        self.max_active = 0
        self.sessions: set[str] = set()

    async def search(self, signal: GeminiSignal, session_id: str) -> list[SearchResult]:
        self.sessions.add(session_id)
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        released = asyncio.Event()
        asyncio.get_running_loop().call_soon(released.set)
        await released.wait()
        self.active -= 1
        return [
            SearchResult(
                source=Source(
                    title=f"Source for {signal.detected_item}",
                    url=f"https://source.test/{signal.detected_item[-1]}",
                ),
                excerpt=f"Extracted evidence for {signal.detected_item}.",
            )
        ]

    async def extract(
        self, signal: GeminiSignal, candidates: list[SearchResult], session_id: str
    ) -> list[SearchResult]:
        del signal
        self.sessions.add(session_id)
        return candidates


class UnknownUrlGemini(ThreeLeadGemini):
    async def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        del signal
        del candidates
        return EvidenceCurationDecision(
            primary_url="https://source.test/not-extracted",
            rationale="This URL was not supplied by Parallel Extract.",
        )


class EmptyParallel:
    async def search(self, signal: GeminiSignal, session_id: str) -> list[SearchResult]:
        del signal
        del session_id
        return []

    async def extract(
        self, signal: GeminiSignal, candidates: list[SearchResult], session_id: str
    ) -> list[SearchResult]:
        del signal
        del candidates
        del session_id
        raise AssertionError("Extract must not run without Search candidates")


class ClosableGemini(ThreeLeadGemini):
    def __init__(self) -> None:
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class ClosableParallel(YieldingParallel):
    def __init__(self) -> None:
        super().__init__()
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


def test_evidence_selection_defaults_to_neutral_no_source() -> None:
    from app.models import EvidenceSelection

    selection = EvidenceSelection()

    assert selection.primary is None
    assert selection.rationale is None
    assert selection.alternatives == []


def test_legacy_finding_maps_old_evidence_to_neutral_alternatives() -> None:
    from app.models import Finding

    finding = Finding.model_validate(
        {
            "id": "finding-1",
            "case_id": "case-1",
            "category": "brand_reference",
            "detected_item": "Example Brand",
            "explanation": "A legacy finding.",
            "confidence": 0.5,
            "supporting_evidence": [
                {
                    "excerpt": "Archived evidence.",
                    "source": {
                        "title": "Archive",
                        "url": "https://source.test/archive",
                    },
                }
            ],
            "source_urls": ["https://source.test/archive"],
            "retrieved_at": "2026-08-02T00:00:00Z",
            "reviewer_status": "pending",
        }
    )

    assert finding.evidence.primary is None
    assert finding.evidence.rationale is None
    assert finding.evidence.alternatives == finding.supporting_evidence


@pytest.mark.parametrize(
    ("primary", "rationale"),
    [
        (
            {
                "excerpt": "Evidence.",
                "source": {"title": "Source", "url": "https://source.test"},
            },
            None,
        ),
        (None, "A rationale without selected evidence."),
    ],
)
def test_evidence_selection_rejects_incomplete_primary_rationale_pairs(
    primary: dict[str, object] | None, rationale: str | None
) -> None:
    from app.models import EvidenceSelection

    with pytest.raises(ValidationError):
        EvidenceSelection(primary=primary, rationale=rationale)


def test_lead_research_is_bounded_and_preserves_detector_order() -> None:
    parallel = YieldingParallel()
    service = RightsClearanceAgentService(
        ThreeLeadGemini(), parallel, max_concurrency=2
    )

    findings = asyncio.run(service.analyze("case-1", "A scene with three leads."))

    assert parallel.max_active == 2
    assert parallel.sessions == {
        "rightsrader:case-1:0",
        "rightsrader:case-1:1",
        "rightsrader:case-1:2",
    }
    assert [finding.detected_item for finding in findings] == [
        "Lead 1",
        "Lead 2",
        "Lead 3",
    ]


def test_ignored_whole_phrases_skip_downstream_research() -> None:
    parallel = YieldingParallel()
    service = RightsClearanceAgentService(
        ThreeLeadGemini(), parallel, max_concurrency=2
    )

    findings = asyncio.run(
        service.analyze(
            "case-1",
            "A scene with three leads.",
            ignored_keywords=["LEAD 2", "ead 3"],
        )
    )

    assert [finding.detected_item for finding in findings] == ["Lead 1", "Lead 3"]
    assert parallel.sessions == {
        "rightsrader:case-1:0",
        "rightsrader:case-1:2",
    }


def test_agent_rejects_a_curated_url_not_returned_by_extract() -> None:
    service = RightsClearanceAgentService(
        UnknownUrlGemini(), YieldingParallel(), max_concurrency=1
    )

    with pytest.raises(EvidenceCurationError):
        asyncio.run(service.analyze("case-1", "A scene."))


def test_parallel_concurrency_setting_is_configurable_and_bounded() -> None:
    assert Settings(parallel_max_concurrency=3).parallel_max_concurrency == 3

    with pytest.raises(ValidationError):
        Settings(parallel_max_concurrency=0)
    with pytest.raises(ValidationError):
        Settings(parallel_max_concurrency=17)


def test_empty_search_results_create_neutral_findings_without_extract() -> None:
    service = RightsClearanceAgentService(
        ThreeLeadGemini(), EmptyParallel(), max_concurrency=2
    )

    findings = asyncio.run(service.analyze("case-1", "A scene."))

    assert len(findings) == 3
    assert all(finding.evidence.primary is None for finding in findings)
    assert all(finding.evidence.rationale is None for finding in findings)
    assert all(finding.supporting_evidence == [] for finding in findings)


def test_agent_service_closes_owned_provider_clients() -> None:
    gemini = ClosableGemini()
    parallel = ClosableParallel()
    service = RightsClearanceAgentService(gemini, parallel)

    asyncio.run(service.aclose())

    assert gemini.closed is True
    assert parallel.closed is True
