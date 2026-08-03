from fastapi.testclient import TestClient


def test_creating_a_case_returns_deterministic_findings() -> None:
    from app.main import create_app

    client = TestClient(create_app())

    response = client.post(
        "/api/cases",
        json={
            "script_text": (
                'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
            )
        },
    )

    assert response.status_code == 201
    case = response.json()
    assert case["script_text"].startswith("MARA opens")
    assert {finding["detected_item"] for finding in case["findings"]} == {
        "Nimbus Soda",
        "Time keeps the reel turning",
    }
    assert all(finding["reviewer_status"] == "pending" for finding in case["findings"])
    assert all(finding["evidence"]["primary"] is not None for finding in case["findings"])
    assert all(finding["evidence"]["rationale"] for finding in case["findings"])


def test_updating_a_finding_status_persists_on_the_case() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    case = client.post(
        "/api/cases",
        json={"script_text": "A Nimbus Soda poster fills the frame."},
    ).json()
    finding_id = case["findings"][0]["id"]

    response = client.patch(
        f"/api/cases/{case['id']}/findings/{finding_id}",
        json={"reviewer_status": "escalated"},
    )

    assert response.status_code == 200
    assert response.json()["reviewer_status"] == "escalated"
    updated_case = client.get(f"/api/cases/{case['id']}").json()
    assert updated_case["findings"][0]["reviewer_status"] == "escalated"
