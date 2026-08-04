from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models import (
    Evidence,
    Production,
    ProductionFinding,
    ProductionMonitoringSnapshot,
    ProductionMonitoringSource,
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
    source_change_state,
    to_public_detail,
    to_public_run,
)
from app.repositories import InMemoryProductionRepository, ProductionRevisionConflict


def utc(second: int) -> datetime:
    return datetime(2026, 8, 3, 0, 0, second, tzinfo=UTC)


def make_production(production_id: str, *, revision: int) -> Production:
    return Production(
        id=production_id,
        name="Nimbus production",
        revision=revision,
        created_at=utc(0),
        updated_at=utc(0),
    )


def make_script_source(source_id: str, production_id: str, version_id: str) -> ProductionSource:
    return ProductionSource(
        id=source_id,
        production_id=production_id,
        kind=ProductionSourceKind.SCRIPT,
        name="Episode one",
        active=True,
        current_version_id=version_id,
        last_monitored_version_id=None,
        created_at=utc(0),
        updated_at=utc(0),
    )


def make_script_version(
    version_id: str, source_id: str, script_text: str
) -> ProductionSourceVersion:
    return ProductionSourceVersion(
        id=version_id,
        source_id=source_id,
        fingerprint_sha256=fingerprint_utf8(script_text),
        script_text=script_text,
        created_at=utc(1),
    )


def make_run(snapshot: ProductionMonitoringSnapshot, run_id: str) -> StoredProductionRun:
    source = snapshot.sources[0]
    finding = ProductionFinding(
        id=f"finding-{run_id}",
        run_id=run_id,
        source_id=source.source.id,
        category="possible reference",
        detected_item="Nimbus Soda",
        explanation="This may be a useful research lead for a reviewer to investigate.",
        confidence=0.5,
        supporting_evidence=[
            Evidence(
                excerpt="Nimbus Soda appears in a reference listing.",
                source=Source(title="Reference listing", url="https://example.test/nimbus"),
            )
        ],
        source_urls=["https://example.test/nimbus"],
        retrieved_at=utc(1),
        reviewer_status=ReviewerStatus.PENDING,
    )
    return StoredProductionRun(
        id=run_id,
        production_id=snapshot.production.id,
        production_revision=snapshot.production.revision,
        trigger=ProductionRunTrigger.INITIAL,
        created_at=utc(1),
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
        findings=[finding],
    )


def seeded_repository_with_one_script() -> InMemoryProductionRepository:
    repository = InMemoryProductionRepository()
    production = repository.create(make_production("production-1", revision=0))
    source = make_script_source("source-1", production.id, "version-1").model_copy(
        update={"last_monitored_version_id": "version-1"}
    )
    repository.create_source(
        production.id,
        source,
        make_script_version("version-1", "source-1", "Nimbus Soda appears."),
    )
    return repository


def test_fingerprint_utf8_uses_exact_lowercase_sha256() -> None:
    assert fingerprint_utf8("Café") == (
        "73473dcc12b763085904a5279d048c4d5b3b008c46f1f32443b99de04aa83a14"
    )
    assert fingerprint_utf8("Cafe") != fingerprint_utf8("Café")


@pytest.mark.parametrize(
    ("active", "last_version_id", "expected"),
    [
        (True, None, SourceChangeState.NEW),
        (True, "older-version", SourceChangeState.CHANGED),
        (True, "version-1", SourceChangeState.UNCHANGED),
        (False, None, SourceChangeState.RETIRED),
        (False, "older-version", SourceChangeState.RETIRED),
        (False, "version-1", SourceChangeState.UNCHANGED),
    ],
)
def test_source_change_state_marks_a_retirement_once(
    active: bool, last_version_id: str | None, expected: SourceChangeState
) -> None:
    source = ProductionSource(
        id="source-1",
        production_id="production-1",
        kind=ProductionSourceKind.SCRIPT,
        name="Episode one",
        active=active,
        current_version_id="version-1",
        last_monitored_version_id=last_version_id,
        created_at=datetime(2026, 8, 3, tzinfo=UTC),
        updated_at=datetime(2026, 8, 3, tzinfo=UTC),
    )

    assert source_change_state(source) is expected


@pytest.mark.parametrize(
    ("script_text", "asset_id"),
    [("A scene.", "asset-1"), (None, None)],
)
def test_source_version_requires_exactly_one_server_side_content_reference(
    script_text: str | None, asset_id: str | None
) -> None:
    with pytest.raises(ValidationError, match="exactly one source content reference"):
        ProductionSourceVersion(
            id="version-1",
            source_id="source-1",
            fingerprint_sha256="a" * 64,
            script_text=script_text,
            asset_id=asset_id,
            created_at=datetime(2026, 8, 3, tzinfo=UTC),
        )


def test_source_version_rejects_non_lowercase_sha256_fingerprint() -> None:
    with pytest.raises(ValidationError):
        ProductionSourceVersion(
            id="version-1",
            source_id="source-1",
            fingerprint_sha256="A" * 64,
            script_text="A scene.",
            created_at=datetime(2026, 8, 3, tzinfo=UTC),
        )


def test_asset_source_rejects_non_plain_text_content_type() -> None:
    with pytest.raises(ValidationError, match="text/plain"):
        ProductionSource(
            id="asset-source-1",
            production_id="production-1",
            kind=ProductionSourceKind.ASSET,
            name="private-document.pdf",
            active=True,
            current_version_id="asset-version-1",
            last_monitored_version_id=None,
            content_type="application/pdf",
            byte_size=12,
            created_at=datetime(2026, 8, 3, tzinfo=UTC),
            updated_at=datetime(2026, 8, 3, tzinfo=UTC),
        )


def test_public_run_omits_internal_fingerprint_and_version_identifier() -> None:
    public = to_public_run(
        StoredProductionRun.model_validate(
            {
                "id": "run-1",
                "production_id": "production-1",
                "production_revision": 2,
                "trigger": "changes_detected",
                "created_at": "2026-08-03T00:00:00Z",
                "source_snapshots": [
                    {
                        "source_id": "source-1",
                        "source_version_id": "version-private",
                        "kind": "script",
                        "name": "Episode one",
                        "fingerprint_sha256": "a" * 64,
                        "change_state": "changed",
                    }
                ],
                "findings": [],
            }
        )
    )

    assert public.model_dump()["source_snapshots"] == [
        {
            "source_id": "source-1",
            "kind": "script",
            "name": "Episode one",
            "change_state": "changed",
        }
    ]


def test_public_detail_exposes_safe_source_views_and_reviewer_counts() -> None:
    created_at = datetime(2026, 8, 3, tzinfo=UTC)
    script = ProductionSource(
        id="script-1",
        production_id="production-1",
        kind="script",
        name="Episode one",
        active=True,
        current_version_id="script-version-1",
        last_monitored_version_id=None,
        created_at=created_at,
        updated_at=created_at,
    )
    asset = ProductionSource(
        id="asset-source-1",
        production_id="production-1",
        kind="asset",
        name="production-note.txt",
        active=False,
        current_version_id="asset-version-1",
        last_monitored_version_id=None,
        content_type="text/plain",
        byte_size=12,
        created_at=created_at,
        updated_at=created_at,
    )

    detail = to_public_detail(
        Production(
            id="production-1",
            name="Nimbus",
            revision=2,
            created_at=created_at,
            updated_at=created_at,
        ),
        [
            ProductionMonitoringSource(
                source=script,
                version=ProductionSourceVersion(
                    id="script-version-1",
                    source_id=script.id,
                    fingerprint_sha256="a" * 64,
                    script_text="INT. STUDIO - DAY",
                    created_at=created_at,
                ),
                change_state=SourceChangeState.NEW,
            ),
            ProductionMonitoringSource(
                source=asset,
                version=ProductionSourceVersion(
                    id="asset-version-1",
                    source_id=asset.id,
                    fingerprint_sha256="b" * 64,
                    asset_id="private-asset-id",
                    created_at=created_at,
                ),
                change_state=SourceChangeState.RETIRED,
            ),
        ],
        latest_run=None,
    )

    assert detail.model_dump() == {
        "id": "production-1",
        "name": "Nimbus",
        "revision": 2,
        "updated_at": created_at,
        "script_count": 1,
        "asset_count": 1,
        "sources_needing_recheck": 2,
        "latest_run_at": None,
        "created_at": created_at,
        "sources": [
            {
                "id": "script-1",
                "kind": "script",
                "name": "Episode one",
                "active": True,
                "change_state": "new",
                "script_text": "INT. STUDIO - DAY",
                "content_type": None,
                "byte_size": None,
            },
            {
                "id": "asset-source-1",
                "kind": "asset",
                "name": "production-note.txt",
                "active": False,
                "change_state": "retired",
                "script_text": None,
                "content_type": "text/plain",
                "byte_size": 12,
            },
        ],
        "reviewer_status_counts": {
            "pending": 0,
            "accepted": 0,
            "dismissed": 0,
            "escalated": 0,
        },
    }


def test_in_memory_repository_preserves_versions_runs_and_review_audit() -> None:
    repository = InMemoryProductionRepository()
    production = repository.create(make_production("production-1", revision=0))
    source = repository.create_source(
        production.id,
        make_script_source("source-1", production.id, "version-1"),
        make_script_version("version-1", "source-1", "Nimbus Soda appears."),
    )
    snapshot = repository.get_monitoring_snapshot(production.id)
    saved = repository.append_complete_run(snapshot, make_run(snapshot, "run-1"))
    updated = repository.append_source_version(
        production.id,
        source.id,
        make_script_version("version-2", source.id, "Nimbus Soda appears again."),
        utc(2),
    )
    review = repository.update_finding_status(
        production.id, saved.id, saved.findings[0].id, ReviewerStatus.ESCALATED, utc(3)
    )

    assert updated.current_version_id == "version-2"
    assert repository.get_run(production.id, saved.id).source_snapshots[0].change_state is (
        SourceChangeState.NEW
    )
    assert review.finding.reviewer_status is ReviewerStatus.ESCALATED
    assert [event.finding_id for event in repository.list_review_events(production.id, 10)] == [
        saved.findings[0].id
    ]


def test_stale_run_is_revision_fenced_without_partial_source_advance() -> None:
    repository = seeded_repository_with_one_script()
    snapshot = repository.get_monitoring_snapshot("production-1")
    repository.append_source_version(
        "production-1",
        "source-1",
        make_script_version("version-2", "source-1", "New text."),
        utc(2),
    )

    with pytest.raises(ProductionRevisionConflict):
        repository.append_complete_run(snapshot, make_run(snapshot, "run-stale"))

    assert repository.list_runs("production-1", 10) == []
    assert repository.get_monitoring_snapshot("production-1").sources[0].change_state is (
        SourceChangeState.CHANGED
    )


def test_retired_source_is_included_once_then_removed_from_future_monitoring_snapshots() -> None:
    repository = seeded_repository_with_one_script()
    first = repository.get_monitoring_snapshot("production-1")
    repository.append_complete_run(first, make_run(first, "run-1"))
    repository.retire_source("production-1", "source-1", utc(2))

    retired = repository.get_monitoring_snapshot("production-1")
    assert [item.change_state for item in retired.sources] == [SourceChangeState.RETIRED]
    repository.append_complete_run(retired, make_run(retired, "run-2"))

    assert repository.get_monitoring_snapshot("production-1").sources == []
    repository.retire_source("production-1", "source-1", utc(3))
    assert repository.get_monitoring_snapshot("production-1").sources == []


def test_in_memory_repository_returns_isolated_copies_and_newest_first_history() -> None:
    repository = seeded_repository_with_one_script()
    first_snapshot = repository.get_monitoring_snapshot("production-1")
    first_run = make_run(first_snapshot, "run-1").model_copy(update={"created_at": utc(2)})
    repository.append_complete_run(first_snapshot, first_run)
    repository.append_source_version(
        "production-1",
        "source-1",
        make_script_version("version-2", "source-1", "Updated text."),
        utc(3),
    )
    second_snapshot = repository.get_monitoring_snapshot("production-1")
    second_run = make_run(second_snapshot, "run-2").model_copy(update={"created_at": utc(4)})
    saved_second = repository.append_complete_run(second_snapshot, second_run)
    repository.update_finding_status(
        "production-1", "run-1", "finding-run-1", ReviewerStatus.ACCEPTED, utc(5)
    )
    repository.update_finding_status(
        "production-1", "run-2", "finding-run-2", ReviewerStatus.DISMISSED, utc(6)
    )

    saved_second.findings[0].explanation = "Mutated by a caller."

    assert repository.get_run("production-1", "run-2").findings[0].explanation != (
        "Mutated by a caller."
    )
    assert [run.id for run in repository.list_runs("production-1", 10)] == ["run-2", "run-1"]
    assert [event.run_id for event in repository.list_review_events("production-1", 10)] == [
        "run-2",
        "run-1",
    ]
