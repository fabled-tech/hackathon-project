# SculptLine pre-import check — v0

A Python 3 CLI that checks a 3D asset against a studio **import profile** before it goes into Unreal, then writes a JSON report and a single-file HTML report. This is shot 6 of the demo storyboard ("pre-import check", hero shot).

Every number in a report comes from parsing the file in that run. If a check can't measure something, its status is `not_checked` and the message says why. It never reports a pass it didn't measure.

## Quick start

```bash
cd fabled-demos/prototype/validator
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # runtime needs numpy only
.venv/bin/python fixtures/make_fixtures.py                                 # (re)generate synthetic fixtures
.venv/bin/python -m pytest -q tests                                        # run the tests
.venv/bin/python -m sculptline_validator check fixtures/synthetic_storyboard_two_flags.gltf \
    --profile profiles/example_studio.json --out reports/
.venv/bin/python -m sculptline_validator check --manifest fixtures/synthetic_pipeline_out/manifest.json \
    --profile profiles/demo_placeholder.json --out reports/      # asset omitted: checks the manifest's combined_fbx
.venv/bin/python run_fixtures.py            # every fixture -> reports/, SUMMARY.md, 1920x1080 PNGs if Chrome is present
```

### Renamed from `fabled_validator`

The package was renamed from `fabled_validator` to `sculptline_validator` in the SculptLine rebrand. A thin
`fabled_validator/` compatibility package stays: `import fabled_validator` re-exports `sculptline_validator`, and
`python -m fabled_validator …` runs the new CLI with the same arguments and exit code, printing a one-line
deprecation notice to **stderr** only (stdout stays pure JSON with `--json-only`). New reports say
`"tool": {"name": "sculptline_validator"}`; older reports with `"fabled_validator"` still validate against the schema.
`schema_version`, the schema `$id` and the manifest schema id (`fabled.pipeline.manifest/0.1`) are unchanged.

### CLI usage

```
python -m sculptline_validator check [ASSET] --profile PROFILE.json [--manifest MANIFEST.json] (--out DIR | --json-only [--out DIR]) [--no-html]
python -m sculptline_validator schema
```

`ASSET` is optional only when `--manifest` is given. In that case the asset is the manifest's `outputs.combined_fbx`.

## Supported input

| Format | Reader | Units / up axis | Skeleton |
|---|---|---|---|
| Wavefront `.obj` + `.mtl` | pure Python | not declared, so the profile's `units.assumed_source_units` and `axes.up` apply | none (OBJ can't carry one), so skeleton checks report `not_checked` |
| glTF 2.0 `.gltf` (sidecar `.bin` or base64 data-URI buffers) and `.glb` (incl. embedded images) | pure Python + numpy | meters and +Y up, per the spec | `skins`, `JOINTS_0` |
| **Binary** FBX 7.1–7.7 | pure Python + numpy (`loaders/fbx_binary.py`), no Autodesk SDK | `GlobalSettings.UnitScaleFactor` / `UpAxis` | `LimbNode` models, `Skin` and `Cluster` deformers |
| ASCII FBX, `.blend`, `.usd`, anything else | — | — | Returns a clear `unsupported_format` error (exit 2) |

Textures: PNG, JPEG and TGA dimensions are read from file headers. Other image formats are listed as "not measured".

## Checks (stable ids, fixed order)

| id | What it measures | Fails / warns when |
|---|---|---|
| `scale` | LOD0 bounding-box extent along the profile up axis, converted to cm | Outside `expected_height_cm`. The message suggests a ×100, ÷100, ×2.54 or ×10 factor if one would land in range. |
| `up_axis` | Extents per axis and the declared up axis | Warn if the declared axis differs from the profile, or if the character is taller along another axis. This is a heuristic. |
| `normals` | Two signals, counted per triangle: (1) winding that disagrees with neighbours, found by propagating orientation across shared edges and resolving each closed shell by signed volume, so fully inside-out shells are caught; (2) stored vertex normals pointing against the face normal | Flagged triangles (union of both signals, `measured.faces_flagged`) > `normals.max_flipped_faces`. Warn on non-orientable surfaces. The fail message reports the two signals separately: `N of T triangles flagged — reversed winding: A; stored normals against face: B (C in both)`. Additive measured fields (no renames): `reversed_winding` (= `faces_winding_inconsistent`), `stored_normals_against_face` (= `faces_stored_normal_against_face`, `null` when the file has no stored normals), `flagged_by_both`. |
| `non_manifold` | Edges shared by more than 2 triangles, after welding vertices by position so UV seams don't count; open boundary edges | Any non-manifold edge, or any open edge if `allow_open_boundaries` is false |
| `degenerate_triangles` | Repeated-vertex and zero-area triangles | More than `max_degenerate_triangles` |
| `triangle_budget` | Triangles per LOD (LOD read from the mesh/node name suffix `_LOD<n>`; untagged = LOD0) | Over budget, fewer LODs than `min_count` (fail), gaps or LODs with no budget (warn) |
| `skeleton_binding` | Top-level bones, skins, which meshes are skinned and bound | Root bone missing or named differently, more than one top bone, skinned mesh without a skin, skin joints not under the root, no skin when `required` |
| `bone_naming` | Every bone name against `bone_name_regex` | Any mismatch |
| `texture_files` | Every texture referenced by a used material exists (external file or embedded data) | Any missing |
| `texture_slots` | Slots per used material | Required slot missing |
| `texture_naming` | File name vs `naming_regex`, and per-slot suffix | Any mismatch |
| `texture_size` | Pixel size from headers | Not power of two, or larger than `max_resolution` |
| `material_count` | Materials used by triangles | More than `max_count` (fail); triangles with no material (warn) |
| `uv_layout` | UV0 per triangle; range | Missing UV0; outside 0–1 (non-UDIM); outside the UDIM range or straddling tiles (UDIM) |
| `texel_density` | Per material on LOD0: `sqrt(UV area × texture px² / world area cm²)`, plus per-face p5/p95 | Outside target ± tolerance (warn, or fail if `severity` = `fail`). Reports `not_checked` when no texture size is known, and also while `scale` fails, because a wrong world scale skews px/cm by the same factor. |

Slot mapping: glTF `baseColorTexture` maps to BaseColor, `normalTexture` to Normal, and `metallicRoughnessTexture` to ORM. MTL `map_Kd` maps to BaseColor, `map_Bump`/`bump`/`norm` to Normal, and `map_Pr` + `map_Pm` on the same file to ORM. FBX `DiffuseColor` maps to BaseColor, `NormalMap`/`Bump` to Normal, and `ShininessExponent` + `ReflectionFactor` on the same file to ORM (Blender's exporter convention).

## Import profile

`profiles/example_studio.json` holds **example values only**, not a real studio's rules. Fields (keys starting with `_` are comments):

| Field | Meaning |
|---|---|
| `profile_name` | Required. Shown on reports. |
| `asset_type` | `character` enables the up-axis height heuristic. |
| `units.assumed_source_units` | `mm`, `cm`, `m`, `in` or `ft`. Used for files with no unit metadata (OBJ). |
| `units.trust_file_units` | If true, use the units the file declares (glTF = m, FBX `UnitScaleFactor`). If false, always use `assumed_source_units`. |
| `units.import_scale` | Uniform multiplier applied after units are resolved, like Unreal's Import Uniform Scale. Default 1.0. Example: 100 if a file's metres should be read as centimetres. Must be > 0. |
| `units.expected_height_cm.{min,max}` | Allowed LOD0 bounding-box height in cm. |
| `axes.up` | `X`, `Y` or `Z`: the up axis of the **delivered file**. Y for Maya/Blender glTF/FBX/OBJ exports; Unreal's importer converts to Z-up. |
| `axes.min_up_ratio` | Heuristic: up extent ÷ widest other extent must be at least this. |
| `lods.triangle_budgets` | `[LOD0, LOD1, …]` max triangles. |
| `lods.min_count` | Minimum number of LODs present in the file. |
| `lods.name_pattern` | Documented LOD suffix pattern. v0 uses `_LOD<n>`. |
| `materials.max_count` | Max materials used. |
| `materials.required_texture_slots` | Any of `BaseColor`, `Normal`, `ORM`, `Roughness`, `Metallic`, `Occlusion`, `Emissive`, `Opacity`. Missing → fail. |
| `materials.recommended_texture_slots` | Same names. Missing → warn (added in 0.2; default `[]`). |
| `textures.naming_regex` | Full-match regex on the texture file name. |
| `textures.slot_suffixes` | e.g. `{"BaseColor":"_BC","Normal":"_N","ORM":"_ORM"}`. The stem must end with the suffix for its slot. |
| `textures.require_power_of_two` | Both dimensions must be a power of two. |
| `textures.max_resolution` | Max pixels on the longer side. |
| `uv.require_uv0` | UV0 required on every triangle. |
| `uv.udim` | false: UVs must stay in [0,1]. true: UDIM tiles 1001–1100, and no triangle may straddle tiles. |
| `uv.tolerance` | Slack for range tests. |
| `texel_density.target_px_per_cm` | Target density (10.24 px/cm = 1024 px/m). |
| `texel_density.tolerance_pct` | ± percent. |
| `texel_density.severity` | `warn` or `fail`. |
| `texel_density.reference_slot` | Which texture's size to use (falls back to any measured texture on the material). |
| `geometry.max_degenerate_triangles` | Allowed degenerate triangles. |
| `geometry.allow_open_boundaries` | If false, open edges fail `non_manifold`. |
| `normals.max_flipped_faces` | Allowed flagged triangles. |
| `skeleton.required` | The asset must carry a skin. |
| `skeleton.root_bone_name` | Required single top-level bone, e.g. `root`. |
| `skeleton.bone_name_regex` | Full-match regex for every bone name. |
| `skeleton.require_all_meshes_skinned` | Fail if any mesh is static. |

## Pipeline manifest (`--manifest`)

The pipeline writes `<out>/manifest.json` with `"schema": "fabled.pipeline.manifest/0.1"`. The canonical shape is `prototype/ui/INTERFACES.md` section 2. **Rule: every path in the manifest is relative to the manifest's own directory.** The validator resolves paths only that way, never against the cwd or the prototype root. An absolute path still works but raises a warning.

Fields the validator reads (tolerant: unknown fields are ignored, and the UI reader's variants are accepted):

| Field | Used for |
|---|---|
| `schema` | Must be `fabled.pipeline.manifest/0.1` (otherwise fail) |
| `outputs.combined_fbx` (or top-level `combined_fbx`) | Binary FBX `SM_<Asset>.fbx` with meshes `_LOD0.._LODn`. This is the asset checked when the positional asset is omitted. The asset name comes from `SM_<Asset>`, or from top-level `asset` / `asset_name` if present. |
| `outputs.lods[]` (or top-level `lods`): `level` (or `name: "LOD<n>"`), `path` (or `file` / `fbx` / `glb` / `obj`), `triangles` (or `tris` / `tri_count`), `budget_triangles` (or `target_tris` / `max_triangles`), `has_uvs` | Per LOD: the file exists; the manifest's `triangles` equals the triangles the validator measures in **both** the combined FBX (that LOD) and the per-LOD file (fail on mismatch, showing both numbers); `budget_triangles` vs the profile's `lods.triangle_budgets[level]` (warn); `has_uvs` vs measured UV0 (warn) |
| `outputs.textures` (or top-level `textures`): keyed by slot (`base_color`, `normal`, `orm`; null = not produced), string or list | Each listed file exists and is named `T_<Name>_<BC\|N\|ORM>.<png\|tga\|jpg>` with the suffix matching its slot (fail) |
| `steps[]` `{name, status}` | `failed` → fail; `manual` / `not_implemented` → warn; all are listed in `measured.steps` |
| `warnings[]` | Any entry → warn. Every warning is quoted in full in the check message (no length cut, no limit on how many); the full list is also in `measured.pipeline_warnings`. Each manifest problem is also listed separately in the additive `measured.problems_fail_list` / `measured.problems_warn_list`. In the HTML, manifest reports put the 15 checks in three columns and the Pipeline manifest card full width underneath, with each problem on its own line and each pipeline warning as a numbered item (nothing collapsed). |
| `status` (optional, top level) | Anything other than `ok` / `success` → warn |
| `export_up_axis` (optional, top level or `outputs.export_up_axis`) | The exported FBX's up axis. When present, it is compared with the combined FBX's declared `UpAxis` (warn on mismatch), and `up_axis` is treated as the **source** file's axis: shown as `measured.source_up_axis`, never warned on. `measured.axis_compared` names the field that was compared. |
| `up_axis` (optional, top level) | With `export_up_axis` present: source axis, information only. Without it (older manifests): compared with the combined FBX's declared `UpAxis` (warn). Skipped when absent. |
| `units` (optional, top level) | Compared with the combined FBX's `UnitScaleFactor` (warn). Skipped when absent. |
| `concept_mockup: true` | warn |
| `input`, `profile`, `previews`, `tool`, `job_id`, … | Not checked (ignored) |

Behaviour:
* The `manifest` check is appended as the 16th row (`group` "Pipeline manifest"). The report gets a top-level `manifest` object: `{path, schema, asset_name, combined_fbx, lod_count, readable, error}`. Without `--manifest`, `manifest` is `null` and the 15 checks are unchanged.
* If the positional asset and the combined FBX differ, the positional asset is validated and the manifest check warns.
* An unreadable or unknown manifest makes the manifest check fail, and the other checks still run if an asset was given. If no asset can be found (no positional asset, and no readable `combined_fbx`), the report is an error with `error.type = "manifest_error"` and exit code 2.

## Demo profile

`profiles/demo_placeholder.json` is named **"DEMO PLACEHOLDER VALUES - not a real studio spec"**. It is a copy of `example_studio.json` with three changes:
* `skeleton.required = false`. On a static mesh, `skeleton_binding` and `bone_naming` report `not_checked` ("Skeleton not required by profile …"). If the asset *does* have bones they are still measured, never assumed.
* `materials.required_texture_slots = ["Normal"]`, because the pipeline currently bakes a Normal map only.
* `materials.recommended_texture_slots = ["BaseColor", "ORM"]`, a new additive profile option: a missing recommended slot is a **warn**, a missing required slot is a **fail**.

All other values (height range 150–220 cm, up axis Y, budgets 60k/30k/15k/7.5k, …) are still the example-studio placeholders.

## Reports

`--out DIR` writes `DIR/<file_name with dots as _>.report.json` and `.report.html`, e.g. `synthetic_storyboard_fixed_gltf.report.html`.

* **JSON** contains: asset path, sha256, size and referenced files; profile name, path and sha256; `generated_at` (UTC) and local time; per-check `status`, `message`, `measured`, `expected` and `items`; `summary` counts; `overall_status`; `complete`. See the schema.
* **HTML** is one file with no scripts and no network requests. It uses a cream and brown palette. The first screen (1920×1080) is the checklist, with flagged rows in red or amber marked FIX or CHECK. Full measured values and tables are below the fold. Fonts are Inter and Playfair Display when installed, otherwise system fallbacks; they are not embedded. Files named `synthetic_*` (or inside a `synthetic_*` folder) get a **SYNTHETIC TEST ASSET** tag.

## For the UI

The UI in `prototype/ui/` should treat the validator as a subprocess or a Python call. The contract below is stable for `schema_version` 0.x.

**Subprocess**

```bash
python -m sculptline_validator check <asset> --profile <profile.json> --json-only           # JSON on stdout only
python -m sculptline_validator check <asset> --profile <profile.json> --json-only --out DIR # also writes JSON+HTML; "wrote …" lines go to stderr
python -m sculptline_validator check --manifest <out>/manifest.json --profile <profile.json> --json-only   # pipeline output: asset = combined_fbx
python -m sculptline_validator schema                                                      # prints schema/report.schema.json
```

* stdout carries exactly one JSON document matching `schema/report.schema.json`, even on errors. Errors have `overall_status: "error"` and `error: {type, message}`.
* Exit codes: **0** = no check warned or failed (`not_checked` allowed; read `complete`). **1** = at least one warn or fail. **2** = error: unsupported or unreadable asset, invalid profile, or bad CLI usage.
* With `--manifest`, exit 2 also covers "no asset could be found from the manifest" (`error.type = "manifest_error"`). A manifest that is unreadable or mismatched but still has an asset is exit 1 (the `manifest` check fails).
* `schema_version` is **0.2.0**. The changes from 0.1.0 are additive only: the optional `manifest` check id and group, the top-level `manifest` object (null without `--manifest`), the `manifest_error` error type, and nullable `asset.path` / `asset.file_name` in error reports. 0.1.0 reports still validate against the schema.
* Check `id`s and their order are fixed (see the table above); `manifest`, when present, is always last. Key UI rows on `id`, show `title`, `status` and `message`, and put `measured` / `items` in a details panel.

**Python**

```python
from sculptline_validator import validate, exit_code_for
report = validate("asset.glb", "profiles/example_studio.json")  # dict, never raises for bad input
report = validate(None, "profiles/demo_placeholder.json", manifest_path="out/manifest.json")  # asset = combined_fbx
code = exit_code_for(report)                                     # same 0/1/2 as the CLI
```

## Fixtures

`fixtures/make_fixtures.py` generates every fixture. Each one is a synthetic box-figure character proxy (180 cm, Y up, 2 LODs, 2 materials, 8-bone skeleton in glTF and FBX), not real art. `fixtures/FIXTURES.md` lists what is wrong in each. The FBX fixtures come from a small binary FBX writer (`fixtures/_fbx_writer.py`). The tests cross-read them with an independent parser (Assimp via `assimp_py`, dev-only) so the reader isn't only tested against its own writer.

`fixtures/synthetic_pipeline_out/` mimics a pipeline output folder: `manifest.json`, `SM_SyntheticProxy.fbx` (static, meshes `_LOD0.._LOD3` = 4,608 / 1,152 / 288 / 72 triangles), per-LOD files (LOD0–2 FBX, LOD3 GLB) and `textures/T_SyntheticProxy_{BC,N,ORM}.png`. There are two broken copies: `synthetic_pipeline_out_tri_mismatch/` (manifest says LOD1 = 1,252) and `synthetic_pipeline_out_missing_lod/` (LOD2 file deleted).

## Known limits (v0)

* FBX: binary only. Applies `Lcl` T/R/S, but ignores pivots, pre/post rotation and geometric transforms (it logs a note when they are set). Reads the first UV and normal layer only. Real-world FBX files from Maya, Max or Blender haven't been tested yet, only the synthetic ones plus the Assimp cross-read.
* glTF: skinned meshes are measured with their node transform (the spec says skinned meshes ignore it). Morph targets, KHR extensions and KTX2/WebP texture sizes aren't interpreted.
* OBJ: texture filenames containing spaces aren't supported in MTL option parsing.
* Non-manifold *vertices* (bow-ties) aren't detected yet, only edges.
* The up-axis check is a heuristic for characters.
* The schema lives in `schema/`, next to the package. A pip-installable package would need to bundle it.

`profiles/demo_placeholder_prop.json` is the static-prop variant (Z-up, 20–80 cm, LOD budgets 20k/10k/5k/2k, no skeleton, Normal required, BaseColor/ORM recommended). Also DEMO PLACEHOLDER VALUES, not a real studio spec. Its budgets mirror the pipeline's own targets, so passing them is not a studio check.
