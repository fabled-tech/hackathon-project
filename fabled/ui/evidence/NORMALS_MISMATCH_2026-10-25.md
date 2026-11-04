# Winding / normals mismatch between shot 21 and shot 24 (investigated 2026-10-25, 22:40–22:50 PT)

**Symptom.** Shot 21 (browser check): "Winding is consistent across 20,224 triangles". Shot 24 (fabled_validator 0.2.0):
"normals: 9 of 37,224 triangles face the wrong way", with SM_HelenKellerBust_LOD0/1/2 listed.

## Root cause (measured): different definition and different scope. Neither tool was wrong about the file.
1. **Definition.** The old browser check counted only *winding* flips (edge orientation vs the connected surface).
   The validator's `normals` check (`validator/fabled_validator/checks.py` check_normals → `geometry.py` analyze)
   flags a triangle if **winding is flipped OR the stored vertex normals point against the face**
   (`sum(3 corner normals) · cross(p1-p0, p2-p0) < 0`).
   In the 22:30 run's report (`evidence/bust_run_2230_validator_report.json`, normals.items), **all 9 flags were
   "stored normal against face"**: winding_flipped 0 and inconsistent_edges 0 on every LOD. On winding alone the
   two tools agreed (0).
2. **Scope.** 20,224 is LOD0 only (the browser analysed LOD0). 37,224 = 20,224 + 10,000 + 5,000 + 2,000, all four
   LOD meshes in the combined `SM_HelenKellerBust.fbx`. The 9 split as LOD0 5, LOD1 2, LOD2 2, LOD3 0.
3. **Weld/edge matching is the same in both:** positions quantised to bbox-diagonal × 1e-6 (validator: LOD0 bbox),
   edges matched on welded vertex ids, only 2-face edges propagate orientation, closed parts oriented by signed
   volume. Two smaller differences were removed: (a) the browser treated only exact-zero area as degenerate
   (validator: area ≤ (diag·1e-7)²); (b) for open parts the browser used a majority vote, while the validator votes with stored normals.

## GLB (browser) vs FBX (validator), measured on the same files
`ui/tools/compare_normals.mjs` runs the UI's own loaders.js/meshops.js in headless Chrome.
`ui/tools/validator_analyze_readonly.py` imports the validator's own loader + analyze() (read-only, no edits).

| File | validator flagged / winding / stored-normal | browser (new code) | same triangle indices |
|---|---|---|---|
| frozen runs `pipeline/runs/20261025-223508` and `20261025-224413`: `SM_HelenKellerBust.fbx` LOD0..3 | 0/0/0 each (19,200 · 10,000 · 5,000 · 2,000 tris) | identical | yes |
| same runs: `SM_HelenKellerBust_LOD0.glb` … `LOD3.glb` | 0/0/0 each | identical | yes |
| `ui/samples/fabled_sample_head.glb` (exercises both signals, incl. 26 stored-normal flags) | 2,023 / 2,003 / 26 of 327,680 | identical | yes |
| `ui/samples/fabled_sample_head.obj` | 506 / 502 / 5 of 81,920 | identical | yes |
| validator fixtures: synthetic_flipped_faces.obj, synthetic_clean_character.glb/.fbx, synthetic_pipeline_out/*.fbx/.glb | identical per mesh | identical | yes |

The 22:30 output files (which had the 9 flags) were deleted when the Pipeline SWE's frozen run started at 22:35,
so their triangle indices can't be recovered. In both frozen runs (22:38 and 22:47 PT), every LOD has 0 flags in both tools, in GLB and FBX, and the validator's normals check passes (0 of 36,200).

## For the Validator SWE (suggestion, not a bug in the measurement)
The headline "N triangles face the wrong way" is used even when winding is 0 and every flag is "stored normal
against face" (the 22:30 run). Suggest wording that splits the two signals, e.g. "0 winding flips; 9 triangles whose stored
normals point against the face". The per-mesh items already carry both numbers.

## For the Pipeline SWE
No action is needed for the frozen runs (0 flags). If stored-normal flags come back on a decimated LOD, it usually means folded
slivers after decimation where the smoothed normals point the other way. Recomputing normals and removing folds on those LODs
before export would clear them. The UI now shows these flags as "stored normal against face", not as winding.

## Also found and fixed during this check (UI bug, now fixed)
After a second file was dropped, the validator could run against the *previous* upload's job: `state.jobId` was still set while the new
upload was in flight. Measured: the OBJ drop reported the GLB's 2,023 of 327,680. The new per-definition comparison caught it as
DOES NOT MATCH. Fix: the job id is cleared on every new file, and a stale validator response is dropped. After the fix, the OBJ shows 506 of 81,920 from both tools.
Earlier screenshot 10_obj_dropped.png (before 22:44 PT) showed the wrong validator report for that reason.
