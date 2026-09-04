# Devpost submission checklist

Hackathon: [Agentic Cinema: The Blockbuster Hackathon](https://agentic-cinema.devpost.com/)
Deadline: **2026-09-09 14:00 PDT**. Judging window is about 2026-09-23 through 2026-10-07.

Track: **Parallel**. Official rules: <https://agentic-cinema.devpost.com/rules>

Paste-ready copy lives in [`devpost-submission.md`](./devpost-submission.md).

## Required fields

| Requirement | Status | Where |
| --- | --- | --- |
| Hosted project URL | Ready | https://hackathon-project-web-five.vercel.app |
| API health (`mode: cloud`, `adjudicator: adk`) | Ready | https://rightsrader-api-56763386386.us-central1.run.app/health |
| Public GitHub repo | Ready | https://github.com/fabled-tech/hackathon-project (`visibility: public`) |
| OSI license detectable in About | Ready | `LICENSE` is Apache-2.0; GitHub shows the badge |
| Runtime Google Cloud use in code | Ready | `google-genai`, `google-adk` imported and called under `services/api/app/integrations/` |
| Runtime Parallel Search in code | Ready | `from parallel import AsyncParallel` in `services/api/app/integrations/parallel.py`; Parallel Web Search also used as Gemini grounding |
| Devpost form: Parallel track selected | Owner | Must be selected on the submission page |
| Team ≤ 4, all members on the Devpost project | Owner | Representative submits |
| ~3 minute demo video (YouTube/Vimeo, public, English) | Missing | Record the README 90-second tour, then 1–2 minutes of Accept / Hand to / Inbox |
| Written description | Drafted | [`devpost-submission.md`](./devpost-submission.md) |

## Official-rules notes that can disqualify us

- **New project during the contest period** (27 Jul 2026 – 9 Sep 2026). Do not describe this as a continuation of an older product.
- **Only Google Cloud AI + Parallel AI.** Do not add OpenAI, Anthropic, AWS Bedrock, or another agent framework. FastAPI, Next.js, and Vercel are allowed (non-AI).
- **Video must show the project running**, in English, ≤ 3 minutes. Only the first 3 minutes are judged.
- **Video trademark risk.** Official rules say the video must not display third-party trademarks. Prefer the original **Nimbus Soda / “Time keeps the reel turning”** two-lane script for the recorded trailer. Keep The Matrix homage for the live judges tour, where it is research subject matter rather than branding.
- **Third-party APIs.** Parallel and Google Cloud use is authorized by the hackathon. Do not upload real studio scripts or personal data to the public demo.
- **Open-source license for Non-Proprietary Aspects** must allow commercial use. Apache-2.0 does.

## Judging criteria (equal weight)

1. Technological implementation — Vertex + ADK + Parallel Search/Extract + grounding, visible in the tool log.
2. Design — complete desk (roster, thread, Inbox, memo), not a chat proof of concept.
3. Potential impact — clearance ownership fights, not “detect the title.”
4. Quality of the idea — contested-lead adjudication, URL allow-list, assigned Inbox.

## Day-of demo (do not burn the daily cap)

1. Open the hosted app. Click **Walk The Matrix homage**.
2. Press **Run next stage** five times. Open **Show agent tool log**.
3. Acting as Jordan, Accept or Dismiss one lead. Acting as Maya, Escalate and Hand to.
4. Open `/health` in a tab and show `mode: cloud`.
5. If the daily analysis cap (25/UTC day) is hit, walk the already-filed Matrix case. Existing cases stay readable.

Local rehearsal: `make dev` then http://127.0.0.1:3000 (mock fixtures, no keys).
