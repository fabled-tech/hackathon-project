# Unreal Editor scripts for the Fabled demos

**Status: UNTESTED IN ENGINE.** Neither script has been run inside Unreal Editor. There is no editor on the build
machine and Epic's documentation hosts were not reachable while they were written, so every Unreal API call is from
memory of the UE 5.x Python API. They pass a test suite that runs them against a hand-written fake `unreal` module.
That shows the scripts' own logic is right (validation, frame ranges, look-at maths, what a re-run deletes). It does
not show that the real engine accepts the calls. Keep the UNTESTED label until someone completes the first-run
checklist below in a real editor.

| Script | Reads | Makes |
|---|---|---|
| `build_sequence_from_shotlist.py` | `sequencer_plan.json` (`fabled.sequencer_plan/0.1`, plan v1 or v2) from Fabled Shots | One Level Sequence: a spawnable CineCameraActor per shot (`CAM_<shot id>`), two linear transform keys aimed at the shot's look-at point, a focal length key, one Camera Cut section per shot, display rate and playback range from the plan. With a v2 plan the cameras are grouped in a Sequencer folder per location. |
| `blockout_from_layout.py` | `blockout_plan.json` (`fabled.blockout_plan/0.1`) from Fabled Forge | One StaticMeshActor per placed item in the open level: the real mesh if it exists in the project, otherwise a scaled engine cube. All in one Outliner folder, tagged `fabled`, plus one PlayerStart. |

Target engines: UE 5.4 to 5.8 (the scripts warn on anything older). Both scripts run synchronously on the game
thread and use no network.

## Plugins

Edit > Plugins, enable, restart the editor:

- **Python Editor Script Plugin** (both scripts)
- **Editor Scripting Utilities** (both scripts)
- **Sequencer Scripting** (sequence script)

## Running

### 1. In the editor (recommended for the first run)

Window > Output Log. Leave the input box on `Cmd` and type:

```
py "C:/path/build_sequence_from_shotlist.py" --plan "C:/path/sequencer_plan.json" --dry-run
py "C:/path/build_sequence_from_shotlist.py" --plan "C:/path/sequencer_plan.json"
py "C:/path/blockout_from_layout.py" --plan "C:/path/blockout_plan.json" --dry-run
py "C:/path/blockout_from_layout.py" --plan "C:/path/blockout_plan.json"
```

On a Mac use `/Users/you/...` paths. Run `--dry-run` first: it validates the plan and logs what would be created
without creating anything. Every line the scripts log starts with `[Fabled]`.

### 2. Headless (commandlet, no editor window)

```
"C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "C:\Proj\Proj.uproject" -run=pythonscript -script="C:/path/build_sequence_from_shotlist.py --plan C:/path/sequencer_plan.json"

"/Users/Shared/Epic Games/UE_5.8/Engine/Binaries/Mac/UnrealEditor-Cmd" "/Users/you/Proj/Proj.uproject" -run=pythonscript -script="/path/blockout_from_layout.py --plan /path/blockout_plan.json --map /Game/Maps/Blockout --save-level"
```

Headless is the less certain route. A commandlet has no Sequencer UI, so the sequence script switches to its
low-level camera path, and it loads no level, so the blockout script needs `--map` and `--save-level` (otherwise the
spawned actors are discarded when the process exits). A failed run ends by raising a Python error, which is meant to
make the commandlet report failure (not verified).

### 3. Plain Python (validation only)

```
python3 build_sequence_from_shotlist.py --plan sequencer_plan.json --dry-run
python3 blockout_from_layout.py --plan blockout_plan.json --dry-run
```

No Unreal needed. Checks the plan and prints what a run would create.

## Options

`build_sequence_from_shotlist.py`

| Option | Meaning |
|---|---|
| `--plan PATH` | The sequencer plan (required). |
| `--dest /Game/...` | Content folder, default `/Game/Fabled/Previs`. |
| `--name NAME` | Asset name, default `LS_FabledPrevis`. |
| `--overwrite` | Delete an existing Level Sequence with that dest/name and rebuild it. Without it the script stops if the asset exists. It refuses to delete an asset that is not a Level Sequence. |
| `--dry-run` | Validate and log; create nothing. |
| `--no-save` | Leave the new asset unsaved (default: the Level Sequence asset is saved, nothing else). |
| `--camera-api auto\|subsystem\|lowlevel` | Which camera-creation path to use. Try `lowlevel` if the default misbehaves. |

`blockout_from_layout.py`

| Option | Meaning |
|---|---|
| `--plan PATH` | The blockout plan (required). |
| `--folder PATH` | Outliner folder, default `Fabled/Blockout`. |
| `--overwrite` | Default. Delete this script's previous actors in the folder, then spawn the whole plan. |
| `--keep` | Delete nothing; spawn only plan items whose label is not already there. |
| `--dry-run` | Validate and log; change nothing. |
| `--map /Game/...` | Load this level first (needed headless). |
| `--save-level` | Save the level afterwards. Off by default: the level is left modified for you to review. |

Exit codes from `main()`: 0 done, 1 failed, 2 bad arguments or plan (every problem is listed at once), 3 cancelled.

What the blockout script deletes on a re-run: only actors that are in the folder **and** carry the `fabled` tag.
Actors you put in that folder yourself are left alone. The Fabled PlayerStart is moved, never duplicated.

## First-run checklist

Do this once on a Mac or PC with Unreal, in a throwaway project or a copy. Tick each item or note what differed.

### Sequence script

1. Export `sequencer_plan.json` from Fabled Shots (or use `fixtures/sequencer_plan.tiny_v1.json`, 3 shots, 120 frames).
2. Run with `--dry-run`. Expect one `dry run: CAM_...` line per shot and no errors.
3. Run without `--dry-run`. Expect `[Fabled] done: /Game/Fabled/Previs/LS_FabledPrevis (...)` and an `API report` line.
4. Open the sequence in Sequencer and check:
   - [ ] Frame rate shows the plan's fps (24) and the playback range is 0 to `total_frames`.
   - [ ] One camera binding per shot, named `CAM_<shot id>`. No extra unnamed "Cine Camera Actor" bindings.
   - [ ] Each camera has **one** Transform track with keys at the shot's first frame and at its end frame, and
         Location/Rotation values change between them only for shots that move. Curve Editor shows straight lines.
   - [ ] Each camera has a `CameraComponent` child with **one** `Current Focal Length` track holding one key at the
         shot's first frame, with the plan's value. No second focal length track.
   - [ ] The Camera Cuts track has one section per shot, edge to edge with no gaps or overlaps, each showing the
         right camera's name.
   - [ ] Click the camera icon on the Camera Cuts track and scrub: the view cuts at the plan's frames, every camera
         looks at the subject mark (150 cm above each stage origin), and no shot shows a black or default view
         (that would mean the camera was not spawned at that time).
   - [ ] Scrub through one moving shot: the move is constant speed and the subject stays near frame centre.
   - [ ] v2 plans: cameras sit in one Sequencer folder per location, and locations are 50 m apart in the level.
5. Run the same command again. Expect it to stop with "already exists ... --overwrite" and change nothing.
6. Run again with `--overwrite`. Expect one sequence, same content, no duplicate asset.
7. Press Ctrl+Z a few times: note whether the build undoes cleanly (asset creation itself is not undoable).

### Blockout script

1. Export `blockout_plan.json` from Fabled Forge (or use `fixtures/blockout_plan.tiny.json`, 3 items). Open a new
   Basic level.
2. Run with `--dry-run`, then for real. Expect `[Fabled] --overwrite: deleted 0 previous actor(s), spawned N ...`.
3. Check in the level and Outliner:
   - [ ] N actors plus `PlayerStart_Fabled` are in the folder `Fabled/Blockout`.
   - [ ] Placeholder boxes sit **on** the floor (not half sunk), with the footprint and height in the plan
         (`placeholder_box_cm` x `scale`), rotated by the plan's yaw.
   - [ ] Details > Actor > Tags on a box: `fabled`, `fabled:<category>`, `fabled:placeholder`.
   - [ ] The PlayerStart is at the plan's spawn point, its capsule resting on the floor, arrow pointing along the
         plan's yaw. Press Play: you start there.
   - [ ] The level shows as modified and was not saved.
4. Put a cube of your own in the same folder. Run the script again:
   - [ ] Same actor count as before (no duplicates), still exactly one `PlayerStart_Fabled`, your cube untouched.
5. Import one asset to the path in the plan (`mesh_path`, e.g. `/Game/Fabled/SM_Crate/SM_Crate`) and re-run:
   - [ ] That item is now the real mesh, sitting on its base pivot (not lifted), tagged without `fabled:placeholder`.
6. Ctrl+Z: note whether the whole blockout undoes in one step.

### If something fails, report back

- The engine version line (`[Fabled] engine version: ...`) and whether you ran in the editor or headless.
- The `[Fabled] API report: ...` line, if the run got that far.
- The first `[Fabled]` error and the Python traceback under it, copied from the Output Log.
- Which checklist box failed, with a screenshot of the Sequencer tree or the Outliner.

### Calls most likely to need adjusting

Sequence script, most likely first:

1. `LevelSequenceEditorSubsystem.create_camera(spawnable=True)`: its return shape, and whether it leaves a child
   `CameraComponent` binding with a `CurrentFocalLength` track.
2. The low-level camera path used headless or with `--camera-api lowlevel` (`add_spawnable_from_instance`, a
   component possessable under a spawnable). The focal length is also written to the spawnable's template as a
   safety net.
3. Spawn lifetime in 5.5+ (`MovieSceneSpawnTrack` / `MovieSceneBindingLifetimeTrack`).
4. Camera cut binding ids (`sequence.get_binding_id` -> `section.set_camera_binding_id`).
5. `channel.add_key(..., time_unit=, interpolation=)` keyword and enum names; the `channel_name` property.
6. `--overwrite`: deleting and re-creating an asset of the same name in one session.
7. Sequencer folders for v2 locations (cosmetic).

Blockout script, most likely first:

1. Headless level load/save (`LevelEditorSubsystem.load_level`, `save_current_level`) and spawning in a commandlet.
2. Writing and reading actor `tags`, and `get_folder_path()` returning the folder as written.
3. Reading the PlayerStart capsule half height (falls back to 92 cm).
4. `static_mesh_component.set_static_mesh` on a freshly spawned StaticMeshActor; loading `/Engine/BasicShapes/Cube`.
5. `spawn_actor_from_class`, `destroy_actor`, `set_actor_location_and_rotation`.

Each script's header has the same list with more detail.

## Known limits

- Only the two transform keys are aimed exactly at the look-at point; rotation is interpolated linearly in between.
- Placeholder boxes use the cube's default material. Per-category colours are not implemented; use the tags.
- `../../unreal/import_fabled_asset.py` by default imports to `/Game/Fabled/<Source>/SM_<Source>`, which is not the
  plan's `mesh_path` (`/Game/Fabled/<AssetName>/<AssetName>`). The blockout script looks in both places, but the
  simplest route is to pass the importer `--dest` and `--name` that match the plan.
- Nothing here renders. Movie Render Graph submission is not part of these scripts.

## Tests without Unreal

```
python3 fabled/demos/tools/test_unreal_scripts.py      # or, from fabled/demos: npm run test:unreal
```

Standard library only, no Unreal, no network. Prints one line per test and exits non-zero on any failure. It puts
`fake_unreal/` on `sys.path`, so `import unreal` inside the scripts loads `fake_unreal/unreal.py`, then runs each
script's `main()` on the fixture plans and asserts on what the fake recorded: camera count, focal keys, transform
keys and whether each rotation really points from the camera at the look-at point, camera cut ranges and bindings,
playback range and fps, plan v1 and v2, validation failures, `--dry-run`, `--overwrite`; and for the blockout: actor
count, box scale, z compensation, real meshes, tags, folder, idempotent re-runs, that only `fabled`-tagged actors are
deleted, and the single PlayerStart.

The fake is a test double. It was written from the same memory of the API as the scripts, so the two can be wrong in
the same way. When a real run disagrees with it, fix the script, then change the fake to match what the engine did.

| Path | What |
|---|---|
| `fake_unreal/unreal.py` | The fake `unreal` module (test double; never loaded inside a real editor). |
| `fixtures/sequencer_plan.lantern_keeper.json` | Output of `sequencerPlan()` in `../film/breakdown.mjs` for `../samples/the_lantern_keeper.fountain`. |
| `fixtures/blockout_plan.mossgate.json` | Output of `blockoutPlan()` in `../game/kit.mjs` for `../samples/mossgate_pitch.txt`. |
| `fixtures/sequencer_plan.tiny_v1.json`, `fixtures/sequencer_plan.tiny_v2.json`, `fixtures/blockout_plan.tiny.json` | Hand-written, so the tests do not depend on the exporters. |

To refresh the two generated fixtures after an exporter change (run from `fabled/demos/`):

```
node -e "import('./film/breakdown.mjs').then(async m=>{const fs=await import('node:fs');const bd=m.breakdown(fs.readFileSync('samples/the_lantern_keeper.fountain','utf8'),{title:'The Lantern Keeper'});fs.writeFileSync('unreal/fixtures/sequencer_plan.lantern_keeper.json',JSON.stringify(m.sequencerPlan(bd),null,1)+'\n')})"
node -e "import('./game/kit.mjs').then(async m=>{const fs=await import('node:fs');const kit=m.buildKit(fs.readFileSync('samples/mossgate_pitch.txt','utf8'),{title:'Mossgate'});fs.writeFileSync('unreal/fixtures/blockout_plan.mossgate.json',JSON.stringify(m.blockoutPlan(kit,m.starterLayout(kit)),null,1)+'\n')})"
```
