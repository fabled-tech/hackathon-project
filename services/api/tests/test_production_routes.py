from dataclasses import replace
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from app.errors import AnalysisUnavailableError
from app.repositories import ProductionRevisionConflict


def _client() -> TestClient:
    from app.main import create_app

    return TestClient(create_app())


def _production_id(client: TestClient, name: str = "Summer feature") -> str:
    response = client.post("/api/productions", json={"name": name})
    assert response.status_code == 201
    return cast(str, response.json()["id"])


def _script(
    client: TestClient, production_id: str, text: str = "Nimbus Soda appears."
) -> dict[str, Any]:
    response = client.post(
        f"/api/productions/{production_id}/scripts",
        json={"name": "Opening scene", "script_text": text},
    )
    assert response.status_code == 201
    return cast(dict[str, Any], response.json())


def test_production_routes_create_sources_monitor_recheck_and_retain_review_audit() -> None:
    """Changing route wiring or review persistence must break the complete production flow."""
    from app.main import create_app

    client = TestClient(create_app())
    production = client.post("/api/productions", json={"name": "Summer feature"}).json()
    script = client.post(
        f"/api/productions/{production['id']}/scripts",
        json={"name": "Opening scene", "script_text": "Nimbus Soda appears."},
    )
    asset = client.post(
        f"/api/productions/{production['id']}/assets",
        files={
            "file": (
                "music-cue.txt",
                b'The cue says "Time keeps the reel turning".',
                "text/plain",
            )
        },
    )

    assert script.status_code == 201
    assert asset.status_code == 201
    first_run = client.post(f"/api/productions/{production['id']}/runs")
    assert first_run.status_code == 201
    assert {item["kind"] for item in first_run.json()["source_snapshots"]} == {"script", "asset"}

    unchanged = client.post(f"/api/productions/{production['id']}/runs")
    assert unchanged.status_code == 409
    assert "Recheck all sources" in unchanged.json()["detail"]

    recheck = client.post(f"/api/productions/{production['id']}/rechecks")
    finding = recheck.json()["findings"][0]
    review = client.patch(
        f"/api/productions/{production['id']}/runs/{recheck.json()['id']}/findings/{finding['id']}",
        json={"reviewer_status": "dismissed"},
    )
    audit = client.get(f"/api/productions/{production['id']}/review-events")

    assert recheck.status_code == 201
    assert recheck.json()["trigger"] == "explicit_recheck"
    assert review.json()["finding"]["reviewer_status"] == "dismissed"
    assert audit.json()[0]["previous_status"] == "pending"
    assert audit.json()[0]["reviewer_status"] == "dismissed"


def test_production_asset_responses_never_expose_private_content_or_storage_fields() -> None:
    """Accidentally serializing private asset storage data must fail this public API test."""
    from app.main import create_app

    client = TestClient(create_app())
    production_id = client.post(
        "/api/productions", json={"name": "Private asset test"}
    ).json()["id"]

    response = client.post(
        f"/api/productions/{production_id}/assets",
        files={"file": ("notes.txt", b"Private note text", "text/plain")},
    )

    serialized = response.json()
    assert response.status_code == 201
    assert "case_id" not in serialized
    assert "asset_id" not in serialized
    assert "storage_reference" not in serialized
    assert "Private note text" not in str(serialized)


def test_production_list_and_detail_include_current_source_summary_counts() -> None:
    """Dropping a source or summary counter from public production views must fail."""
    client = _client()
    production_id = _production_id(client, "Feature A")
    _script(client, production_id)
    asset = client.post(
        f"/api/productions/{production_id}/assets",
        files={"file": ("note.txt", b"A plain text cue", "text/plain")},
    )

    detail = client.get(f"/api/productions/{production_id}")
    summary = client.get("/api/productions")

    assert asset.status_code == 201
    assert detail.json()["script_count"] == 1
    assert detail.json()["asset_count"] == 1
    assert detail.json()["sources_needing_recheck"] == 2
    assert {source["kind"] for source in detail.json()["sources"]} == {"script", "asset"}
    assert summary.json() == [
        {
            "id": production_id,
            "name": "Feature A",
            "revision": 2,
            "updated_at": detail.json()["updated_at"],
            "script_count": 1,
            "asset_count": 1,
            "sources_needing_recheck": 2,
            "latest_run_at": None,
        }
    ]


def test_named_script_replacement_preserves_its_name_and_updates_public_text() -> None:
    """A version update must not replace a script's identity or leave stale text public."""
    client = _client()
    production_id = _production_id(client)
    source = _script(client, production_id, "First Nimbus Soda mention.")

    response = client.put(
        f"/api/productions/{production_id}/scripts/{source['id']}",
        json={"script_text": "Second Nimbus Soda mention."},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": source["id"],
        "kind": "script",
        "name": "Opening scene",
        "active": True,
        "change_state": "new",
        "updated_at": response.json()["updated_at"],
        "script_text": "Second Nimbus Soda mention.",
        "content_type": None,
        "byte_size": None,
    }


def test_script_replacement_rejects_an_asset_source_without_corrupting_monitoring() -> None:
    """Appending script content to an asset source must be rejected before monitoring breaks."""
    client = _client()
    production_id = _production_id(client)
    asset = client.post(
        f"/api/productions/{production_id}/assets",
        files={"file": ("cue.txt", b"Nimbus Soda cue", "text/plain")},
    )

    response = client.put(
        f"/api/productions/{production_id}/scripts/{asset.json()['id']}",
        json={"script_text": "A mismatched script version."},
    )

    assert asset.status_code == 201
    assert response.status_code == 422
    assert response.json() == {"detail": "Source kind does not support script versions."}
    assert client.post(f"/api/productions/{production_id}/runs").status_code == 201


def test_asset_replacement_rejects_a_script_source_and_cleans_stored_upload() -> None:
    """A rejected asset version must not leave private bytes behind or corrupt a script source."""
    from app.main import create_app

    app = create_app()
    client = TestClient(app)
    production_id = _production_id(client)
    script = _script(client, production_id)

    response = client.post(
        f"/api/productions/{production_id}/assets/{script['id']}/versions",
        files={"file": ("mismatch.txt", b"orphaned private bytes", "text/plain")},
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "Source kind does not support asset versions."}
    assert app.state.services.asset_repository.list_for_case(production_id) == []
    assert client.post(f"/api/productions/{production_id}/runs").status_code == 201


def test_asset_replacement_keeps_public_metadata_without_exposing_uploaded_content() -> None:
    """An asset version update must expose only safe current source metadata."""
    client = _client()
    production_id = _production_id(client)
    created = client.post(
        f"/api/productions/{production_id}/assets",
        files={"file": ("first.txt", b"first private text", "text/plain")},
    )

    response = client.post(
        f"/api/productions/{production_id}/assets/{created.json()['id']}/versions",
        files={"file": ("second.txt", b"second private text", "text/plain")},
    )

    assert created.status_code == 201
    assert response.status_code == 200
    assert response.json() == {
        "id": created.json()["id"],
        "kind": "asset",
        "name": "first.txt",
        "active": True,
        "change_state": "new",
        "updated_at": response.json()["updated_at"],
        "script_text": None,
        "content_type": "text/plain",
        "byte_size": len(b"first private text"),
    }
    assert "second private text" not in str(response.json())


def test_retiring_a_monitored_source_generates_exactly_one_retired_run_snapshot() -> None:
    """Retirement must be monitored once, then disappear from subsequent explicit rechecks."""
    client = _client()
    production_id = _production_id(client)
    source = _script(client, production_id)
    assert client.post(f"/api/productions/{production_id}/runs").status_code == 201

    retired = client.delete(f"/api/productions/{production_id}/sources/{source['id']}")
    retirement_run = client.post(f"/api/productions/{production_id}/runs")
    recheck = client.post(f"/api/productions/{production_id}/rechecks")

    assert retired.status_code == 200
    assert retired.json()["change_state"] == "retired"
    assert retirement_run.status_code == 201
    assert retirement_run.json()["source_snapshots"] == [
        {
            "source_id": source["id"],
            "kind": "script",
            "name": "Opening scene",
            "change_state": "retired",
        }
    ]
    assert recheck.status_code == 201
    assert recheck.json()["source_snapshots"] == []


@pytest.mark.parametrize("name", ["", " \t ", "x" * 121])
def test_production_rejects_invalid_names(name: str) -> None:
    """Skipping API name validation must not create anonymous or overlong productions."""
    response = _client().post("/api/productions", json={"name": name})

    assert response.status_code == 422


def test_script_creation_rejects_a_whitespace_only_name() -> None:
    """A named script must not persist an identifier that has no visible characters."""
    client = _client()
    production_id = _production_id(client)

    response = client.post(
        f"/api/productions/{production_id}/scripts",
        json={"name": " \t ", "script_text": "Nimbus Soda appears."},
    )

    assert response.status_code == 422
    assert client.get(f"/api/productions/{production_id}").json()["script_count"] == 0


@pytest.mark.parametrize(
    ("upload", "expected_detail"),
    [
        (("note.txt", b"hello", "application/json"), "Only text/plain assets are supported"),
        (("note.txt", b"\xff", "text/plain"), "Asset must contain valid UTF-8 text"),
        (("note.txt", b"x" * (256 * 1024 + 1), "text/plain"), "Asset must not exceed 256 KiB"),
    ],
)
def test_production_asset_upload_rejects_invalid_media_content_or_size(
    upload: tuple[str, bytes, str], expected_detail: str
) -> None:
    """Bypassing shared text upload validation must not persist an unsafe source."""
    client = _client()
    production_id = _production_id(client)

    response = client.post(f"/api/productions/{production_id}/assets", files={"file": upload})

    assert response.status_code == 422
    assert response.json()["detail"] == expected_detail
    assert client.get(f"/api/productions/{production_id}").json()["asset_count"] == 0


def test_production_routes_map_unknown_production_source_run_and_finding_to_404() -> None:
    """Repository identity errors must not surface as server failures or internal details."""
    client = _client()
    production_id = _production_id(client)
    source = _script(client, production_id)
    run = client.post(f"/api/productions/{production_id}/runs").json()

    responses = [
        client.get("/api/productions/missing"),
        client.put(f"/api/productions/{production_id}/scripts/missing", json={"script_text": "x"}),
        client.get(f"/api/productions/{production_id}/runs/missing"),
        client.patch(
            f"/api/productions/{production_id}/runs/{run['id']}/findings/missing",
            json={"reviewer_status": "dismissed"},
        ),
        client.delete(f"/api/productions/{production_id}/sources/missing"),
    ]

    assert source["id"]
    assert [response.status_code for response in responses] == [404, 404, 404, 404, 404]
    assert all("missing" not in response.json()["detail"].lower() for response in responses)


class _FailingMonitoringService:
    def __init__(self, error: Exception) -> None:
        self._error = error

    def monitor(self, production_id: str, *, explicit_recheck: bool) -> None:
        del production_id, explicit_recheck
        raise self._error


@pytest.mark.parametrize(
    ("error", "status_code", "expected_detail"),
    [
        (
            AnalysisUnavailableError("provider credential secret"),
            503,
            "Production monitoring is temporarily unavailable. Please try again.",
        ),
        (
            ProductionRevisionConflict("latest revision"),
            409,
            "The production changed while monitoring. Review the latest sources and try again.",
        ),
    ],
)
def test_production_monitoring_maps_failures_to_safe_responses(
    error: Exception, status_code: int, expected_detail: str
) -> None:
    """Provider and revision exceptions must retain their designated public boundary."""
    from app.main import create_app

    app = create_app()
    client = TestClient(app)
    app.state.services = replace(
        app.state.services, production_monitoring_service=_FailingMonitoringService(error)
    )
    production_id = _production_id(client)

    response = client.post(f"/api/productions/{production_id}/runs")

    assert response.status_code == status_code
    assert response.json() == {"detail": expected_detail}
    assert "credential" not in response.text
