# AGENTS.md — Fabled (Fable Technologies)

Fabled turns high-poly 3D sculpts into Unreal-ready static-mesh assets (retopo, UVs, LODs, baked maps, FBX with LodGroup) and checks them against a studio import profile before import. Audience: technical art directors at AA studios shipping in Unreal. Patrick Argento's startup and UCLA ENGR 215 project. Everything here is a **prototype**.

## Layout (relative to `fabled/`)
| Path | What |
|---|---|
| `pipeline/` | Python driver `fabled_pipeline.py` + Blender step scripts `scripts/01..07_*.py`, `config/*.json`, vendored `fast_simplification` (linux x86_64 / CPython 3.11 `.so`). `input/`, `output/`, `runs/` are NOT in the kit. |
| `validator/` | `fabled_validator` package (pre-import check), `profiles/`, `schema/report.schema.json`, `fixtures/`, `tests/` |
| `ui/` | Local demo UI: `server.mjs` (Node, no deps) + `public/` (ES modules, three.js 0.169). `stub/`, `samples/`, `tools/`, `INTERFACES.md` |
| `unreal/` | `import_fabled_asset.py` (Unreal Editor Python, **UNTESTED DRAFT**), `CAPTURE_NOTES.md` |
| `docs/demo/fabled_demo_script_storyboard.md` | Demo script + shot list (v1 draft; numbers are placeholders until captured) |
| `landing-mockup/` | Static `index.html` + PNG, bannered CONCEPT MOCKUP |

Never edit anything in the parent `cinema_project/` root — that is the separate RightsRadar repo.

## Run each part (details in GETTING_STARTED.md)
- Validator: `cd validator && python -m fabled_validator check <asset> --profile profiles/<p>.json --out reports/` (or `--manifest <out>/manifest.json`). Tests: `python -m pytest -q tests`.
- Pipeline: `cd pipeline && python3 fabled_pipeline.py --input <mesh> --out <dir> --config config/default.json [--validator-profile ...] [--freeze]`. Needs Blender 4.5 (`--blender` or `$FABLED_BLENDER`).
- UI: `cd ui && npm install && npm start` (http://127.0.0.1:5178/) or `npm run start:stub`.
- Unreal: `unreal/import_fabled_asset.py --manifest <manifest.json>` inside UE — never run yet.

## Conventions
- Anything stubbed, previewed, mocked or synthetic is labeled **CONCEPT MOCKUP** (UI badge, `concept_mockup:true` in JSON, filenames `*.CONCEPT_MOCKUP.json`, `synthetic_*` fixtures). Placeholder profiles say **DEMO PLACEHOLDER VALUES**.
- Show only real, measured outputs. No invented metrics, and no "time saved" claims. Runtimes are wall-clock on one machine only. If you didn't measure it, say `not_checked`/unknown.
- Paths in `manifest.json` are relative to the manifest's folder.
- Before any Blender job, run `ps aux | grep -i [b]lender`. Only one heavy Blender job at a time on a shared machine (it's memory-bound; the driver has a RSS watchdog).
- Keep the validator test suite passing. Don't change check ids/order or the report schema unless the change is additive.

## Rules (non-negotiable)
1. All coding goes through Cursor cloud agents and pull requests. No direct commits to main.
2. No deploying, publishing, merging, or public pushes without Patrick's explicit OK. (The static Vercel demo build is prepped but **not deployed**. Keep it that way until he says so.)
3. No secrets in git. Use env vars only, with test-mode or placeholder keys.
4. Don't touch the `cinema_project` root (RightsRadar).
