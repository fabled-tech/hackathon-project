# GETTING_STARTED.md

All paths relative to `fabled/`. Versions come from the code/READMEs; nothing here has been run on Patrick's Mac yet.

## Dependencies
| Part | Needs |
|---|---|
| Validator | Python 3 (tested here on 3.13.5); runtime `numpy>=1.24`; dev `pytest>=7`, `jsonschema>=4`, optional `assimp_py>=1.0` |
| Pipeline | Python 3 driver + **Blender 4.5.15 LTS** (the frozen runs used it; the driver default path is the Linux tarball `~/blender/blender-4.5.15-linux-x64/blender`, so on Mac pass `--blender` or set `SCULPTLINE_BLENDER`). Blender-side: bpy, numpy, Pillow, vendored `fast_simplification` 0.2.0. **The vendored `.so` is linux x86_64 / CPython 3.11**, so on macOS arm64 it won't load. You need a Mac build matching Blender's bundled Python (untested). |
| UI | Node (version not pinned), `three ^0.169.0`, `playwright-core ^1.64.1` (screenshot tests only) |
| Unreal | UE 5.3–5.5 with Python Editor Script Plugin (untested) |

## Validator
```bash
cd validator
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests            # 95 passed (2026-11-03, Linux box, Python 3.13.5)
.venv/bin/python fixtures/make_fixtures.py     # regenerate synthetic fixtures
.venv/bin/python -m sculptline_validator check fixtures/synthetic_storyboard_two_flags.gltf --profile profiles/example_studio.json --out reports/
.venv/bin/python -m sculptline_validator check --manifest fixtures/synthetic_pipeline_out/manifest.json --profile profiles/demo_placeholder.json --out reports/
.venv/bin/python -m sculptline_validator schema
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
python3 sculptline_pipeline.py --help
python3 sculptline_pipeline.py --input input/raw/HK_NPG_75_16-full_resolution-obj.obj \
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
```
Without `pipeline/runs/`, "Open latest/frozen pipeline output" and `npm run build:demo` have nothing to load. Produce a run first.
Static demo (local only; **do not deploy**): `npm run build:demo && npm run check:demo && npm run serve:demo` → http://127.0.0.1:5190/.

## Unreal (untested)
In UE: `py "<path>/unreal/import_sculptline_asset.py" --manifest "<out>/manifest.json" --dest /Game/SculptLine/Demo`. Check every API call against your engine version.
