from io import BytesIO

from docx import Document
from fastapi.testclient import TestClient

from app.main import create_app
from app.models.requests import MAX_ANALYSIS_FILE_BYTES


def create_production(client: TestClient, ignore_keywords: list[str] | None = None) -> str:
    created = client.post(
        "/api/productions",
        json={"title": "Multimodal Production"},
    ).json()
    if ignore_keywords:
        client.patch(
            f"/api/productions/{created['id']}",
            json={"ignore_keywords": ignore_keywords},
        )
    return str(created["id"])


def docx_bytes(text: str) -> bytes:
    document = Document()
    document.add_paragraph(text)
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def test_docx_analysis_extracts_text_researches_leads_and_stores_source() -> None:
    client = TestClient(create_app())
    production_id = create_production(client)

    response = client.post(
        f"/api/cases/from-file/{production_id}",
        files={
            "file": (
                "clearance-notes.docx",
                docx_bytes("Nimbus Soda appears beside the hero prop."),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 201
    case = response.json()
    assert case["title"] == "clearance-notes.docx"
    assert "Nimbus Soda appears" in case["script_text"]
    assert [finding["detected_item"] for finding in case["findings"]] == ["Nimbus Soda"]
    assert case["asset_count"] == 1
    assets = client.get(f"/api/cases/{case['id']}/assets").json()
    assert assets[0]["filename"] == "clearance-notes.docx"


def test_image_analysis_creates_a_production_case_and_stores_source() -> None:
    client = TestClient(create_app())
    production_id = create_production(client)

    response = client.post(
        f"/api/cases/from-file/{production_id}",
        files={
            "file": (
                "wardrobe-board.png",
                b"\x89PNG\r\n\x1a\nmock-image",
                "image/png",
            )
        },
    )

    assert response.status_code == 201
    case = response.json()
    assert case["title"] == "wardrobe-board.png"
    assert case["asset_count"] == 1
    assert [finding["detected_item"] for finding in case["findings"]] == [
        "wardrobe-board.png"
    ]


def test_docx_analysis_applies_production_ignore_phrases() -> None:
    client = TestClient(create_app())
    production_id = create_production(client, ["Nimbus Soda"])

    response = client.post(
        f"/api/cases/from-file/{production_id}",
        files={
            "file": (
                "brand-notes.docx",
                docx_bytes("Nimbus Soda appears beside the hero prop."),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 201
    assert response.json()["findings"] == []


def test_multimodal_analysis_rejects_bad_types_signatures_and_sizes() -> None:
    client = TestClient(create_app())
    production_id = create_production(client)

    unsupported = client.post(
        f"/api/cases/from-file/{production_id}",
        files={"file": ("notes.txt", b"notes", "text/plain")},
    )
    wrong_signature = client.post(
        f"/api/cases/from-file/{production_id}",
        files={"file": ("image.png", b"not-png", "image/png")},
    )
    oversized = client.post(
        f"/api/cases/from-file/{production_id}",
        files={
            "file": (
                "image.png",
                b"\x89PNG\r\n\x1a\n" + b"x" * MAX_ANALYSIS_FILE_BYTES,
                "image/png",
            )
        },
    )

    assert unsupported.status_code == 422
    assert wrong_signature.status_code == 422
    assert oversized.status_code == 422
