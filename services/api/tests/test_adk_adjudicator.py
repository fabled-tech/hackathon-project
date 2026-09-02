import asyncio
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
from app.models.analysis import GeminiSignal
from app.models.memo import Hypothesis


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


def test_judge_rejects_url_not_returned_by_any_advocate() -> None:
    class FakeModels:
        async def generate_content(self, **kwargs: object) -> SimpleNamespace:
            text = (
                '{"verdict":"license_required","confidence":0.9,'
                '"winning_hypothesis_id":"h1",'
                '"dispositive_url":"https://invented.test",'
                '"rationale":"r","recommended_owner_role":"legal"}'
            )
            return SimpleNamespace(text=text, candidates=[SimpleNamespace(grounding_metadata=None)])

    fake_genai = SimpleNamespace(aio=SimpleNamespace(models=FakeModels()))
    client = AdkAdjudicator(
        "p",
        "global",
        "gemini-3.7-flash",
        "key",
        parallel_sdk=None,
        genai_client=fake_genai,
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
    signal = GeminiSignal(category="quotation", detected_item="X", explanation="e", confidence=0.9)
    decision = EvidenceCurationDecision(primary_url=None, rationale=None)

    with pytest.raises(AdjudicationError):
        asyncio.run(
            client._judge(  # noqa: SLF001
                signal, decision, hypotheses, reports, allowed={"https://real.test"}
            )
        )
