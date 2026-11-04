# Unreal capture: shot 7 (0:58 to 1:08), "Import to Unreal"

**Status: UNTESTED.** The exported FBX is Z-up (validator: FBX GlobalSettings UpAxis=2) in cm. The manifest's `up_axis` is the *source* axis. I wrote these notes and `import_fabled_asset.py` without Unreal Editor (it isn't installed
on the build box). Do a dry run before recording and fix any API differences for your engine version.

Goal from the storyboard: *"Import dialog, asset in level at correct scale next to a reference mannequin,
camera pull-back showing LOD switches. Use the LOD coloration view mode so the LOD switching reads on screen."*
This shot must be real capture (no mockup).

## Before recording
1. **Project:** UE 5.4/5.5 Third Person template (it ships the Mannequin `SK_Mannequin`, which is the scale reference). Enable **Python Editor Script Plugin** and **Editor Scripting Utilities**, then restart.
2. **Asset:** a *real* pipeline run. Use `prototype/ui/work/<job>/out/manifest.json` from the UI, or `prototype/pipeline/output/manifest.json`. Don't capture a manifest with `"concept_mockup": true`.
3. **Dry run:** run the script once (see below) into `/Game/Fabled/DryRun`, check scale, LOD count and materials, then delete it.
4. **Level:** a new Basic level (floor, sky, directional light). Place `SK_Mannequin` (or `BP_ThirdPersonCharacter`) at the origin, facing +X.
5. **Editor UI:** hide the Content Browser drawer, set the viewport to *Lit* at a 1920×1080 window, turn off Realtime warnings and stat overlays. Turn on Game View (G) for the clean beauty frames.
6. **OBS:** 1920×1080, 60 fps, capture the editor window only. Turn off notifications.

## Shot list (one clean take, about 10 s of usable footage; record longer and trim)
| Beat | ~Time | Action | What's on screen |
|---|---|---|---|
| a | 0:58 | Content Browser → Import, pick the Fabled FBX. Optionally show the FBX Import Options dialog for a second (Import LODs checked, Uniform Scale 1.0, Skeleton = SK_Mannequin if skinned). Or run the script from the Output Log: `py "…/import_fabled_asset.py" --manifest "…/manifest.json" --dest /Game/Fabled/Demo` | Import dialog / log line `[Fabled] done: …` |
| b | 1:00 | Drag the imported mesh into the level next to the mannequin (about 100 cm to its right). | Asset at correct scale beside the mannequin (a bust should read as head-sized next to it) |
| c | 1:02 | Open the mesh editor for a beat: material slots filled (not grey), LOD dropdown showing LOD0..n | Proves materials are hooked up and LODs imported |
| d | 1:04 | Back in the level: View Mode → **Level of Detail Coloration → Mesh LODs**. Start close, then slowly dolly back (hold right mouse + S, or use a Sequencer camera) | Mesh changes colour LOD0 → LOD1 → LOD2 → LOD3 as the camera pulls back |
| e | 1:08 | Return to Lit, hold for a moment | Clean final frame |

### Camera
- Start: about 150 cm from the asset at chest height, slightly 3/4 (about 30° off front), FOV 50, mannequin and asset both in frame.
- Pull-back: straight back along the view axis to roughly 20 to 30 m over about 4 s, at constant speed. For a repeatable move, use a Sequencer **CineCameraActor** with two keys (0 s close, 4 s far) and record via Movie Render Queue, or just play it in the viewport while OBS records.
- Keep the floor grid visible; it reinforces scale.

### On-screen captions (add in the edit, not in Unreal)
- "Real capture, Unreal Engine <version>". Fill in the actual version.
- Tri counts per LOD: **only** values from the manifest or the Unreal static mesh editor for this exact asset. Write them down from the Output Log lines `[Fabled] LODi: unreal tris=… manifest tris=…`.
- If any step was done by hand (material hookup, skeleton binding), say so: "material hooked up manually".
- No time-saved claims.

## Checks before you call it done
- [ ] Scale: the asset's bounds in the Details panel match the pipeline's measured height (`report.json` / `work/step01.json` → `scale_check.height_cm_after_conversion`, and `manifest.input.dims_cm`). Re-read these from the run you capture: `source_units_to_m` changed between runs (cm → inch), so older numbers are stale.
- [ ] LOD count in the mesh editor = number of LODs in the manifest.
- [ ] LOD coloration shows at least 3 distinct colours during the pull-back.
- [ ] Materials are not the default grey checker.
- [ ] Skeletal only: the mesh plays the mannequin idle without explosions (only if the skeleton binding step actually ran).

## Known gaps in the script (untested draft)
- Uses the legacy FBX importer options (`FbxImportUI`). On UE 5.3+ with Interchange FBX enabled these may be ignored. Run `Interchange.FeatureFlags.Import.FBX 0`, or port to an Interchange pipeline (TODO in the script).
- Material instance creation and texture hookup is a TODO. Today it relies on the materials embedded in the FBX.
- Per-LOD file import uses `EditorStaticMeshLibrary.import_lod` / `StaticMeshEditorSubsystem.import_lod`, and availability differs by version.
- Triangle readback per LOD may print `None` if the API isn't exposed. Read counts from the mesh editor instead.
