# Clearance Adjudicator and hackathon submission readiness

Date: 2026-09-01
Status: approved design, awaiting implementation plan
Target: Agentic Cinema: The Blockbuster Hackathon, Parallel track. Deadline 2026-09-09 14:00 PDT.

## Goal

Ship RightsRadar as a Parallel-track submission that passes Stage One screening and scores on all
four Stage Two criteria (technological implementation, design, potential impact, quality of idea)
by adding one genuinely multi-agent stage, the **Clearance Adjudicator**, and by closing the
submission blockers (public repo, license, hosted API, official Parallel SDK).

The team has one engineer driving an agent in the evenings. Every item below is sized for that.

## Non-goals

- No Google sign-in or real authentication. Roster members remain the user model.
- No LangGraph or any non-Google agent framework. Rules forbid "other agent frameworks."
- No rewrite of Intake, Research, or Curation onto ADK. They work and are tested.
- No Agent Engine hosting, Imagen, Lyria, or TTS.
- No new screens. The Adjudicator plugs into the existing desk, thread, pipeline strip, and Inbox.

## Why an Adjudicator

Real clearance disputes are about *which* source controls. The 2026-08-31 cloud run on the Matrix
homage returned, for the lead "The Matrix", both a Warner Bros. / Village Roadshow co-ownership
filing and a USPTO registration for "MATRIX" owned by The Matrix.org Foundation. Curation picks one
primary source. A rights desk needs the competing readings argued and resolved, with the losing
reading recorded. That is a natural fan-out / judge pattern and a credible use of a multi-agent
network rather than a chain of prompts.

## Architecture

### Contested-lead detector (deterministic, no LLM)

After `ResearchAgent.research_lead` has extracted results and a Curation decision, a lead is
**contested** when any of:

1. The lead category (a free-form string from Gemini in cloud mode, e.g. `Film Title/Franchise`,
   or a fixture key like `quotation` in mock) contains any of `franchise`, `title`, `character`,
   `quot`, or `likeness` after lower-casing (ownership is routinely ambiguous there), or
2. The lead's signal confidence is below `RIGHTSRADAR_ADJUDICATE_BELOW_CONFIDENCE`
   (default `0.75`), or
3. Extracted sources include at least one host on the registry list (`uspto.gov`,
   `copyright.gov`, `trademarkia.com`, `wipo.int`, `sec.gov`, `justia.com`) **and** at least one
   host not on that list, which signals both a registry record and a separate claimant.

Uncontested leads finish exactly as today. The detector lives in
`services/api/app/agents/adjudicator.py` as a pure function `is_contested(signal, extracted,
decision) -> bool` and is unit tested.

### Adjudicator (ADK)

Package: `google-adk` (1.x line) in the `cloud` dependency group. Gemini runs on Vertex through ADC
(`GOOGLE_GENAI_USE_VERTEXAI=true`, project and location from existing settings).

`Adjudicator` is an ADK `SequentialAgent` with three sub-agents:

1. **HypothesisAgent** (`LlmAgent`, `output_key="hypotheses"`, JSON response schema). Input: the
   lead, scene excerpt, and the extracted excerpts. Output: two or three mutually exclusive
   hypotheses, each `{id, claim, likely_rights_holder, what_would_prove_it}`.
2. **Advocates** (`ParallelAgent`). One `LlmAgent` per hypothesis, constructed at run time from
   `state["hypotheses"]`, `output_key=f"advocate_{id}"`. Each Advocate has exactly one tool,
   `search_authoritative(search_queries: list[str], include_domains: list[str]) -> list[dict]`,
   a `FunctionTool` that calls `parallel-web` `client.search(..., mode="fast",
   advanced_settings={"source_policy": {"include_domains": include_domains}})` and returns
   `[{url, title, excerpt, publish_date}]`. The instruction tells the Advocate to prove its
   hypothesis from registries and official sources, run at most two searches, and end with
   `{best_url, why, strength: strong|weak|none}`. Advocates never call Extract; the main Research
   lanes already did.
3. **JudgeAgent** (`LlmAgent`, `output_key="memo"`, JSON response schema). Input: all
   `advocate_*` outputs and the original Curation decision. It calls Gemini with
   `types.Tool(parallel_ai_search=types.ToolParallelAiSearch(api_key=<parallel key>,
   custom_configs={"mode": "fast", "max_results": 5}))` as a grounding tool so the memo can cite
   grounding chunks. Output is a **Clearance Memo**:

   ```json
   {
     "verdict": "cleared | license_required | rewrite_recommended | needs_human",
     "confidence": 0.0,
     "winning_hypothesis_id": "h1",
     "dispositive_url": "https://...",
     "rationale": "one paragraph",
     "recommended_owner_role": "clearance | legal | production"
   }
   ```

   `dispositive_url` **must** be a URL returned by an Advocate's tool call or present in the
   Judge's grounding chunks; anything else fails validation and the memo is rejected (same rule
   Curation already enforces for its primary URL).

Execution: `Runner(agent=adjudicator, app_name="rightsrader", session_service=
InMemorySessionService())` invoked with `run_async` from the existing asyncio pipeline. One
session per lead, `session_id=f"rightsrader:{case_id}:{index}:adjudicate"`.

### Recording and persistence

- Tool log: every Advocate search is recorded as `ToolCallEvent(provider=parallel,
  method="search_authoritative", agent_name="Adjudicator", lead=<item>)`; the Hypothesis and
  Judge model calls as `provider=vertex, method="hypothesize"` and `method="judge_grounded"`.
  Fixture flag follows `provider_is_fixture` as today.
- Thread: Adjudicator posts (a) one message listing the hypotheses, (b) one message per Advocate
  with its best URL and strength, (c) the Judge's verdict line with `@<owner role member>`
  mention. `agent_name="Adjudicator"`.
- Finding: new optional field `memo: ClearanceMemo | None` on `Finding`
  (`services/api/app/models/cases.py`). The memo's `recommended_owner_role` maps to the roster
  member with that role (skip if the role is missing; never invent people) and is appended to
  `stakeholder_ids` and set as `assignee`. This is what routes the item into that user's Inbox.
- Firestore: `memo` is stored on the finding document. No new collections.
- OpenAPI/client: `make generate-client` regenerates `packages/api-client/src/generated.ts`;
  CI `check-client` must stay green.

### Mock mode

`MockAdjudicator` returns deterministic memos for the two featured demo scripts
(`The Matrix` → `license_required`, legal; `There is no spoon` → `rewrite_recommended`, legal;
`Nimbus Soda` → `cleared`, clearance) and `needs_human` for anything else. Tool calls are
recorded with `fixture=True`. E2E and offline demos work unchanged.

### Failure handling

If ADK, Vertex, or Parallel raises during adjudication, the lead keeps its Curation result,
`memo` stays `None`, the failed call is logged with `ok=False`, and the thread gets one line:
"Adjudicator could not resolve this lead; leaving it with Curation's pick." The case never
returns 503 because of the Adjudicator. Adjudication for all contested leads runs under the same
concurrency bound as Research (`RIGHTSRADAR_PARALLEL_MAX_CONCURRENCY`).

## UI

Files: `apps/web/components/script-review.tsx` (desk, pipeline, finding cards),
`apps/web/components/dashboard.tsx` (Inbox, walkthrough orchestration),
`apps/web/lib/demo-reveal.ts`, `apps/web/components/demo-coach.tsx`.

1. **Pipeline strip.** Add an `Adjudicator` node after Curation, rendered only when the case has
   at least one finding with a memo or an Adjudicator tool call. `revealStage` gains
   `'adjudication'`.
2. **Walkthrough.** `DEMO_REVEAL_BY_STEP` becomes
   `ready → intake → research → curation → adjudication → human`. `AGENTS_BY_STAGE.adjudication`
   adds `Adjudicator`; findings show memos only at `adjudication` and `human`. The coach gets one
   more step with copy explaining the fan-out. `scripts/show-walkthrough.cjs` presses Next five
   times.
3. **Thread.** No new component. Adjudicator messages render like other agent messages, with
   their Parallel and Vertex chips underneath.
4. **Clearance Memo card.** Inside the finding card, below primary evidence: verdict stamp
   (reuse the stamp CSS from `globals.css`), confidence, dispositive source link (opens in a new
   tab), rationale paragraph, and "Assigned to <Name> (<role>)". Escalate and Dismiss are
   unchanged.
5. **Inbox.** Rows show a small verdict chip when a memo exists. No filter changes.
6. **Judge-facing copy.** Rename "JUDGE LOG" to "Agent tool log"; chips show `live` or
   `fixture`; add one line under the pipeline strip: "Intake → Research (Parallel Search ×N +
   Extract) → Curation → Adjudicator (ADK multi-agent) → your call."
7. **Polish backlog.** Items from the codebase/UI audit that are cheap and visible go into the
   implementation plan as a final task; anything larger is deferred.

## Deployment and operations

### API on Cloud Run

- Build from `services/api/Dockerfile` (already installs the `cloud` group). Add `google-adk`
  and `parallel-web` to that group.
- Service: `rightsrader-api`, region matching the Firestore/GCS project, min instances 0,
  request timeout 300 s, concurrency 8, 1 GiB memory.
- Env: `RIGHTSRADAR_MODE=cloud`, project/location/bucket/collection from the existing `.env`
  keys, `RIGHTSRADAR_PARALLEL_API_KEY` mounted from Secret Manager,
  `RIGHTSRADAR_ALLOWED_ORIGINS=https://hackathon-project-web-five.vercel.app`.
- Service account roles: Vertex AI User, Cloud Datastore User, Storage Object Admin, Secret
  Manager Secret Accessor.
- `services/api/app/main.py` reads `allowed_origins` from settings (comma separated) instead of
  the hardcoded localhost list; localhost defaults remain for mock/dev.
- `/health` continues to report `mode`; add `adjudicator: "adk" | "fixture"` so judges can see
  the multi-agent path is live.

### Cost guard

- Firestore document `rightsrader_quota/{YYYY-MM-DD}` with an atomic increment.
  `POST /api/cases` and `POST /api/cases/from-file/{production_id}` return `429` with body
  `{"detail": "Daily live-analysis budget reached. Pre-analyzed demo cases remain open."}` once
  `RIGHTSRADAR_DAILY_ANALYSIS_CAP` (default `25`) is reached. The web shows that message inline.
- Pre-analyzed demo cases (Matrix homage, two-lane skywalk) are created once in cloud and are
  reused by `runWalkthrough`, so the walkthrough never spends budget after the first run.
- Advocates use Parallel `mode="fast"`; main Research lanes keep `advanced`.

### Web on Vercel

- Set `NEXT_PUBLIC_API_BASE_URL` to the Cloud Run URL in the Vercel project and redeploy.
- Confirm the Vercel project's production branch is `main`; `9ed8d7f` has not produced a
  Production deployment as of 2026-09-01 and the live site still shows the pre-walkthrough build.
- Disable Vercel deployment protection on Production so judges are not asked to log in.

## Submission compliance (Stage One)

1. Repository public; `LICENSE` (Apache-2.0) at the repo root so GitHub detects it in About.
2. Parallel via the official `parallel-web` Python SDK. `ParallelSearchHttpClient` is replaced
   by `ParallelSdkClient` implementing the same `ParallelSearchClient` Protocol (`search`,
   `extract`, `aclose`) using `AsyncParallel`; tests that mocked `httpx` move to mocking the SDK
   client. Timeout 90 s (Extract live fetch can take up to 60 s).
3. Google Cloud SDKs present and called at runtime: `google-genai` (existing) and `google-adk`
   (new). Both are on the rules' accepted list.
4. README: a "Judges: 90-second tour" section at the top with the live URL, the demo click path,
   the Adjudicator explanation, and the expected tool-call table including
   `search_authoritative ≥ 2`, `hypothesize ≥ 1`, `judge_grounded ≥ 1` on the Matrix script.
5. Devpost text and a sub-3-minute video recorded from the live URL (English captions).

## Testing

- Unit (`services/api/tests`): `is_contested` truth table; `ClearanceMemo` validator rejects a
  `dispositive_url` no Advocate or grounding chunk returned; owner-role → roster mapping skips
  missing roles; `MockAdjudicator` outputs; `ParallelSdkClient` request shaping (objective,
  `search_queries`, `advanced_settings.source_policy`, session id) and URL restriction on
  Extract.
- API (`test_case_routes.py`): adjudicator failure leaves `memo=None` and returns 201; quota cap
  returns 429 and does not call agents.
- Web unit (`apps/web/tests`): `demo-reveal` includes the `adjudication` stage; Inbox verdict
  chip helper.
- E2E (mock, `tests/e2e/demo-mode.spec.ts`): walkthrough shows five stages, Adjudicator chips,
  and a memo card; Inbox row for Maya shows the rewrite verdict.
- Cloud: one recorded run of the Matrix walkthrough against Cloud Run before the video; verify
  `/health` shows `mode: cloud`, `adjudicator: adk`, and that memo URLs are real.

## Sequencing (for the implementation plan)

1. Compliance first: LICENSE, public repo, `parallel-web` swap, CORS from settings, quota cap.
2. Cloud Run deploy and Vercel env; confirm the public URL works end to end with today's
   pipeline.
3. Adjudicator backend with mock, unit tests, client regeneration.
4. UI: pipeline node, walkthrough stage, memo card, Inbox chip, copy fixes, audit polish.
5. E2E update, README/Devpost text, recorded cloud run, video.
