# Fabled demo UI (local prototype)

The local web app for the Fabled demo (storyboard shots 3, 4, 5 and 6): drop a sculpt in, set the studio import
profile, compare the high-poly and retopo meshes side by side with synced cameras, wireframe and a LOD switcher,
then run the pre-import check.

Plain HTML/ES modules plus three.js 0.169 (served from `node_modules`, no CDN, no build step), and a
dependency-free Node server. Binds to localhost by default (LAN mode for the iPad app is opt-in, see below). Nothing is deployed or published.

## Run
```bash
cd /workspace/fabled-demos/prototype/ui
npm install            # once: three + playwright-core (playwright is only for the screenshot test)
npm start              # http://127.0.0.1:5178/  uses pipeline/validator CLIs if found, else stubs
npm run start:stub     # same, but forces the CONCEPT MOCKUP stubs (fast demo while the pipeline isn't finished)
```
Open http://127.0.0.1:5178/ and either drop a file on the drop zone or click **Load sample sculpt**.
Use `PORT=5180 npm start` for another port.

### Who can talk to the server
The server has no login, so it only answers its own page and native clients (details and the full rules:
`INTERFACES.md` §11).
- **Default (`HOST=127.0.0.1`)**: open it as `http://127.0.0.1:5178` or `http://localhost:5178`. Any other `Host`
  name is a 403 (DNS-rebinding defence).
- **LAN mode for the iPad app (`HOST=0.0.0.0 npm start`)**: also reachable by any of this machine's own addresses, e.g.
  `http://192.168.1.20:5178`. To use a name instead, list it: `FABLED_ALLOWED_HOSTS=my-mac.local HOST=0.0.0.0 npm start`.
  There is still no authentication, so every device on that network can upload, run the pipeline and start generations
  with your provider keys. Trusted networks only.
- **Other websites are refused**: a request to `/api/*` whose `Origin` is not this server gets a 403, and no CORS
  headers are ever sent.
- **JSON endpoints need `Content-Type: application/json`** (415 otherwise). With curl:
  `curl -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:5178/api/jobs/<id>/validate`.
  Uploads take raw bytes with any type: `curl --data-binary @mesh.glb 'http://127.0.0.1:5178/api/jobs?filename=mesh.glb'`.

| Env var | Default | What |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `5178` | bind address and port |
| `FABLED_ALLOWED_HOSTS` | none | extra `Host` names to accept, comma-separated |
| `FABLED_UPLOAD_MAX_BYTES` | `1073741824` (1 GiB) | largest accepted upload; larger is a 413 |
| `FABLED_PIPELINE`, `FABLED_VALIDATOR`, `FABLED_PIPELINE_CMD`, `FABLED_VALIDATOR_CMD`, `FABLED_CLI_TIMEOUT_MS`, `FABLED_BLENDER`, `FABLED_ENGINE`, `PYTHON` | | pipeline / validator discovery and overrides (`INTERFACES.md` §2, §3) |
| provider keys and overrides | | `PROVIDERS.md` |

> While `prototype/pipeline/` is still being built, `npm start` will find `fabled_pipeline.py` and actually
> launch Blender when you click **Build retopo + LODs**. A full run can take minutes. If it fails, the UI shows
> the error and offers an explicitly labeled browser preview instead. Use `npm run start:stub` to skip the pipeline.

## Demo flow (matches the storyboard)
0. **Open latest pipeline output** shows the real pipeline run on the sample asset (historical bust scan, CC0, Smithsonian NPG.75.16; credit and no-endorsement line shown on screen): LOD0..3, previews, maps, and the real validator report against `profiles/demo_placeholder_prop.json` (labeled DEMO PLACEHOLDER VALUES).
1. **Load sample sculpt.** The left viewer shows the 327,680-triangle procedural head. The count is computed from the file.
2. **Pre-import check** runs on load and flags two real, deliberately seeded issues:
   - *scale.height_range*: the head reads as about 34 m tall, because the glTF is in metres but the sculpt was authored in cm. Click **Set profile scale to 0.01**.
   - *normals.consistent_winding*: 2,003 triangles have reversed winding, highlighted red in the viewer. Click **Preview unified winding** (browser preview only; the check stays flagged because the file on disk is unchanged).
3. **Build retopo + LODs**, then switch LOD0..LOD3 and toggle **Wireframe**. Orbiting either view moves both.
4. **Re-check**: the scale check goes green. The winding check stays flagged as preview-only, and the real validator reports on the uploaded file.

## What is real vs stubbed (as of 2026-10-25 22:35 PT)
| Piece | Status |
|---|---|
| Loading .obj/.fbx/.glb/.gltf/.ply/.stl in the browser | **Real**. Tested: GLB, OBJ, PLY, and the pipeline's GLB LODs. The FBX loader is the fallback when a LOD has no GLB |
| Tri/vertex counts, bounds, browser checks | **Real**, computed from loaded geometry (`checks.js`, `meshops.js`) |
| **Open latest pipeline output** (read-only) | **Real**: loads `pipeline/output/manifest.json`, the LOD GLBs, previews, textures and source credit, then runs the real validator with `--manifest` |
| Validator | **Real** `fabled_validator` (auto-discovered, exit 0/1/2 parsed). Saved reports in `validator/reports/` can be rendered too. The stub is used only with `FABLED_VALIDATOR=off` |
| Build retopo + LODs from an upload | `npm start` runs the **real pipeline** (async, live step bar from `progress.json`; manifest read even on failure). Tested only against `test_fixtures/mock_pipeline_cli.py` (TEST FIXTURE), not a real Blender run from the UI. With `FABLED_PIPELINE=off`: browser decimation preview, labeled CONCEPT MOCKUP |
| "Preview unified winding" | **Browser preview only.** The check stays flagged and the validator still checks the file on disk |
| Skeleton control | Shown, labeled "not used by the pipeline yet" (static mesh only) |
| Workspace tree, asset pages, notes, activity | **Real** (2026-11-06): built from manifests, validator reports, upload jobs and samples on disk (`GET /api/workspace`). Notes and activity persist in `work/` |
| AI providers (Meshy, Tripo, Higgsfield, Runway) | **Adapters written, not run against the live APIs** (no keys; vendor docs unreachable from the authoring session). Off until a key is set. The offline mock provider is labeled CONCEPT MOCKUP. See `PROVIDERS.md` |

A **CONCEPT MOCKUP** badge in the header is visible whenever any stub, preview or test fixture is on screen.

Connected workspace + provider plugin tests (no keys or network): `npm run test:connected` (also part of `npm test`).
Its last suite is the server hardening tests (cross-site guard, Content-Type rule, security headers, path traversal,
limits, LAN mode), which also run alone: `node tools/test_server_security.mjs`. That suite starts one server on
`0.0.0.0` (an ephemeral port) for a few seconds to test LAN mode.

Extra tests: `node tools/test_mock_pipeline.mjs` (progress bar + failed run, with the mock CLI server on :5179; see the file header) and `node tools/shot_saved_report.mjs [report-rel] [png]`.

## Sample sculpt
`samples/fabled_sample_head.glb` (327,680 tris) and `samples/fabled_sample_head.obj` (81,920 tris), generated
procedurally by `tools/make_sample_sculpt.py` (self-made, no third-party assets, free to use in the demo).
Counts are in `samples/SAMPLE_INFO.json`.

The offline mock AI provider returns one of `samples/mock_generations/{knight_helmet,mushroom_cottage,potion_flask}.glb`
(85k to 225k tris, ~0.18 to 0.43 m, Y up). They are modeled procedurally by `tools/make_mock_generations.py`: signed distance fields meshed with
surface nets, numpy only, self-made, no license restrictions. They are dense, closed, manifold triangle meshes with smooth normals and **no seeded
defects**: the browser checks and the validator flag only "needs retopology", "no UVs" and "no textures", which is what the pipeline is
for. Counts are in `samples/mock_generations/MOCK_INFO.json`. Regenerate with `python3 tools/make_mock_generations.py` (~35 s). Seeded issues: cm/m units mismatch, plus one patch of flipped triangles.
For the real demo the storyboard calls for a licensed or self-made character sculpt. The pipeline bot is using a
Smithsonian bust; check its license notes before showing it.

## Verify (headless)
```bash
npm start &            # or start:stub
npm run test:screens   # loads page, drops the sample, builds LODs, applies fixes, re-checks; fails on any console error
```
Screenshots go to `screenshots/`, with the log and console output in `screenshots/run_log.json`.

## Files
- `server.mjs`: local server and API. Shells out to the pipeline/validator, or serves the stubs. Also the cross-site request guard, body limits and security headers (`INTERFACES.md` §11)
- `public/index.html`, `styles.css`: UI (cream and brown deck palette, Playfair Display + Inter, SIL OFL fonts in `public/fonts/`)
- `public/app.js`: wiring. `loaders.js`: three.js loaders. `meshops.js`: weld, topology, decimation, texel density. `checks.js`: browser checks. `viewer.js`: synced side-by-side viewers
- `stub/*.CONCEPT_MOCKUP.json`: stub manifest and report (tri counts are null on purpose)
- `INTERFACES.md`: manifest/report schemas, CLI invocation, open questions
- `workspace.mjs` (server) + `public/workspace.js`, `public/workspace-model.js`: connected workspace (tree, Connections, asset page, notes, activity, Generate dialog). `public/licensed.js`: licensed-sample rules shared by browser and server
- `providers/`: AI provider plugins (`index.mjs` registry + task store, one file per provider). `PROVIDERS.md`: what is verified, how to enable one, how to add one
- `tools/make_sample_sculpt.py`, `tools/screenshot_test.mjs`
- `work/`: per-job uploads and CLI outputs (gitignored)
- `../unreal/import_fabled_asset.py`, `../unreal/CAPTURE_NOTES.md`: Unreal import script and shot-7 capture notes (**untested**)

## Static demo build (Vercel-ready, prep only: nothing deployed)
A backend-free build that shows one **pre-processed real run** (frozen pipeline run + its recorded validator report). It has no Blender, no validator and no `/api` calls in the browser.

```bash
cd prototype/ui
R=../pipeline/runs/20261025-224413        # the frozen run announced by the Pipeline SWE (use the timestamped folder)
npm run build:demo                         # = node tools/build_demo.mjs --src $R
#   validator report: read fresh at build time from validator/reports/frozen_<run>/*.report.json (the Validator SWE's
#   independent report, demo_placeholder_prop profile); override with --report/--profile. Bundled file + timestamp go to dist/demo-data/README.md and demo.json.
npm run check:demo                         # same check Vercel's buildCommand runs
python3 -m http.server 5190 --bind 127.0.0.1 -d dist     # or: npx serve dist -l 5190
node tools/demo_test.mjs http://127.0.0.1:5190/          # headless check + screenshots/demo_*.png
```
- What it bundles: `dist/` = `public/`, the three.js modules it imports (traced) and `demo-data/` (manifest.json, LOD GLBs, textures, previews, SOURCE.json, validator_report.json, validator_profile.json, demo.json, BUILD_INFO.json). Run files are copied unchanged. In the report and profile copies, box-local absolute paths are replaced with `<frozen-run>`, `<validator>` and `<prototype>`.
- What the build refuses: samples, test fixtures, stub/CONCEPT_MOCKUP files, the mock CLI, `.blend` files, a manifest or report marked concept_mockup/test_fixture, a manifest whose status isn't ok, or a report made for a different run.
- Demo mode turns on via `<meta name="fabled-demo">` (added to dist/index.html) or `?demo=1` (the local server also serves `/demo-data/` from dist/). It hides upload, Build, saved reports and the editable profile. The header reads "Pre-processed real run, recorded <manifest created_at, PT>".
- `vercel.json` (ui/): static output `dist/`, no functions, `buildCommand` only runs the dist check. The host cannot build the data, so run `build:demo` locally first. `dist/vercel.json` lets `dist/` be deployed alone as plain static files. `dist/` is in .gitignore (~15 MB).
- Size (2026-10-25 23:06 PT build): 15.0 MB, 46 files (was 54.8 MB). Largest: display normal map WebP 3.6 MB, three.module.js 1.2 MB, previews/normal_map_texture_1024.png 1.2 MB, Inter.ttf 0.8 MB, preview wireframes 0.7-0.8 MB, LOD0.glb 0.6 MB, ORM WebP 0.6 MB.
- Downsizing (derived copies only; the run folder is never modified, intermediates are cached in `.build-cache/`):
  - GLBs: `tools/strip_glb.mjs` removes embedded images/textures/samplers and compacts the buffer; geometry, UVs and tangents are byte-identical. LOD0-3: 672,660 / 390,220 / 217,324 / 102,168 bytes (LOD0 was 7,626,328).
  - Maps: `tools/derive_textures.py` extracts the map embedded in the GLB (OpenGL convention) and saves WebP lossless (method 6), verified bit-exact. Normal 3.73 MB (embedded PNG 5.40 MB; the export PNG is the DirectX version, 16.75 MB, not bundled). ORM 0.66 MB. Lossy WebP was measured and rejected: q90-q100 are 0.50-1.25 MB, but max channel error is 106-110 and p99 normal-angle error is about 10 deg.
  - The viewer applies the WebP maps as external textures (flipY false, no colour space, repeat; normalScale (1,1) because the GLB has tangents). This is the "Baked maps" toggle.
  - Visual check: `node tools/render_compare.mjs <run dir>` (needs the :5190 static server) then `python3 tools/compare_frames.py`. Output goes to `screenshots/demo_downsize_compare_LOD0.png`, the `demo_downsize_LOD0_*.png` frames and `demo_downsize_metrics.json`.
- The bust is a licensed sample: the verbatim credit line, the no-endorsement line and the neutral display name are applied wherever it appears (`LICENSED_SAMPLES` in public/app.js).
