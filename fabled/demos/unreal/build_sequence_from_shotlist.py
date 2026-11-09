"""Fabled Shots -> Unreal Sequencer builder.

STATUS: UNTESTED DRAFT / UNTESTED IN ENGINE.
    This script has never been executed inside Unreal Editor (there is no editor on the build box and Epic's
    documentation hosts were not reachable while it was written). It passes tools/test_unreal_scripts.py, which
    runs it against fake_unreal/unreal.py, a hand-written test double. That proves the script's own logic and data
    flow (validation, frame maths, look-at maths, which track gets which key). It does NOT prove that the real
    engine accepts these calls. Keep this label until someone has run it in UE and checked the result (README.md
    in this folder has the first-run checklist).

What it does
    Reads a `fabled.sequencer_plan/0.1` JSON exported by the Fabled Shots workspace and builds one Level Sequence:
      * one spawnable CineCameraActor per shot, named CAM_<shot id>
      * a transform track with two linear keys (start and end of the move), each aimed at the shot's look_at point
      * a CurrentFocalLength key on the camera component binding
      * one Camera Cut section per shot, covering [start_frame, end_frame) and bound to that shot's camera
      * display rate = plan fps, playback range = [0, total_frames)
    Plan versions: v1 (no `plan_version`; stage-relative coordinates around the origin) and v2 (`plan_version: 2`;
    absolute world coordinates, `location` and `stage_origin` per shot, top-level `stages`). Coordinates are used
    as written in both; with v2 the cameras are also grouped into one Sequencer folder per location.

Run (two ways)
    Editor, Output Log (Cmd dropdown, or `py` prefix):
        py "C:/path/build_sequence_from_shotlist.py" --plan "C:/path/sequencer_plan.json" --dest /Game/Fabled/Previs
    Headless commandlet (no editor UI; uses the low-level camera path, see "Most likely to need adjusting" 2):
        UnrealEditor-Cmd.exe "C:/Proj/Proj.uproject" -run=pythonscript -script="C:/path/build_sequence_from_shotlist.py --plan C:/path/sequencer_plan.json"
        (macOS: /Users/Shared/Epic\\ Games/UE_5.x/Engine/Binaries/Mac/UnrealEditor-Cmd, same arguments)
    Plain Python outside Unreal can only validate a plan:
        python3 build_sequence_from_shotlist.py --plan sequencer_plan.json --dry-run

Plugins to enable (Edit > Plugins, then restart)
    Python Editor Script Plugin, Sequencer Scripting, Editor Scripting Utilities.

Options
    --plan PATH        sequencer_plan.json (required)
    --dest /Game/...   content folder for the Level Sequence (default /Game/Fabled/Previs)
    --name NAME        asset name (default LS_FabledPrevis, or LS_<title> when the plan has a title)
    --overwrite        delete an existing Level Sequence with the same dest/name and rebuild it.
                       Without it the script stops if the asset exists. It never deletes a non-LevelSequence asset.
    --dry-run          validate the plan and log what would be created; create nothing
    --no-save          leave the new asset unsaved (default: save the Level Sequence asset; nothing else is saved)
    --camera-api auto|subsystem|lowlevel
                       auto: LevelSequenceEditorSubsystem.create_camera when the editor UI is up, else low-level.
                       Use `lowlevel` to try the other path if `subsystem` misbehaves in your engine version.

Units, so nobody has to guess
    * Plan frames are display-rate frames (plan fps). end_frame is exclusive: a shot covers [start_frame, end_frame).
    * `set_playback_start/_end`, `section.set_range`, `set_start_frame/_end_frame` take display-rate frames as ints.
    * `channel.add_key(unreal.FrameNumber(n), value, time_unit=DISPLAY_RATE)` is passed display-rate frames, and the
      time unit is given explicitly. Nothing in this script works in tick resolution.
    * The end-of-move key sits at end_frame (the cut point), so the last rendered frame of a shot (end_frame - 1)
      is (n-1)/n of the way through the move. Per-camera sections are left open-ended so both keys are inside.
    * Positions are Unreal cm. Rotation: Unreal is left-handed, Z up, X forward. yaw = atan2(dy, dx) about Z,
      pitch = atan2(dz, hypot(dx, dy)) (positive looks up), roll = 0. Transform channel order is
      Location X,Y,Z then Rotation X (roll), Y (pitch), Z (yaw), then Scale X,Y,Z.
    * Only the two keys are aimed exactly at look_at. Between them rotation is interpolated linearly, so on a long
      lateral move the aim drifts slightly mid-shot. Bake more keys by hand if that matters.

Most likely to need adjusting on first run, most likely first (none of these has been seen working)
    1. `LevelSequenceEditorSubsystem.create_camera(spawnable=True)`: return shape (the code accepts a
       (binding, actor) tuple in either order, a lone binding or a lone actor) and whether it leaves a child
       "CameraComponent" binding with a CurrentFocalLength track. If it does not, the fallback is
       `sequence.add_possessable(component)` + `set_parent`, which is known to be flaky for spawnables.
    2. The low-level camera path (headless, or --camera-api lowlevel): `add_spawnable_from_instance`, the
       component possessable under a spawnable, and whether a headless commandlet has an editor world to spawn
       the temporary camera in. As a safety net the focal length is also written to the spawnable's template.
    3. Spawn lifetime, especially in 5.5+: the script looks for `MovieSceneSpawnTrack` and
       `MovieSceneBindingLifetimeTrack` on each camera and opens their sections to the whole sequence; if neither
       exists and the binding is a classic spawnable it adds a `MovieSceneSpawnTrack`. Class names are from memory.
    4. Camera cut binding: `sequence.get_binding_id(binding)` -> `section.set_camera_binding_id(id)`, falling back
       to `make_binding_id(binding, LOCAL)` and to `MovieSceneObjectBindingID` + `set_editor_property('guid', ...)`.
    5. `channel.add_key(..., time_unit=..., interpolation=...)` keyword names, the enum names
       (`MovieSceneTimeUnit` vs `SequenceTimeUnit`, `MovieSceneKeyInterpolation.LINEAR`), and the scripting
       channel's `channel_name` property used to pick Location/Rotation channels (falls back to index order).
    6. `--overwrite`: `EditorAssetLibrary.delete_asset` then `create_asset` with the same name in one session.
    7. Sequencer folders for v2 locations (`add_root_folder_to_sequence`, `add_child_object_binding`): cosmetic,
       failures are logged and skipped.
    The script ends with an "API report" log line saying which variant of each call it used. Send that line and
    the first error from the Output Log when reporting a failure.

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

SCHEMA = "fabled.sequencer_plan/0.1"
KNOWN_PLAN_VERSIONS = (1, 2)
MIN_ENGINE = (5, 4)
FOCAL_MIN_MM, FOCAL_MAX_MM = 4.0, 1200.0
DEFAULT_DEST = "/Game/Fabled/Previs"
DEFAULT_NAME = "LS_FabledPrevis"
# plan fps -> (numerator, denominator) for the rates that are not whole numbers
NTSC_RATES = {23.976: (24000, 1001), 23.98: (24000, 1001), 29.97: (30000, 1001), 59.94: (60000, 1001)}
XF_CHANNEL_NAMES = ("Location.X", "Location.Y", "Location.Z", "Rotation.X", "Rotation.Y", "Rotation.Z")

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
             "5.4-5.8 and several Sequencer scripting names differ on older engines")
    return version


# ----------------------------------------------------------------------------------------------- validation

def _is_num(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _is_int(value):
    return _is_num(value) and float(value).is_integer()


def _check_vec(obj, key, where, errors):
    vec = obj.get(key)
    if not isinstance(vec, dict):
        errors.append(f"{where}: {key} must be an object with numeric x, y, z")
        return None
    bad = [axis for axis in ("x", "y", "z") if not _is_num(vec.get(axis))]
    if bad:
        errors.append(f"{where}: {key}.{'/'.join(bad)} must be finite numbers")
        return None
    return vec


def frame_rate_parts(fps):
    """Plan fps -> (numerator, denominator), or None when the rate is not usable."""
    if not _is_num(fps) or fps <= 0 or fps > 1000:
        return None
    if _is_int(fps):
        return int(fps), 1
    return NTSC_RATES.get(round(float(fps), 3))


def validate_plan(plan):
    """Check the whole plan and return (errors, warnings). Nothing is created unless errors is empty."""
    errors, warnings = [], []
    if not isinstance(plan, dict):
        return ["plan: the JSON root must be an object"], warnings
    if plan.get("schema") != SCHEMA:
        errors.append(f"schema: expected {SCHEMA!r}, found {plan.get('schema')!r}")
    version = plan.get("plan_version", 1)
    if not _is_int(version) or version < 1:
        errors.append(f"plan_version: expected a positive integer, found {version!r}")
        version = 1
    elif int(version) not in KNOWN_PLAN_VERSIONS:
        warnings.append(f"plan_version {version} is newer than this script knows ({KNOWN_PLAN_VERSIONS}); "
                        "building from the fields it understands")
    version = int(version)

    if frame_rate_parts(plan.get("fps")) is None:
        errors.append(f"fps: expected a whole number (or 23.976 / 29.97 / 59.94), found {plan.get('fps')!r}")
    total = plan.get("total_frames")
    if not _is_int(total) or total <= 0:
        errors.append(f"total_frames: expected a positive integer, found {total!r}")
        total = None

    stage_names = None
    if version >= 2:
        stages = plan.get("stages")
        if not isinstance(stages, list):
            errors.append("stages: plan_version 2 needs a list of {location, origin}")
        else:
            stage_names = set()
            for i, stage in enumerate(stages):
                where = f"stages[{i}]"
                if not isinstance(stage, dict):
                    errors.append(f"{where}: must be an object")
                    continue
                if not isinstance(stage.get("location"), str) or not stage["location"].strip():
                    errors.append(f"{where}: location must be a non-empty string")
                else:
                    stage_names.add(stage["location"])
                _check_vec(stage, "origin", where, errors)

    shots = plan.get("shots")
    if not isinstance(shots, list) or not shots:
        errors.append("shots: expected a non-empty list")
        return errors, warnings

    seen_ids, ranges = set(), []
    for i, shot in enumerate(shots):
        if not isinstance(shot, dict):
            errors.append(f"shots[{i}]: must be an object")
            continue
        shot_id = shot.get("id")
        where = f"shots[{i}]" + (f" ({shot_id})" if isinstance(shot_id, str) and shot_id else "")
        if not isinstance(shot_id, str) or not shot_id.strip():
            errors.append(f"{where}: id must be a non-empty string")
        elif shot_id in seen_ids:
            errors.append(f"{where}: duplicate id")
        else:
            seen_ids.add(shot_id)

        start, end = shot.get("start_frame"), shot.get("end_frame")
        frames_ok = True
        if not _is_int(start) or start < 0:
            errors.append(f"{where}: start_frame must be an integer >= 0, found {start!r}")
            frames_ok = False
        if not _is_int(end):
            errors.append(f"{where}: end_frame must be an integer, found {end!r}")
            frames_ok = False
        if frames_ok and end <= start:
            errors.append(f"{where}: end_frame ({end}) must be greater than start_frame ({start})")
            frames_ok = False
        if frames_ok:
            ranges.append((int(start), int(end), where))

        focal = shot.get("focal_length_mm")
        if not _is_num(focal):
            errors.append(f"{where}: focal_length_mm must be a number, found {focal!r}")
        elif not FOCAL_MIN_MM <= focal <= FOCAL_MAX_MM:
            errors.append(f"{where}: focal_length_mm {focal} is outside {FOCAL_MIN_MM:g}-{FOCAL_MAX_MM:g} mm")

        cam_start = _check_vec(shot, "camera_start", where, errors)
        cam_end = _check_vec(shot, "camera_end", where, errors)
        target = _check_vec(shot, "look_at", where, errors)
        for key, cam in (("camera_start", cam_start), ("camera_end", cam_end)):
            if cam and target and all(cam[a] == target[a] for a in ("x", "y", "z")):
                errors.append(f"{where}: {key} is the same point as look_at, so there is no direction to aim")
        if "label" in shot and shot["label"] is not None and not isinstance(shot["label"], str):
            errors.append(f"{where}: label must be a string")

        if version >= 2:
            location = shot.get("location")
            if not isinstance(location, str) or not location.strip():
                errors.append(f"{where}: location must be a non-empty string (plan_version 2)")
            elif stage_names is not None and location not in stage_names:
                warnings.append(f"{where}: location {location!r} is not listed in stages")
            _check_vec(shot, "stage_origin", where, errors)

    ranges.sort()
    for (a_start, a_end, a_where), (b_start, b_end, b_where) in zip(ranges, ranges[1:]):
        if b_start < a_end:
            errors.append(f"{b_where}: frames {b_start}-{b_end} overlap {a_where} ({a_start}-{a_end})")
        elif b_start > a_end:
            warnings.append(f"gap: no shot covers frames {a_end}-{b_start} (between {a_where} and {b_where})")
    if ranges and total is not None:
        last_end = max(end for _, end, _ in ranges)
        if last_end > total:
            errors.append(f"total_frames is {total} but the last shot ends at frame {last_end}")
        elif last_end < total:
            warnings.append(f"total_frames is {total} but the last shot ends at frame {last_end}")
        if ranges[0][0] > 0:
            warnings.append(f"the first shot starts at frame {ranges[0][0]}, not 0")
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

def look_at_angles(cam, target):
    """(pitch, yaw) in degrees that point Unreal's +X (forward) from `cam` at `target`.

    Unreal: left-handed, Z up, X forward, Y right. Yaw turns about Z from +X towards +Y; positive pitch looks up.
    Same result as FVector::Rotation() / KismetMathLibrary::FindLookAtRotation. Roll is always 0.
    """
    dx, dy, dz = target["x"] - cam["x"], target["y"] - cam["y"], target["z"] - cam["z"]
    yaw = math.degrees(math.atan2(dy, dx))
    pitch = math.degrees(math.atan2(dz, math.hypot(dx, dy)))
    return pitch, yaw


def unwind_towards(angle, reference):
    """Shift `angle` by whole turns so it is within 180 degrees of `reference` (keeps a linear key pair on the
    short way round, e.g. 170 -> 190 instead of 170 -> -170)."""
    return reference + ((angle - reference + 180.0) % 360.0 - 180.0)


def shot_keys(shot):
    """The two transform keys of a shot: [(frame, (x, y, z), (roll, pitch, yaw)), ...] using the pure-Python maths."""
    start_pitch, start_yaw = look_at_angles(shot["camera_start"], shot["look_at"])
    end_pitch, end_yaw = look_at_angles(shot["camera_end"], shot["look_at"])
    end_yaw = unwind_towards(end_yaw, start_yaw)
    pos = lambda p: (float(p["x"]), float(p["y"]), float(p["z"]))  # noqa: E731
    return [(int(shot["start_frame"]), pos(shot["camera_start"]), (0.0, start_pitch, start_yaw)),
            (int(shot["end_frame"]), pos(shot["camera_end"]), (0.0, end_pitch, end_yaw))]


def sanitize_asset_name(text):
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "", str(text).title().replace(" ", ""))
    return cleaned or "FabledPrevis"


# ----------------------------------------------------------------------------------------------- engine helpers

def _call_first(obj, names, *args):
    """Call the first method in `names` that exists on obj (Epic renamed several of these between 5.0 and 5.4)."""
    for name in names:
        fn = getattr(obj, name, None)
        if callable(fn):
            return fn(*args), name
    raise FabledError(f"{type(obj).__name__} has none of: {', '.join(names)}")


def _guid_key(guid):
    """A hashable value for an unreal.Guid (its str() can include a memory address, so do not use that)."""
    fn = getattr(guid, "to_string", None)
    if callable(fn):
        return str(fn())
    try:
        return (guid.a, guid.b, guid.c, guid.d)
    except Exception:  # noqa: BLE001
        return str(guid)


def _binding_valid(binding):
    if binding is None:
        return False
    fn = getattr(binding, "is_valid", None)
    try:
        return bool(fn()) if callable(fn) else True
    except Exception:  # noqa: BLE001
        return False


def _time_unit():
    """DISPLAY_RATE of whichever enum this engine has (MovieSceneTimeUnit in 5.x, SequenceTimeUnit before)."""
    for enum_name in ("MovieSceneTimeUnit", "SequenceTimeUnit"):
        enum = getattr(unreal, enum_name, None)
        if enum is not None and hasattr(enum, "DISPLAY_RATE"):
            return enum.DISPLAY_RATE
    return None


def _interpolation(linear):
    enum = getattr(unreal, "MovieSceneKeyInterpolation", None)
    return getattr(enum, "LINEAR" if linear else "CONSTANT", None) if enum is not None else None


def _add_key(channel, frame, value, linear=True):
    """Key `value` at display-rate frame `frame`. The time unit is passed explicitly (display rate, not ticks)."""
    kwargs = {}
    unit, interp = _time_unit(), _interpolation(linear)
    if unit is not None:
        kwargs["time_unit"] = unit
    if interp is not None:
        kwargs["interpolation"] = interp
    time = unreal.FrameNumber(int(frame))
    try:
        return channel.add_key(time, float(value), **kwargs)
    except TypeError:
        # Wrapper without those keyword names: the documented default time unit is display rate.
        key = channel.add_key(time, float(value))
        mode = getattr(getattr(unreal, "RichCurveInterpMode", None), "RCIM_LINEAR" if linear else "RCIM_CONSTANT", None)
        if mode is not None and callable(getattr(key, "set_interpolation_mode", None)):
            key.set_interpolation_mode(mode)
        return key


def _channels(section):
    result, _ = _call_first(section, ("get_all_channels", "get_channels"))
    return list(result)


def _channel_name(channel):
    for getter in (lambda: channel.get_editor_property("channel_name"), lambda: channel.channel_name):
        try:
            name = getter()
        except Exception:  # noqa: BLE001
            continue
        if name is not None:
            return str(name)
    return None


def _clear_keys(channel):
    try:
        for key in list(channel.get_keys()):
            channel.remove_key(key)
    except Exception:  # noqa: BLE001  (a fresh channel has no keys; failing to clear is not fatal)
        pass


def _open_section(section, playback):
    """Make a per-camera section cover the whole sequence by unbounding both ends; fall back to an explicit range
    in display-rate frames. Returns the variant used."""
    start_fn = getattr(section, "set_start_frame_bounded", None)
    end_fn = getattr(section, "set_end_frame_bounded", None)
    if callable(start_fn) and callable(end_fn):
        start_fn(False)
        end_fn(False)
        return "unbounded"
    section.set_range(int(playback[0]), int(playback[1]) + 1)  # display-rate frames, end exclusive
    return "set_range"


def _first_section(track):
    sections = list(track.get_sections())
    if sections:
        return sections[0], "reused"
    return track.add_section(), "added"


class _Build:
    """State for one build: the sequence, which API variants were used, and what was created."""

    def __init__(self, seq, playback, camera_api):
        self.seq = seq
        self.playback = playback          # (start, end) in display-rate frames, end exclusive
        self.camera_api = camera_api      # "subsystem" or "lowlevel"
        self.subsystem = None
        self.actor_subsystem = None
        self.report = {}                  # feature -> set of variants used
        self.folders = {}
        self.cameras = []                 # (shot, camera binding)
        self.aim_checked = False

    def note(self, feature, variant):
        self.report.setdefault(feature, set()).add(variant)

    def report_line(self):
        return "; ".join(f"{k}={'|'.join(sorted(v))}" for k, v in sorted(self.report.items()))


def _is_headless():
    """True under `UnrealEditor-Cmd -run=pythonscript` (a commandlet has no Sequencer UI to drive)."""
    try:
        return "-run=" in str(unreal.SystemLibrary.get_command_line()).lower()
    except Exception:  # noqa: BLE001
        return False


def _aim(build, cam, target):
    """(pitch, yaw) for the camera at `cam` looking at `target`; engine maths when available, cross-checked once
    against the pure-Python formula so a convention mismatch shows up in the log on the first run."""
    pitch, yaw = look_at_angles(cam, target)
    fn = getattr(getattr(unreal, "MathLibrary", None), "find_look_at_rotation", None)
    if not callable(fn):
        build.note("look_at", "python")
        return pitch, yaw
    try:
        rot = fn(unreal.Vector(float(cam["x"]), float(cam["y"]), float(cam["z"])),
                 unreal.Vector(float(target["x"]), float(target["y"]), float(target["z"])))
        engine_pitch, engine_yaw = float(rot.pitch), float(rot.yaw)
    except Exception as exc:  # noqa: BLE001
        warn(f"MathLibrary.find_look_at_rotation failed ({exc}); using the script's own look-at maths")
        build.note("look_at", "python")
        return pitch, yaw
    if not build.aim_checked:
        build.aim_checked = True
        if abs(engine_pitch - pitch) > 0.05 or abs(unwind_towards(engine_yaw, yaw) - yaw) > 0.05:
            warn(f"look-at mismatch: engine pitch/yaw {engine_pitch:.3f}/{engine_yaw:.3f} vs script "
                 f"{pitch:.3f}/{yaw:.3f}; using the engine value. Please report this line.")
    build.note("look_at", "MathLibrary.find_look_at_rotation")
    return engine_pitch, engine_yaw


# ----------------------------------------------------------------------------------------------- cameras

def _unpack_camera_result(result):
    """create_camera returns (binding, actor) per Epic's docs; accept either order, or only one of the two."""
    items = list(result) if isinstance(result, (tuple, list)) else [result]
    binding = actor = None
    for item in items:
        if item is None:
            continue
        if callable(getattr(item, "get_child_possessables", None)):
            binding = item
        elif callable(getattr(item, "get_cine_camera_component", None)):
            actor = item
    return binding, actor


def _top_level_ids(seq):
    ids = {}
    for binding in seq.get_bindings():
        try:
            if _binding_valid(binding.get_parent()):
                continue
        except Exception:  # noqa: BLE001
            pass
        ids[_guid_key(binding.get_id())] = binding
    return ids


def _camera_via_subsystem(build):
    """Editor path: mimics Sequencer's "create camera" button. Per Epic's docs it adds a spawnable camera binding,
    its component binding with default property tracks, a transform track, and (first call only) a camera cut."""
    seq = build.seq
    before = _top_level_ids(seq)
    result = build.subsystem.create_camera(spawnable=True)
    binding, actor = _unpack_camera_result(result)
    if not _binding_valid(binding):
        new = [b for key, b in _top_level_ids(seq).items() if key not in before]
        binding = new[0] if len(new) == 1 else None
    if not _binding_valid(binding):
        raise FabledError("LevelSequenceEditorSubsystem.create_camera did not produce a camera binding "
                          "(is the sequence open and focused in Sequencer?)")
    return binding, actor


def _set_component_focal(component, focal):
    fn = getattr(component, "set_current_focal_length", None)
    if callable(fn):
        fn(float(focal))
    else:
        component.set_editor_property("current_focal_length", float(focal))


def _camera_low_level(build, shot):
    """Fallback path with no Sequencer UI: spawn a temporary CineCameraActor, turn it into a spawnable, try to bind
    its camera component under it, delete the temporary actor. Returns (binding, component binding or None)."""
    seq = build.seq
    focal = float(shot["focal_length_mm"])
    start = shot["camera_start"]
    temp = None
    try:
        if build.actor_subsystem is None:
            build.actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        temp = build.actor_subsystem.spawn_actor_from_class(
            unreal.CineCameraActor, unreal.Vector(float(start["x"]), float(start["y"]), float(start["z"])),
            unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
    except Exception as exc:  # noqa: BLE001  (no editor world in a commandlet is the expected cause)
        warn(f"could not spawn a temporary camera in the level ({exc}); creating the spawnable from the class")
        temp = None

    comp_binding = None
    if temp is not None:
        try:
            component = temp.get_cine_camera_component()
            _set_component_focal(component, focal)
            binding = seq.add_spawnable_from_instance(temp)
            try:
                comp_binding = seq.add_possessable(component)
                parent = comp_binding.get_parent()
                if not (_binding_valid(parent) and _guid_key(parent.get_id()) == _guid_key(binding.get_id())):
                    comp_binding.set_parent(binding)
                    if _binding_valid(parent):
                        parent.remove()  # a possessable the engine made for the temporary actor
            except Exception as exc:  # noqa: BLE001
                warn(f"{shot['id']}: could not bind the camera component under the spawnable ({exc})")
                comp_binding = None
        finally:
            build.actor_subsystem.destroy_actor(temp)
        build.note("camera", "add_spawnable_from_instance")
    else:
        binding = seq.add_spawnable_from_class(unreal.CineCameraActor)
        build.note("camera", "add_spawnable_from_class")
    if not _binding_valid(binding):
        raise FabledError(f"{shot['id']}: could not add a spawnable camera to the sequence")

    # Safety net: the lens is constant within a shot, so also store it on the spawnable's template. If the
    # component binding above does not resolve in this engine version, the camera still has the right lens.
    try:
        template = binding.get_object_template()
        _set_component_focal(template.get_cine_camera_component(), focal)
        build.note("focal_on_template", "set")
    except Exception as exc:  # noqa: BLE001
        warn(f"{shot['id']}: could not set the focal length on the spawnable template ({exc})")
    return binding, comp_binding


def _component_binding(build, binding, actor, shot):
    """The camera component binding under a camera binding. create_camera makes it; otherwise try to add it."""
    children = list(binding.get_child_possessables())
    for child in children:
        if "cameracomponent" in str(child.get_name()).replace(" ", "").lower():
            build.note("component_binding", "found")
            return child
    if children:
        build.note("component_binding", "first-child")
        return children[0]
    if actor is None:
        return None
    try:  # flaky for spawnables per Epic's forum (UE-79406); last resort when create_camera made no child binding
        comp_binding = build.seq.add_possessable(actor.get_cine_camera_component())
        comp_binding.set_parent(binding)
        build.note("component_binding", "add_possessable+set_parent")
        return comp_binding
    except Exception as exc:  # noqa: BLE001
        warn(f"{shot['id']}: no camera component binding and could not add one ({exc})")
        return None


def _key_focal_length(build, comp_binding, shot):
    """One CurrentFocalLength key at the shot's first frame, on the existing track when there is one."""
    track = None
    for candidate in comp_binding.find_tracks_by_type(unreal.MovieSceneFloatTrack):
        if "CurrentFocalLength" in (str(candidate.get_property_name()), str(candidate.get_property_path())):
            track = candidate
            break
    if track is None:
        track = comp_binding.add_track(unreal.MovieSceneFloatTrack)
        track.set_property_name_and_path("CurrentFocalLength", "CurrentFocalLength")
        build.note("focal_track", "added")
    else:
        build.note("focal_track", "reused")
    section, _ = _first_section(track)
    _open_section(section, build.playback)
    channel = _channels(section)[0]
    _clear_keys(channel)
    _add_key(channel, shot["start_frame"], shot["focal_length_mm"], linear=False)


def _transform_channels(build, section):
    """[loc x, loc y, loc z, roll, pitch, yaw] channels of a 3D transform section (doubles in UE5)."""
    channels = _channels(section)
    by_name = {}
    for channel in channels:
        name = _channel_name(channel)
        if name:
            by_name[name] = channel
    if all(name in by_name for name in XF_CHANNEL_NAMES):
        build.note("transform_channels", "by-name")
        return [by_name[name] for name in XF_CHANNEL_NAMES]
    if len(channels) < 6:
        raise FabledError(f"transform section has {len(channels)} channels, expected at least 9")
    build.note("transform_channels", "by-index")
    return channels[:6]  # documented order: Location X,Y,Z, Rotation X(roll),Y(pitch),Z(yaw), Scale X,Y,Z


def _key_transform(build, binding, shot):
    """Two linear keys: camera_start at start_frame, camera_end at end_frame, each aimed at look_at, roll 0.
    Scale channels are left alone (no key and no default means the spawned actor keeps its scale of 1)."""
    tracks = list(binding.find_tracks_by_type(unreal.MovieScene3DTransformTrack))
    if tracks:
        track = tracks[0]
        build.note("transform_track", "reused")
    else:
        track = binding.add_track(unreal.MovieScene3DTransformTrack)
        build.note("transform_track", "added")
    section, _ = _first_section(track)
    build.note("camera_sections", _open_section(section, build.playback))
    channels = _transform_channels(build, section)
    for channel in channels:
        _clear_keys(channel)

    start_pitch, start_yaw = _aim(build, shot["camera_start"], shot["look_at"])
    end_pitch, end_yaw = _aim(build, shot["camera_end"], shot["look_at"])
    end_yaw = unwind_towards(end_yaw, start_yaw)
    keys = ((shot["start_frame"], shot["camera_start"], start_pitch, start_yaw),
            (shot["end_frame"], shot["camera_end"], end_pitch, end_yaw))
    for frame, pos, pitch, yaw in keys:
        values = (pos["x"], pos["y"], pos["z"], 0.0, pitch, yaw)  # roll (Rotation.X) stays 0
        for channel, value in zip(channels, values):
            _add_key(channel, frame, value, linear=True)


def _ensure_spawned(build, binding, shot):
    """Make the spawnable exist for the whole sequence, so it is there whenever its camera cut is active."""
    found = False
    for class_name in ("MovieSceneSpawnTrack", "MovieSceneBindingLifetimeTrack"):
        track_class = getattr(unreal, class_name, None)
        if track_class is None:
            continue
        for track in binding.find_tracks_by_type(track_class):
            sections = list(track.get_sections())
            if not sections:
                sections = [track.add_section()]
            for section in sections:
                _open_section(section, build.playback)
            build.note("spawn_lifetime", class_name)
            found = True
    if found:
        return
    # No lifetime track. A classic spawnable (listed by get_spawnables) gets the Spawned track Sequencer's UI would
    # have given it. Anything else (5.5+ may store spawnables as custom bindings) is left the way the engine made it.
    try:
        own = _guid_key(binding.get_id())
        classic = any(_guid_key(b.get_id()) == own for b in build.seq.get_spawnables())
    except Exception:  # noqa: BLE001
        classic = False
    if not classic:
        build.note("spawn_lifetime", "none found, left as created")
        return
    try:
        track = binding.add_track(unreal.MovieSceneSpawnTrack)
        section = track.add_section()
        _open_section(section, build.playback)
        channel = _channels(section)[0]
        if callable(getattr(channel, "set_default", None)):
            channel.set_default(True)
        build.note("spawn_lifetime", "added MovieSceneSpawnTrack")
    except Exception as exc:  # noqa: BLE001
        warn(f"{shot['id']}: found no Spawned / Binding Lifetime track and could not add one ({exc}); "
             "if this camera is missing when cut to, add the track by hand")


def _name_binding(binding, name):
    for setter in ("set_name", "set_display_name"):
        try:
            getattr(binding, setter)(name)
        except Exception:  # noqa: BLE001  (cosmetic)
            pass


def _file_under_location(build, binding, location):
    """v2 plans: one Sequencer folder per location. Cosmetic; any failure is logged once and skipped."""
    if "folders_failed" in build.report:
        return
    try:
        folder = build.folders.get(location)
        if folder is None:
            folder = build.seq.add_root_folder_to_sequence(str(location))
            build.folders[location] = folder
        folder.add_child_object_binding(binding)
        build.note("folders", "per-location")
    except Exception as exc:  # noqa: BLE001
        warn(f"could not group cameras into Sequencer folders ({exc}); continuing without folders")
        build.note("folders_failed", "yes")


def _make_camera(build, shot):
    binding = actor = comp_binding = None
    if build.camera_api == "subsystem":
        try:
            binding, actor = _camera_via_subsystem(build)
            build.note("camera", "create_camera")
        except Exception as exc:  # noqa: BLE001
            warn(f"{shot['id']}: create_camera path failed ({exc}); switching to the low-level camera path")
            build.camera_api = "lowlevel"
            binding = None
    if binding is None:
        binding, comp_binding = _camera_low_level(build, shot)
    if comp_binding is None:
        comp_binding = _component_binding(build, binding, actor, shot)

    _name_binding(binding, f"CAM_{shot['id']}")
    if actor is not None:
        try:
            actor.set_actor_label(f"CAM_{shot['id']}")
            _set_component_focal(actor.get_cine_camera_component(), shot["focal_length_mm"])
        except Exception:  # noqa: BLE001  (cosmetic on the spawned preview instance)
            pass
    _key_transform(build, binding, shot)
    if comp_binding is not None:
        _key_focal_length(build, comp_binding, shot)
    else:
        warn(f"{shot['id']}: focal length {shot['focal_length_mm']} mm is NOT keyed (no camera component binding)")
        build.note("focal_track", "MISSING")
    _ensure_spawned(build, binding, shot)
    if isinstance(shot.get("location"), str):
        _file_under_location(build, binding, shot["location"])
    build.cameras.append((shot, binding))
    return binding


# ----------------------------------------------------------------------------------------------- camera cuts

def _binding_id(build, binding):
    seq = build.seq
    fn = getattr(seq, "get_binding_id", None)
    if callable(fn):
        try:
            build.note("binding_id", "get_binding_id")
            return fn(binding)
        except Exception:  # noqa: BLE001
            pass
    fn = getattr(seq, "make_binding_id", None)
    space = getattr(getattr(unreal, "MovieSceneObjectBindingSpace", None), "LOCAL", None)
    if callable(fn) and space is not None:
        try:
            build.note("binding_id", "make_binding_id")
            return fn(binding, space)
        except Exception:  # noqa: BLE001
            pass
    binding_id = unreal.MovieSceneObjectBindingID()
    binding_id.set_editor_property("guid", binding.get_id())
    build.note("binding_id", "MovieSceneObjectBindingID.guid")
    return binding_id


def _build_camera_cuts(build):
    """One camera cut section per created camera. create_camera already adds a Camera Cut track with one section
    for the first camera, so existing tracks and sections are reused instead of added a second time."""
    seq = build.seq
    tracks, _ = _call_first(seq, ("find_tracks_by_type", "find_master_tracks_by_type"), unreal.MovieSceneCameraCutTrack)
    tracks = list(tracks)
    if tracks:
        track = tracks[0]
        build.note("cut_track", "reused")
    else:
        track, _ = _call_first(seq, ("add_track", "add_master_track"), unreal.MovieSceneCameraCutTrack)
        build.note("cut_track", "added")
    sections = list(track.get_sections())
    cameras = sorted(build.cameras, key=lambda pair: pair[0]["start_frame"])
    for index, (shot, binding) in enumerate(cameras):
        section = sections[index] if index < len(sections) else track.add_section()
        # display-rate frames; the end frame is exclusive, so consecutive shots butt up without overlapping
        section.set_range(int(shot["start_frame"]), int(shot["end_frame"]))
        binding_id = _binding_id(build, binding)
        try:
            section.set_camera_binding_id(binding_id)
        except AttributeError:
            section.set_editor_property("camera_binding_id", binding_id)
    for extra in sections[len(cameras):]:
        track.remove_section(extra)
    return track


# ----------------------------------------------------------------------------------------------- build

def _optional(what, fn):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        warn(f"{what} failed ({exc}); not critical, continuing")
        return None


def _prepare_asset(asset_path, overwrite):
    """Stop if the asset exists (unless --overwrite); with --overwrite delete it, but only if it is a LevelSequence."""
    lib = unreal.EditorAssetLibrary
    if not lib.does_asset_exist(asset_path):
        return
    if not overwrite:
        raise FabledError(f"{asset_path} already exists. Re-run with --overwrite to delete and rebuild it, "
                          "or pass a different --name / --dest. Nothing was changed.")
    existing = lib.load_asset(asset_path)
    if existing is not None and not isinstance(existing, unreal.LevelSequence):
        raise FabledError(f"{asset_path} exists and is a {type(existing).__name__}, not a LevelSequence; "
                          "refusing to delete it. Pass a different --name / --dest.")

    def _close_if_open():
        seq_lib = unreal.LevelSequenceEditorBlueprintLibrary
        current = seq_lib.get_current_level_sequence()
        if current is not None and str(current.get_path_name()).split(".")[0] == asset_path:
            seq_lib.close_level_sequence()

    _optional("closing the Level Sequence in Sequencer", _close_if_open)
    if not lib.delete_asset(asset_path):
        raise FabledError(f"could not delete the existing {asset_path} (is it open or referenced?). Nothing was built.")
    _optional("garbage collection", unreal.SystemLibrary.collect_garbage)
    log(f"--overwrite: deleted the existing {asset_path}")


def _open_in_sequencer(build):
    """Open the sequence in Sequencer and fetch the subsystem. False means: use the low-level camera path."""
    seq = build.seq
    try:
        lib = unreal.LevelSequenceEditorBlueprintLibrary
        lib.open_level_sequence(seq)
        current = lib.get_current_level_sequence()
        if current is None or current.get_path_name() != seq.get_path_name():
            warn("the new sequence did not become the focused sequence in Sequencer")
            return False
        build.subsystem = unreal.get_editor_subsystem(unreal.LevelSequenceEditorSubsystem)
        return build.subsystem is not None and callable(getattr(build.subsystem, "create_camera", None))
    except Exception as exc:  # noqa: BLE001
        warn(f"could not open the sequence in Sequencer ({exc})")
        return False


def build_sequence(plan, dest, name, overwrite=False, save=True, camera_api="auto"):
    """Create the Level Sequence described by an already-validated plan. Returns (sequence, exit code)."""
    num, den = frame_rate_parts(plan["fps"])
    total = int(plan["total_frames"])
    shots = sorted(plan["shots"], key=lambda s: s["start_frame"])
    asset_path = f"{dest}/{name}"

    _prepare_asset(asset_path, overwrite)
    seq = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, dest, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    if seq is None:
        raise FabledError(f"could not create the Level Sequence {asset_path} (see the Output Log above)")

    build = _Build(seq, (0, total), "lowlevel")
    cancelled = False
    with unreal.ScopedEditorTransaction("Fabled: build Level Sequence from shot list"):
        seq.set_display_rate(unreal.FrameRate(numerator=num, denominator=den))
        seq.set_playback_start(0)       # display-rate frames
        seq.set_playback_end(total)     # display-rate frames, exclusive
        seconds = total * den / num
        _optional("setting the view range", lambda: (seq.set_view_range_start(-0.05 * seconds), seq.set_view_range_end(1.05 * seconds)))
        _optional("setting the work range", lambda: (seq.set_work_range_start(0.0), seq.set_work_range_end(seconds)))

        if camera_api != "lowlevel":
            if _is_headless():
                log("running as a commandlet (no Sequencer UI): using the low-level camera path")
            elif _open_in_sequencer(build):
                build.camera_api = "subsystem"
            elif camera_api == "subsystem":
                raise FabledError("--camera-api subsystem was requested but the sequence could not be opened in Sequencer")
            else:
                warn("falling back to the low-level camera path")

        with unreal.ScopedSlowTask(len(shots) + 1, "Fabled: building cameras") as task:
            task.make_dialog(True)
            for shot in shots:
                if task.should_cancel():
                    cancelled = True
                    break
                task.enter_progress_frame(1, f"Fabled: camera {shot['id']}")
                _make_camera(build, shot)
                log(f"{shot['id']}: frames {shot['start_frame']}-{shot['end_frame']}  {shot['focal_length_mm']} mm  {shot.get('label') or ''}")
            task.enter_progress_frame(1, "Fabled: camera cuts")
            _build_camera_cuts(build)

    if build.subsystem is not None:
        _optional("refreshing Sequencer", unreal.LevelSequenceEditorBlueprintLibrary.refresh_current_level_sequence)
    if save:
        if not unreal.EditorAssetLibrary.save_loaded_asset(seq):
            warn(f"the Level Sequence was built but could not be saved; save {asset_path} by hand")
    else:
        log("--no-save: the Level Sequence is unsaved")
    log(f"API report: {build.report_line()}")
    if cancelled:
        warn(f"cancelled after {len(build.cameras)} of {len(shots)} shots: {asset_path} is incomplete. "
             "Re-run with --overwrite to rebuild it.")
        return seq, EXIT_CANCELLED
    log(f"done: {asset_path}  ({len(shots)} shots, {total} frames @ {plan['fps']} fps)")
    return seq, EXIT_OK


def describe(plan, dest, name):
    """Log what a build would create (used by --dry-run). Pure Python, touches nothing."""
    version = int(plan.get("plan_version", 1))
    shots = sorted(plan["shots"], key=lambda s: s["start_frame"])
    log(f"dry run: would create Level Sequence {dest}/{name}: {len(shots)} cameras, "
        f"{plan['total_frames']} frames @ {plan['fps']} fps (plan v{version})")
    for shot in shots:
        (f0, p0, r0), (f1, p1, r1) = shot_keys(shot)
        where = f" [{shot['location']}]" if isinstance(shot.get("location"), str) else ""
        log(f"dry run: CAM_{shot['id']}{where} cut {f0}-{f1} {shot['focal_length_mm']} mm  "
            f"key@{f0} pos=({p0[0]:g}, {p0[1]:g}, {p0[2]:g}) pitch={r0[1]:.2f} yaw={r0[2]:.2f}  "
            f"key@{f1} pos=({p1[0]:g}, {p1[1]:g}, {p1[2]:g}) pitch={r1[1]:.2f} yaw={r1[2]:.2f}")


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
    ap = _Parser(prog="build_sequence_from_shotlist.py", description="Build a Level Sequence from a Fabled sequencer plan.")
    ap.add_argument("--plan", required=True, help="path to sequencer_plan.json")
    ap.add_argument("--dest", default=DEFAULT_DEST, help=f"content folder (default {DEFAULT_DEST})")
    ap.add_argument("--name", default=None, help=f"asset name (default {DEFAULT_NAME})")
    ap.add_argument("--overwrite", action="store_true", help="delete and rebuild an existing Level Sequence of that name")
    ap.add_argument("--dry-run", action="store_true", help="validate and log what would be created; create nothing")
    ap.add_argument("--no-save", action="store_true", help="do not save the new Level Sequence asset")
    ap.add_argument("--camera-api", choices=("auto", "subsystem", "lowlevel"), default="auto")
    return ap.parse_args(argv)


def main(argv=None):
    """Entry point for `py "<script>" --plan ...`, for `-run=pythonscript -script="<script> --plan ..."`, and for
    the tests. Returns an exit code: 0 built (or dry run fine), 1 build failed, 2 bad arguments or plan, 3 cancelled."""
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
    dest = args.dest.rstrip("/")
    if not re.fullmatch(r"(/[A-Za-z0-9_\-]+)+", dest):
        errors.append(f"--dest {args.dest!r} is not a content path like /Game/Fabled/Previs")
    name = args.name or (f"LS_{sanitize_asset_name(plan['title'])}" if isinstance(plan, dict) and isinstance(plan.get("title"), str) and plan["title"].strip() else DEFAULT_NAME)
    if not re.fullmatch(r"[A-Za-z0-9_]+", name):
        errors.append(f"--name {name!r} may only contain letters, digits and underscores")
    for message in warnings:
        warn(message)
    if errors:
        error(f"{args.plan}: {len(errors)} problem(s); nothing was created:")
        for message in errors:
            error(f"  - {message}")
        return EXIT_INVALID

    if args.dry_run:
        describe(plan, dest, name)
        if unreal is not None:
            exists = _optional("checking for an existing asset", lambda: unreal.EditorAssetLibrary.does_asset_exist(f"{dest}/{name}"))
            if exists:
                log(f"dry run: {dest}/{name} already exists; a real run needs --overwrite" + (" (given)" if args.overwrite else ""))
        log("dry run: nothing was created")
        return EXIT_OK
    if unreal is None:
        error("the `unreal` module is not available: run this inside Unreal Editor (see the header), or add --dry-run")
        return EXIT_FAILED

    try:
        _, code = build_sequence(plan, dest, name, overwrite=args.overwrite, save=not args.no_save, camera_api=args.camera_api)
        return code
    except FabledError as exc:
        error(str(exc))
        return EXIT_FAILED
    except Exception as exc:  # noqa: BLE001
        error(f"build failed: {type(exc).__name__}: {exc}")
        error(traceback.format_exc())
        error(f"a partly built {dest}/{name} may exist; fix the cause and re-run with --overwrite. "
              "Please report the lines above (UNTESTED IN ENGINE script).")
        return EXIT_FAILED


if __name__ == "__main__":
    _code = main()
    if _code != EXIT_OK:
        # Raise (not sys.exit) so a headless -run=pythonscript run reports failure without killing an interactive editor.
        raise RuntimeError(f"[Fabled] build_sequence_from_shotlist.py failed (exit code {_code}); see the [Fabled] errors above")
