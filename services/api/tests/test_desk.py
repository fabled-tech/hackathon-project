from fastapi.testclient import TestClient

from app.agents.stakeholders import stakeholders_for_lead
from app.models import ProductionMember, WorkspaceRole


def _member(name: str, role: WorkspaceRole) -> ProductionMember:
    return ProductionMember(id=f"{role.value}-{name.lower()}", name=name, role=role)


def test_brand_lead_attaches_production_and_clearance() -> None:
    roster = [
        _member("Jordan", WorkspaceRole.CLEARANCE),
        _member("Alex", WorkspaceRole.PRODUCTION),
        _member("Maya", WorkspaceRole.LEGAL),
    ]

    attached = stakeholders_for_lead("brand_reference", roster)

    assert [member.name for member in attached] == ["Jordan", "Alex"]


def test_likeness_lead_attaches_legal_and_clearance() -> None:
    roster = [
        _member("Jordan", WorkspaceRole.CLEARANCE),
        _member("Alex", WorkspaceRole.PRODUCTION),
        _member("Maya", WorkspaceRole.LEGAL),
    ]

    attached = stakeholders_for_lead("likeness_reference", roster)

    assert [member.name for member in attached] == ["Jordan", "Maya"]


def test_unknown_category_attaches_only_clearance() -> None:
    roster = [
        _member("Jordan", WorkspaceRole.CLEARANCE),
        _member("Alex", WorkspaceRole.PRODUCTION),
    ]

    attached = stakeholders_for_lead("unmapped_category", roster)

    assert [member.name for member in attached] == ["Jordan"]


def test_missing_roles_are_skipped() -> None:
    roster = [_member("Alex", WorkspaceRole.PRODUCTION)]

    attached = stakeholders_for_lead("brand_reference", roster)

    assert [member.name for member in attached] == ["Alex"]


def test_production_roster_is_created_and_updated() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    created = client.post(
        "/api/productions",
        json={
            "title": "Desk Feature",
            "studio": "Fabled",
            "roster": [
                {"name": "Jordan", "role": "clearance"},
                {"name": "Alex", "role": "production"},
                {"name": "Maya", "role": "legal"},
            ],
        },
    )

    assert created.status_code == 201
    roster = created.json()["roster"]
    assert [member["name"] for member in roster] == ["Jordan", "Alex", "Maya"]
    assert {member["role"] for member in roster} == {"clearance", "production", "legal"}

    updated = client.patch(
        f"/api/productions/{created.json()['id']}",
        json={"roster": [{"name": "Jordan", "role": "clearance"}]},
    )
    assert updated.status_code == 200
    assert [member["name"] for member in updated.json()["roster"]] == ["Jordan"]


def test_case_thread_includes_named_agents_and_stakeholders() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    production = client.post(
        "/api/productions",
        json={
            "title": "Neon Skywalk",
            "roster": [
                {"name": "Jordan", "role": "clearance"},
                {"name": "Alex", "role": "production"},
                {"name": "Maya", "role": "legal"},
            ],
        },
    ).json()

    response = client.post(
        "/api/cases",
        json={
            "production_id": production["id"],
            "script_text": (
                'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
            ),
        },
    )

    assert response.status_code == 201
    case = response.json()
    thread = case["thread"]
    assert thread[0]["agent_name"] == "Intake"
    assert thread[0]["author_kind"] == "agent"
    agent_names = {message["agent_name"] for message in thread}
    assert {"Intake", "Research", "Curation"} <= agent_names
    research_posts = [message for message in thread if message["agent_name"] == "Research"]
    assert any("Parallel Search" in message["body"] for message in research_posts)
    assert any(
        "Extracted" in message["body"] or "Extract will not run" in message["body"]
        for message in research_posts
    )
    nimbus = next(
        finding for finding in case["findings"] if finding["detected_item"] == "Nimbus Soda"
    )
    quote = next(
        finding
        for finding in case["findings"]
        if finding["detected_item"] == "Time keeps the reel turning"
    )
    roster_by_role = {member["role"]: member["id"] for member in production["roster"]}
    assert roster_by_role["clearance"] in nimbus["stakeholder_ids"]
    assert roster_by_role["production"] in nimbus["stakeholder_ids"]
    assert roster_by_role["legal"] not in nimbus["stakeholder_ids"]
    assert roster_by_role["clearance"] in quote["stakeholder_ids"]
    assert roster_by_role["legal"] in quote["stakeholder_ids"]

    tool_calls = case["tool_calls"]
    methods = {call["method"] for call in tool_calls}
    providers = {call["provider"] for call in tool_calls}
    assert "identify_material" in methods
    assert "search" in methods
    assert "extract" in methods or any(
        "Extract will not run" in message["body"] for message in thread
    )
    assert "vertex" in providers
    assert "parallel" in providers
    secret_markers = ("api_key", "apikey", "authorization", "bearer ", "sk-")
    for call in tool_calls:
        assert call["fixture"] is True
        assert isinstance(call["ok"], bool)
        assert call["summary"]
        assert isinstance(call["duration_ms"], int)
        lowered = call["summary"].lower()
        assert all(marker not in lowered for marker in secret_markers)

    persisted = client.get(f"/api/cases/{case['id']}")
    assert persisted.status_code == 200
    assert persisted.json()["tool_calls"] == tool_calls


def test_human_can_reply_in_thread_as_roster_member() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    production = client.post(
        "/api/productions",
        json={
            "title": "Desk Reply",
            "roster": [{"name": "Jordan", "role": "clearance"}],
        },
    ).json()
    case = client.post(
        "/api/cases",
        json={
            "production_id": production["id"],
            "script_text": "A Nimbus Soda poster fills the frame.",
        },
    ).json()
    finding_id = case["findings"][0]["id"]
    member_id = production["roster"][0]["id"]

    reply = client.post(
        f"/api/cases/{case['id']}/thread",
        json={
            "member_id": member_id,
            "body": "Studio-owned brand. Safe to dismiss.",
            "finding_id": finding_id,
        },
    )
    assert reply.status_code == 201
    last = reply.json()["thread"][-1]
    assert last["author_kind"] == "human"
    assert last["member_id"] == member_id
    assert "Studio-owned" in last["body"]

    escalated = client.patch(
        f"/api/cases/{case['id']}/findings/{finding_id}",
        json={"reviewer_status": "escalated", "actor_member_id": member_id},
    )
    assert escalated.status_code == 200
    refreshed = client.get(f"/api/cases/{case['id']}").json()
    assert refreshed["findings"][0]["reviewer_status"] == "escalated"
    assert any(
        message["author_kind"] == "human"
        and "escalated" in message["body"]
        and "case desk thread" in message["body"]
        for message in refreshed["thread"]
    )


def test_research_does_not_extract_before_search_candidates() -> None:
    from app.agents.service import RightsClearanceAgentService
    from app.models import EvidenceCurationDecision
    from app.models.analysis import GeminiSignal

    class OneLeadGemini:
        async def identify_material(self, script_text: str) -> list[GeminiSignal]:
            del script_text
            return [
                GeminiSignal(
                    category="brand_reference",
                    detected_item="Lead 1",
                    explanation="Detected.",
                    confidence=0.8,
                )
            ]

        async def plan_queries(self, signal: GeminiSignal) -> list[str]:
            return [f"{signal.detected_item} official source", f"{signal.detected_item} news"]

        async def brief_stakeholders(self, signal, candidates):
            del signal, candidates
            raise AssertionError("Brief must not run without extracted pages")

        async def curate_evidence(self, signal, candidates):
            del signal
            del candidates
            return EvidenceCurationDecision(primary_url=None, rationale=None)

    class EmptyThenAssertParallel:
        def __init__(self) -> None:
            self.extracted = False
            self.search_calls = 0

        async def search(self, signal, session_id, objective=None):
            del signal, session_id, objective
            self.search_calls += 1
            return []

        async def extract(self, signal, candidates, session_id):
            del signal, candidates, session_id
            self.extracted = True
            raise AssertionError("Extract must not run without Search candidates")

    parallel = EmptyThenAssertParallel()
    service = RightsClearanceAgentService(OneLeadGemini(), parallel, max_concurrency=1)
    import asyncio

    findings = asyncio.run(service.analyze("case-1", "A scene."))
    assert findings[0].evidence.primary is None
    assert parallel.extracted is False
    assert parallel.search_calls >= 2


def test_research_cannot_curate_or_brief_before_extract() -> None:
    from app.agents.service import RightsClearanceAgentService
    from app.models import EvidenceCurationDecision, Source
    from app.models.analysis import GeminiSignal, SearchResult

    class OrderTrackingGemini:
        def __init__(self) -> None:
            self.order: list[str] = []

        async def identify_material(self, script_text: str) -> list[GeminiSignal]:
            del script_text
            return [
                GeminiSignal(
                    category="brand_reference",
                    detected_item="Lead 1",
                    explanation="Detected.",
                    confidence=0.8,
                )
            ]

        async def plan_queries(self, signal: GeminiSignal) -> list[str]:
            self.order.append("plan_queries")
            return [f"{signal.detected_item} trademark", f"{signal.detected_item} official"]

        async def brief_stakeholders(self, signal, candidates):
            del signal
            assert candidates, "Brief must receive extracted pages"
            self.order.append("brief_stakeholders")
            return "Stakeholders: extracted pages mention the lead on the official source."

        async def curate_evidence(self, signal, candidates):
            del signal
            assert candidates, "Curation must receive extracted pages"
            self.order.append("curate_evidence")
            return EvidenceCurationDecision(
                primary_url=candidates[0].source.url,
                rationale="Grounded in extract.",
            )

    class SearchThenExtractParallel:
        def __init__(self) -> None:
            self.order: list[str] = []

        async def search(self, signal, session_id, objective=None):
            del session_id, objective
            self.order.append(f"search:{signal.detected_item}")
            return [
                SearchResult(
                    source=Source(
                        title="Official",
                        url=f"https://source.test/{signal.detected_item}",
                    ),
                    excerpt=f"Page about {signal.detected_item}.",
                )
            ]

        async def extract(self, signal, candidates, session_id):
            del signal, session_id
            assert candidates, "Extract must receive search candidates"
            self.order.append("extract")
            return candidates

    gemini = OrderTrackingGemini()
    parallel = SearchThenExtractParallel()
    service = RightsClearanceAgentService(gemini, parallel, max_concurrency=1)
    import asyncio

    asyncio.run(service.analyze("case-1", "A scene."))
    assert gemini.order == ["plan_queries", "brief_stakeholders", "curate_evidence"]
    assert parallel.order[0].startswith("search:")
    assert "extract" in parallel.order
    assert parallel.order.index("extract") < len(parallel.order)
    assert all(
        step.startswith("search:") or step == "extract" for step in parallel.order
    )
    assert parallel.order.index("extract") > 0


def test_two_lead_case_records_rich_research_tool_loop() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    production = client.post(
        "/api/productions",
        json={
            "title": "Two Lane Demo",
            "roster": [
                {"name": "Jordan", "role": "clearance"},
                {"name": "Alex", "role": "production"},
                {"name": "Maya", "role": "legal"},
            ],
        },
    ).json()
    response = client.post(
        "/api/cases",
        json={
            "production_id": production["id"],
            "script_text": (
                'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
            ),
        },
    )
    assert response.status_code == 201
    case = response.json()
    tool_calls = case["tool_calls"]
    methods = [call["method"] for call in tool_calls]
    assert methods.count("identify_material") >= 1
    assert methods.count("plan_queries") >= 2
    assert methods.count("search") >= 4
    assert methods.count("extract") >= 2
    assert methods.count("brief_stakeholders") >= 2
    assert methods.count("curate_evidence") >= 2

    for lead in ("Nimbus Soda", "Time keeps the reel turning"):
        lead_calls = [call for call in tool_calls if call.get("lead") == lead]
        lead_methods = [call["method"] for call in lead_calls]
        assert lead_methods.count("plan_queries") >= 1
        assert lead_methods.count("search") >= 2
        assert lead_methods.count("extract") == 1
        assert lead_methods.count("brief_stakeholders") == 1
        assert lead_methods.count("curate_evidence") == 1

    thread_bodies = " ".join(message["body"] for message in case["thread"])
    assert "objective" in thread_bodies.lower() or "planning" in thread_bodies.lower()
    assert "Parallel search" in thread_bodies or "Parallel Search" in thread_bodies
    assert "brief" in thread_bodies.lower()

    persisted = client.get(f"/api/cases/{case['id']}").json()
    assert [call["method"] for call in persisted["tool_calls"]] == methods
    for call in persisted["tool_calls"]:
        assert call["fixture"] is True
        lowered = call["summary"].lower()
        assert all(
            marker not in lowered
            for marker in ("api_key", "apikey", "authorization", "bearer ", "sk-")
        )


def test_delete_case_removes_it_from_the_production() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    production = client.post(
        "/api/productions",
        json={"title": "Cleanup Desk", "roster": [{"name": "Jordan", "role": "clearance"}]},
    ).json()
    created = client.post(
        "/api/cases",
        json={"production_id": production["id"], "script_text": "A Nimbus Soda can rolls by."},
    )
    assert created.status_code == 201
    case_id = created.json()["id"]

    deleted = client.delete(f"/api/cases/{case_id}")
    assert deleted.status_code == 204
    assert client.get(f"/api/cases/{case_id}").status_code == 404
    remaining = client.get(f"/api/productions/{production['id']}/cases")
    assert remaining.status_code == 200
    assert remaining.json() == []
    assert client.delete(f"/api/cases/{case_id}").status_code == 404


def test_matrix_homage_returns_franchise_and_quote_leads() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    production = client.post(
        "/api/productions",
        json={
            "title": "Matrix Desk",
            "roster": [
                {"name": "Jordan", "role": "clearance"},
                {"name": "Alex", "role": "production"},
                {"name": "Maya", "role": "legal"},
            ],
        },
    ).json()
    response = client.post(
        "/api/cases",
        json={
            "production_id": production["id"],
            "title": "The Matrix rooftop homage",
            "script_text": (
                "INT. GREENSCREEN STAGE — NIGHT\n\n"
                "Second unit hangs a forty-foot The Matrix one-sheet behind the coat-and-shades "
                'hero. The AD marks the rooftop dodge. "There is no spoon," she says. '
                '"Just hit it like the movie."'
            ),
        },
    )

    assert response.status_code == 201
    case = response.json()
    assert case["title"] == "The Matrix rooftop homage"
    items = {finding["detected_item"]: finding for finding in case["findings"]}
    assert "The Matrix" in items
    assert "There is no spoon" in items
    assert items["The Matrix"]["category"] == "franchise_reference"
    assert items["There is no spoon"]["category"] == "quotation"
    roster_by_role = {member["role"]: member["id"] for member in production["roster"]}
    assert roster_by_role["clearance"] in items["The Matrix"]["stakeholder_ids"]
    assert roster_by_role["production"] in items["The Matrix"]["stakeholder_ids"]
    assert roster_by_role["legal"] in items["There is no spoon"]["stakeholder_ids"]
