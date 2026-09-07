from fastapi.testclient import TestClient

from app.main import create_app


def test_filed_case_advances_one_cloud_stage_per_press() -> None:
    client = TestClient(create_app())
    production = client.post(
        "/api/productions",
        json={
            "title": "Live tutorial",
            "studio": "Fabled",
            "roster": [
                {"name": "Jordan", "role": "clearance"},
                {"name": "Alex", "role": "production"},
                {"name": "Maya", "role": "legal"},
            ],
        },
    ).json()
    filed = client.post(
        "/api/cases",
        json={
            "production_id": production["id"],
            "title": "The Matrix rooftop homage",
            "start_mode": "filed",
            "script_text": 'A The Matrix one-sheet. "There is no spoon," she says.',
        },
    )
    assert filed.status_code == 201
    case = filed.json()
    assert case["pipeline_stage"] == "filed"
    assert case["findings"] == []
    assert case["thread"] == []

    intake = client.post(f"/api/cases/{case['id']}/advance")
    assert intake.status_code == 200
    case = intake.json()
    assert case["pipeline_stage"] == "intake"
    assert case["findings"] == []
    assert any(message["agent_name"] == "Intake" for message in case["thread"])
    assert any(call["method"] == "identify_material" for call in case["tool_calls"])

    research = client.post(f"/api/cases/{case['id']}/advance")
    assert research.status_code == 200
    case = research.json()
    assert case["pipeline_stage"] == "research"
    assert case["findings"] == []
    assert any(message["agent_name"] == "Research" for message in case["thread"])
    assert any(call["method"] == "search" for call in case["tool_calls"])

    curation = client.post(f"/api/cases/{case['id']}/advance")
    assert curation.status_code == 200
    case = curation.json()
    assert case["pipeline_stage"] == "curation"
    assert len(case["findings"]) >= 1
    assert all(finding["memo"] is None for finding in case["findings"])
    assert any(message["agent_name"] == "Curation" for message in case["thread"])

    adjudication = client.post(f"/api/cases/{case['id']}/advance")
    assert adjudication.status_code == 200
    case = adjudication.json()
    assert case["pipeline_stage"] == "adjudication"
    assert any(finding["memo"] is not None for finding in case["findings"])
    assert any(message["agent_name"] == "Adjudicator" for message in case["thread"])

    done = client.post(f"/api/cases/{case['id']}/advance")
    assert done.status_code == 409
