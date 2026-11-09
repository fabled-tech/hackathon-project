"""Fabled Forge -> Unreal level blockout builder.

STATUS: UNTESTED DRAFT / UNTESTED IN ENGINE.
    This script has never been executed inside Unreal Editor (there is no editor on the build box and Epic's
    documentation hosts were not reachable while it was written). It passes tools/test_unreal_scripts.py, which
    runs it against fake_unreal/unreal.py, a hand-written test double. That proves the script's own logic and data
    flow (validation, box scale, pivot compensation, what gets deleted on a re-run). It does NOT prove that the real
    engine accepts these calls. Keep this label until someone has run it in UE and checked the result (README.md
    in this folder has the first-run checklist).

What it does
    Reads a `fabled.blockout_plan/0.1` JSON exported by the Fabled Forge workspace and spawns one StaticMeshActor
    per placed item in the level that is open in the editor:
      * if a Static Mesh exists at the item's `mesh_path` (or at the importer's default location, e.g.
        /Game/Fabled/Crate/SM_Crate for a plan path of /Game/Fabled/SM_Crate/SM_Crate; see mesh_candidates) the
        actor uses it, at the item's uniform scale, with the actor placed exactly at the item's location (real
        meshes are expected to have a base pivot);
      * otherwise the actor is the engine's 100 cm cube scaled to `placeholder_box_cm` x scale and lifted by half
        its height, because the cube's pivot is at its centre and the plan's location is the base centre.
    Every actor goes in one World Outliner folder and is tagged `fabled`, `fabled:<category>` and, for boxes,
    `fabled:placeholder`. One PlayerStart (tagged `fabled`, `fabled:playerstart`) is placed at the plan's spawn
    point, raised by its capsule half height and turned to the plan's yaw.
    Re-running replaces the script's own previous output: only actors that are in the folder AND tagged `fabled`
    are deleted. Anything else in that folder is left alone. The PlayerStart is moved, never duplicated.
    Nothing is saved: the level is left modified for you to review and save (unless you pass --save-level).
    Placeholder boxes use the cube's default material; per-category colours are not implemented (use the tags).

Run (two ways)
    Editor, Output Log (Cmd dropdown, or `py` prefix), with the target level open:
        py "C:/path/blockout_from_layout.py" --plan "C:/path/blockout_plan.json" --folder Fabled/Blockout
    Headless commandlet (a commandlet opens no level, so name one, and ask for it to be saved or the work is lost):
        UnrealEditor-Cmd.exe "C:/Proj/Proj.uproject" -run=pythonscript -script="C:/path/blockout_from_layout.py --plan C:/path/blockout_plan.json --map /Game/Maps/Blockout --save-level"
        (macOS: /Users/Shared/Epic\\ Games/UE_5.x/Engine/Binaries/Mac/UnrealEditor-Cmd, same arguments)
    Plain Python outside Unreal can only validate a plan:
        python3 blockout_from_layout.py --plan blockout_plan.json --dry-run

Plugins to enable (Edit > Plugins, then restart)
    Python Editor Script Plugin, Editor Scripting Utilities.

Options
    --plan PATH       blockout_plan.json (required)
    --folder PATH     World Outliner folder for the actors (default Fabled/Blockout)
    --overwrite       (default) delete this script's previous actors in the folder, then spawn the whole plan
    --keep            delete nothing; spawn only plan items whose label is not already in the folder
    --dry-run         validate the plan and log what would be deleted and spawned; change nothing
    --map /Game/...   load this level first (needed headless; in the editor it replaces the open level)
    --save-level      save the current level when done (off by default: nothing is saved automatically)

Most likely to need adjusting on first run, most likely first (none of these has been seen working)
    1. Headless use: `LevelEditorSubsystem.load_level` / `save_current_level` inside a -run=pythonscript
       commandlet, and whether actor spawning works there at all. The in-editor path is the safer one.
    2. `actor.set_editor_property("tags", [...])` and reading `tags` back (drives what a re-run deletes), and
       `actor.get_folder_path()` returning the folder as written ("Fabled/Blockout").
    3. PlayerStart capsule: `get_component_by_class(unreal.CapsuleComponent)` and
       `get_scaled_capsule_half_height()`; falls back to 92 cm (APlayerStart's capsule half height, from memory).
    4. `actor.static_mesh_component.set_static_mesh(mesh)` on a freshly spawned StaticMeshActor (mobility Static;
       fine in an editor world) and `EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")`.
    5. `EditorActorSubsystem.spawn_actor_from_class(cls, location, rotation)` / `destroy_actor`, and
       `set_actor_location_and_rotation(location, rotation, sweep, teleport)`.
    `unreal.Rotator` is always built with keywords (roll=, pitch=, yaw=): its positional order is not pitch/yaw/roll.
    The script ends with an "API report" log line. Send that line and the first error from the Output Log when
    reporting a failure.

Follow-up (not in this draft): drive the same plan into a *running* editor over the Remote Control API
(HTTP on port 30010, `PUT /remote/object/call` on an EditorActorSubsystem) so a browser session can place actors live.

Everything runs synchronously on the game thread (UE 5.6+ asserts on editor scripting from other threads); no
threads, timers or network access are used.
"""
import argparse
import json
import math
import re
import sys
import traceback

try:
    import unreal  # type: ignore
except ImportError:  # plain Python: only --dry-run (plan validation) is possible
    unreal = None

SCHEMA = "fabled.blockout_plan/0.1"
MIN_ENGINE = (5, 4)
CUBE_PATH = "/Engine/BasicShapes/Cube"   # 100 cm cube, pivot at its centre
CUBE_CM = 100.0
PLAYER_START_HALF_HEIGHT_CM = 92.0       # APlayerStart capsule half height (from memory); the real value is read back
PLAYER_START_LABEL = "PlayerStart_Fabled"
TAG_FABLED = "fabled"
TAG_PLACEHOLDER = "fabled:placeholder"
TAG_PLAYER_START = "fabled:playerstart"
DEFAULT_FOLDER = "Fabled/Blockout"

EXIT_OK, EXIT_FAILED, EXIT_INVALID, EXIT_CANCELLED = 0, 1, 2, 3


class FabledError(Exception):
    """A problem the user can act on; logged without a traceback."""


# ----------------------------------------------------------------------------------------------- logging

def log(msg):
    if unreal is not None:
        unreal.log(f"[Fabled] {msg}")
    else:
        print(f"[Fabled] {msg}")


def warn(msg):
    if unreal is not None:
        unreal.log_warning(f"[Fabled] {msg}")
    else:
        print(f"[Fabled] WARNING: {msg}")


def error(msg):
    if unreal is not None:
        unreal.log_error(f"[Fabled] {msg}")
    else:
        print(f"[Fabled] ERROR: {msg}", file=sys.stderr)


def check_engine_version():
    """Log the engine version and warn when it is older than MIN_ENGINE. Returns (major, minor) or None."""
    if unreal is None:
        log("no `unreal` module: running in plain Python, only --dry-run plan validation is available")
        return None
    if getattr(unreal, "__fabled_fake__", False):
        warn("this is the FAKE `unreal` test double (fake_unreal/unreal.py), not Unreal Engine")
    try:
        text = str(unreal.SystemLibrary.get_engine_version())
    except Exception as exc:  # noqa: BLE001
        warn(f"could not read the engine version ({exc}); continuing")
        return None
    match = re.match(r"\s*(\d+)\.(\d+)", text)
    version = (int(match.group(1)), int(match.group(2))) if match else None
    log(f"engine version: {text}")
    if version is None:
        warn("engine version string not understood; continuing")
    elif version < MIN_ENGINE:
        warn(f"engine {version[0]}.{version[1]} is older than {MIN_ENGINE[0]}.{MIN_ENGINE[1]}: this script targets "
             "5.4-5.8 and some editor scripting names differ on older engines")
    return version


# ----------------------------------------------------------------------------------------------- validation

def _is_num(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _check_fields(obj, key, fields, where, errors, positive=False):
    group = obj.get(key)
    if not isinstance(group, dict):
        errors.append(f"{where}: {key} must be an object with numeric {', '.join(fields)}")
        return None
    bad = [f for f in fields if not _is_num(group.get(f))]
    if bad:
        errors.append(f"{where}: {key}.{'/'.join(bad)} must be finite numbers")
        return None
    if positive and any(group[f] <= 0 for f in fields):
        errors.append(f"{where}: {key} values must all be greater than 0")
        return None
    return group


def validate_plan(plan):
    """Check the whole plan and return (errors, warnings). Nothing is changed unless errors is empty."""
    errors, warnings = [], []
    if not isinstance(plan, dict):
        return ["plan: the JSON root must be an object"], warnings
    if plan.get("schema") != SCHEMA:
        errors.append(f"schema: expected {SCHEMA!r}, found {plan.get('schema')!r}")

    spawn = plan.get("spawn")
    if spawn is None:
        warnings.append("spawn: missing, so no PlayerStart will be placed")
    elif not isinstance(spawn, dict) or any(not _is_num(spawn.get(k)) for k in ("x", "y", "z")):
        errors.append("spawn: must be an object with numeric x, y, z (and optional yaw)")
    elif "yaw" in spawn and not _is_num(spawn["yaw"]):
        errors.append(f"spawn: yaw must be a number, found {spawn['yaw']!r}")
    if "grid_cm" in plan and plan["grid_cm"] is not None and (not _is_num(plan["grid_cm"]) or plan["grid_cm"] <= 0):
        errors.append(f"grid_cm: must be a positive number, found {plan['grid_cm']!r}")

    actors = plan.get("actors")
    if not isinstance(actors, list):
        errors.append("actors: expected a list")
        return errors, warnings
    if not actors:
        warnings.append("actors: the list is empty, so nothing will be spawned")
    seen = set()
    for i, item in enumerate(actors):
        if not isinstance(item, dict):
            errors.append(f"actors[{i}]: must be an object")
            continue
        label = item.get("label")
        where = f"actors[{i}]" + (f" ({label})" if isinstance(label, str) and label else "")
        if not isinstance(label, str) or not label.strip():
            errors.append(f"{where}: label must be a non-empty string")
        elif label in seen:
            warnings.append(f"{where}: duplicate label (with --keep only the first one is matched)")
        else:
            seen.add(label)
        mesh_path = item.get("mesh_path")
        if not isinstance(mesh_path, str) or not re.fullmatch(r"(/[^/]+){2,}", mesh_path):
            errors.append(f"{where}: mesh_path must be a content path like /Game/Fabled/Crate/Crate, found {mesh_path!r}")
        if "imported" in item and not isinstance(item["imported"], bool):
            errors.append(f"{where}: imported must be true or false")
        _check_fields(item, "location", ("x", "y", "z"), where, errors)
        _check_fields(item, "rotation", ("pitch", "yaw", "roll"), where, errors)
        _check_fields(item, "placeholder_box_cm", ("x", "y", "z"), where, errors, positive=True)
        scale = item.get("scale")
        if not _is_num(scale) or scale <= 0:
            errors.append(f"{where}: scale must be a number greater than 0, found {scale!r}")
        if not isinstance(item.get("category"), str) or not item["category"].strip():
            errors.append(f"{where}: category must be a non-empty string")
    return errors, warnings


def load_plan(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except OSError as exc:
        raise FabledError(f"cannot read plan {path!r}: {exc.strerror or exc}") from exc
    except ValueError as exc:
        raise FabledError(f"plan {path!r} is not valid JSON: {exc}") from exc


# ----------------------------------------------------------------------------------------------- maths

def placeholder_scale(item):
    """Actor scale that turns the 100 cm cube into the item's budgeted box, times the item's own scale."""
    box, s = item["placeholder_box_cm"], float(item["scale"])
    return (box["x"] / CUBE_CM * s, box["y"] / CUBE_CM * s, box["z"] / CUBE_CM * s)


def placeholder_location(item):
    """Where the cube's centre must be so that the box's base centre sits on the item's location.

    The plan's location is a base pivot; the cube's pivot is its centre, half the (scaled) height above the base
    along the actor's own up axis. For an untilted item that is simply +Z. The up axis for pitch/yaw/roll is the
    Z row of Unreal's FRotationMatrix.
    """
    loc, rot = item["location"], item["rotation"]
    half = item["placeholder_box_cm"]["z"] * float(item["scale"]) / 2.0
    pitch, yaw, roll = (math.radians(float(rot[k])) for k in ("pitch", "yaw", "roll"))
    sp, cp, sy, cy, sr, cr = math.sin(pitch), math.cos(pitch), math.sin(yaw), math.cos(yaw), math.sin(roll), math.cos(roll)
    up = (-(cr * sp * cy + sr * sy), cy * sr - cr * sp * sy, cr * cp)
    return (loc["x"] + up[0] * half, loc["y"] + up[1] * half, loc["z"] + up[2] * half)


def mesh_candidates(mesh_path):
    """Content paths to try for an item: the plan's path first, then where ../../unreal/import_fabled_asset.py puts
    a mesh when run with its defaults (/Game/Fabled/<Source>/SM_<Source>), which is not the plan's path."""
    folder, _, name = mesh_path.rpartition("/")
    if not name.startswith("SM_"):
        return [mesh_path, f"{folder}/SM_{name}"]
    parent, _, leaf = folder.rpartition("/")
    return [mesh_path, f"{parent}/{name[3:]}/{name}"] if leaf == name and len(name) > 3 else [mesh_path]


def normalize_folder(folder):
    return str(folder).replace("\\", "/").strip("/ ")


# ----------------------------------------------------------------------------------------------- engine helpers

def _folder_of(actor):
    try:
        path = actor.get_folder_path()
    except Exception:  # noqa: BLE001
        return ""
    text = "" if path is None else str(path)
    return "" if text == "None" else normalize_folder(text)


def _tags(actor):
    for getter in (lambda: actor.get_editor_property("tags"), lambda: actor.tags):
        try:
            return [str(tag) for tag in getter()]
        except Exception:  # noqa: BLE001
            continue
    return []


def _set_tags(actor, tags):
    actor.set_editor_property("tags", [unreal.Name(tag) for tag in tags])


def _is_ours(actor, folder):
    """Only actors this script made: inside the folder AND tagged `fabled`."""
    return _folder_of(actor) == folder and TAG_FABLED in _tags(actor)


def _is_player_start(actor):
    return isinstance(actor, unreal.PlayerStart)


def _static_mesh_component(actor):
    component = getattr(actor, "static_mesh_component", None)
    if component is None:
        component = actor.get_component_by_class(unreal.StaticMeshComponent)
    if component is None:
        raise FabledError(f"{type(actor).__name__} has no StaticMeshComponent")
    return component


def _assign_mesh(component, mesh):
    fn = getattr(component, "set_static_mesh", None)
    if callable(fn):
        fn(mesh)
    else:
        component.set_editor_property("static_mesh", mesh)


def _rotator(pitch=0.0, yaw=0.0, roll=0.0):
    # Keywords on purpose: unreal.Rotator's positional order is (roll, pitch, yaw), not (pitch, yaw, roll).
    return unreal.Rotator(roll=float(roll), pitch=float(pitch), yaw=float(yaw))


class _Build:
    def __init__(self, folder):
        self.folder = folder
        self.actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        self.meshes = {}      # mesh_path -> (StaticMesh or None, resolved path or None)
        self.cube = None
        self.report = {}

    def note(self, feature, variant):
        self.report.setdefault(feature, set()).add(variant)

    def report_line(self):
        return "; ".join(f"{k}={'|'.join(sorted(v))}" for k, v in sorted(self.report.items()))


def find_mesh_path(mesh_path):
    """First candidate path that exists in the project, or None. Does not load anything."""
    for candidate in mesh_candidates(mesh_path):
        if unreal.EditorAssetLibrary.does_asset_exist(candidate):
            return candidate
    return None


def _resolve_mesh(build, item):
    mesh_path = item["mesh_path"]
    if mesh_path not in build.meshes:
        found, mesh = find_mesh_path(mesh_path), None
        if found:
            asset = unreal.EditorAssetLibrary.load_asset(found)
            if isinstance(asset, unreal.StaticMesh):
                mesh = asset
            else:
                warn(f"{found} exists but is a {type(asset).__name__}, not a Static Mesh; using a placeholder box")
                found = None
        build.meshes[mesh_path] = (mesh, found)
    mesh, found = build.meshes[mesh_path]
    if mesh is None and item.get("imported"):
        warn(f"{item['label']}: the plan says this asset is imported but no Static Mesh was found at "
             f"{' or '.join(mesh_candidates(mesh_path))}; using a placeholder box")
    return mesh


def _cube(build):
    if build.cube is None:
        build.cube = unreal.EditorAssetLibrary.load_asset(CUBE_PATH)
        if build.cube is None:
            raise FabledError(f"could not load the engine cube {CUBE_PATH} for placeholder boxes")
    return build.cube


def _spawn_item(build, item):
    """Spawn one plan item. Returns True when it used a real mesh, False for a placeholder box."""
    mesh = _resolve_mesh(build, item)
    loc, rot, s = item["location"], item["rotation"], float(item["scale"])
    tags = [TAG_FABLED, f"fabled:{item['category'].strip()}"]
    if mesh is not None:
        position, scale = (loc["x"], loc["y"], loc["z"]), (s, s, s)   # real meshes keep their base pivot
    else:
        mesh = _cube(build)
        position, scale = placeholder_location(item), placeholder_scale(item)  # centred pivot: lift by half height
        tags.append(TAG_PLACEHOLDER)
    # A StaticMeshActor spawned from the class has mobility Static and no mesh; assigning the mesh afterwards is
    # allowed in an editor world (the Static-mobility guard in SetStaticMesh only applies once play has begun).
    actor = build.actors.spawn_actor_from_class(
        unreal.StaticMeshActor, unreal.Vector(float(position[0]), float(position[1]), float(position[2])),
        _rotator(pitch=rot["pitch"], yaw=rot["yaw"], roll=rot["roll"]))
    if actor is None:
        raise FabledError(f"{item['label']}: the editor did not spawn a StaticMeshActor (is a level open?)")
    _assign_mesh(_static_mesh_component(actor), mesh)
    actor.set_actor_scale3d(unreal.Vector(float(scale[0]), float(scale[1]), float(scale[2])))
    actor.set_actor_label(item["label"])
    actor.set_folder_path(build.folder)
    _set_tags(actor, tags)
    return TAG_PLACEHOLDER not in tags


def _capsule_half_height(player_start):
    try:
        capsule = player_start.get_component_by_class(unreal.CapsuleComponent)
        value = float(capsule.get_scaled_capsule_half_height())
        return value if value > 0 else None
    except Exception:  # noqa: BLE001
        return None


def _ensure_player_start(build, spawn, level_actors):
    """Exactly one Fabled PlayerStart: reuse (move) the existing one, otherwise spawn it. Its origin is the capsule
    centre, so it sits half a capsule above the plan's spawn point (which is on the floor)."""
    yaw = float(spawn.get("yaw", 0.0) or 0.0)
    rotation = _rotator(yaw=yaw)
    ours = [a for a in level_actors if _is_player_start(a) and _is_ours(a, build.folder)]
    for extra in ours[1:]:
        build.actors.destroy_actor(extra)
    if ours:
        player_start = ours[0]
        build.note("player_start", "moved existing")
    else:
        player_start = build.actors.spawn_actor_from_class(
            unreal.PlayerStart, unreal.Vector(float(spawn["x"]), float(spawn["y"]), float(spawn["z"]) + PLAYER_START_HALF_HEIGHT_CM), rotation)
        if player_start is None:
            raise FabledError("the editor did not spawn a PlayerStart (is a level open?)")
        build.note("player_start", "spawned")
    half = _capsule_half_height(player_start)
    build.note("capsule_half_height", "read from capsule" if half is not None else f"default {PLAYER_START_HALF_HEIGHT_CM:g}")
    half = half if half is not None else PLAYER_START_HALF_HEIGHT_CM
    player_start.set_actor_location_and_rotation(
        unreal.Vector(float(spawn["x"]), float(spawn["y"]), float(spawn["z"]) + half), rotation, False, True)
    player_start.set_actor_label(PLAYER_START_LABEL)
    player_start.set_folder_path(build.folder)
    _set_tags(player_start, [TAG_FABLED, TAG_PLAYER_START])
    others = sum(1 for a in level_actors if _is_player_start(a) and a not in ours)
    if others:
        log(f"note: the level has {others} other PlayerStart(s); the game mode chooses which one is used")
    return player_start


def _require_level(map_path):
    """Load --map when given, then make sure an editor world exists."""
    if map_path:
        if not unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).load_level(map_path):
            raise FabledError(f"could not load the level {map_path}")
        log(f"loaded level {map_path}")
    try:
        world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    except Exception:  # noqa: BLE001  (cannot tell on this engine version; let the spawn calls decide)
        return
    if world is None:
        raise FabledError("no level is open. Open one in the editor, or pass --map /Game/... when running headless.")


def build_blockout(plan, folder, keep=False, map_path=None, save_level=False):
    """Spawn the actors of an already-validated plan. Returns an exit code."""
    folder = normalize_folder(folder)
    _require_level(map_path)
    build = _Build(folder)
    items = plan["actors"]
    spawned = real = skipped = deleted = 0
    cancelled = False

    with unreal.ScopedEditorTransaction("Fabled: level blockout from layout"):
        level_actors = list(build.actors.get_all_level_actors())
        ours = [a for a in level_actors if _is_ours(a, folder)]
        foreign = sum(1 for a in level_actors if _folder_of(a) == folder and a not in ours)
        existing_labels = set()
        if keep:
            existing_labels = {str(a.get_actor_label()) for a in ours if not _is_player_start(a)}
        else:
            for actor in ours:
                if _is_player_start(actor):
                    continue  # moved in place below, so there is never a second one
                build.actors.destroy_actor(actor)
                deleted += 1
        if foreign:
            log(f"left {foreign} actor(s) in '{folder}' untouched (not tagged '{TAG_FABLED}', so not made by this script)")

        with unreal.ScopedSlowTask(len(items) + 1, "Fabled: spawning blockout actors") as task:
            task.make_dialog(True)
            for item in items:
                if task.should_cancel():
                    cancelled = True
                    break
                task.enter_progress_frame(1, f"Fabled: {item['label']}")
                if item["label"] in existing_labels:
                    skipped += 1
                    continue
                if _spawn_item(build, item):
                    real += 1
                spawned += 1
                if keep:
                    existing_labels.add(item["label"])  # a duplicate label later in the plan is skipped too
            task.enter_progress_frame(1, "Fabled: player start")
            if plan.get("spawn") and not cancelled:
                survivors = [a for a in level_actors if keep or a not in ours or _is_player_start(a)]
                _ensure_player_start(build, plan["spawn"], survivors)

    mode = "--keep" if keep else "--overwrite"
    log(f"API report: {build.report_line()}")
    log(f"{mode}: deleted {deleted} previous actor(s), spawned {spawned} in '{folder}' "
        f"({real} real meshes, {spawned - real} placeholder boxes), skipped {skipped} already present")
    if save_level:
        if not unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level():
            warn("--save-level: the level could not be saved; save it by hand")
        else:
            log("--save-level: saved the current level")
    else:
        log("nothing was saved: the level is modified, review it and save it yourself (Ctrl+Z undoes the blockout)")
    if cancelled:
        warn(f"cancelled after {spawned + skipped} of {len(items)} items: the blockout is incomplete; re-run to finish it")
        return EXIT_CANCELLED
    log(f"done: {plan.get('title') or 'blockout'}")
    return EXIT_OK


def describe(plan, folder, keep, map_path):
    """Log what a run would do (used by --dry-run). Reads the project and level when available; changes nothing."""
    folder = normalize_folder(folder)
    items = plan["actors"]
    existing_labels, ours, foreign, have_level = set(), [], 0, False
    if unreal is not None and map_path:
        log(f"dry run: would load level {map_path} first (not loaded now, so the current level is not inspected)")
    elif unreal is not None:
        try:
            level_actors = list(unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors())
            ours = [a for a in level_actors if _is_ours(a, folder)]
            foreign = sum(1 for a in level_actors if _folder_of(a) == folder and a not in ours)
            existing_labels = {str(a.get_actor_label()) for a in ours if not _is_player_start(a)}
            have_level = True
        except Exception as exc:  # noqa: BLE001
            warn(f"dry run: could not inspect the open level ({exc})")
    if have_level:
        previous = sum(1 for a in ours if not _is_player_start(a))
        log(f"dry run: '{folder}' holds {previous} actor(s) from a previous run and {foreign} other actor(s); "
            + ("--keep would delete nothing" if keep else f"--overwrite would delete those {previous} and leave the {foreign} alone"))
    real = boxes = skipped = 0
    for item in items:
        if keep and item["label"] in existing_labels:
            skipped += 1
            continue
        found = None
        if unreal is not None:
            try:
                found = find_mesh_path(item["mesh_path"])
            except Exception:  # noqa: BLE001
                found = None
        if found:
            real += 1
            loc = item["location"]
            log(f"dry run: {item['label']} [{item['category']}] mesh {found} at ({loc['x']:g}, {loc['y']:g}, {loc['z']:g}) "
                f"yaw {item['rotation']['yaw']:g} scale {item['scale']:g}")
        else:
            boxes += 1
            pos, scale = placeholder_location(item), placeholder_scale(item)
            log(f"dry run: {item['label']} [{item['category']}] placeholder box at ({pos[0]:g}, {pos[1]:g}, {pos[2]:g}) "
                f"yaw {item['rotation']['yaw']:g} cube scale ({scale[0]:g}, {scale[1]:g}, {scale[2]:g})")
    spawn = plan.get("spawn")
    if spawn:
        log(f"dry run: PlayerStart at ({spawn['x']:g}, {spawn['y']:g}, {spawn['z'] + PLAYER_START_HALF_HEIGHT_CM:g}) yaw {spawn.get('yaw', 0) or 0:g}")
    suffix = "" if unreal is not None else " (no engine here: every item is listed as a box; mesh lookups need Unreal)"
    log(f"dry run: would spawn {real + boxes} actor(s) in '{folder}': {real} real meshes, {boxes} placeholder boxes, "
        f"{skipped} skipped{suffix}")


# ----------------------------------------------------------------------------------------------- entry point

class _ArgumentError(Exception):
    def __init__(self, message="", status=EXIT_INVALID):
        super().__init__(message)
        self.status = status


class _Parser(argparse.ArgumentParser):
    """argparse that raises instead of calling sys.exit(), so a typo or --help cannot take the editor process down."""

    def error(self, message):
        raise _ArgumentError(f"{message}\n{self.format_usage().strip()}")

    def exit(self, status=0, message=None):  # reached by --help (status 0) after the help text was printed
        raise _ArgumentError(message.strip() if message else "", EXIT_OK if status == 0 else EXIT_INVALID)


def parse_args(argv):
    ap = _Parser(prog="blockout_from_layout.py", description="Spawn a level blockout from a Fabled blockout plan.")
    ap.add_argument("--plan", required=True, help="path to blockout_plan.json")
    ap.add_argument("--folder", default=DEFAULT_FOLDER, help=f"World Outliner folder (default {DEFAULT_FOLDER})")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--overwrite", action="store_true", help="(default) replace this script's previous actors in the folder")
    mode.add_argument("--keep", action="store_true", help="delete nothing; only spawn items whose label is missing")
    ap.add_argument("--dry-run", action="store_true", help="validate and log what would happen; change nothing")
    ap.add_argument("--map", default=None, help="level to load first, e.g. /Game/Maps/Blockout (needed headless)")
    ap.add_argument("--save-level", action="store_true", help="save the current level afterwards (off by default)")
    return ap.parse_args(argv)


def main(argv=None):
    """Entry point for `py "<script>" --plan ...`, for `-run=pythonscript -script="<script> --plan ..."`, and for
    the tests. Returns an exit code: 0 done (or dry run fine), 1 build failed, 2 bad arguments or plan, 3 cancelled."""
    try:
        args = parse_args(sys.argv[1:] if argv is None else list(argv))
    except _ArgumentError as exc:
        if str(exc):
            error(str(exc))
        return exc.status

    check_engine_version()
    try:
        plan = load_plan(args.plan)
    except FabledError as exc:
        error(str(exc))
        return EXIT_INVALID

    errors, warnings = validate_plan(plan)
    if not normalize_folder(args.folder):
        errors.append("--folder must not be empty")
    if args.map is not None and not re.fullmatch(r"(/[A-Za-z0-9_\-]+)+", args.map):
        errors.append(f"--map {args.map!r} is not a content path like /Game/Maps/Blockout")
    for message in warnings:
        warn(message)
    if errors:
        error(f"{args.plan}: {len(errors)} problem(s); nothing was changed:")
        for message in errors:
            error(f"  - {message}")
        return EXIT_INVALID

    if args.dry_run:
        describe(plan, args.folder, args.keep, args.map)
        log("dry run: nothing was changed")
        return EXIT_OK
    if unreal is None:
        error("the `unreal` module is not available: run this inside Unreal Editor (see the header), or add --dry-run")
        return EXIT_FAILED

    try:
        return build_blockout(plan, args.folder, keep=args.keep, map_path=args.map, save_level=args.save_level)
    except FabledError as exc:
        error(str(exc))
        return EXIT_FAILED
    except Exception as exc:  # noqa: BLE001
        error(f"blockout failed: {type(exc).__name__}: {exc}")
        error(traceback.format_exc())
        error("the level may hold part of the blockout; undo (Ctrl+Z) or re-run after fixing the cause. "
              "Please report the lines above (UNTESTED IN ENGINE script).")
        return EXIT_FAILED


if __name__ == "__main__":
    _code = main()
    if _code != EXIT_OK:
        # Raise (not sys.exit) so a headless -run=pythonscript run reports failure without killing an interactive editor.
        raise RuntimeError(f"[Fabled] blockout_from_layout.py failed (exit code {_code}); see the [Fabled] errors above")
