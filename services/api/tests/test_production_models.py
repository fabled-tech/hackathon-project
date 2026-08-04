from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models import (
    Production,
    ProductionMonitoringSource,
    ProductionSource,
    ProductionSourceKind,
    ProductionSourceVersion,
    SourceChangeState,
    StoredProductionRun,
    fingerprint_utf8,
    source_change_state,
    to_public_detail,
    to_public_run,
)


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
