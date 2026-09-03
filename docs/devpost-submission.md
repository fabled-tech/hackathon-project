# RightsRadar — Devpost submission

Live app: https://hackathon-project-web-five.vercel.app

Track: **Parallel**. Google Cloud: Vertex AI Gemini via `google-genai`, ADK via `google-adk`,
Firestore, Cloud Storage, Cloud Run. Parallel: `parallel-web` Search + Extract, and Parallel Web
Search as a Gemini grounding provider.

## Inspiration

Clearance desks do not argue about whether a script mentions a title. They argue about *who owns
what*. A one-sheet that says “The Matrix” can be a Warner Bros. / Village Roadshow franchise
reference that needs a studio license — or it can collide with a USPTO registration for “MATRIX”
owned by an unrelated software project. Curation can pick one primary URL. A real desk needs the
competing readings framed, argued, and resolved, with the losing reading kept on the record.

RightsRadar started as a hosted research desk for that work: named agents, a production roster,
and Parallel-backed evidence that a reviewer can dismiss or escalate. The Clearance Adjudicator
is the multi-agent stage that makes the ownership fight visible instead of collapsing it into a
single citation.

## What it does

RightsRadar is a rights-clearance research desk, not a chatbot. A production team files script
text and production files. Four named agents run the case, and the fourth only runs on contested
leads:

1. **IntakeAgent** (Vertex Gemini) detects research leads and @mentions Research.
2. **ResearchAgent** attaches roster stakeholders, then for each lead: Vertex `plan_queries`,
   Parallel Search once per objective, Parallel Extract on the merged URL set, and Vertex
   `brief_stakeholders`.
3. **CurationAgent** (Vertex Gemini `curate_evidence`) cites only extracted URLs, or refuses a
   source, and @mentions the same stakeholders.
4. **Clearance Adjudicator** (ADK) takes contested leads — franchise, quote, character, likeness,
   low confidence, or registry-vs-claimant evidence. An ADK `LlmAgent` frames 2–3 hypotheses, an
   ADK `ParallelAgent` runs one advocate per hypothesis with a `parallel-web` Search tool pinned
   to registries, and Gemini (grounded with Parallel Web Search) writes a Clearance Memo. The memo
   is assigned to a roster member and lands in their **Inbox**. It may only cite a URL an advocate
   or the grounding step returned.

Humans reply in the same thread as Jordan (clearance), Alex (production), or Maya (legal). The
walkthrough files The Matrix rooftop homage (franchise **and** “There is no spoon”) and reveals
Intake → Research → Curation → Adjudicator → your turn, one **Run next stage** press at a time.

It is research assistance only: it does not provide legal advice or make final infringement
determinations.

## How we built it

- **Vertex Gemini via `google-genai`** for Intake, query planning, stakeholder briefs, Curation,
  and the grounded Judge that writes the Clearance Memo.
- **ADK `LlmAgent` / `ParallelAgent`** (`google-adk`) for the Adjudicator: hypotheses first, then
  one advocate per hypothesis in parallel.
- **`parallel-web` Search + Extract** for the main Research lanes (`advanced` Search, then one
  Extract on the merged shortlist) and for advocate `search_authoritative` calls pinned to
  registry domains.
- **Parallel Web Search as Gemini grounding** on the Judge so the memo can cite grounding chunks,
  not invented URLs.
- **Firestore and Cloud Storage** for the case thread, findings, memos, and private production
  assets.
- **FastAPI on Cloud Run** (`RIGHTSRADAR_MODE=cloud`, daily analysis cap) with `/health`
  reporting `mode: cloud` and `adjudicator: adk`.
- **Next.js on Vercel** for the production workspace, case desk, walkthrough, and Inbox.

Mock mode uses labeled fixtures so Playwright and local `make dev` stay offline. Cloud mode uses
Application Default Credentials for Vertex and a server-only Parallel API key.

## Challenges

**URL discipline.** No agent may cite a URL a tool did not return. Curation may only pick an
extracted candidate. The Adjudicator memo’s `dispositive_url` must be an advocate result or a
Judge grounding chunk; anything else fails validation and the memo is rejected. That rule is
what makes the tool log judge-visible instead of decorative.

**Extract live-fetch latency.** Parallel Extract can take tens of seconds to fetch and excerpt
pages. The API timeout is 90 s, Research stays bounded by `RIGHTSRADAR_PARALLEL_MAX_CONCURRENCY`,
and the walkthrough reuses a pre-analyzed Matrix case so the demo does not spend the live budget
after the first cloud run.

**Cost cap.** Live Vertex + Parallel + ADK calls add up. New analyses increment a per-UTC-day
Firestore quota (`RIGHTSRADAR_DAILY_ANALYSIS_CAP`). Once the cap is hit, new cases return 429
while pre-analyzed demo cases stay readable.

## Accomplishments

- A hosted Parallel-track desk with a public Next.js app, Cloud Run API, and a 90-second judges
  tour at the top of the README.
- A genuine multi-agent stage: ADK hypotheses, parallel registry advocates, and a grounded
  Clearance Memo assigned into a real person’s Inbox.
- Deterministic mock fixtures so e2e can walk six stages and assert Maya sees **Rewrite
  recommended** without calling live APIs.
- Tool-call chips and an agent tool log that let judges count Vertex and Parallel calls
  (`hypothesize`, `search_authoritative`, `judge_grounded` on the Matrix script).
- Stakeholder mapping that never invents people: clearance always; production on brand and
  franchise; legal on likeness, quotes, music, and character.

## What we learned

Ownership disputes are a fan-out problem, not a longer prompt. The Matrix one-sheet vs the
MATRIX software mark is the same lead with two coherent readings; arguing them in parallel and
forcing the Judge to cite a tool-returned URL is more honest than asking one model to “pick the
best source.”

We also learned that demo credibility is operational: mock fixtures must be labeled, the live
badge must come from `/health`, and the walkthrough has to reveal stages instead of dumping a
finished case, or judges cannot tell Vertex and Parallel actually ran.

## What's next

- **Parallel Task API** for deep dossiers on reviewer-escalated or still-ambiguous leads, so a
  contested franchise or likeness can leave the fast desk path without losing the memo trail.
- **Monitor** for re-checks: watch the dispositive registry or studio page and reopen the Inbox
  item if the record that won the memo changes.

The foundation still excludes authentication, payment, and final legal decisions. The quality
bar after the hackathon is a labeled Gemini and Parallel evaluation harness with a human-review
rubric, then those Task and Monitor paths.

## Built with

`google-adk, google-genai, vertex-ai, gemini, parallel-web, parallel-search, firestore, cloud-run, fastapi, nextjs, vercel`
