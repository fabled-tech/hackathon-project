# ARCHITECTURE.md

```
high-poly sculpt (.obj/.ply/.stl/.fbx/.glb/.gltf)
  └─ pipeline (fabled_pipeline.py → headless Blender 4.5, one process per step)
       └─ <out>/manifest.json  (fabled.pipeline.manifest/0.1) + export/ + previews/ + report.json
            └─ validator (python -m fabled_validator check --manifest …)  → report JSON/HTML (schema_version 0.2.0)
                 └─ Unreal import (unreal/import_fabled_asset.py — untested)
UI (server.mjs) orchestrates upload → pipeline → validator over /api/*, and renders manifest + report.
```

## Pipeline steps (`pipeline/scripts/`)
1 `01_import` units/axis → Z-up, pivot bottom-centre, measure. 2 `02_retopo` quadric proxy (vendored fast-simplification) → QuadriFlow → fallbacks voxel+QuadriFlow, voxel+decimate. 3 `03_uv` Smart UV Project + pack, triangulate. 4 `04_lods` collapse-decimate to `config.lods[]` budgets (hard maxima). 5 `05_bake` Cycles CPU: 2048² DirectX normal, AO→ORM.R (G=0.6, B=0.0 constants). 6 `06_export` binary FBX 7400 in cm (UnitScaleFactor 1.0), combined file with patched **LodGroup**, per-LOD FBX + GLB; re-import verify. 7 `07_previews` + `post_previews.py` composites. The driver writes `<out>/progress.json` `{step,total,name,label,done,status,updated_at}` each step and a memory watchdog (`limits.max_rss_mb`, `limits.min_mem_available_mb`).
Exit 0 = `status:"ok"`; exit 1 = manifest still written with `status:"failed"`, `error`.

## Output folder & file naming
```
<out>/manifest.json  report.json  progress.json  config_used.json  validator_profile.json  SOURCE.json
<out>/export/SM_<Asset>.fbx (LodGroup)  SM_<Asset>_LOD<n>.fbx|.glb  T_<Asset>_N.png  T_<Asset>_ORM.png  [T_<Asset>_BC.png]  gltf/T_<Asset>_N.png (OpenGL green)
<out>/previews/  logs/  work/ (.blend intermediates; not copied by --freeze)
```
`--freeze` copies to `runs/<YYYYmmdd-HHMMSS>/` and repoints `runs/latest`.

## Manifest (key fields; full list in pipeline/README.md and ui/INTERFACES.md §2)
`schema`, `concept_mockup`, `job_id`, `created_at`, `asset`, `status` ok|failed, `error`, `path_rule`, `up_axis` (source), `export_up_axis`, `units{unit_scale_factor,unreal_units,source_units_to_m}`, `combined_fbx`, `combined_fbx_has_lodgroup`, `lods[{level,path,triangles,budget_triangles}]`, `profile`, `textures[{material,base_color,normal,orm}]`, `source{name,url,license,attribution,…}`, `tool{name,version,blender_version}`, `input{…}`, `outputs{lods[…,triangles,budget_triangles,within_tolerance,glb,…],combined_fbx,textures{base_color,normal,orm},previews[]}`, `steps[{name,status: automated|manual|failed|not_implemented,runtime_s,peak_rss_mb}]`, `warnings[]`, `manual_steps[]`. **All paths relative to the manifest's folder**; `*_abs` fields are informational.

## Validator
Readers: OBJ/MTL, glTF/GLB, binary FBX 7.1–7.7 (pure Python + numpy; no ASCII FBX/USD/.blend → exit 2). 15 core checks in fixed order: `scale, up_axis, normals, non_manifold, degenerate_triangles, triangle_budget, skeleton_binding, bone_naming, texture_files, texture_slots, texture_naming, texture_size, material_count, uv_layout, texel_density`; with `--manifest`, a 16th `manifest` check (cross-checks per-LOD triangle counts, files, texture names, steps, warnings). Statuses: pass/warn/fail/not_checked.
Report (`schema/report.schema.json`, `schema_version` 0.2.0): asset (path, sha256, size), profile (name, path, sha256), `generated_at`, `checks[{id,title,status,message,measured,expected,items}]`, `summary{pass,warn,fail,not_checked,total,flagged}`, `overall_status` (incl. `error` with `error{type,message}`), `complete`, `manifest` (null without `--manifest`). Files: `<name_with_dots_as_>.report.json|.html`. Exit 0 clean / 1 any warn|fail / 2 error.
Profiles (`validator/profiles/`, all example/placeholder values): `example_studio`, `demo_placeholder` (char, Y-up 150–220 cm), `demo_placeholder_prop` (Z-up 20–80 cm, 20k/10k/5k/2k), `demo_placeholder_mochi_character` (Y-up 20–40 cm). Pipeline-side copies in `pipeline/config/validator_profile_{bust,mochi}.json` (Mochi: Z-up 20–45 cm).

## UI ↔ data
`server.mjs` (port `PORT`, default 5178; host `HOST`) shells out to pipeline/validator if found, else serves `stub/*.CONCEPT_MOCKUP.json`. Env: `FABLED_PIPELINE=off`, `FABLED_VALIDATOR=off`, `FABLED_PIPELINE_CMD`, `FABLED_VALIDATOR_CMD`, `FABLED_PIPELINE_MANIFEST`, `FABLED_CLI_TIMEOUT_MS`, `FABLED_USE_DEMO_PROP_PROFILE`, `PYTHON`.
API (ui/INTERFACES.md §4): `GET /api/status`; `POST /api/jobs?filename=` (raw bytes); `POST /api/jobs/<id>/process` (UI profile `fabled.import_profile/0.1`); `GET …/progress` (reads progress.json); `GET …/result`; `POST …/validate`; `GET …/files/<rel>`; `POST /api/open-output?dir=` (read-only: `pipeline/output`, `pipeline/runs`, `ui/test_fixtures/*`); `GET /api/saved-reports`, `/api/saved-report?path=`. Jobs live in `ui/work/<job>/`. Browser loads LOD GLBs (FBX fallback) via three.js and keys report rows on check `id`.
Static demo: `npm run build:demo` bundles the frozen run + its validator report into `dist/` (refuses stubs/fixtures/non-ok manifests); demo mode via `<meta name="fabled-demo">` or `?demo=1`. `vercel.json` is prepped; **not deployed**.

## Unreal
`import_fabled_asset.py` reads the manifest, imports the combined FBX via `AssetImportTask` + `FbxImportUI` (scale 1.0, since 1 unit = 1 cm), falls back to per-LOD files, logs per-LOD tri counts. Targets UE 5.3–5.5. Never executed.
