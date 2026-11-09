# Fabled industry demos: Fabled Shots (film) and Fabled Forge (games)

Two workspaces that show the Fabled business model: **one collaboration core, one industry layer per creative
field, each plugged into the tools that field already uses** (Unreal Engine on the engine side; Higgsfield, Meshy and
Tripo on the generation side). Both run from one zero-dependency Node server and share `../ui/providers/` (the same
AI provider plugins as Fabled Studio). Research behind them: `../../docs/research/film-and-game-creative-tool-products.md`.

```bash
cd fabled/demos
npm start                      # http://127.0.0.1:5181/   → /film/ and /game/
npm test                       # engines + exporters + HTTP API (spawns its own server, no network, no keys)
npm run test:unreal            # the two Unreal scripts against a stand-in `unreal` module (logic only, not the real engine)
npm run test:screens           # headless-Chromium regression walkthrough of both demos (needs the server up; see below)
HIGGSFIELD_API_KEY=… HIGGSFIELD_API_SECRET=… npm start   # real image→video in Fabled Shots (see ../ui/PROVIDERS.md)
MESHY_API_KEY=… npm start                                 # real text→3D in Fabled Forge
```

The demos need Node 18 or newer and nothing else. `npm run test:screens` also needs Playwright with Chromium
(`npm i -D playwright && npx playwright install chromium`); it fails on any failed check or unexpected console error and
writes `screenshots/*.png`.

Keys live in the server environment only; the browser sees provider *names* and a `configured` flag. Project state is
JSON in `work/` (gitignored); shot frames are files under `work/film/<project>/frames/`. Several browser tabs on one
project see each other's edits within ~3 s.

**Collaboration and safety rules the server enforces** (the full contract is the comment at the top of `server.mjs`):
- Edits to one project are applied one at a time, so simultaneous edits are all kept. A client may send
  `If-Match: <rev>`; a stale revision gets `409` with the current project and nothing is changed.
- Polling (`…/clips?rev=`, `…/generations?rev=`) answers a small `unchanged` body while nothing a collaborator cares
  about has changed. Provider progress ticks do not bump the revision.
- Status, size, move, category, assignee and import profile are whitelisted; numbers are clamped; free text is cleaned.
- Requests from other websites are refused: `Origin` must match `Host`, `Host` must be a loopback name unless the
  server was started with a non-loopback `HOST` (then also `FABLED_ALLOWED_HOSTS`), and bodies must be
  `application/json`. There is no login: on a LAN bind, anyone who can reach the port can use the API.
- A second "generate" on an item whose generation is still queued or running is refused (`409 generation_running`)
  unless the request sends `force: true`, because providers bill per generation.

## Fabled Shots (`/film/`) — screenplay → shot list → storyboard/animatic → clips → Unreal Sequencer

| Step | What happens | Real or labeled? |
|---|---|---|
| Breakdown | `film/breakdown.mjs` parses Fountain/standard screenplay text into scenes, characters, dialogue, action and props. | Real, deterministic, offline. |
| Proposed coverage | Per scene: an establishing shot, OTS/medium coverage alternating sides for dialogue, action rules (run → handheld tracking, explode → crash zoom, look → push-in …) with lens and a duration estimate. | Real rules; numbers carry an **ESTIMATE** badge. An LLM "director pass" can replace `proposeShots()` without changing the schema. |
| Review | Director / DP / previs artist approve, send back, edit size, move, lens, duration, assignee; comments per shot; activity log. | Real. |
| Storyboard & animatic | Placeholder frames are drawn from shot metadata (framing, OTS mask, move arrow) and the animatic plays them with a Ken Burns move per preset at the estimated timing. Voice-over and off-screen lines stay on the scene instead of cutting to the speaker. | Placeholder frames are labeled **CONCEPT MOCKUP**. Uploaded stills (PNG, JPEG or WebP, up to 10 MB) replace them. |
| Clips | "Animate frame → clip" sends the shot's still + prompt to an image→video provider (Higgsfield adapter; Runway also present) and polls it. | Real call when a key is set; the Higgsfield adapter follows the public API shape found in Nov 2026 research but is **not yet exercised with a key**. Open question: the still is sent inline as a data URI, and whether Higgsfield accepts that (rather than a public URL or an upload) is unverified; stills over about 6 MB are refused by the adapter before any call. |
| Export | `shotlist.json` (`fabled.shotlist/0.1`), `shotlist.csv`, `sequencer_plan.json` (`fabled.sequencer_plan/0.1`, `plan_version: 2`: one stage per location 50 m apart, camera per shot in absolute world cm, focal length, start/end transform, frame ranges at 24 fps) and `unreal/build_sequence_from_shotlist.py`. | Exports are real; the Unreal script passes its stand-in tests but is **UNTESTED IN ENGINE** (no editor on the build box). |

## Fabled Forge (`/game/`) — pitch → asset kit → generate → validate → layout → Unreal blockout

| Step | What happens | Real or labeled? |
|---|---|---|
| Kit | `game/kit.mjs` turns a pitch (free text plus optional `Genre:`/`Characters:`/`Props:`/`Environment:` lines) into assets, each with a category, an import profile and budgets (LOD tris, height range, axis, texel density, textures, rig). | Real rules; budgets are **DEMO PLACEHOLDER VALUES** mirroring `../validator/profiles/`. |
| Task board | Kanban by status `requested → generating → generated → in_pipeline → validated → imported`, assignees (designer, artists, vendor, TAD), comments. | Real. |
| Generate | Text→3D through a provider plugin: offline mock (procedural GLBs, **CONCEPT MOCKUP**), or Meshy/Tripo with keys. Output downloads and hands off to Fabled Studio's pipeline + pre-import validator against the asset's profile. | Real plumbing; hand-off is a link (the pipeline stays in `../ui`). |
| Level layout | Top-down canvas, drag/rotate/scale on a 1 m grid, player spawn; saved as `fabled.layout/0.1`. | Real. |
| Export | `kit.json`, `layout.json`, `import_profiles.json` (validator input), `blockout_plan.json` (`fabled.blockout_plan/0.1`: one actor per placement with a `/Game/Fabled/<Asset>/<Asset>` mesh path, plus placeholder-box dims) and `unreal/blockout_from_layout.py`. | Exports are real; the Unreal script passes its stand-in tests but is **UNTESTED IN ENGINE**. Known mismatch: `../unreal/import_fabled_asset.py` defaults to `/Game/Fabled/<source file stem>/SM_<stem>`, so import with `--dest /Game/Fabled/<Asset> --name <Asset>` (the blockout script also looks in the importer's default place). |

## Layout

```
demos/
  server.mjs                 one HTTP server: static + /api/film/* + /api/game/* (+ /api/status, /api/samples, /api/mock-models)
  film/breakdown.mjs         screenplay parser, coverage rules, move presets, CSV + Sequencer-plan exporters
  game/kit.mjs               pitch parser, category defaults, layout sanitizing, starter layout, blockout plan
  public/                    landing (index.html), shared.css, film/ and game/ apps (plain ES modules, no build step)
  unreal/                    build_sequence_from_shotlist.py, blockout_from_layout.py (UNTESTED IN ENGINE), README.md with a
                             first-run checklist, fake_unreal/ (test stand-in), fixtures/
  samples/                   the_lantern_keeper.fountain (original, CC0), mossgate_pitch.txt
  tools/                     test_engines.mjs, test_demos.mjs, test_unreal_scripts.py, screenshot_demos.mjs
  work/                      runtime state (gitignored)
```

## What to verify before showing this to a studio
1. Run both Unreal scripts in UE 5.6+ following `unreal/README.md` (it lists the API calls most likely to need adjusting, in order). Passing the stand-in tests proves the scripts' logic and data flow, not that the engine accepts the calls.
2. Make one real Higgsfield image→video call and one real Meshy call; pin the response shapes in `../ui/tools/test_connected_workspace.mjs`, and settle whether Higgsfield takes an inline still.
3. Replace the rule-based `proposeShots()` with a model-backed director pass only once a reviewer has compared it against a human shot list on the same script. Known limits of the rules: pronoun subjects ("She falls") and words that are both noun and verb ("hands", "watch").
4. Add real accounts before more than one trusted team uses a server: roles are self-declared and there is no login.
