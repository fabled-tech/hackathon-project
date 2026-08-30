from fastapi.testclient import TestClient

from app.main import create_app
from app.models.requests import MAX_PRODUCTION_ICON_BYTES

PNG_ICON = b"\x89PNG\r\n\x1a\n" + b"test-icon"


def create_production(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/productions",
        json={"title": "Icon Test Production"},
    )
    assert response.status_code == 201
    return response.json()


def test_uploads_reads_and_removes_a_private_production_icon() -> None:
    client = TestClient(create_app())
    production = create_production(client)
    production_id = str(production["id"])

    upload = client.post(
        f"/api/productions/{production_id}/icon",
        files={"file": ("icon.png", PNG_ICON, "image/png")},
    )

    assert upload.status_code == 200
    version = upload.json()["icon_version"]
    assert version
    assert upload.json()["icon_content_type"] == "image/png"

    downloaded = client.get(f"/api/productions/{production_id}/icon/{version}")
    assert downloaded.status_code == 200
    assert downloaded.content == PNG_ICON
    assert downloaded.headers["content-type"] == "image/png"
    assert downloaded.headers["x-content-type-options"] == "nosniff"

    removed = client.delete(f"/api/productions/{production_id}/icon")
    assert removed.status_code == 200
    assert removed.json()["icon_version"] is None
    assert client.get(f"/api/productions/{production_id}/icon/{version}").status_code == 404


def test_selecting_a_builtin_icon_removes_the_custom_icon() -> None:
    client = TestClient(create_app())
    production_id = str(create_production(client)["id"])
    uploaded = client.post(
        f"/api/productions/{production_id}/icon",
        files={"file": ("icon.png", PNG_ICON, "image/png")},
    ).json()

    updated = client.patch(
        f"/api/productions/{production_id}",
        json={"icon": "film"},
    )

    assert updated.status_code == 200
    assert updated.json()["icon"] == "film"
    assert updated.json()["icon_version"] is None
    assert (
        client.get(
            f"/api/productions/{production_id}/icon/{uploaded['icon_version']}"
        ).status_code
        == 404
    )


def test_rejects_invalid_or_oversized_production_icons() -> None:
    client = TestClient(create_app())
    production_id = str(create_production(client)["id"])

    wrong_type = client.post(
        f"/api/productions/{production_id}/icon",
        files={"file": ("icon.gif", b"GIF89a", "image/gif")},
    )
    wrong_signature = client.post(
        f"/api/productions/{production_id}/icon",
        files={"file": ("icon.png", b"not-a-png", "image/png")},
    )
    oversized = client.post(
        f"/api/productions/{production_id}/icon",
        files={
            "file": (
                "icon.png",
                b"\x89PNG\r\n\x1a\n" + b"x" * MAX_PRODUCTION_ICON_BYTES,
                "image/png",
            )
        },
    )

    assert wrong_type.status_code == 422
    assert wrong_signature.status_code == 422
    assert oversized.status_code == 422


def test_agent_run_endpoints_are_disabled() -> None:
    client = TestClient(create_app())
    production_id = str(create_production(client)["id"])

    assert client.post(f"/api/productions/{production_id}/brief").status_code == 404
    assert client.post(f"/api/productions/{production_id}/watch").status_code == 404
    assert client.get(f"/api/productions/{production_id}/runs").status_code == 404
