import asyncio
import json
from types import SimpleNamespace

import pytest

from app.errors import AdjudicationError
from app.integrations.adk_adjudicator import (
    AdkAdjudicator,
    authoritative_domains_for,
    build_advocate_agents,
    extract_json_object,
)
from app.models import EvidenceCurationDecision
from app.models.analysis import GeminiSignal, SearchResult, Source
from app.models.memo import Hypothesis

EXTRACT_URL = "https://extract.test/research-page"
ADVOCATE_URL = "https://www.uspto.gov/trademark/matrix"


def test_extract_json_object_tolerates_fences_and_prose() -> None:
    text = (
        'Here you go:\n```json\n{"best_url": "https://a.test", '
        '"why": "x", "strength": "strong"}\n```'
    )
    assert extract_json_object(text)["best_url"] == "https://a.test"
    with pytest.raises(AdjudicationError):
        extract_json_object("no json here")


def test_authoritative_domains_always_include_registries() -> None:
    signal = GeminiSignal(
        category="Film Title/Franchise",
        detected_item="The Matrix",
        explanation="e",
        confidence=0.9,
    )
    domains = authoritative_domains_for(signal)
    assert "uspto.gov" in domains and "copyright.gov" in domains and "wikipedia.org" in domains


def test_build_advocate_agents_one_per_hypothesis_with_state_keys() -> None:
    hypotheses = [
        Hypothesis(id="h1", claim="a", likely_rights_holder="A", what_would_prove_it="x"),
        Hypothesis(id="h2", claim="b", likely_rights_holder="B", what_would_prove_it="y"),
    ]

    def tool(search_queries: list[str], include_domains: list[str]) -> list[dict]:
        return []

    agents = build_advocate_agents(hypotheses, "gemini-3.7-flash", tool)
    assert [agent.name for agent in agents] == ["advocate_h1", "advocate_h2"]
    assert [agent.output_key for agent in agents] == ["advocate_h1", "advocate_h2"]


def _hypotheses() -> list[Hypothesis]:
    return [
        Hypothesis(
            id="h1",
            claim="studio owns it",
            likely_rights_holder="Studio",
            what_would_prove_it="A registry record",
        ),
        Hypothesis(
            id="h2",
            claim="the phrase is generic",
            likely_rights_holder="No one",
            what_would_prove_it="No matching filing",
        ),
    ]


def _signal() -> GeminiSignal:
    return GeminiSignal(
        category="quotation",
        detected_item="X",
        explanation="e",
        confidence=0.9,
        context_excerpt="INT. KITCHEN",
    )


def _extracted(*urls: str) -> list[SearchResult]:
    return [SearchResult(source=Source(title=url, url=url), excerpt="text") for url in urls]


def _fake_judge_genai(dispositive_url: str) -> SimpleNamespace:
    class FakeModels:
        async def generate_content(self, **kwargs: object) -> SimpleNamespace:
            text = json.dumps(
                {
                    "verdict": "license_required",
                    "confidence": 0.9,
                    "winning_hypothesis_id": "h1",
                    "dispositive_url": dispositive_url,
                    "rationale": "r",
                    "recommended_owner_role": "legal",
                }
            )
            return SimpleNamespace(
                text=text, candidates=[SimpleNamespace(grounding_metadata=None)]
            )

    return SimpleNamespace(aio=SimpleNamespace(models=FakeModels()))


class FakeParallelSdk:
    async def search(self, **kwargs: object) -> SimpleNamespace:
        del kwargs
        return SimpleNamespace(
            results=[
                SimpleNamespace(
                    url=ADVOCATE_URL,
                    title="USPTO",
                    excerpts=["studio filing"],
                    publish_date=None,
                )
            ]
        )


class ScriptedRunner:
    """Writes session state and invokes the first advocate search tool only."""

    def __init__(self, agent: object, session_service: object) -> None:
        self.agent = agent
        self.session_service = session_service

    async def run_async(self, user_id: str, session_id: str, new_message: object):
        del new_message
        storage = self.session_service.sessions["rightsrader"][user_id][session_id]
        name = getattr(self.agent, "name", "")
        if name == "hypothesis_agent":
            storage.state["hypotheses"] = {
                "hypotheses": [item.model_dump() for item in _hypotheses()]
            }
        elif name == "advocates":
            first = self.agent.sub_agents[0]
            results = await first.tools[0](
                search_queries=["matrix trademark filing"],
                include_domains=["uspto.gov"],
            )
            url = results[0]["url"] if results else None
            storage.state["advocate_h1"] = json.dumps(
                {"best_url": url, "why": "registry hit", "strength": "strong"}
            )
            storage.state["advocate_h2"] = json.dumps(
                {"best_url": None, "why": "nothing found", "strength": "none"}
            )
        return
        yield  # pragma: no cover — makes this an async generator


def _adjudicator(dispositive_url: str) -> AdkAdjudicator:
    return AdkAdjudicator(
        "p",
        "global",
        "gemini-3.7-flash",
        "key",
        parallel_sdk=FakeParallelSdk(),
        genai_client=_fake_judge_genai(dispositive_url),
        runner_factory=lambda **kwargs: ScriptedRunner(**kwargs),
    )


def test_judge_rejects_url_not_returned_by_any_advocate() -> None:
    client = AdkAdjudicator(
        "p",
        "global",
        "gemini-3.7-flash",
        "key",
        parallel_sdk=None,
        genai_client=_fake_judge_genai("https://invented.test"),
    )
    hypotheses = [Hypothesis(id="h1", claim="a", likely_rights_holder="A", what_would_prove_it="x")]
    reports = [
        SimpleNamespace(
            hypothesis_id="h1",
            best_url="https://real.test",
            why="w",
            strength="strong",
            searched_urls=["https://real.test"],
        )
    ]
    decision = EvidenceCurationDecision(primary_url=None, rationale=None)

    with pytest.raises(AdjudicationError):
        asyncio.run(
            client._judge(  # noqa: SLF001
                _signal(), decision, hypotheses, reports, allowed={"https://real.test"}
            )
        )


def test_judge_rejects_dispositive_url_that_is_only_an_extract_url() -> None:
    client = AdkAdjudicator(
        "p",
        "global",
        "gemini-3.7-flash",
        "key",
        parallel_sdk=None,
        genai_client=_fake_judge_genai(EXTRACT_URL),
    )
    hypotheses = [Hypothesis(id="h1", claim="a", likely_rights_holder="A", what_would_prove_it="x")]
    reports = [
        SimpleNamespace(
            hypothesis_id="h1",
            best_url=ADVOCATE_URL,
            why="w",
            strength="strong",
            searched_urls=[ADVOCATE_URL],
        )
    ]
    decision = EvidenceCurationDecision(primary_url=None, rationale=None)

    with pytest.raises(AdjudicationError):
        asyncio.run(
            client._judge(  # noqa: SLF001
                _signal(), decision, hypotheses, reports, allowed={ADVOCATE_URL}
            )
        )


def test_adjudicate_rejects_judge_url_that_is_only_an_extract() -> None:
    client = _adjudicator(EXTRACT_URL)
    with pytest.raises(AdjudicationError):
        asyncio.run(
            client.adjudicate(
                _signal(),
                _extracted(EXTRACT_URL),
                EvidenceCurationDecision(primary_url=EXTRACT_URL, rationale="curation pick"),
                "session-extract",
            )
        )


def test_adjudicate_reads_hypotheses_and_records_search_and_judge() -> None:
    client = _adjudicator(ADVOCATE_URL)
    result = asyncio.run(
        client.adjudicate(
            _signal(),
            _extracted(EXTRACT_URL),
            EvidenceCurationDecision(primary_url=None, rationale=None),
            "session-orch",
        )
    )
    assert [item.id for item in result.memo.hypotheses] == ["h1", "h2"]
    methods = [call.method for call in result.calls]
    assert "search_authoritative" in methods
    assert "judge_grounded" in methods
    by_id = {report.hypothesis_id: report for report in result.memo.advocates}
    assert by_id["h1"].searched_urls == [ADVOCATE_URL]
    assert by_id["h2"].searched_urls == []
    assert result.memo.dispositive_url == ADVOCATE_URL
