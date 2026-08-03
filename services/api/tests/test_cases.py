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


def test_creating_a_case_returns_cited_character_franchise_and_likeness_leads() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    response = client.post(
        "/api/cases",
        json={
            "script_text": (
                "Captain Aurelia opens The Copper Comet Chronicles while Rowan Voss watches. "
                'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
            )
        },
    )

    assert response.status_code == 201
    findings = {finding["category"]: finding for finding in response.json()["findings"]}

    assert findings["character_reference"]["detected_item"] == "Captain Aurelia"
    assert findings["franchise_reference"]["detected_item"] == "The Copper Comet Chronicles"
    assert findings["likeness_reference"]["detected_item"] == "Rowan Voss"
    assert {finding["detected_item"] for finding in findings.values()} == {
        "Captain Aurelia",
        "The Copper Comet Chronicles",
        "Rowan Voss",
        "Nimbus Soda",
        "Time keeps the reel turning",
    }
    for category in ("character_reference", "franchise_reference", "likeness_reference"):
        finding = findings[category]
        assert 0 <= finding["confidence"] <= 1
        assert "research" in finding["explanation"].casefold()
        assert finding["reviewer_status"] == "pending"
        assert finding["retrieved_at"]
        assert finding["supporting_evidence"]
        assert finding["supporting_evidence"][0]["source"]["url"] in finding["source_urls"]


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
