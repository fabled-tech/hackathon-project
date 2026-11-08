# SculptLine UI: interfaces to the pipeline and validator

Status: **v0.2. Contracts resolved with the pipeline and validator owners on 2026-10-25 (PT).** Anything still
open is in §6. Where a contract below is owned by another component, that component's code wins, and this file
records how the UI reads it.

```
browser (public/*.js, three.js)
   │  fetch /api/*
   ▼
server.mjs  (Node ≥18, no deps, binds 127.0.0.1:5178)
   ├─ pipeline:  python3 pipeline/sculptline_pipeline.py …   → <out>/progress.json (live), <out>/manifest.json (end, also on failure)
   └─ validator: validator/.venv/bin/python -m sculptline_validator check … --json-only → report JSON on stdout
   No CLI found / SCULPTLINE_*=off → stub/*.CONCEPT_MOCKUP.json (labeled in the UI)
```

Names after the SculptLine rebrand: the server prefers `pipeline/sculptline_pipeline.py` and `-m sculptline_validator`, and
falls back to `pipeline/fabled_pipeline.py` / `-m fabled_validator` when only those exist. Every setting below is read as
`SCULPTLINE_<NAME>` first, then the legacy `FABLED_<NAME>` (helper: `env.mjs`). Wire-format ids such as
`fabled.import_profile/0.1`, `fabled.pipeline.manifest/0.1`, `fabled.workspace/0.1` and the pipeline config key
`fabled_profile` are unchanged on purpose: they are versioned formats already present in committed manifests and reports.

Each upload job lives in `prototype/ui/work/<job_id>/`: the uploaded sculpt, `profile.json` (UI profile),
`pipeline_config.json`, `validator_profile.json` / `validator_profile_export.json`, `validator_report.json`, and `out/`
(passed to the pipeline as `--out`). Jobs opened read-only over an existing output folder keep only the profile and
report files in `work/<job_id>/`. Nothing is ever written into the opened folder.

---

## 1. UI import profile (`fabled.import_profile/0.1`)

```jsonc
{
  "schema": "fabled.import_profile/0.1",
  "name": "Studio default (example)",
  "units": "m",                    // m | cm | mm : what one unit of the *source sculpt* means
  "scale": 0.01,                   // extra uniform multiplier on the source sculpt
  "up_axis": "Y",                  // Y | Z : up axis of the *source sculpt*
  "asset_class": { "id": "bust", "label": "Bust / head prop", "height_cm": [20, 80] },
  "skeleton": { "type": "none" | "asset" | "custom", "asset_path": "…" },   // shown, but NOT used by the pipeline yet (static mesh only)
  "texel_density": { "px_per_m": 1024, "texture_size": 2048 },
  "lod_budget": [ { "level": 0, "max_triangles": 30000, "screen_size": 1.0 } ]   // variable count
}
```
Profile values are user inputs (the defaults are examples), not measurements.

### 1a. To the pipeline config (resolved)
`server.mjs` loads `pipeline/config/default.json`, overrides these keys, and writes `work/<job>/pipeline_config.json`:

| pipeline key | from |
|---|---|
| `asset_name` | stem of the uploaded file name (non `[A-Za-z0-9_]` → `_`). Export names become `SM_<asset>…` |
| `source_units_to_m` | `{m:1, cm:0.01, mm:0.001}[units] × scale` (the pipeline bakes this in) |
| `expected_height_cm_range` | `asset_class.height_cm` |
| `lods` | `lod_budget → [{ "name": "LOD<i>", "target_tris", "screen_size" }]`, variable count |
| `bake.resolution` | `texel_density.texture_size` |
| `fabled_profile` | full UI profile. The pipeline honors `up_axis`; skeleton is unused (static mesh only) |

### 1b. To the validator profile (resolved; `validator/sculptline_validator/profile.py`)
There are two modes, because the pipeline output already has units and scale baked in and is exported Z-up:

| validator key | raw upload (`validator_profile.json`) | pipeline output (`validator_profile_export.json`) |
|---|---|---|
| `units.assumed_source_units` | UI `units` | manifest `units.unreal_units` (default `cm`) |
| `units.import_scale` | UI `scale` (> 0, default 1.0) | **1.0** (never re-applied) |
| `axes.up` | UI `up_axis` | manifest `export_up_axis` (default **Z**). NOT the manifest `up_axis`, which is the source axis |
| `units.expected_height_cm` | `asset_class.height_cm` | same |
| `lods.triangle_budgets` | `lod_budget[*].max_triangles` | same |
| `texel_density.target_px_per_cm` | `px_per_m / 100` (confirmed) | same |
| `skeleton.required` | `skeleton.type != "none"` | same |
| `profile_name`, `asset_type`, `normals.max_flipped_faces: 0` | | |

- When starting a pipeline run, the export-mode profile is passed as `--validator-profile` (the pipeline copies it into `<out>/validator_profile.json`).
- When an existing output folder is **opened** (the bust), the server validates with `validator/profiles/demo_placeholder_prop.json` if that file exists. Disable with `SCULPTLINE_USE_DEMO_PROP_PROFILE=off`. The UI shows its **DEMO PLACEHOLDER VALUES** label next to the profile name.

---

## 2. Pipeline CLI and manifest (resolved; locked shape)

```
python3 prototype/pipeline/sculptline_pipeline.py --input <sculpt> --out <job>/out --config <job>/pipeline_config.json \
        [--validator-profile <job>/validator_profile.json]      # added only if `--help` lists it
```
- cwd `prototype/pipeline/`. Blender comes from the pipeline's `SCULPTLINE_BLENDER` / `--blender` (the UI server resolves it with the same variable and passes `--blender`).
- Runs asynchronously. The UI polls `GET /api/jobs/<id>/progress` (reads `<out>/progress.json`) and then `GET /api/jobs/<id>/result`.
- **The manifest is read whenever it exists, including after a non-zero exit.** A failed run writes `status: "failed"`, the failed step's `status: "failed"`, the reason in `warnings`, and partial outputs. The UI shows the failure plus every LOD it can load.
- No manifest → the UI shows the exit code and log tail, and offers an explicitly labeled browser decimation preview.
- Overrides: `SCULPTLINE_PIPELINE_CMD` (shell template: `{input} {out} {config} {profile} {validator_profile}`), `SCULPTLINE_PIPELINE=off` (stub), `SCULPTLINE_CLI_TIMEOUT_MS` (default 60 min), `SCULPTLINE_PIPELINE_MANIFEST` (manifest file name), `SCULPTLINE_ENGINE` (default engine).

### progress.json (rewritten at each step start and end)
```json
{ "step": 5, "total": 8, "name": "texture_bake", "label": "Bake normal (+AO) maps, Cycles CPU", "done": false, "status": "running", "updated_at": "2026-10-25T22:28:26-07:00" }
```
`status`: running | ok | failed. The bar fills to `done ? step : step-1` out of `total` (or `done`/`total` if `done` is a number).

### manifest.json (`fabled.pipeline.manifest/0.1`)
**Path rule: every path is relative to the manifest's directory (= `<out>`). There is no other fallback.** The
server serves files only from inside that folder.

The pipeline writes the **top-level** fields and keeps **`outputs.*`** as duplicates. The UI reads top-level first,
falls back to `outputs.*`, merges `outputs.lods[i]` into `lods[i]` by `level` (that's where `glb`, `vertices` and `has_uvs` live), and ignores unknown fields.

```jsonc
{
  "schema": "fabled.pipeline.manifest/0.1",
  "concept_mockup": false,                       // true or "test_fixture": true → UI keeps the CONCEPT MOCKUP labels
  "asset": "HelenKellerBust",
  "status": "ok" | "failed" | …,
  "up_axis": "Y",                                // SOURCE sculpt axis (as configured)
  "export_up_axis": "Z",                         // delivered FBX axis (being added; validator axes.up uses this, default Z)
  "units": { "unreal_units": "cm", "source_units_to_m": 0.0254, "unit_scale_factor": 1.0 },
  "combined_fbx": "export/SM_<asset>.fbx",       // dup: outputs.combined_fbx
  "lods": [ { "level": 0, "path": "export/SM_<asset>_LOD0.fbx", "triangles": 20000, "budget_triangles": 20000 } ],
  "textures": [ { "material": "M_<asset>", "base_color": null, "normal": "export/T_<asset>_N.png", "orm": "export/T_<asset>_ORM.png" } ],
                                                 // dict form also accepted; null = "not produced yet" (neutral, not an error)
  "source": { "name": "…", "url": "…", "license": "CC0" },   // shown as credit (fallback: input.source_url / input.license)
  "profile": "validator_profile.json",           // validator profile the pipeline used
  "pipeline_config": "config_used.json",
  "input": { "sculpt_path": "…", "triangles": 8504655, "vertices": 4253276, "dims_cm": [..] },
  "steps": [ { "name": "retopology", "status": "automated" | "manual" | "not_implemented" | "failed" | "ok", "method": "…", "runtime_s": 12.3 } ],
  "warnings": [ "…" ],
  "outputs": {
    "lods": [ { "level": 0, "name": "LOD0", "path": "export/SM_<asset>_LOD0.fbx", "format": "fbx", "glb": "export/SM_<asset>_LOD0.glb",
                "triangles": 20000, "vertices": 10002, "budget_triangles": 20000, "screen_size": 1.0, "has_uvs": true } ],
    "combined_fbx": "…", "uv_layout_png": "…", "textures": { … },
    "previews": [ { "path": "previews/compare_shaded_highpoly_vs_lod0.png", "label": "…" } ]
  }
}
```
Per-LOD files are `SM_<asset>_LOD<n>.fbx` (plus `.glb` when available), and there's one combined `SM_<asset>.fbx`.

**How the UI uses it:**
- Viewer: for each LOD it loads `glb` first and falls back to `path` (FBX). It **counts triangles itself** and shows the manifest's `triangles` next to them ("manifest says …").
- Texel density is computed from the loaded LOD UVs.
- Steps with status `not_implemented` appear as info items in the check list. `manual` is shown neutral.
- Textures that are `null` show as "not produced yet".
- The previews appear as thumbnails. In opened-output mode, the high-poly preview fills the left viewer, because the input is not loaded in the browser (8.5M tris).
- The retopo/LOD view stays labeled CONCEPT MOCKUP until a manifest with `concept_mockup: false` and no `test_fixture` loads.

---

## 3. Validator CLI and report (resolved)

```
cd prototype/validator && .venv/bin/python -m sculptline_validator check --manifest <out>/manifest.json --profile <p.json> --json-only   # when `check --help` lists --manifest
cd prototype/validator && .venv/bin/python -m sculptline_validator check <asset> --profile <p.json> --json-only                          # otherwise
```
- Auto-discovered; `SCULPTLINE_VALIDATOR_CMD` is no longer needed (still honored as an override: `{asset} {profile} {manifest}`). `SCULPTLINE_VALIDATOR=off` → stub.
- **Target:**
  - pipeline manifest via `--manifest` (asset defaults to `combined_fbx`; LOD budgets per mesh via the `_LOD<n>` name pattern);
  - else the combined FBX;
  - else the uploaded sculpt (raw-upload profile).
- **Exit codes 0 (no flags), 1 (warn/fail) and 2 (error) are all normal.** The server parses stdout. On 2, stdout is still a report with `overall_status: "error"`.
- **Report location:** stdout, saved by the server to `ui/work/<job>/validator_report.json`. The validator's own saved reports live in `prototype/validator/reports/**/*.report.json`, and the UI can render any of them read-only ("Saved validator reports…", `GET /api/saved-report`).

### Report (`validator/schema/report.schema.json`, 0.1.0 → 0.2.0 additive)
The UI renders:
- **Headline:** `overall_status` (pass / warn / fail / error), `summary` counts as-is, `complete`, `profile.name` (with a DEMO PLACEHOLDER VALUES tag when the name says so), and the top-level `manifest` object (path, lod_count, readable, error).
- **`error`:** `type` + `message`, including `manifest_error`. `checks[]` may be empty.
- **`checks[]`:** `{id, group, title, status: pass|warn|fail|not_checked, message, measured, expected, items, items_total}`, including the 16th `manifest` row. `fail` → red, `warn` → amber, `pass` → green, `not_checked` → **grey "NOT CHECKED", never green, never counted as a pass**.
- Real reports are labeled "<report tool.name> x.y.z · real report" (`sculptline_validator`; reports written before the rebrand say `fabled_validator`). Stub reports are labeled CONCEPT MOCKUP.

---

## 4. Local HTTP API (server.mjs)

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/status` | | `{pipeline:{available, command_preview, supports_validator_profile, latest_output_manifest}, validator:{available, command_preview, supports_manifest}}` |
| `POST /api/jobs?filename=x.glb` | raw bytes | `{job_id, input_path}` |
| `POST /api/jobs/<id>/process` | UI profile | stub: `{ok, source:"stub", manifest}` · pipeline: `{ok, source:"pipeline", started:true}` |
| `GET /api/jobs/<id>/progress` | | `{running, exit_code, progress:<progress.json>\|null}` |
| `GET /api/jobs/<id>/result` | | `{ok, exit_code, failed, manifest, manifest_path, export_asset, stdout, stderr}` (ok whenever a manifest exists), or `{ok:false, error, …}` |
| `POST /api/open-output?dir=pipeline/output` | | read-only job over an existing output folder (allowed: `pipeline/output`, `ui/test_fixtures/*`): `{ok, job_id, manifest, out_dir, export_asset}` |
| `POST /api/jobs/<id>/validate` | UI profile | `{ok, source:"validator"\|"stub", exit_code, target:{kind:manifest\|combined_fbx\|uploaded_sculpt, path}, profile_used, report}` |
| `GET /api/jobs/<id>/files/<rel>` | | file bytes, `<rel>` resolved against the job's output folder only |
| `GET /api/saved-reports` / `GET /api/saved-report?path=<rel>` | | list / read `validator/reports/**/*.report.json` |

---

## 5. Honesty rules the UI enforces
- Tri, vertex and bounds figures are computed from loaded files. Manifest figures are labeled "manifest says" / "from pipeline manifest".
- "Preview unified winding" edits **only the in-browser copy**. The winding check then stays flagged ("browser preview only; file on disk still has N reversed triangles"). The validator always checks the file on disk, so it can never turn green from this. There is no pipeline re-export with a winding fix yet (§6).
- Stubs, browser decimation previews and test fixtures carry CONCEPT MOCKUP / TEST FIXTURE labels.

## 6. Still open
1. Pipeline: `export_up_axis` in the manifest (being added; the UI defaults to Z until then).
2. Pipeline: a re-export option that fixes winding (or a "recalculate normals outside" step), so the UI fix could be real.
3. Texel target: the pipeline ignores `px_per_m` (it only takes `texture_size`). The real bust measures ~27 px/cm against the UI default of 10.24 → WARN. This is a product decision on the default.
4. ORM in FBX: the pipeline exports `T_<asset>_ORM.png`, but the validator's FBX slot mapping doesn't see it yet (pipeline + validator to agree).

## 7. Normals / winding: one definition (added 2026-10-25 22:50 PT)
The browser check (`public/meshops.js` analyzeTopology) now uses the validator's definition (`validator/sculptline_validator/geometry.py` analyze, `checks.py` check_normals):
flagged = winding flipped (BFS over 2-face edges on positions welded at bbox-diagonal × 1e-6; closed parts oriented by signed volume, open parts by a stored-normal vote)
OR stored normals against the face (sum of the 3 corner normals · geometric normal < 0). Zero-area (≤ (diag·1e-7)²) and duplicate-index faces are never flagged.
Scope matches as well: for pipeline output the browser analyses every loaded LOD (the validator checks all LOD meshes in the combined FBX).
Measured identical, including triangle indices, on the bust GLB/FBX, the samples and the validator fixtures (`evidence/NORMALS_MISMATCH_2026-10-25.md`).
In the UI the `normals.flipped` row shows the **validator figure as authoritative**. The browser figure is labeled "browser check: GLB preview" (or "uploaded <FMT>"), and any mismatch is shown as DOES NOT MATCH; the browser figure is never shown alone once the validator has run.

## 8. Profile panel: which values are on screen
- New upload: the editable profile (tag "EDITABLE PROFILE · used for a new upload").
- Opened pipeline output: a read-only "VALUES USED FOR THIS OUTPUT" panel, built from the validator profile file actually used. `/api/open-output` returns `validator_profile {path, content}`, and `/validate` returns `profile_used_content`. Manifest budgets are shown next to it. The panel carries the DEMO PLACEHOLDER VALUES tag when the profile says so. The browser checks use these values (height range, LOD budgets, no texel target → info only). The editable profile is hidden behind "Show editable profile (for a new upload)".

## 9. Frozen runs, asset name, static demo, licensed sample (2026-10-25 ~22:55 PT)
- `/api/status` → `pipeline.frozen_run` = the timestamped folder that `pipeline/runs/latest` points to (e.g. `pipeline/runs/20261025-224413`), and `supports_asset_name`. "Open frozen pipeline run" opens that folder read-only; `pipeline/runs` is now an allowed open-output root.
- Build from an upload now also passes `--asset-name <input stem>` when the pipeline's `--help` lists it (config.asset_name is still set too).
- The static demo (`tools/build_demo.mjs` → `dist/`) reads `demo-data/demo.json`, then the manifest, validator report and validator profile listed there. No `/api` calls. See README "Static demo build".
- Licensed sample (NPG.75.16): the verbatim credit (linked to 3d.si.edu), the no-endorsement line, the display name "Sample asset: historical bust scan (CC0)" (never her name as a title or label) and the height shown as "measured … from the file (source units inferred)". These apply in real and demo mode (`LICENSED_SAMPLES` in public/app.js). File and mesh names stay as exported.

## 10. Connected workspace + AI providers (added 2026-11-06)
The asset tree, Connections panel, asset page and Generate dialog read live server data (`public/workspace.js`; pure helpers in
`public/workspace-model.js`). The old hardcoded `ASSET_CATALOG` is gone: it listed invented assets and a fake "Validating"
status, and it titled the licensed bust with her name. All state is under the gitignored `ui/work/`.

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/workspace` | | `fabled.workspace/0.1`: `groups[runs, uploads, generated, samples]` of assets `{id, kind, name, status{label,tone}, triangles{input,lod_count,lod0_triangles}, created_at, folder, open, validator, provenance, concept_mockup, has_note}` (built from disk each call, see `workspace.mjs`) |
| `GET /api/workspace/notes?asset=<id>` / `PUT` same | `{text}` (≤ 20,000 chars; empty clears) | `{ok, note:{text, updated_at}\|null}` stored in `work/workspace_notes.json` |
| `GET /api/activity?asset=<id>&limit=n` | | newest-first events from `work/activity.jsonl`: `uploaded, pipeline_started/finished/failed, validator_run, generation_started/succeeded/failed/imported, note` |
| `GET /api/providers` | | `{providers:[{id,name,category,kinds,env (names only),configured,docs,verification,…}], generations:[…]}` |
| `POST /api/providers/<id>/generations` | `{kind, prompt, image:{job_id,rel}\|{data_uri,label}\|{url}, source_asset_id}` | `{ok, generation}`. The image is sent to the provider but never stored |
| `GET /api/generations/<id>` | | polls the provider (≤ every 2 s) and returns the task |
| `POST /api/generations/<id>/import` | | downloads the model (https only, 300 MB cap) into a new upload job with `provenance`: `{ok, job_id, asset_id, filename}`; idempotent |
| `GET /api/jobs/<id>/input` | | the uploaded or imported sculpt, to reopen it from the tree |

Asset ids: `run:<path from fabled/>`, `job:<job id>`, `gen:<generation id>`, `sample:<file>`. `job.json` now also records
`created_at`, `asset_id` and, for imports, `provenance`. Status labels come from the strongest real signal: a stored
`validator_report.json` → manifest `status` → "Uploaded". On the asset page, a stored report is labeled "Saved report", because a
live Re-check may use a different profile (e.g. the bust run's stored report reads 10 pass / 3 warn / 0 fail / 3 not checked,
while a Re-check with `demo_placeholder_prop` reads 9 / 3 / 0 / 4). Provider details and verification status are in `PROVIDERS.md`.

