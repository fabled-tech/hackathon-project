# GETTING_STARTED.md

All paths relative to `fabled/`. Versions come from the code/READMEs; nothing here has been run on Patrick's Mac yet.

## Dependencies
| Part | Needs |
|---|---|
| Validator | Python 3 (tested here on 3.13.5); runtime `numpy>=1.24`; dev `pytest>=7`, `jsonschema>=4`, optional `assimp_py>=1.0` |
| Pipeline | Python 3 driver + **Blender 4.5.15 LTS** (the frozen runs used it; the driver default path is the Linux tarball `~/blender/blender-4.5.15-linux-x64/blender`, so on Mac pass `--blender` or set `FABLED_BLENDER`). Blender-side: bpy, numpy, Pillow, vendored `fast_simplification` 0.2.0. **The vendored `.so` is linux x86_64 / CPython 3.11**, so on macOS arm64 it won't load. You need a Mac build matching Blender's bundled Python (untested). |
| UI | Node ≥ 18 (stated in the `ui/server.mjs` header; the provider adapters use global `fetch`; `ui/package.json` has no `engines` field), `three ^0.169.0`, `playwright-core ^1.64.1` (screenshot tests only) |
| Unreal | UE 5.3–5.5 with Python Editor Script Plugin (untested) |

## Validator
```bash
cd validator
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests            # 95 passed (2026-11-03, Linux box, Python 3.13.5)
.venv/bin/python fixtures/make_fixtures.py     # regenerate synthetic fixtures
.venv/bin/python -m fabled_validator check fixtures/synthetic_storyboard_two_flags.gltf --profile profiles/example_studio.json --out reports/
.venv/bin/python -m fabled_validator check --manifest fixtures/synthetic_pipeline_out/manifest.json --profile profiles/demo_placeholder.json --out reports/
.venv/bin/python -m fabled_validator schema
.venv/bin/python run_fixtures.py               # all fixtures → reports/ + SUMMARY.md
```

## Sample input
No large meshes ship in the kit (`pipeline/input/` is excluded).
- **Small, self-made:** `ui/samples/fabled_sample_head.{glb,obj}` (procedural, seeded scale and winding issues; `npm run sample` regenerates them). Fine for the UI and validator. It is not real high-poly input.
- **Real CC0 sculpt (the frozen run):** *Helen Adams Keller* by Onorio Ruotolo, NPG.75.16. Source: [Smithsonian 3D](https://3d.si.edu/object/3d/helen-adams-keller:d8c64ccc-4ebc-11ea-b77f-2e728ce88125), record [npg.si.edu](https://npg.si.edu/object/npg_NPG.75.16) (both pages showed CC0 on 2026-10-25). Download the full-resolution OBJ zip (~194 MB → 749 MB OBJ, no colour/UVs). Unzip to `pipeline/input/raw/HK_NPG_75_16-full_resolution-obj.obj`. `config/default.json` assumes inches (`source_units_to_m = 0.0254`), which is an inference a human still needs to confirm. The original `pipeline/input/SOURCE.json` (license and unit notes) is included.
- Inputs accepted: `.obj .ply .stl .fbx .glb .gltf`.

## Pipeline (heavy: check `ps aux | grep -i [b]lender` first; one job at a time)
```bash
cd pipeline
python3 fabled_pipeline.py --help
python3 fabled_pipeline.py --input input/raw/HK_NPG_75_16-full_resolution-obj.obj \
  --out output --config config/default.json --asset-name HelenKellerBust \
  --validator-profile config/validator_profile_bust.json --freeze --blender /path/to/Blender
# dev subset: --steps 05,06
```
On the 8 vCPU / 15 GB Linux box the run took about 3.5 min wall-clock, with 5.5 GB peak RSS. Mac timing is unknown.

## UI
```bash
cd ui
npm install
npm start               # http://127.0.0.1:5178/ (PORT=5180 to change); real CLIs if found, else stubs
npm run start:stub      # force CONCEPT MOCKUP stubs, no Blender
npm run test:screens    # headless check (server must be running)
npm test                # static + API tests, provider adapters (fake fetch), server hardening tests
```
The server answers only its own page and native clients; other websites get a 403 from `/api/*` (rules: `ui/INTERFACES.md` §11).

| Env var | Default | What |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Open the UI as `http://127.0.0.1:5178` or `http://localhost:5178`; any other `Host` name is a 403 |
| `HOST=0.0.0.0` | off | **LAN mode** for the iPad app (`FabledStudio/README.md`): the server also answers on this machine's own addresses, e.g. `http://192.168.1.20:5178`. No authentication: every device on that network can upload, run the pipeline and start provider generations. Trusted networks only |
| `FABLED_ALLOWED_HOSTS` | none | Extra `Host` names to accept, comma-separated. Needed to reach the server by name, e.g. `FABLED_ALLOWED_HOSTS=my-mac.local HOST=0.0.0.0 npm start` |
| `FABLED_UPLOAD_MAX_BYTES` | `1073741824` | Largest accepted upload (413 above it) |
| `HIGGSFIELD_MAX_DATA_URI_BYTES` | `8388608` | Largest image the Higgsfield adapter will send inline as a data URI (`ui/PROVIDERS.md`, "Higgsfield image input") |

JSON API calls need `Content-Type: application/json` (415 otherwise); uploads take raw bytes:
```bash
curl --data-binary @mesh.glb 'http://127.0.0.1:5178/api/jobs?filename=mesh.glb'
curl -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:5178/api/jobs/<job_id>/validate
```
Without `pipeline/runs/`, "Open latest/frozen pipeline output" and `npm run build:demo` have nothing to load. Produce a run first.
Static demo (local only; **do not deploy**): `npm run build:demo && npm run check:demo && npm run serve:demo` → http://127.0.0.1:5190/.

## Unreal (untested)
In UE: `py "<path>/unreal/import_fabled_asset.py" --manifest "<out>/manifest.json" --dest /Game/Fabled/Demo`. Check every API call against your engine version.

## macOS setup (what a Mac needs per part)
Read from the repo's files on 2026-11-09. **None of it has been run on a Mac yet**; treat it as a checklist to confirm, not a tested recipe.

| Part | Needs on the Mac | Where that comes from |
|---|---|---|
| `ui/` (Fabled Studio web app + server) | Node ≥ 18. Run `npm install` once in `ui/`: it fetches `three` (served to the browser from `node_modules`) and `playwright-core` (screenshot tests only). The server itself has no runtime npm dependency | `ui/server.mjs` header, `ui/package.json` |
| `demos/` (Fabled Shots, Fabled Forge) | Node ≥ 18. No `npm install`: the package has no dependencies | `demos/package.json` (`engines.node >=18`, no `dependencies`) |
| `validator/` | Python 3 with `numpy>=1.24`. Create the venv with `python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt` (adds `pytest`, `jsonschema`, optional `assimp_py`). The UI server uses `validator/.venv/bin/python` when it exists, otherwise `python3` (override with `PYTHON`) | `validator/requirements.txt`, `requirements-dev.txt`, `ui/server.mjs` |
| `pipeline/`, **Native engine** | Python 3 with `numpy` in the interpreter that runs `fabled_pipeline.py` (the UI server starts it with `python3`, or `$PYTHON`, not with the validator venv). It imports the validator package from `../validator`, so keep both folders. This is the engine to use on a Mac for now: pick **Native** in the UI, or pass `--blender none` | `pipeline/fabled_pipeline.py`, `pipeline/native_pipeline.py` |
| `pipeline/`, **Blender engine** | Blender 4.5 LTS (the frozen runs used 4.5.15 on Linux). The UI server looks for `$FABLED_BLENDER`, then `blender` on `PATH`, `/opt/homebrew/bin/blender`, `/usr/local/bin/blender`, `/Applications/Blender.app/Contents/MacOS/Blender`. **Not expected to work on macOS yet:** the vendored `fast_simplification` is a Linux x86_64 / CPython 3.11 binary (`pipeline/vendor/fast_simplification/*.cpython-311-x86_64-linux-gnu.so`) and will not load in a Mac Blender until it is rebuilt for that Blender's Python | `pipeline/README.md`, `pipeline/scripts/common.py`, `ui/server.mjs` (`findBlender`) |
| `FabledStudio/` (native Mac / iPad app) | Xcode 15 or newer on macOS 14 or newer; the iPad build targets iOS 17. Open `FabledStudio.xcodeproj`, or use `swift build` / `swift test`. The connected workspace needs the `ui/` server running (on an iPad: LAN mode above) | `FabledStudio/Package.swift` (`swift-tools-version: 5.9`, `.macOS(.v14)`, `.iOS(.v17)`), `project.pbxproj` (deployment targets 14.0 / 17.0) |
| `unreal/`, `demos/unreal/` | Unreal Engine with the Python Editor Script Plugin (`unreal/import_fabled_asset.py` says it targets UE 5.3 to 5.5). **Untested drafts**: none of these scripts has run inside the editor | `unreal/import_fabled_asset.py`, `demos/unreal/*.py` headers |

Blender version note: this file and `pipeline/README.md` say 4.5.15 LTS, which is what the recorded runs used. `PROJECT.md` at the repo root mentions "Blender 5.2.3 LTS"; nothing under `fabled/` uses or was tested with that version, so the two statements have not been reconciled.
