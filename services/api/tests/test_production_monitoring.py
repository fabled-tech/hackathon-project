from datetime import UTC, datetime

import pytest

from app.errors import (
    AnalysisUnavailableError,
    ProductionContentUnavailableError,
    ProductionNoChangesError,
)
from app.models import (
    AssetUpload,
    Evidence,
    EvidenceSelection,
    Finding,
    Production,
    ProductionRunTrigger,
    ProductionSource,
    ProductionSourceKind,
    ProductionSourceVersion,
    ReviewerStatus,
    Source,
    SourceChangeState,
    StoredProductionRun,
    StoredProductionRunSourceSnapshot,
    fingerprint_utf8,
)
from app.repositories import (
    InMemoryAssetRepository,
    InMemoryProductionRepository,
    ProductionRevisionConflict,
)
from app.services import ProductionMonitoringService


def utc(second: int) -> datetime:
    return datetime(2026, 8, 3, 0, 0, second, tzinfo=UTC)


def make_script_version(version_id: str, source_id: str, text: str) -> ProductionSourceVersion:
    return ProductionSourceVersion(
        id=version_id,
        source_id=source_id,
        fingerprint_sha256=fingerprint_utf8(text),
        script_text=text,
        created_at=utc(1),
    )


def make_agent_finding(analysis_id: str, text: str) -> Finding:
    evidence = Evidence(
        excerpt=f"Reference evidence for {text}",
        source=Source(title="Reference listing", url="https://example.test/reference"),
    )
    return Finding(
        id=f"agent-finding-{analysis_id}",
        case_id=analysis_id,
        category="possible reference",
        detected_item="Nimbus Soda",
        explanation="This is a neutral research lead for a reviewer to investigate.",
        confidence=0.5,
        supporting_evidence=[evidence],
        source_urls=[evidence.source.url],
        retrieved_at=utc(2),
        reviewer_status=ReviewerStatus.PENDING,
        evidence=EvidenceSelection(primary=evidence, rationale="Traceable source evidence."),
    )


class RecordingAgent:
    def __init__(self, failure_after: int | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self.failure_after = failure_after

    def analyze(self, analysis_id: str, script_text: str) -> list[Finding]:
        self.calls.append((analysis_id, script_text))
        if self.failure_after is not None and len(self.calls) > self.failure_after:
            raise AnalysisUnavailableError("provider failure")
        return [make_agent_finding(analysis_id, script_text)]


def seeded_production_with_script_and_asset(
    *, asset_content: bytes = b"Nimbus asset note."
) -> tuple[InMemoryProductionRepository, InMemoryAssetRepository]:
    repository = InMemoryProductionRepository()
    assets = InMemoryAssetRepository()
    production = repository.create(
        Production(
            id="production-1",
            name="Nimbus production",
            revision=0,
            created_at=utc(0),
            updated_at=utc(0),
        )
    )
    script = ProductionSource(
        id="script-1",
        production_id=production.id,
        kind=ProductionSourceKind.SCRIPT,
        name="Episode one",
        active=True,
        current_version_id="version-script",
        last_monitored_version_id=None,
        created_at=utc(0),
        updated_at=utc(0),
    )
    repository.create_source(
        production.id,
        script,
        make_script_version("version-script", script.id, "Nimbus Soda appears in scene one."),
    )
    stored_asset = assets.store(
        production.id,
        AssetUpload(
            filename="production-note.txt",
            content_type="text/plain",
            content=asset_content,
        ),
    )
    asset = ProductionSource(
        id="asset-1",
        production_id=production.id,
        kind=ProductionSourceKind.ASSET,
        name=stored_asset.filename,
        active=True,
        current_version_id="version-asset",
        last_monitored_version_id=None,
        content_type=stored_asset.content_type,
        byte_size=stored_asset.byte_size,
        created_at=utc(1),
        updated_at=utc(1),
    )
    repository.create_source(
        production.id,
        asset,
        ProductionSourceVersion(
            id="version-asset",
            source_id=asset.id,
            fingerprint_sha256=fingerprint_utf8(asset_content.decode("utf-8", errors="replace")),
            asset_id=stored_asset.id,
            created_at=utc(1),
        ),
    )
    return repository, assets


def complete_current_snapshot(repository: InMemoryProductionRepository) -> None:
    snapshot = repository.get_monitoring_snapshot("production-1")
    repository.append_complete_run(
        snapshot,
        StoredProductionRun(
            id="completed-run",
            production_id=snapshot.production.id,
            production_revision=snapshot.production.revision,
            trigger=ProductionRunTrigger.INITIAL,
            created_at=utc(3),
            source_snapshots=[
                StoredProductionRunSourceSnapshot(
                    source_id=item.source.id,
                    source_version_id=item.version.id,
                    kind=item.source.kind,
                    name=item.source.name,
                    fingerprint_sha256=item.version.fingerprint_sha256,
                    change_state=item.change_state,
                )
                for item in snapshot.sources
            ],
            findings=[],
        ),
    )


def seeded_completed_production() -> tuple[InMemoryProductionRepository, InMemoryAssetRepository]:
    repository = InMemoryProductionRepository()
    assets = InMemoryAssetRepository()
    production = repository.create(
        Production(
            id="production-1",
            name="Nimbus production",
            revision=0,
            created_at=utc(0),
            updated_at=utc(0),
        )
    )
    script = ProductionSource(
        id="script-1",
        production_id=production.id,
        kind=ProductionSourceKind.SCRIPT,
        name="Episode one",
        active=True,
        current_version_id="version-script",
        last_monitored_version_id=None,
        created_at=utc(0),
        updated_at=utc(0),
    )
    repository.create_source(
        production.id,
        script,
        make_script_version("version-script", script.id, "Nimbus Soda appears in scene one."),
    )
    complete_current_snapshot(repository)
    return repository, assets


def test_monitor_aggregates_active_scripts_and_assets_by_source_version() -> None:
    repository, assets = seeded_production_with_script_and_asset()
    agent = RecordingAgent()
    service = ProductionMonitoringService(repository, assets, agent, clock=lambda: utc(3))

    run = service.monitor("production-1", explicit_recheck=False)

    assert set(agent.calls) == {
        ("version-script", "Nimbus Soda appears in scene one."),
        ("version-asset", "Nimbus asset note."),
    }
    assert {finding.source_id for finding in run.findings} == {"script-1", "asset-1"}
    assert all("case_id" not in finding.model_dump() for finding in run.findings)
    assert run.trigger is ProductionRunTrigger.INITIAL


def test_agent_failure_leaves_no_partial_production_run() -> None:
    repository, assets = seeded_production_with_script_and_asset()
    service = ProductionMonitoringService(repository, assets, RecordingAgent(failure_after=1))

    with pytest.raises(AnalysisUnavailableError):
        service.monitor("production-1", explicit_recheck=False)

    assert repository.list_runs("production-1", 10) == []
    assert repository.get_monitoring_snapshot("production-1").sources[0].change_state is (
        SourceChangeState.NEW
    )


def test_normal_unchanged_run_requires_an_explicit_recheck_but_recheck_succeeds() -> None:
    repository, assets = seeded_completed_production()
    agent = RecordingAgent()
    service = ProductionMonitoringService(repository, assets, agent, clock=lambda: utc(4))

    with pytest.raises(ProductionNoChangesError):
        service.monitor("production-1", explicit_recheck=False)

    run = service.monitor("production-1", explicit_recheck=True)

    assert run.trigger is ProductionRunTrigger.EXPLICIT_RECHECK
    assert len(agent.calls) == 1


def test_retired_source_creates_a_zero_agent_changes_run_once() -> None:
    repository, assets = seeded_completed_production()
    repository.retire_source("production-1", "script-1", utc(4))
    agent = RecordingAgent()
    service = ProductionMonitoringService(repository, assets, agent, clock=lambda: utc(5))

    run = service.monitor("production-1", explicit_recheck=False)

    assert agent.calls == []
    assert run.findings == []
    assert [item.change_state for item in run.source_snapshots] == [SourceChangeState.RETIRED]


def test_revision_change_during_analysis_returns_conflict_without_saving(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository, assets = seeded_production_with_script_and_asset()
    agent = RecordingAgent()
    original = agent.analyze
    edited = False

    def analyze_then_edit(analysis_id: str, text: str) -> list[Finding]:
        nonlocal edited
        result = original(analysis_id, text)
        if not edited:
            repository.append_source_version(
                "production-1",
                "script-1",
                make_script_version("version-new", "script-1", "Changed during review."),
                utc(9),
            )
            edited = True
        return result

    monkeypatch.setattr(agent, "analyze", analyze_then_edit)

    with pytest.raises(ProductionRevisionConflict):
        ProductionMonitoringService(repository, assets, agent).monitor(
            "production-1", explicit_recheck=False
        )

    assert repository.list_runs("production-1", 10) == []


def test_missing_or_malformed_asset_content_raises_a_safe_error_without_saving() -> None:
    repository, assets = seeded_production_with_script_and_asset(asset_content=b"\xff")
    service = ProductionMonitoringService(repository, assets, RecordingAgent())

    with pytest.raises(ProductionContentUnavailableError) as error:
        service.monitor("production-1", explicit_recheck=False)

    assert str(error.value) == "Production source content is unavailable."
    assert repository.list_runs("production-1", 10) == []


def test_asset_storage_read_failure_raises_a_safe_error_without_saving(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository, assets = seeded_production_with_script_and_asset()

    def unavailable_content(owner_id: str, asset_id: str) -> bytes:
        raise RuntimeError("private blob read failed")

    monkeypatch.setattr(assets, "get_content", unavailable_content)

    with pytest.raises(ProductionContentUnavailableError) as error:
        ProductionMonitoringService(repository, assets, RecordingAgent()).monitor(
            "production-1", explicit_recheck=False
        )

    assert str(error.value) == "Production source content is unavailable."
    assert repository.list_runs("production-1", 10) == []
