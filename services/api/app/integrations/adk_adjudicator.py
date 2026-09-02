"""Clearance Adjudicator: ADK hypotheses + parallel advocates, grounded Gemini judge."""
from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Callable
from time import perf_counter
from typing import Any

from app.errors import AdjudicationError
from app.integrations.adjudicator import AdjudicationCall, AdjudicationResult
from app.models import EvidenceCurationDecision, ToolCallProvider
from app.models.analysis import GeminiSignal, SearchResult
from app.models.memo import (
    AdvocateReport,
    ClearanceMemo,
    Hypothesis,
    HypothesisSet,
    validate_memo_urls,
)

logger = logging.getLogger("rightsrader.integrations")

AUTHORITATIVE_DOMAINS = (
    "uspto.gov",
    "copyright.gov",
    "wipo.int",
    "sec.gov",
    "justia.com",
    "trademarkia.com",
    "wikipedia.org",
)
_APP_NAME = "rightsrader"
_USER_ID = "adjudicator"
_MAX_ADVOCATE_SEARCHES = 2
_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)


def extract_json_object(text: str) -> dict[str, Any]:
    match = _JSON_BLOCK.search(text or "")
    if not match:
        raise AdjudicationError("Agent reply did not contain a JSON object")
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise AdjudicationError("Agent reply contained invalid JSON") from error
    if not isinstance(parsed, dict):
        raise AdjudicationError("Agent reply JSON was not an object")
    return parsed


def authoritative_domains_for(signal: GeminiSignal) -> list[str]:
    del signal  # category-specific additions are a follow-up; registries cover every lead.
    return list(AUTHORITATIVE_DOMAINS)


def _elapsed(started: float) -> int:
    return max(0, int((perf_counter() - started) * 1000))


def build_advocate_agents(
    hypotheses: list[Hypothesis],
    model: str,
    tool: Callable[..., Any],
    *,
    tool_for: Callable[[Hypothesis], Callable[..., Any]] | None = None,
) -> list[Any]:
    from google.adk.agents import LlmAgent

    agents = []
    for hypothesis in hypotheses:
        bound = tool_for(hypothesis) if tool_for is not None else tool
        agents.append(
            LlmAgent(
                name=f"advocate_{hypothesis.id}",
                model=model,
                description=f"Argues hypothesis {hypothesis.id}",
                instruction=(
                    "You are an advocate on a film rights-clearance desk. Your job is to prove ONE "
                    f"hypothesis using authoritative web sources.\n\nHypothesis {hypothesis.id}: "
                    f"{hypothesis.claim}\nLikely rights holder: {hypothesis.likely_rights_holder}\n"
                    f"What would prove it: {hypothesis.what_would_prove_it}\n\n"
                    f"Call search_authoritative at most {_MAX_ADVOCATE_SEARCHES} times with 2-3 "
                    "keyword queries (3-6 words each) and the include_domains you were given. "
                    "Only cite URLs the tool returned. Then reply with ONLY a JSON object: "
                    '{"best_url": string|null, "why": string, "strength": "strong"|"weak"|"none"}. '
                    "Never give legal advice."
                ),
                tools=[bound],
                output_key=f"advocate_{hypothesis.id}",
            )
        )
    return agents


class AdkAdjudicator:
    def __init__(
        self,
        project: str,
        location: str,
        model: str,
        parallel_api_key: str,
        parallel_sdk: Any,
        *,
        genai_client: Any | None = None,
        runner_factory: Callable[..., Any] | None = None,
    ) -> None:
        self._project = project
        self._location = location
        self._model = model
        self._parallel_api_key = parallel_api_key
        self._parallel_sdk = parallel_sdk
        self._genai = genai_client or self._build_genai()
        self._runner_factory = runner_factory
        os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "true")
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", project)
        os.environ.setdefault("GOOGLE_CLOUD_LOCATION", location)

    def _build_genai(self) -> Any:
        from google import genai
        from google.genai import types

        return genai.Client(
            vertexai=True,
            project=self._project,
            location=self._location,
            http_options=types.HttpOptions(api_version="v1"),
        )

    async def adjudicate(
        self,
        signal: GeminiSignal,
        extracted: list[SearchResult],
        decision: EvidenceCurationDecision,
        session_id: str,
    ) -> AdjudicationResult:
        from google.adk.agents import ParallelAgent
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService
        from google.genai import types

        calls: list[AdjudicationCall] = []
        allowed: set[str] = set()
        session_cls: Any = InMemorySessionService
        session_service: Any = session_cls()
        await session_service.create_session(
            app_name=_APP_NAME, user_id=_USER_ID, session_id=session_id
        )

        def make_runner(agent: Any) -> Any:
            if self._runner_factory is not None:
                return self._runner_factory(agent=agent, session_service=session_service)
            return Runner(agent=agent, app_name=_APP_NAME, session_service=session_service)

        async def run(agent: Any, prompt: str) -> None:
            runner = make_runner(agent)
            message = types.Content(role="user", parts=[types.Part(text=prompt)])
            async for _event in runner.run_async(
                user_id=_USER_ID, session_id=session_id, new_message=message
            ):
                pass

        async def state() -> dict[str, Any]:
            session = await session_service.get_session(
                app_name=_APP_NAME, user_id=_USER_ID, session_id=session_id
            )
            return dict(session.state) if session is not None else {}

        # 1. Hypotheses (ADK LlmAgent with output_schema).
        started = perf_counter()
        hypotheses = await self._hypothesize(signal, extracted, run, state)
        calls.append(
            AdjudicationCall(
                ToolCallProvider.VERTEX,
                "hypothesize",
                f"ADK HypothesisAgent framed {len(hypotheses)} competing readings of "
                f"{signal.detected_item}.",
                duration_ms=_elapsed(started),
            )
        )

        # 2. Advocates fan out (ADK ParallelAgent) with a parallel-web search tool.
        searched: dict[str, list[str]] = {}
        include_domains = authoritative_domains_for(signal)

        def tool_for(hypothesis: Hypothesis) -> Callable[..., Any]:
            async def search_authoritative(
                search_queries: list[str], include_domains: list[str]
            ) -> list[dict[str, Any]]:
                """Search authoritative sources (registries, official sites) for this hypothesis.

                Args:
                    search_queries: 2-3 keyword queries, 3-6 words each.
                    include_domains: domains to restrict results to.
                """
                started_tool = perf_counter()
                ok = True
                urls: list[str] = []
                try:
                    response = await self._parallel_sdk.search(
                        objective=f"Find authoritative evidence about {signal.detected_item}.",
                        search_queries=search_queries[:3],
                        mode="fast",
                        max_chars_total=6_000,
                        session_id=session_id,
                        advanced_settings={
                            "source_policy": {"include_domains": include_domains[:10]},
                            "max_results": 5,
                        },
                    )
                    results = [
                        {
                            "url": item.url,
                            "title": getattr(item, "title", None) or item.url,
                            "excerpt": "\n".join(getattr(item, "excerpts", None) or [])[:1_200],
                            "publish_date": getattr(item, "publish_date", None),
                        }
                        for item in (getattr(response, "results", None) or [])
                    ]
                    urls = [item["url"] for item in results]
                except Exception as error:  # tool errors are reported, not raised
                    ok = False
                    logger.warning("advocate search failed error=%s", type(error).__name__)
                    results = []
                allowed.update(urls)
                searched.setdefault(hypothesis.id, []).extend(urls)
                calls.append(
                    AdjudicationCall(
                        ToolCallProvider.PARALLEL,
                        "search_authoritative",
                        f"Advocate ran Parallel Search ({len(urls)} URL(s)) on registries for "
                        f"{signal.detected_item}.",
                        ok=ok,
                        duration_ms=_elapsed(started_tool),
                    )
                )
                return results

            return search_authoritative

        advocates = build_advocate_agents(
            hypotheses, self._model, lambda *_a, **_k: [], tool_for=tool_for
        )
        fan_out = ParallelAgent(
            name="advocates", sub_agents=advocates, description="Argue each hypothesis in parallel"
        )
        await run(
            fan_out,
            f"Lead: {signal.detected_item}. Scene: {signal.context_excerpt[:800]}. "
            f"include_domains: {', '.join(include_domains)}",
        )
        final_state = await state()
        reports: list[AdvocateReport] = []
        for hypothesis in hypotheses:
            raw = final_state.get(f"advocate_{hypothesis.id}", "")
            try:
                parsed = extract_json_object(str(raw))
            except AdjudicationError:
                parsed = {
                    "best_url": None,
                    "why": "Advocate returned no usable evidence.",
                    "strength": "none",
                }
            best_url = parsed.get("best_url")
            if best_url not in allowed:
                best_url = None
            reports.append(
                AdvocateReport(
                    hypothesis_id=hypothesis.id,
                    best_url=best_url,
                    why=str(parsed.get("why", ""))[:1_000],
                    strength=(
                        parsed.get("strength")
                        if parsed.get("strength") in ("strong", "weak", "none")
                        else "none"
                    ),
                    searched_urls=list(dict.fromkeys(searched.get(hypothesis.id, []))),
                )
            )

        # 3. Judge: Gemini grounded with Parallel Web Search.
        started = perf_counter()
        memo = await self._judge(signal, decision, hypotheses, reports, allowed=allowed)
        calls.append(
            AdjudicationCall(
                ToolCallProvider.VERTEX,
                "judge_grounded",
                f"Gemini judge (grounded with Parallel Web Search) ruled {memo.verdict.value} "
                f"on {signal.detected_item}.",
                duration_ms=_elapsed(started),
            )
        )
        return AdjudicationResult(memo=memo, calls=calls)

    async def _hypothesize(
        self,
        signal: GeminiSignal,
        extracted: list[SearchResult],
        run: Callable[[Any, str], Any],
        state: Callable[[], Any],
    ) -> list[Hypothesis]:
        from google.adk.agents import LlmAgent

        agent = LlmAgent(
            name="hypothesis_agent",
            model=self._model,
            description="Frames competing rights-holder hypotheses",
            instruction=(
                "You are the hypothesis framer on a film rights-clearance desk. Given a lead and "
                "extracted web excerpts, list 2 or 3 mutually exclusive hypotheses about WHO "
                "controls the rights and WHAT the reference actually is. Give each an id h1..h3. "
                "Do not decide; do not give legal advice."
            ),
            output_schema=HypothesisSet,
            output_key="hypotheses",
        )
        excerpts = "\n\n".join(
            f"[{item.source.url}] {item.excerpt[:600]}" for item in extracted[:5]
        ) or "(no extracted excerpts)"
        await run(
            agent,
            (
                f"Lead: {signal.detected_item} ({signal.category})\n"
                f"Scene: {signal.context_excerpt[:800]}\n"
                f"Explanation: {signal.explanation}\n\nExcerpts:\n{excerpts}"
            ),
        )
        raw = (await state()).get("hypotheses")
        try:
            payload = raw if isinstance(raw, dict) else extract_json_object(str(raw))
            return HypothesisSet.model_validate(payload).hypotheses
        except Exception as error:
            raise AdjudicationError("HypothesisAgent returned invalid hypotheses") from error

    async def _judge(
        self,
        signal: GeminiSignal,
        decision: EvidenceCurationDecision,
        hypotheses: list[Hypothesis],
        reports: list[Any],
        *,
        allowed: set[str],
    ) -> ClearanceMemo:
        from google.genai import types

        briefs = "\n".join(
            f"- {r.hypothesis_id}: strength={r.strength} best_url={r.best_url} why={r.why}"
            for r in reports
        )
        prompt = (
            "You are the judge on a film rights-clearance desk. Advocates argued these hypotheses "
            f"about the lead '{signal.detected_item}':\n"
            + "\n".join(
                f"- {h.id}: {h.claim} (holder: {h.likely_rights_holder})" for h in hypotheses
            )
            + (
                f"\n\nAdvocate briefs:\n{briefs}\n\n"
                f"Curation's earlier pick: {decision.primary_url}\n\n"
            )
            + "Use grounding only to confirm, not to introduce new claims. Reply with ONLY a JSON "
            'object: {"verdict": "cleared"|"license_required"|"rewrite_recommended"|"needs_human", '
            '"confidence": 0..1, "winning_hypothesis_id": string, "dispositive_url": string|null, '
            '"rationale": string, "recommended_owner_role": "clearance"|"legal"|"production"}. '
            "dispositive_url must be one of the advocate URLs. No legal advice."
        )
        try:
            response = await self._genai.aio.models.generate_content(
                model=self._model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0,
                    tools=[
                        types.Tool(
                            parallel_ai_search=types.ToolParallelAiSearch(
                                api_key=self._parallel_api_key,
                                custom_configs={"mode": "fast", "max_results": 5},
                            )
                        )
                    ],
                ),
            )
        except Exception as error:
            raise AdjudicationError("Judge call failed") from error

        grounded_urls: set[str] = set()
        for candidate in getattr(response, "candidates", None) or []:
            metadata = getattr(candidate, "grounding_metadata", None)
            for chunk in getattr(metadata, "grounding_chunks", None) or []:
                web = getattr(chunk, "web", None)
                uri = getattr(web, "uri", None)
                if isinstance(uri, str):
                    grounded_urls.add(uri)

        payload = extract_json_object(getattr(response, "text", "") or "")
        payload.setdefault("hypotheses", [h.model_dump() for h in hypotheses])
        payload.setdefault(
            "advocates",
            [r.model_dump() if hasattr(r, "model_dump") else dict(vars(r)) for r in reports],
        )
        try:
            memo = ClearanceMemo.model_validate(payload)
        except Exception as error:
            raise AdjudicationError("Judge returned an invalid memo") from error
        return validate_memo_urls(memo, allowed | grounded_urls)
