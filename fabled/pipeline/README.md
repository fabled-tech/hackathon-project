# SculptLine mesh pipeline: prototype v0.1

Headless Blender (bpy) scripts that take one real high-poly sculpt or scan and turn it into an Unreal-ready static mesh: import and measure, retopology, UVs, a LOD chain built from tri budgets, normal and AO bakes, binary FBX (cm, LodGroup) plus GLB, and preview renders. Every number below and in `manifest.json` / `report.json` was measured by the pipeline on this box. **No "time saved" figures anywhere.** The runtimes are this machine's wall-clock only.

## Quick start

```bash
cd prototype/pipeline
python3 sculptline_pipeline.py --input input/raw/HK_NPG_75_16-full_resolution-obj.obj \
    --out output --config config/default.json --asset-name HelenKellerBust \
    --validator-profile config/validator_profile_bust.json --freeze
# The UI's call (also works):
python3 sculptline_pipeline.py --input <sculpt> --out <job>/out --config <job>/pipeline_config.json
```

The driver was renamed from `fabled_pipeline.py` in the SculptLine rebrand. `fabled_pipeline.py` remains as a deprecated
shim that runs `sculptline_pipeline.py` with the same arguments and exit code. The Blender add-on is
`blender_sculptline_addon.py` (sidebar tab "SculptLine"). Manifests keep `"schema": "fabled.pipeline.manifest/0.1"`;
new manifests say `"tool": {"name": "SculptLine pipeline"}` (older ones say `fabled-pipeline`).

| CLI flag | Meaning |
|---|---|
| `--input` | High-poly mesh: `.obj`, `.ply`, `.stl`, `.fbx`, `.glb`/`.gltf` |
| `--out` | Output folder. If you leave it out, the output goes to `runs/<YYYYmmdd-HHMMSS>/` and is frozen automatically |
| `--config` | Pipeline config (default `config/default.json`). The UI version is accepted too (see INTERFACES.md §1a) |
| `--asset-name` | Name used in `SM_`/`T_`/`M_` file names. Default: config `asset_name`, otherwise the input file stem, sanitised for Unreal |
| `--validator-profile` | Validator profile JSON. It is copied to `<out>/validator_profile.json`, and the manifest's `profile` field points at that copy |
| `--freeze` | On success, copy `<out>` to `runs/<ts>/` (without the multi-GB `.blend` intermediates) and repoint `runs/latest` and `runs/latest.txt`. Earlier runs are never deleted |
| `--blender` | Blender binary. Default: `$SCULPTLINE_BLENDER` (the old `$FABLED_BLENDER` still works; the new name wins if both are set), otherwise `~/blender/blender-4.5.15-linux-x64/blender` |
| `--steps` | Dev only: run a subset, e.g. `05,06` |

Exit code 0 means success, and `<out>/manifest.json` has `status:"ok"`. Exit code 1 means a step failed: `manifest.json` is still written with `status:"failed"`, `error`, the failing step marked `"failed"` and an explanation in `warnings[]`. While the run is going, `<out>/progress.json` is rewritten at the start and end of every step:
`{step, total, name, label, done, status: running|ok|failed, updated_at}`.

**Environment:** Blender **4.5.15 LTS** (official tarball, `~/blender/blender-4.5.15-linux-x64/`), CPU only (Cycles CPU, software GL). Box: 8 vCPU, ~15 GB RAM (5–9 GB free during runs), no GPU. The memory watchdog in the driver kills a step if Blender's RSS goes over `limits.max_rss_mb` or system MemAvailable drops below `limits.min_mem_available_mb`. `vendor/` contains `fast-simplification` 0.2.0, a quadric decimator used inside Blender's Python for the 8.5M-tri sculpt, because Blender's Decimate modifier needed more than 8 GB and was killed by the watchdog.

## Test input (real, CC0)

*Helen Adams Keller* by Onorio Ruotolo, 1916, plaster and paint. National Portrait Gallery, Smithsonian Institution, **NPG.75.16**. Full-resolution OBJ from Smithsonian 3D.
- Record: https://npg.si.edu/object/npg_NPG.75.16. The page says **"Restrictions & Rights: CC0"**, and its media blocks say *"CCO - Creative Commons (CC0 1.0) This media is in the public domain (free of copyright restrictions). You can copy, modify, and distribute this work without contacting the Smithsonian."* (fetched 2026-10-25)
- Smithsonian Open Access API: the 3D package `3d_package:d8c64ccc-4ebc-11ea-b77f-2e728ce88125` has `usage.access = "CC0"` and an empty restriction text. The 3d.si.edu page itself returned HTTP 403 to this box, so I could not read its wording.
- Download: `…/3d_package:d8c64ccc-…/resources/HK_NPG_75_16-full_resolution-obj.zip` (193.8 MB zip, 748.9 MB OBJ, no colour or UVs).
- Attribution (CC0 doesn't require it; given as the Smithsonian asks): *Helen Adams Keller by Onorio Ruotolo, 1916. National Portrait Gallery, Smithsonian Institution (NPG.75.16). 3D model from Smithsonian 3D.*
- `input/SOURCE.json` has the full details: URLs, the license quote, the catalogue dimensions verbatim, and the unit analysis. The driver copies it to `<out>/SOURCE.json`.

**Units (needs human confirmation).** Smithsonian labels the file "scale in mm". The raw OBJ bbox is X 8.11 × Y 20.91 × Z 11.09 units, with Y-up as the tall axis. The catalogue gives **50.5 × 21.9 × 26.7 cm with base**, and the scan does include the plinth.
- mm would make it 2.1 cm tall. Rejected.
- cm would make it 20.9 cm tall and 8.1 cm wide. Rejected.
- **inches give 53.1 × 20.6 × 28.2 cm** (H×W×D), within about 6% of the catalogue on all three axes. The pipeline uses inches (`source_units_to_m = 0.0254`). This is an inference, so it is flagged in the warnings and in SOURCE.json.

## Steps (scripts/)

| # | Script | What it does |
|---|---|---|
| 1 | `01_import.py` | Imports the file and converts the source up axis to Blender Z-up. The axis comes from `fabled_profile.up_axis`, then `source_up_axis`, default Y. Applies `source_units_to_m`, puts the pivot at bottom-centre, and measures tris/verts, bbox, non-manifold and boundary edges, plus a scale check against `expected_height_cm_range` and `reference_dims_cm` |
| 2 | `02_retopo.py` | `prep`: quadric-decimates the sculpt to a 200k-tri proxy, then repairs it (drops faces on non-manifold edges, fills holes, recalculates normals). Then tries `quadriflow` → `voxel_quadriflow` → `voxel_decimate` in order, each as its own Blender process with a timeout. QuadriFlow aims just under the LOD0 budget and re-runs up to twice to land within `[budget·(1−tol), budget]`. If a remesher overshoots, the result is collapse-decimated down. Normals are recalculated to point outside |
| 3 | `03_uv.py` | Smart UV Project (66°), Pack Islands (concave, rotate, margin 0.004), seams marked from islands. Triangulates LOD0 (so the bake and the export share one triangulation) and flattens the few faces whose smooth normals point against the face. Measures islands, flipped UVs, inter-island overlap (rasterised at 2048²), UV use and texel density |
| 4 | `04_lods.py` | LOD1..N come from LOD0 with collapse Decimate (UVs carried over), using the explicit budgets in `config.lods[]` (any count, with optional `screen_size`). Measures target vs actual per LOD |
| 5 | `05_bake.py` | Cycles CPU bake from the **full 8.5M-tri sculpt** onto LOD0: a 2048² tangent-space normal map (DirectX/−Y green for Unreal, 16-bit PNG) and AO into ORM.R. ORM.G = roughness 0.6 and ORM.B = metallic 0.0 are **constants**. Builds `M_<asset>` |
| 6 | `06_export.py` | Binary FBX 7400: per-LOD `SM_<asset>_LOD<n>.fbx` plus the combined `SM_<asset>.fbx` with a **LodGroup** root and children `SM_<asset>_LOD0..n`. Per-LOD GLB too (metres, +Y up, glTF material with an OpenGL-convention normal map, metallicRoughness and occlusion). Every file is re-imported to check counts, size, axes, `UnitScaleFactor` and the referenced textures |
| 7 | `07_previews.py` | Cycles CPU renders (transparent PNG) of the high-poly, LOD0 (with and without the normal map), LOD3, and wireframes of every LOD plus head close-ups |
| 8 | `post_previews.py` | Labelled composites (Pillow) plus the UV layout, normal map and AO thumbnails |

### FBX settings (exact)
For export, the scene switches to `unit_settings.scale_length = 0.01` (centimetres) and the mesh data is scaled ×100, so vertices are stored in cm with **UnitScaleFactor = 1.0** (read back from the file) and identity object scale. In Unreal, 1 unit = 1 cm.
`export_scene.fbx(use_selection=True, object_types={MESH} (+EMPTY for combined), global_scale=1.0, apply_unit_scale=True, apply_scale_options='FBX_SCALE_NONE', axis_forward='-Y', axis_up='Z', use_space_transform=True, bake_space_transform=False, use_mesh_modifiers=True, mesh_smooth_type='FACE', use_triangles=True, use_tspace=True, use_mesh_edges=False, add_leaf_bones=False, bake_anim=False, path_mode='RELATIVE', embed_textures=False)`.
The file header is `Kaydara FBX Binary`, version 7400. GlobalSettings: UpAxis=2 (Z), FrontAxis=1, CoordAxis=0 with sign −1. Pivot is bottom-centre at the origin.
- **LodGroup:** Blender's exporter writes an Empty's `fbx_type` custom property as the NodeAttribute class, but leaves `TypeFlags` and the Model type as `"Null"`. `06_export.py` patches both at runtime so the combined file has a real `LodGroup` node. This is verified only by re-reading the file in Blender and by the validator. **It has not been tested in Unreal.**
- **ORM in FBX:** Blender's exporter only writes a texture that is linked *directly* to a Principled socket. Going through Separate Color, the ORM was silently dropped (verified). So `T_<asset>_ORM.png` is linked directly to Roughness and Metallic, and the FBX records it in the `ShininessExponent` + `ReflectionFactor` slots. That is what the validator maps to ORM, and it recognises it. Unreal still has to split R/G/B in its material.

## Output layout and manifest

```
<out>/manifest.json   fabled.pipeline.manifest/0.1 (for the UI)     <out>/report.json   every metric from every step
<out>/progress.json   live step progress                           <out>/config_used.json, validator_profile.json, SOURCE.json
<out>/export/         SM_<asset>.fbx (combined, LodGroup), SM_<asset>_LOD<n>.fbx/.glb, T_<asset>_N.png, T_<asset>_ORM.png, gltf/T_<asset>_N.png (OpenGL green, for the GLBs)
<out>/previews/       labelled composites + raw/ transparent renders
<out>/logs/           one Blender log per step          <out>/work/   step JSONs (+ .blend intermediates, not copied to runs/)
```

**Path rule: every path in `manifest.json` is relative to `<out>`, the folder that contains the manifest.** Fields ending in `_abs` are absolute and informational only.

Manifest schema (top level): `schema`, `concept_mockup:false`, `job_id`, `created_at` (America/Los_Angeles offset), `asset`, `status` (`ok|failed`), `error`, `path_rule`, `up_axis` (**source** file axis), `export_up_axis` (exported FBX axis, read back), `exported_size` (FBX and GLB bbox in cm vs catalogue), `units{unit_scale_factor (read back from the FBX), unreal_units:"cm", source_units_to_m}`, `combined_fbx`, `combined_fbx_is_binary`, `combined_fbx_has_lodgroup`, `fbx_texture_files_referenced`, `lods[{level,path,triangles,budget_triangles}]`, `profile` (validator profile copy or null), `pipeline_config` (`config_used.json`), `textures[{material,base_color,normal,orm}]`, `orm_channels`, `source{name,url,license,license_url,attribution,record_urls,source_json,units_needs_human_confirmation}`, `tool{name,version,blender_version}`, `input{sculpt_path,format,triangles,vertices,dims_cm,source_url,license,attribution,…}`, `outputs{lods[{level,name,mesh_name,path,format:"fbx",glb,triangles,vertices,budget_triangles,delta_pct,within_tolerance,screen_size,has_uvs,uv_islands,…}], combined_fbx, uv_layout_png, textures{base_color,normal,orm}, previews[{path,label}]}`, `stages` (per-stage counts), `steps[{name,status: automated|manual|failed|not_implemented,method,runtime_s,peak_rss_mb}]`, `runtimes_s`, `runtimes_note`, `warnings[]`, `manual_steps[]`, `report`.
LOD budgets are **hard maxima**. `within_tolerance` means `budget·(1−lod_tolerance) ≤ triangles ≤ budget`.

## Results: frozen run `runs/20261025-224413/` (`runs/latest`)

| Stage | Triangles | Verts | Notes |
|---|---|---|---|
| Input sculpt | **8,504,655** | 4,253,276 | 4 non-manifold edges, 1,959 boundary edges; 53.1 × 20.6 × 28.2 cm after the inch conversion |
| Retopo proxy | 200,089 | 100,049 | quadric decimation; repair removed 156 faces on non-manifold edges and filled holes |
| LOD0 (QuadriFlow) | **19,200** / 20,000 budget | 9,602 | 9,600 pure quads before triangulation, closed mesh. Solve at 1 m: rejected; at 10 m: 16,712 tris, then 19,200 (kept) |
| LOD1 | **10,000** / 10,000 | 5,002 | collapse-decimated from LOD0 |
| LOD2 | **5,000** / 5,000 | 2,502 | " |
| LOD3 | **2,000** / 2,000 | 1,002 | " |

- **UVs (LOD0):** 121 islands, 0 inter-island overlap pixels (2048² raster), 0 flipped UV faces, 64.4% of 0–1 space used, 28.8 px/cm at 2048².
- **Bakes:** normal map 2048² 16-bit, DirectX green, from the full 8.5M-tri sculpt (Cycles CPU, 4 spp). AO 2048² (16 spp) in ORM.R; ORM.G = 0.6 and ORM.B = 0.0 are constants.
- **Normals:** 1 face on LOD0, and 1 / 4 / 3 faces on LOD1/2/3, were set flat because their smooth normals pointed against the face. After that, the validator reports 0 flipped faces.
- **Exported size:** combined FBX bbox 20.6 × 27.8 × **53.1 cm** (Z up), LOD0 GLB 20.6 × **53.1** × 27.7 cm (Y up). Catalogue with base: 50.5 × 21.9 × 26.7 cm.
- **Files:** `SM_HelenKellerBust.fbx` 3.0 MB; LOD0–3 FBX 1.57 / 0.88 / 0.45 / 0.20 MB; LOD0–3 GLB ~7.1–7.6 MB each (mostly embedded textures); `T_HelenKellerBust_N.png` 16.8 MB; `T_HelenKellerBust_ORM.png`.
- **Wall-clock on this box** (s, includes Blender start-up and .blend load; this machine's runtime only, not a comparison with artist time): import 21.0 · retopo 44.3 · UV 12.5 · LODs 3.5 · bakes 27.6 (normal 11.4, AO 12.9) · export+verify 2.5 · previews 93.0 · composites 5.0. Total ≈ 3.5 min. Peak RSS 5.5 GB (bake).
- **Validator smoke test** (`python -m fabled_validator check runs/20261025-224413/export/SM_HelenKellerBust.fbx --profile validator_profile.json --json-only`, profile = `config/validator_profile_bust.json`, *example values* for a static bust): `overall_status: pass`, `complete: false`, 12 pass / 0 warn / 0 fail / 3 not_checked (up_axis heuristic is characters-only; no skeleton). Saved as `runs/20261025-224413/validator_report.json`.
- **Best previews:** `previews/compare_shaded_highpoly_vs_lod0.png`, `previews/lod_strip_wire.png`, `previews/normal_map_on_lod0.png`, `previews/closeup_wire_highpoly_vs_lod0.png` (plus `uv_layout_lod0.png`, `normal_map_texture_1024.png`, `ao_map_texture_1024.png`, and raw transparent renders in `previews/raw/`).
- `runs/20261025-223508/` is an earlier run whose AO came out wrong (see its `SUPERSEDED.txt`).

## What is still manual or weak

1. **Retopology is QuadriFlow, not artist retopo.** Quads are even, but edge loops ignore facial anatomy and deformation. OK for a static prop, not for an animated character. QuadriFlow needed two workarounds on this asset: a repaired proxy, and solving at 10 m scale, because Blender's pre-check rejects the real-size mesh. If it fails, the fallback is voxel remesh + decimate, which gives triangles, not quads.
2. **UVs are automatic:** Smart UV seams are not artist-placed, and 121 islands with 64% use wastes texels.
3. **LOD1–3** are collapse-decimated triangles that reuse LOD0's maps. No per-LOD bake.
4. **Materials:** no base colour (the scan has none). Roughness and metallic are constants. No Unreal material graph is built; the FBX only references `T_*_N` and `T_*_ORM`.
5. **No Unreal import test.** The LodGroup pickup, scale in-editor and material hookup are unverified in UE (checked only by Blender re-import and the SculptLine validator).
6. No collision, no lightmap UV channel, no skeleton or skinning (`skinning: not_implemented`).
7. Source units are inferred (inches). A human needs to confirm them.
8. Preview framing (head close-up) is tuned to this asset (`previews.closeup_*` in config).
