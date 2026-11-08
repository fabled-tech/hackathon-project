# Fabled industry demos: Fabled Shots (film) and Fabled Forge (games)

Two workspaces that show the Fabled business model: **one collaboration core, one industry layer per creative
field, each plugged into the tools that field already uses** (Unreal Engine on the engine side; Higgsfield, Meshy and
Tripo on the generation side). Both run from one zero-dependency Node server and share `../ui/providers/` (the same
AI provider plugins as Fabled Studio). Research behind them: `../../docs/research/film-and-game-creative-tool-products.md`.

```bash
cd fabled/demos
npm start                      # http://127.0.0.1:5181/   → /film/ and /game/
npm test                       # engines + exporters + HTTP API (spawns its own server, no network, no keys)
npm run test:screens           # headless-Chromium walkthrough of both demos → screenshots/*.png (needs the server up)
HIGGSFIELD_API_KEY=… HIGGSFIELD_API_SECRET=… npm start   # real image→video in Fabled Shots (see ../ui/PROVIDERS.md)
MESHY_API_KEY=… npm start                                 # real text→3D in Fabled Forge
```

Keys live in the server environment only; the browser sees provider *names* and a `configured` flag. Project state is
JSON in `work/` (gitignored). Several browser tabs on one project see each other's edits within ~3 s (revision polling).

## Fabled Shots (`/film/`) — screenplay → shot list → storyboard/animatic → clips → Unreal Sequencer

| Step | What happens | Real or labeled? |
|---|---|---|
| Breakdown | `film/breakdown.mjs` parses Fountain/standard screenplay text into scenes, characters, dialogue, action and props. | Real, deterministic, offline. |
| Proposed coverage | Per scene: an establishing shot, OTS/medium coverage alternating sides for dialogue, action rules (run → handheld tracking, explode → crash zoom, look → push-in …) with lens and a duration estimate. | Real rules; numbers carry an **ESTIMATE** badge. An LLM "director pass" can replace `proposeShots()` without changing the schema. |
| Review | Director / DP / previs artist approve, send back, edit size, move, lens, duration, assignee; comments per shot; activity log. | Real. |
| Storyboard & animatic | Placeholder frames are drawn from shot metadata (framing, OTS mask, move arrow) and the animatic plays them with a Ken Burns move per preset at the estimated timing. | Placeholder frames are labeled **CONCEPT MOCKUP**. Uploaded stills replace them. |
| Clips | "Animate frame → clip" sends the shot's still + prompt to an image→video provider (Higgsfield adapter; Runway also present) and polls it. | Real call when a key is set; the Higgsfield adapter is updated to the public API shape found in Nov 2026 research but **not yet exercised with a key** from this repo. |
| Export | `shotlist.json` (`fabled.shotlist/0.1`), `shotlist.csv`, `sequencer_plan.json` (`fabled.sequencer_plan/0.1`: camera per shot, focal length, start/end transform, frame ranges at 24 fps) and `unreal/build_sequence_from_shotlist.py`. | Exports are real; the Unreal script is an **UNTESTED DRAFT** (no editor on the build box). |

## Fabled Forge (`/game/`) — pitch → asset kit → generate → validate → layout → Unreal blockout

| Step | What happens | Real or labeled? |
|---|---|---|
| Kit | `game/kit.mjs` turns a pitch (free text plus optional `Genre:`/`Characters:`/`Props:`/`Environment:` lines) into assets, each with a category, an import profile and budgets (LOD tris, height range, axis, texel density, textures, rig). | Real rules; budgets are **DEMO PLACEHOLDER VALUES** mirroring `../validator/profiles/`. |
| Task board | Kanban by status `requested → generating → generated → in_pipeline → validated → imported`, assignees (designer, artists, vendor, TAD), comments. | Real. |
| Generate | Text→3D through a provider plugin: offline mock (procedural GLBs, **CONCEPT MOCKUP**), or Meshy/Tripo with keys. Output downloads and hands off to Fabled Studio's pipeline + pre-import validator against the asset's profile. | Real plumbing; hand-off is a link (the pipeline stays in `../ui`). |
| Level layout | Top-down canvas, drag/rotate/scale on a 1 m grid, player spawn; saved as `fabled.layout/0.1`. | Real. |
| Export | `kit.json`, `layout.json`, `import_profiles.json` (validator input), `blockout_plan.json` (`fabled.blockout_plan/0.1`: one actor per placement with the `/Game/Fabled/<Asset>/<Asset>` path the importer uses, plus placeholder-box dims) and `unreal/blockout_from_layout.py`. | Exports are real; the Unreal script is an **UNTESTED DRAFT**. |

## Layout

```
demos/
  server.mjs                 one HTTP server: static + /api/film/* + /api/game/* (+ /api/status, /api/samples, /api/mock-models)
  film/breakdown.mjs         screenplay parser, coverage rules, CSV + Sequencer-plan exporters
  game/kit.mjs               pitch parser, category defaults, starter layout, blockout plan
  public/                    landing (index.html), shared.css, film/ and game/ apps (plain ES modules, no build step)
  unreal/                    build_sequence_from_shotlist.py, blockout_from_layout.py  (UNTESTED DRAFTS)
  samples/                   the_lantern_keeper.fountain (original, CC0), mossgate_pitch.txt
  tools/                     test_demos.mjs, screenshot_demos.mjs
  work/                      runtime state (gitignored)
```

## What to verify before showing this to a studio
1. Run `unreal/build_sequence_from_shotlist.py` and `unreal/blockout_from_layout.py` in UE 5.6+ and fix API names (their headers list the calls to check). Then drop the UNTESTED label.
2. Make one real Higgsfield image→video call and one real Meshy call; pin the response shapes in `../ui/tools/test_connected_workspace.mjs`.
3. Replace the rule-based `proposeShots()` with a model-backed director pass only once a reviewer has compared it against a human shot list on the same script.
