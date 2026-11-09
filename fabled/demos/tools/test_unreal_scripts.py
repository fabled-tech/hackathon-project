#!/usr/bin/env python3
"""Tests for ../unreal/build_sequence_from_shotlist.py and ../unreal/blockout_from_layout.py WITHOUT Unreal.

    python3 fabled/demos/tools/test_unreal_scripts.py        (standard library only; exit code 1 on any failure)

The scripts are run against ../unreal/fake_unreal/unreal.py, a hand-written test double of the few `unreal` classes
they use. A pass here proves the scripts' own logic and data flow: plan validation, frame ranges, look-at maths, which
binding/track/section/channel receives which key, what a re-run deletes. It does NOT prove that Unreal Engine accepts
these calls: the fake encodes the same from-memory assumptions about the API as the scripts do. The scripts stay
labeled UNTESTED IN ENGINE until someone runs them in a real editor (see ../unreal/README.md).
"""
import contextlib
import importlib.util
import io
import json
import math
import os
import subprocess
import sys
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
UNREAL_DIR = os.path.normpath(os.path.join(HERE, "..", "unreal"))
FIXTURES = os.path.join(UNREAL_DIR, "fixtures")
SEQ_SCRIPT = os.path.join(UNREAL_DIR, "build_sequence_from_shotlist.py")
BLK_SCRIPT = os.path.join(UNREAL_DIR, "blockout_from_layout.py")

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(UNREAL_DIR, "fake_unreal"))
import unreal as fake  # noqa: E402  (the fake; there is no real engine here)

assert getattr(fake, "__fabled_fake__", False), "expected the fake unreal module"


def _load(path):
    spec = importlib.util.spec_from_file_location(os.path.splitext(os.path.basename(path))[0], path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


seq_script = _load(SEQ_SCRIPT)
blk_script = _load(BLK_SCRIPT)
TMP = tempfile.TemporaryDirectory(prefix="fabled_unreal_tests_")
TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def fixture(name):
    return os.path.join(FIXTURES, name)


def read(name):
    with open(fixture(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_plan(plan, name="plan.json"):
    path = os.path.join(TMP.name, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(plan if isinstance(plan, str) else json.dumps(plan))
    return path


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def eq(actual, expected, what):
    check(actual == expected, f"{what}: expected {expected!r}, got {actual!r}")


def near(actual, expected, what, tol=1e-6):
    check(abs(actual - expected) <= tol, f"{what}: expected {expected!r}, got {actual!r}")


def errors():
    return fake.STATE.messages("error")


def warnings():
    return fake.STATE.messages("warning")


def called(name):
    return [args for call, args in fake.STATE.calls if call == name]


# ================================================================================================ sequence helpers

SEQ_PATH = "/Game/Fabled/Previs/LS_FabledPrevis"
XF = ("Location.X", "Location.Y", "Location.Z", "Rotation.X", "Rotation.Y", "Rotation.Z")


def run_seq(plan_path, *extra, **config):
    fake.reset(**config)
    return seq_script.main(["--plan", plan_path, *extra])


def sequence(path=SEQ_PATH):
    seq = fake.STATE.assets.get(path)
    check(isinstance(seq, fake.LevelSequence), f"no LevelSequence at {path}")
    return seq


def cameras(seq):
    """Top-level spawnable bindings by name."""
    return {b.get_name(): b for b in seq.get_spawnables()}


def transform_keys(binding):
    """{frame: {channel name: key}} from the camera's one transform track / one section."""
    tracks = binding.find_tracks_by_type(fake.MovieScene3DTransformTrack)
    eq(len(tracks), 1, f"{binding.get_name()} transform tracks")
    sections = tracks[0].get_sections()
    eq(len(sections), 1, f"{binding.get_name()} transform sections")
    out = {}
    for channel in sections[0].get_all_channels():
        for key in channel.get_keys():
            out.setdefault(key.frame, {})[str(channel._channel_name)] = key
    return out, sections[0]


def focal_track_keys(binding):
    children = binding.get_child_possessables()
    eq(len(children), 1, f"{binding.get_name()} child (component) bindings")
    tracks = [t for t in children[0].find_tracks_by_type(fake.MovieSceneFloatTrack) if str(t.get_property_name()) == "CurrentFocalLength"]
    eq(len(tracks), 1, f"{binding.get_name()} CurrentFocalLength tracks")
    eq(tracks[0].get_property_path(), "CurrentFocalLength", "focal property path")
    sections = tracks[0].get_sections()
    eq(len(sections), 1, f"{binding.get_name()} focal sections")
    return sections[0].get_all_channels()[0].get_keys(), sections[0], children[0]


def forward(pitch, yaw):
    """Unit forward (+X) vector of an Unreal rotator with roll 0: X forward, Z up, yaw about Z, +pitch looks up."""
    p, y = math.radians(pitch), math.radians(yaw)
    return (math.cos(p) * math.cos(y), math.cos(p) * math.sin(y), math.sin(p))


def assert_aimed(pos, pitch, yaw, target, what):
    d = (target["x"] - pos[0], target["y"] - pos[1], target["z"] - pos[2])
    length = math.sqrt(sum(c * c for c in d))
    f = forward(pitch, yaw)
    dot = sum(a * b / length for a, b in zip(f, d))
    check(dot > 1 - 1e-9, f"{what}: rotation pitch={pitch:.4f} yaw={yaw:.4f} does not point at look_at (cos={dot:.9f})")


def assert_sequence_matches(plan, seq, lifetime_classes=(fake.MovieSceneSpawnTrack,)):
    """The full contract: one camera per shot, keys, aim, focal, cuts, lifetime, rate and ranges."""
    shots = plan["shots"]
    rate = seq.get_display_rate()
    eq((rate.numerator, rate.denominator), (plan["fps"], 1), "display rate")
    eq((seq.get_playback_start(), seq.get_playback_end()), (0, plan["total_frames"]), "playback range")
    cams = cameras(seq)
    eq(len(cams), len(shots), "camera count")
    eq(len(seq.get_bindings()), 2 * len(shots), "bindings (camera + component per shot)")

    for shot in shots:
        name = f"CAM_{shot['id']}"
        check(name in cams, f"missing camera binding {name}")
        binding = cams[name]
        keys, section = transform_keys(binding)
        eq(sorted(keys), sorted({shot["start_frame"], shot["end_frame"]}), f"{name} transform key frames")
        check(section.covers(shot["start_frame"], shot["end_frame"] + 1), f"{name} transform section does not contain both keys")
        ends = ((shot["start_frame"], shot["camera_start"]), (shot["end_frame"], shot["camera_end"]))
        if shot["start_frame"] == shot["end_frame"]:
            ends = ends[:1]
        yaws = []
        for frame, cam in ends:
            at = keys[frame]
            eq(sorted(at), sorted(XF), f"{name}@{frame} keyed channels (location + rotation, no scale)")
            for axis in "XYZ":
                near(at[f"Location.{axis}"].value, cam[axis.lower()], f"{name}@{frame} Location.{axis}")
            eq(at["Rotation.X"].value, 0.0, f"{name}@{frame} roll")
            pos = tuple(at[f"Location.{axis}"].value for axis in "XYZ")
            assert_aimed(pos, at["Rotation.Y"].value, at["Rotation.Z"].value, shot["look_at"], f"{name}@{frame}")
            yaws.append(at["Rotation.Z"].value)
            for key in at.values():
                check(key.interpolation is fake.MovieSceneKeyInterpolation.LINEAR, f"{name}@{frame} key is not linear")
                check(key.time_unit is fake.MovieSceneTimeUnit.DISPLAY_RATE, f"{name}@{frame} key is not in display-rate frames")
                check(isinstance(key.value, float), f"{name}@{frame} key value is not a float")
        if len(yaws) == 2:
            check(abs(yaws[1] - yaws[0]) <= 180.0 + 1e-9, f"{name} yaw goes the long way round: {yaws}")

        focal_keys, focal_section, component = focal_track_keys(binding)
        eq(len(focal_keys), 1, f"{name} focal keys")
        eq((focal_keys[0].frame, focal_keys[0].value), (shot["start_frame"], float(shot["focal_length_mm"])), f"{name} focal key")
        check(focal_keys[0].time_unit is fake.MovieSceneTimeUnit.DISPLAY_RATE, f"{name} focal key time unit")
        check(focal_section.covers(shot["start_frame"], shot["end_frame"]), f"{name} focal section does not cover the shot")
        eq(component.get_parent().get_id(), binding.get_id(), f"{name} component binding parent")

        lifetime = [t for cls in lifetime_classes for t in binding.find_tracks_by_type(cls)]
        eq(len(lifetime), 1, f"{name} spawn/lifetime tracks")
        sections = lifetime[0].get_sections()
        check(sections and all(s.covers(0, plan["total_frames"]) for s in sections), f"{name} is not spawned for the whole sequence")

    cut_tracks = seq.find_tracks_by_type(fake.MovieSceneCameraCutTrack)
    eq(len(cut_tracks), 1, "camera cut tracks")
    cuts = sorted(cut_tracks[0].get_sections(), key=lambda s: s.get_start_frame())
    eq(len(cuts), len(shots), "camera cut sections")
    for cut, shot in zip(cuts, sorted(shots, key=lambda s: s["start_frame"])):
        eq((cut.get_start_frame(), cut.get_end_frame()), (shot["start_frame"], shot["end_frame"]), f"cut range for {shot['id']}")
        eq(cut.get_camera_binding_id().guid, cams[f"CAM_{shot['id']}"].get_id(), f"cut binding for {shot['id']}")
    for a, b in zip(cuts, cuts[1:]):
        check(a.get_end_frame() <= b.get_start_frame(), "camera cut sections overlap")


# ================================================================================================ sequence tests

@test
def seq_v1_builds_cameras_keys_cuts_and_ranges():
    plan = read("sequencer_plan.tiny_v1.json")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json")), 0, "exit code")
    seq = sequence()
    assert_sequence_matches(plan, seq)
    eq(errors(), [], "errors logged")
    eq(len(seq.get_root_folders_in_sequence()), 0, "v1 has no locations, so no folders")
    eq(fake.STATE.saved, [SEQ_PATH], "saved assets")
    eq(len(called("create_camera")), 3, "create_camera calls")
    eq(fake.STATE.actors, [], "level actors left behind")


@test
def seq_reuses_tracks_create_camera_already_made():
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json")), 0, "exit code")
    seq = sequence()
    for binding in seq.get_spawnables():
        component = binding.get_child_possessables()[0]
        names = sorted(str(t.get_property_name()) for t in component.get_tracks())
        eq(names, ["CurrentAperture", "CurrentFocalLength", "ManualFocusDistance"], f"{binding.get_name()} component tracks (no duplicates)")
        for track in component.get_tracks():
            if str(track.get_property_name()) != "CurrentFocalLength":
                eq(track.get_sections()[0].get_all_channels()[0].get_keys(), [], "aperture / focus distance are left alone")
        eq(len(binding.get_tracks()), 2, f"{binding.get_name()} tracks (transform + spawn, no duplicates)")
    eq(called("add_possessable"), [], "add_possessable must not be used when create_camera made the component binding")
    report = [m for m in fake.STATE.messages("log") if "API report" in m]
    check(report and "focal_track=reused" in report[0] and "cut_track=reused" in report[0] and "transform_track=reused" in report[0],
          f"API report should say tracks were reused: {report}")


@test
def seq_exact_angles_and_yaw_seam():
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json")), 0, "exit code")
    cams = cameras(sequence())
    keys, _ = transform_keys(cams["CAM_S01-001"])  # on +X looking back at the origin, 10 cm above the target
    near(abs(keys[0]["Rotation.Z"].value), 180.0, "yaw looking down -X")
    near(keys[0]["Rotation.Y"].value, math.degrees(math.atan2(-10, 1200)), "slight downward pitch")
    keys, _ = transform_keys(cams["CAM_S01-002"])  # crosses the +/-180 seam: must not swing through 0
    start_yaw, end_yaw = keys[48]["Rotation.Z"].value, keys[84]["Rotation.Z"].value
    near(start_yaw, math.degrees(math.atan2(-50, -300)), "start yaw")
    near(abs(end_yaw - start_yaw), 2 * math.degrees(math.atan2(50, 300)), "yaw travel across the seam")
    keys, _ = transform_keys(cams["CAM_S01-003"])  # high camera: looks down
    check(keys[84]["Rotation.Y"].value < -45, "high camera should pitch down steeply")
    eq(keys[84]["Rotation.Y"].value, keys[120]["Rotation.Y"].value, "static shot keeps its pitch")


@test
def seq_v2_uses_world_coordinates_and_location_folders():
    plan = read("sequencer_plan.tiny_v2.json")
    eq(run_seq(fixture("sequencer_plan.tiny_v2.json")), 0, "exit code")
    seq = sequence()
    assert_sequence_matches(plan, seq)
    cams = cameras(seq)
    keys, _ = transform_keys(cams["CAM_S02-002"])
    eq(keys[36]["Location.X"].value, 5239.0, "v2 coordinates are absolute (stage origin is not added again)")
    folders = {str(f.get_folder_name()): f.get_child_object_bindings() for f in seq.get_root_folders_in_sequence()}
    eq(sorted(folders), ["HARBOR", "KITCHEN"], "Sequencer folders per location")
    eq(sorted(g.to_string() for g in folders["HARBOR"]),
       sorted(cams[n].get_id().to_string() for n in ("CAM_S01-001", "CAM_S03-003")), "HARBOR folder contents")
    eq(folders["KITCHEN"], [cams["CAM_S02-002"].get_id()], "KITCHEN folder contents")


@test
def seq_production_fixture_from_the_real_exporter():
    plan = read("sequencer_plan.lantern_keeper.json")
    check(len(plan["shots"]) >= 10, "fixture should be the full Lantern Keeper plan")
    eq(run_seq(fixture("sequencer_plan.lantern_keeper.json")), 0, "exit code")
    seq = sequence()
    assert_sequence_matches(plan, seq)
    cuts = sorted(seq.find_tracks_by_type(fake.MovieSceneCameraCutTrack)[0].get_sections(), key=lambda s: s.get_start_frame())
    eq(cuts[0].get_start_frame(), 0, "first cut starts at 0")
    eq(cuts[-1].get_end_frame(), plan["total_frames"], "last cut ends at total_frames")
    check(all(a.get_end_frame() == b.get_start_frame() for a, b in zip(cuts, cuts[1:])), "cuts are contiguous")
    eq(warnings(), [w for w in warnings() if "FAKE" in w], "no warnings other than the fake-engine notice")
    if plan.get("plan_version") == 2:
        eq(len(seq.get_root_folders_in_sequence()), len(plan["stages"]), "one folder per stage")


@test
def seq_accepts_every_create_camera_return_shape():
    plan = read("sequencer_plan.tiny_v1.json")
    for shape in ("binding,actor", "actor,binding", "binding", "actor"):
        eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), create_camera_result=shape), 0, f"exit code for {shape}")
        assert_sequence_matches(plan, sequence())


@test
def seq_adds_component_binding_when_create_camera_made_none():
    plan = read("sequencer_plan.tiny_v1.json")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), camera_default_tracks=False), 0, "exit code")
    assert_sequence_matches(plan, sequence())
    eq(len(called("add_possessable")), 3, "add_possessable fallback calls")


@test
def seq_camera_cuts_are_reused_however_many_create_camera_left_behind():
    plan = read("sequencer_plan.tiny_v1.json")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), camera_cut_per_call=True), 0, "exit code when every call adds a cut")
    seq = sequence()
    assert_sequence_matches(plan, seq)
    track = seq.find_tracks_by_type(fake.MovieSceneCameraCutTrack)[0]   # stray sections are removed on a rebuild
    track.add_section().set_range(0, 120)
    track.add_section().set_range(10, 20)
    build = seq_script._Build(seq, (0, plan["total_frames"]), "lowlevel")
    build.cameras = [(shot, cameras(seq)[f"CAM_{shot['id']}"]) for shot in plan["shots"]]
    seq_script._build_camera_cuts(build)
    assert_sequence_matches(plan, seq)


@test
def seq_spawn_lifetime_variants():
    plan = read("sequencer_plan.tiny_v1.json")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), lifetime_track="binding_lifetime"), 0, "exit code (binding lifetime)")
    assert_sequence_matches(plan, sequence(), lifetime_classes=(fake.MovieSceneBindingLifetimeTrack,))
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), lifetime_track="none"), 0, "exit code (no lifetime track)")
    seq = sequence()
    assert_sequence_matches(plan, seq)
    for binding in seq.get_spawnables():
        channel = binding.find_tracks_by_type(fake.MovieSceneSpawnTrack)[0].get_sections()[0].get_all_channels()[0]
        eq(channel.get_default(), True, "added spawn track defaults to spawned")


@test
def seq_low_level_camera_path():
    plan = read("sequencer_plan.tiny_v1.json")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), "--camera-api", "lowlevel"), 0, "exit code")
    seq = sequence()
    assert_sequence_matches(plan, seq)
    eq(called("create_camera"), [], "create_camera must not be used")
    eq(called("open_level_sequence"), [], "Sequencer must not be opened")
    eq(len(called("add_spawnable_from_instance")), 3, "add_spawnable_from_instance calls")
    eq(fake.STATE.actors, [], "temporary cameras must be removed from the level")
    eq(len(fake.STATE.destroyed), 3, "temporary cameras destroyed")
    for shot in plan["shots"]:
        template = cameras(seq)[f"CAM_{shot['id']}"].get_object_template()
        eq(template.get_cine_camera_component().current_focal_length, float(shot["focal_length_mm"]), "focal length on the spawnable template")


@test
def seq_headless_commandlet_uses_low_level_path():
    plan = read("sequencer_plan.tiny_v1.json")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), command_line="Proj.uproject -run=pythonscript -script=x.py"), 0, "exit code")
    assert_sequence_matches(plan, sequence())
    eq(called("open_level_sequence"), [], "a commandlet has no Sequencer UI to open")
    eq(called("create_camera"), [], "create_camera must not be used headless")


@test
def seq_headless_without_a_world_still_sets_the_lens():
    plan = read("sequencer_plan.tiny_v1.json")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), command_line="-run=pythonscript", has_world=False), 0, "exit code")
    seq = sequence()
    cams = cameras(seq)
    eq(len(cams), 3, "camera count")
    eq(len(called("add_spawnable_from_class")), 3, "add_spawnable_from_class calls")
    for shot in plan["shots"]:
        binding = cams[f"CAM_{shot['id']}"]
        eq(binding.get_object_template().get_cine_camera_component().current_focal_length, float(shot["focal_length_mm"]), "template focal length")
        keys, _ = transform_keys(binding)
        eq(sorted(keys), sorted({shot["start_frame"], shot["end_frame"]}), "transform keys")
    check(sum("NOT keyed" in w for w in warnings()) == 3, "each un-keyed focal length must be reported")
    eq(len(seq.find_tracks_by_type(fake.MovieSceneCameraCutTrack)[0].get_sections()), 3, "camera cuts")


@test
def seq_falls_back_when_sequencer_does_not_open():
    plan = read("sequencer_plan.tiny_v1.json")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), sequencer_ui=False), 0, "exit code")
    assert_sequence_matches(plan, sequence())
    eq(called("create_camera"), [], "create_camera must not be used when the sequence is not focused")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), "--camera-api", "subsystem", sequencer_ui=False), 1, "forced subsystem path fails clearly")
    check(any("could not be opened in Sequencer" in e for e in errors()), f"clear message expected: {errors()}")


@test
def seq_look_at_and_channel_fallbacks_give_the_same_keys():
    plan = read("sequencer_plan.tiny_v1.json")
    saved = fake.MathLibrary
    try:
        del fake.MathLibrary
        eq(run_seq(fixture("sequencer_plan.tiny_v1.json")), 0, "exit code without MathLibrary")
        assert_sequence_matches(plan, sequence())
        check(any("look_at=python" in m for m in fake.STATE.messages("log")), "API report should show the python look-at")
    finally:
        fake.MathLibrary = saved
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), channel_names=False), 0, "exit code without channel names")
    assert_sequence_matches(plan, sequence())
    check(any("transform_channels=by-index" in m for m in fake.STATE.messages("log")), "API report should show by-index channels")


@test
def seq_rerun_without_overwrite_stops_and_changes_nothing():
    path = fixture("sequencer_plan.tiny_v1.json")
    eq(run_seq(path), 0, "first run")
    first, state = sequence(), fake.STATE
    eq(seq_script.main(["--plan", path]), 1, "second run exit code")
    check(fake.STATE is state and sequence() is first, "the existing asset must be untouched")
    eq(len(first.get_spawnables()), 3, "no cameras added to the existing sequence")
    eq(len(called("create_asset")), 1, "create_asset must not be called again")
    eq(called("delete_asset"), [], "nothing deleted")
    check(any("already exists" in e and "--overwrite" in e for e in errors()), f"clear message expected: {errors()}")
    eq(len([p for p in fake.STATE.assets if p.startswith("/Game/")]), 1, "no second asset")


@test
def seq_overwrite_deletes_and_rebuilds():
    path = fixture("sequencer_plan.tiny_v1.json")
    eq(run_seq(path), 0, "first run")
    first = sequence()
    eq(seq_script.main(["--plan", path, "--overwrite"]), 0, "overwrite run")
    second = sequence()
    check(second is not first, "a new asset must replace the old one")
    eq(fake.STATE.deleted_assets, [SEQ_PATH], "deleted assets")
    assert_sequence_matches(read("sequencer_plan.tiny_v1.json"), second)
    eq(len([p for p in fake.STATE.assets if p.startswith("/Game/")]), 1, "exactly one asset")


@test
def seq_overwrite_never_deletes_other_asset_types_and_reports_failed_delete():
    path = fixture("sequencer_plan.tiny_v1.json")
    fake.reset()
    mesh = fake.add_static_mesh(SEQ_PATH)
    eq(seq_script.main(["--plan", path, "--overwrite"]), 1, "exit code when a StaticMesh has that name")
    check(fake.STATE.assets[SEQ_PATH] is mesh and not fake.STATE.deleted_assets, "the other asset must survive")
    check(any("not a LevelSequence" in e for e in errors()), f"clear message expected: {errors()}")
    eq(run_seq(path), 0, "first run")
    fake.STATE.config["fail_delete"] = True
    first = sequence()
    eq(seq_script.main(["--plan", path, "--overwrite"]), 1, "exit code when delete fails")
    check(sequence() is first and len(called("create_asset")) == 1, "nothing rebuilt after a failed delete")


@test
def seq_validation_reports_every_problem_at_once_and_creates_nothing():
    plan = read("sequencer_plan.tiny_v1.json")
    plan["schema"] = "something/else"
    plan["fps"] = True
    plan["total_frames"] = 100
    a, b, c = plan["shots"]
    a["end_frame"] = 0                       # end_frame <= start_frame
    a["focal_length_mm"] = 2                 # below 4 mm
    b["start_frame"] = 40                    # (kept valid) but ...
    b["focal_length_mm"] = 2000              # above 1200 mm
    b["camera_start"]["x"] = "300"           # not a number
    del b["camera_end"]
    c["start_frame"] = 60                    # overlaps b (40-84)
    c["id"] = b["id"]                        # duplicate id
    c["camera_start"] = dict(c["look_at"])   # camera on the target
    eq(run_seq(write_plan(plan)), 2, "exit code")
    text = "\n".join(errors())
    for needle in ("schema:", "fps:", "must be greater than start_frame", "outside 4-1200", "2000", "camera_start.x",
                   "camera_end must be an object", "overlap", "duplicate id", "same point as look_at", "total_frames is 100"):
        check(needle in text, f"missing validation message {needle!r} in:\n{text}")
    check(f"{len(errors()) - 1} problem(s)" in errors()[0], f"summary line should count the problems: {errors()[0]}")
    eq([p for p in fake.STATE.assets if p.startswith("/Game/")], [], "assets created")
    eq((fake.STATE.calls, fake.STATE.transactions, fake.STATE.actors), ([], [], []), "engine calls made")


@test
def seq_validation_of_files_arguments_and_v2_fields():
    eq(run_seq(os.path.join(TMP.name, "missing.json")), 2, "missing file")
    check(any("cannot read plan" in e for e in errors()), "missing file message")
    eq(run_seq(write_plan("{not json")), 2, "invalid JSON")
    check(any("not valid JSON" in e for e in errors()), "invalid JSON message")
    eq(run_seq(write_plan("[]")), 2, "root is not an object")
    fake.reset()
    eq(seq_script.main([]), 2, "no --plan")
    eq(seq_script.main(["--plan", fixture("sequencer_plan.tiny_v1.json"), "--bogus"]), 2, "unknown argument")
    with contextlib.redirect_stdout(io.StringIO()) as out:
        eq(seq_script.main(["--help"]), 0, "--help must return, not exit the interpreter")
    check("--overwrite" in out.getvalue() and "--dry-run" in out.getvalue(), "--help lists the options")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), "--dest", "Game/NoSlash"), 2, "bad --dest")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json"), "--name", "bad name!"), 2, "bad --name")

    plan = read("sequencer_plan.tiny_v2.json")
    del plan["stages"]
    del plan["shots"][0]["location"]
    plan["shots"][1]["stage_origin"] = {"x": 0, "y": "0", "z": 0}
    eq(run_seq(write_plan(plan)), 2, "v2 plan without its v2 fields")
    text = "\n".join(errors())
    for needle in ("stages:", "location must be a non-empty string", "stage_origin.y"):
        check(needle in text, f"missing v2 validation message {needle!r} in:\n{text}")

    plan = read("sequencer_plan.tiny_v1.json")       # v1 must not need any v2 field
    eq(seq_script.validate_plan(plan), ([], []), "v1 plan validates cleanly")
    plan = read("sequencer_plan.tiny_v2.json")
    eq(seq_script.validate_plan(plan), ([], []), "v2 plan validates cleanly")


@test
def seq_warnings_do_not_block_gaps_and_newer_versions():
    plan = read("sequencer_plan.tiny_v2.json")
    plan["plan_version"] = 3
    plan["shots"][1]["start_frame"] = 40      # frames 36-40 uncovered
    plan["shots"][2]["location"] = "ELSEWHERE"
    eq(run_seq(write_plan(plan)), 0, "exit code")
    text = "\n".join(warnings())
    for needle in ("plan_version 3 is newer", "gap: no shot covers frames 36-40", "not listed in stages"):
        check(needle in text, f"missing warning {needle!r} in:\n{text}")
    assert_sequence_matches(plan, sequence())


@test
def seq_dry_run_creates_nothing():
    eq(run_seq(fixture("sequencer_plan.tiny_v2.json"), "--dry-run"), 0, "exit code")
    eq([p for p in fake.STATE.assets if p.startswith("/Game/")], [], "assets created")
    eq((fake.STATE.calls, fake.STATE.transactions, fake.STATE.actors, fake.STATE.saved), ([], [], [], []), "engine side effects")
    logs = fake.STATE.messages("log")
    eq(sum("dry run: CAM_" in m for m in logs), 3, "one dry-run line per camera")
    check(any("would create Level Sequence /Game/Fabled/Previs/LS_FabledPrevis: 3 cameras, 96 frames @ 24 fps (plan v2)" in m for m in logs), f"summary line: {logs}")
    check(any("nothing was created" in m for m in logs), "explicit nothing-created line")
    eq(run_seq(fixture("sequencer_plan.tiny_v1.json")), 0, "real run")
    before = len(sequence().get_bindings())
    eq(seq_script.main(["--plan", fixture("sequencer_plan.tiny_v1.json"), "--dry-run"]), 0, "dry run over an existing asset")
    check(any("already exists" in m and "--overwrite" in m for m in fake.STATE.messages("log")), "dry run should mention the existing asset")
    eq((len(sequence().get_bindings()), fake.STATE.deleted_assets), (before, []), "existing asset untouched by a dry run")


@test
def seq_engine_version_transaction_progress_cancel_and_options():
    path = fixture("sequencer_plan.tiny_v1.json")
    eq(run_seq(path), 0, "exit code")
    check(any("engine version: 5.8.2" in m for m in fake.STATE.messages("log")), "engine version is logged")
    check(not any("older than" in w for w in warnings()), "no old-engine warning on 5.8")
    check(any("FAKE" in w for w in warnings()), "the fake engine must announce itself")
    eq(len(fake.STATE.transactions), 1, "one editor transaction")
    check(not fake.STATE.transactions[0].open, "transaction closed")
    task = fake.STATE.slow_tasks[0]
    eq((task.work, len(task.frames), task.dialog), (4.0, 4, True), "slow task: one frame per shot plus the cuts")

    eq(run_seq(path, engine_version="5.3.2-29314046+++UE5+Release-5.3"), 0, "old engine still runs")
    check(any("older than 5.4" in w for w in warnings()), "old-engine warning")

    eq(run_seq(path, cancel_after=1), 3, "cancelled exit code")
    seq = sequence()
    eq(len(seq.get_spawnables()), 1, "cameras made before the cancel")
    eq(len(seq.find_tracks_by_type(fake.MovieSceneCameraCutTrack)[0].get_sections()), 1, "cuts for the cameras that exist")
    check(any("cancelled after 1 of 3" in w for w in warnings()), "cancel warning")

    eq(run_seq(path, "--no-save", "--dest", "/Game/Shots/Seq_01/", "--name", "LS_Custom"), 0, "custom dest/name")
    sequence("/Game/Shots/Seq_01/LS_Custom")
    eq(fake.STATE.saved, [], "--no-save saves nothing")

    plan = read("sequencer_plan.tiny_v1.json")
    plan["fps"], plan["title"] = 23.976, "the lantern keeper"
    eq(run_seq(write_plan(plan)), 0, "23.976 fps")
    rate = sequence("/Game/Fabled/Previs/LS_TheLanternKeeper").get_display_rate()
    eq((rate.numerator, rate.denominator), (24000, 1001), "NTSC display rate")


@test
def seq_plain_python_can_only_dry_run():
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    run = lambda *args: subprocess.run([sys.executable, SEQ_SCRIPT, *args], capture_output=True, text=True, env=env, cwd=TMP.name)  # noqa: E731
    ok = run("--plan", fixture("sequencer_plan.tiny_v1.json"), "--dry-run")
    eq(ok.returncode, 0, f"plain-Python dry run exit code ({ok.stderr.strip()[-200:]})")
    check("plain Python" in ok.stdout and ok.stdout.count("dry run: CAM_") == 3, f"dry-run output: {ok.stdout}")
    real = run("--plan", fixture("sequencer_plan.tiny_v1.json"))
    check(real.returncode != 0 and "run this inside Unreal Editor" in real.stderr, f"non-dry-run without Unreal must fail clearly: {real.stderr[-300:]}")
    bad = run("--plan", write_plan({"schema": "x"}, "bad_cli.json"), "--dry-run")
    check(bad.returncode != 0 and "schema:" in bad.stderr, "invalid plan must fail in plain Python too")


# ================================================================================================ blockout helpers

FOLDER = "Fabled/Blockout"
CRATE = "/Game/Fabled/SM_Crate/SM_Crate"


def run_blk(plan_path, *extra, reset=True, meshes=(), **config):
    if reset:
        fake.reset(**config)
    for mesh in meshes:
        fake.add_static_mesh(mesh)
    return blk_script.main(["--plan", plan_path, *extra])


def level(cls=None, folder=None):
    return [a for a in fake.STATE.actors if (cls is None or type(a) is cls) and (folder is None or str(a.get_folder_path()) == folder)]


def by_label():
    return {a.get_actor_label(): a for a in fake.STATE.actors}


def tags(actor):
    return [str(t) for t in actor.tags]


def vec(v):
    return (v.x, v.y, v.z)


def assert_blockout_matches(plan, existing_meshes=(), folder=FOLDER, half_height=92.0):
    actors = level(fake.StaticMeshActor, folder)
    eq(len(actors), len(plan["actors"]), "StaticMeshActor count in the folder")
    labels = by_label()
    cube = fake.STATE.assets["/Engine/BasicShapes/Cube"]
    for item in plan["actors"]:
        actor = labels[item["label"]]
        loc, box, s = item["location"], item["placeholder_box_cm"], item["scale"]
        mesh = actor.static_mesh_component.static_mesh
        if item["mesh_path"] in existing_meshes:
            check(mesh is fake.STATE.assets[item["mesh_path"]], f"{item['label']} should use its real mesh")
            eq(vec(actor.get_actor_location()), (loc["x"], loc["y"], loc["z"]), f"{item['label']} location (base pivot, no lift)")
            eq(vec(actor.get_actor_scale3d()), (s, s, s), f"{item['label']} scale")
            eq(tags(actor), ["fabled", f"fabled:{item['category']}"], f"{item['label']} tags")
        else:
            check(mesh is cube, f"{item['label']} should be the engine cube")
            eq(vec(actor.get_actor_scale3d()), (box["x"] / 100 * s, box["y"] / 100 * s, box["z"] / 100 * s), f"{item['label']} box scale")
            eq(vec(actor.get_actor_location()), (loc["x"], loc["y"], loc["z"] + box["z"] * s / 2), f"{item['label']} location (lifted by half the box height)")
            eq(tags(actor), ["fabled", f"fabled:{item['category']}", "fabled:placeholder"], f"{item['label']} tags")
        rot = actor.get_actor_rotation()
        eq((rot.pitch, rot.yaw, rot.roll), (item["rotation"]["pitch"], item["rotation"]["yaw"], item["rotation"]["roll"]), f"{item['label']} rotation")
    starts = level(fake.PlayerStart)
    ours = [a for a in starts if "fabled" in tags(a)]
    eq(len(ours), 1 if plan.get("spawn") else 0, "Fabled PlayerStart count")
    if plan.get("spawn"):
        sp, ps = plan["spawn"], ours[0]
        eq(vec(ps.get_actor_location()), (sp["x"], sp["y"], sp["z"] + half_height), "PlayerStart location (spawn + capsule half height)")
        rot = ps.get_actor_rotation()
        eq((rot.pitch, rot.yaw, rot.roll), (0.0, float(sp.get("yaw", 0)), 0.0), "PlayerStart rotation")
        eq((str(ps.get_folder_path()), ps.get_actor_label(), tags(ps)), (folder, "PlayerStart_Fabled", ["fabled", "fabled:playerstart"]), "PlayerStart folder/label/tags")


# ================================================================================================ blockout tests

@test
def blk_spawns_meshes_boxes_tags_folder_and_player_start():
    plan = read("blockout_plan.tiny.json")
    eq(run_blk(fixture("blockout_plan.tiny.json"), meshes=[CRATE]), 0, "exit code")
    assert_blockout_matches(plan, existing_meshes=[CRATE])
    labels = by_label()
    eq(vec(labels["SM_Gate_b002"].get_actor_scale3d()), (4.0, 2.5, 5.0), "400x250x500 cm box from the 100 cm cube")
    eq(labels["SM_Gate_b002"].get_actor_location().z, 270.0, "box centre = base z 20 + 500/2")
    eq(vec(labels["SM_Troll_c003"].get_actor_scale3d()), (1.6, 1.2, 3.8), "box scale times the item scale of 2")
    eq(labels["SM_Troll_c003"].get_actor_location().z, 190.0, "z compensation uses the scaled height")
    eq(labels["SM_Crate_a001"].get_actor_location().z, 0.0, "real mesh is not lifted")
    eq(len(fake.STATE.actors), 4, "nothing else in the level")
    eq((fake.STATE.level_saves, fake.STATE.saved), (0, []), "nothing saved automatically")
    check(any("nothing was saved" in m for m in fake.STATE.messages("log")), "says the level is left unsaved")
    eq(errors(), [], "errors logged")


@test
def blk_rerun_is_idempotent_with_a_single_player_start():
    plan = read("blockout_plan.tiny.json")
    eq(run_blk(fixture("blockout_plan.tiny.json"), meshes=[CRATE]), 0, "first run")
    first = list(fake.STATE.actors)
    first_start = level(fake.PlayerStart)[0]
    for _ in range(2):
        eq(run_blk(fixture("blockout_plan.tiny.json"), reset=False), 0, "re-run")
        assert_blockout_matches(plan, existing_meshes=[CRATE])
        eq(len(fake.STATE.actors), 4, "actor count after a re-run")
        eq(len(level(fake.PlayerStart)), 1, "PlayerStart count after a re-run")
        check(level(fake.PlayerStart)[0] is first_start, "the PlayerStart is moved, not replaced")
    check(all(a in fake.STATE.destroyed for a in first if a is not first_start), "first-run actors were replaced")


@test
def blk_only_deletes_its_own_tagged_actors():
    plan = read("blockout_plan.tiny.json")
    fake.reset()
    sub = fake.get_editor_subsystem(fake.EditorActorSubsystem)
    untagged = sub.spawn_actor_from_class(fake.StaticMeshActor, fake.Vector(1, 2, 3))
    untagged.set_folder_path(FOLDER)                       # a person's actor in the same folder
    untagged.set_actor_label("SM_Gate_b002")               # even with a clashing label
    other_tag = sub.spawn_actor_from_class(fake.StaticMeshActor, fake.Vector())
    other_tag.set_folder_path(FOLDER)
    other_tag.set_editor_property("tags", [fake.Name("mine")])
    elsewhere = sub.spawn_actor_from_class(fake.StaticMeshActor, fake.Vector())
    elsewhere.set_folder_path("Fabled/Other")              # tagged fabled but in another folder
    elsewhere.set_editor_property("tags", [fake.Name("fabled")])
    user_start = sub.spawn_actor_from_class(fake.PlayerStart, fake.Vector(5, 5, 92))
    user_start.set_folder_path(FOLDER)                     # a person's PlayerStart in the folder, untagged
    mine = [untagged, other_tag, elsewhere, user_start]
    for _ in range(2):
        eq(run_blk(fixture("blockout_plan.tiny.json"), reset=False), 0, "run")
        check(all(a in fake.STATE.actors for a in mine), "an actor the script did not create was deleted")
        check(not any(a in fake.STATE.destroyed for a in mine), "an actor the script did not create was destroyed")
        eq(len(fake.STATE.actors), 4 + 3 + 1, "foreign actors + plan actors + one Fabled PlayerStart")
    eq(vec(untagged.get_actor_location()), (1.0, 2.0, 3.0), "foreign actor not moved")
    eq(vec(user_start.get_actor_location()), (5.0, 5.0, 92.0), "the person's PlayerStart not moved")
    eq(len([a for a in level(fake.PlayerStart) if "fabled" in tags(a)]), 1, "one Fabled PlayerStart")
    eq(len(fake.STATE.destroyed), 3, "only the first run's three plan actors were replaced")
    check(any("left 3 actor(s)" in m and "untouched" in m for m in fake.STATE.messages("log")), "reports what it left alone")


@test
def blk_boxes_become_meshes_after_import():
    plan = read("blockout_plan.tiny.json")
    eq(run_blk(fixture("blockout_plan.tiny.json")), 0, "first run, nothing imported")
    assert_blockout_matches(plan)
    check(any("plan says this asset is imported" in w for w in warnings()), "warns when the plan says imported but the mesh is missing")
    gate = "/Game/Fabled/SM_Gate/SM_Gate"
    eq(run_blk(fixture("blockout_plan.tiny.json"), reset=False, meshes=[CRATE, gate]), 0, "second run after import")
    assert_blockout_matches(plan, existing_meshes=[CRATE, gate])


@test
def blk_finds_meshes_at_the_importers_default_path_and_rejects_non_meshes():
    eq(blk_script.mesh_candidates("/Game/Fabled/SM_Gate/SM_Gate"), ["/Game/Fabled/SM_Gate/SM_Gate", "/Game/Fabled/Gate/SM_Gate"], "candidates (SM_ name)")
    eq(blk_script.mesh_candidates("/Game/Fabled/Gate/Gate"), ["/Game/Fabled/Gate/Gate", "/Game/Fabled/Gate/SM_Gate"], "candidates (plain name)")
    eq(run_blk(fixture("blockout_plan.tiny.json"), meshes=["/Game/Fabled/Gate/SM_Gate"]), 0, "exit code")
    gate = by_label()["SM_Gate_b002"]
    check(gate.static_mesh_component.static_mesh is fake.STATE.assets["/Game/Fabled/Gate/SM_Gate"], "importer-default path should be used")
    eq(tags(gate), ["fabled", "fabled:environment"], "real-mesh tags")

    fake.reset()
    fake.add_asset(CRATE, fake.SkeletalMesh(CRATE))
    eq(blk_script.main(["--plan", fixture("blockout_plan.tiny.json")]), 0, "exit code with a skeletal mesh at the path")
    crate = by_label()["SM_Crate_a001"]
    check(crate.static_mesh_component.static_mesh is fake.STATE.assets["/Engine/BasicShapes/Cube"], "non-static-mesh asset falls back to a box")
    check(any("not a Static Mesh" in w for w in warnings()), "warns about the asset type")


@test
def blk_keep_mode_only_adds_what_is_missing():
    plan = read("blockout_plan.tiny.json")
    eq(run_blk(fixture("blockout_plan.tiny.json")), 0, "first run")
    first = list(fake.STATE.actors)
    eq(run_blk(fixture("blockout_plan.tiny.json"), "--keep", reset=False), 0, "--keep run")
    eq(fake.STATE.actors, first, "--keep must not delete or add when everything is present")
    eq(fake.STATE.destroyed, [], "--keep destroys nothing")
    gone = by_label()["SM_Troll_c003"]
    fake.get_editor_subsystem(fake.EditorActorSubsystem).destroy_actor(gone)
    eq(run_blk(fixture("blockout_plan.tiny.json"), "--keep", reset=False), 0, "--keep run after removing one")
    assert_blockout_matches(plan)
    eq(len(fake.STATE.actors), 4, "only the missing actor was added back")
    check(all(a in fake.STATE.actors for a in first if a is not gone), "kept actors are the original ones")
    fake.reset()
    eq(blk_script.main(["--plan", fixture("blockout_plan.tiny.json"), "--keep", "--overwrite"]), 2, "--keep with --overwrite is rejected")


@test
def blk_dry_run_changes_nothing():
    eq(run_blk(fixture("blockout_plan.tiny.json"), "--dry-run", meshes=[CRATE]), 0, "exit code")
    eq((fake.STATE.actors, fake.STATE.destroyed, fake.STATE.transactions, fake.STATE.calls), ([], [], [], []), "side effects")
    logs = "\n".join(fake.STATE.messages("log"))
    for needle in ("SM_Crate_a001 [prop] mesh /Game/Fabled/SM_Crate/SM_Crate", "SM_Gate_b002 [environment] placeholder box at (1400, 0, 270)",
                   "cube scale (4, 2.5, 5)", "PlayerStart at (0, -1200, 92) yaw 90", "would spawn 3 actor(s)", "1 real meshes, 2 placeholder boxes", "nothing was changed"):
        check(needle in logs, f"missing dry-run line {needle!r} in:\n{logs}")
    eq(run_blk(fixture("blockout_plan.tiny.json")), 0, "real run")
    before = list(fake.STATE.actors)
    eq(run_blk(fixture("blockout_plan.tiny.json"), "--dry-run", reset=False), 0, "dry run over existing output")
    eq((fake.STATE.actors, fake.STATE.destroyed), (before, []), "existing output untouched by a dry run")
    check(any("holds 3 actor(s) from a previous run" in m for m in fake.STATE.messages("log")), "dry run reports what an overwrite would delete")


@test
def blk_validation_reports_every_problem_at_once_and_changes_nothing():
    plan = read("blockout_plan.tiny.json")
    plan["schema"] = "fabled.layout/0.1"
    plan["spawn"] = {"x": 0, "y": "far", "z": 0}
    a, b, c = plan["actors"]
    a["label"] = ""
    a["scale"] = 0
    b["mesh_path"] = "Game/NoLeadingSlash"
    b["placeholder_box_cm"]["z"] = -5
    b["rotation"] = {"pitch": 0, "yaw": None, "roll": 0}
    del c["location"]
    c["category"] = 7
    c["imported"] = "yes"
    eq(run_blk(write_plan(plan), meshes=[CRATE]), 2, "exit code")
    text = "\n".join(errors())
    for needle in ("schema:", "spawn:", "label must be a non-empty string", "scale must be a number greater than 0", "mesh_path must be a content path",
                   "placeholder_box_cm values must all be greater than 0", "rotation.yaw", "location must be an object", "category must be", "imported must be"):
        check(needle in text, f"missing validation message {needle!r} in:\n{text}")
    check(f"{len(errors()) - 1} problem(s)" in errors()[0], f"summary line should count the problems: {errors()[0]}")
    eq((fake.STATE.actors, fake.STATE.transactions, fake.STATE.calls), ([], [], []), "side effects")
    eq(run_blk(os.path.join(TMP.name, "nope.json")), 2, "missing file")
    eq(run_blk(write_plan("{")), 2, "invalid JSON")
    eq(run_blk(fixture("blockout_plan.tiny.json"), "--folder", "/"), 2, "empty folder")
    eq(run_blk(fixture("sequencer_plan.tiny_v1.json")), 2, "a sequencer plan is not a blockout plan")
    fake.reset()
    eq(blk_script.main([]), 2, "no --plan")
    with contextlib.redirect_stdout(io.StringIO()) as out:
        eq(blk_script.main(["--help"]), 0, "--help must return, not exit the interpreter")
    check("--keep" in out.getvalue() and "--dry-run" in out.getvalue(), "--help lists the options")
    eq(blk_script.validate_plan(read("blockout_plan.tiny.json")), ([], []), "tiny plan validates cleanly")
    eq(blk_script.validate_plan(read("blockout_plan.mossgate.json")), ([], []), "production plan validates cleanly")


@test
def blk_production_fixture_from_the_real_exporter():
    plan = read("blockout_plan.mossgate.json")
    check(len(plan["actors"]) >= 10, "fixture should be the full Mossgate plan")
    eq(run_blk(fixture("blockout_plan.mossgate.json")), 0, "exit code")
    assert_blockout_matches(plan)
    eq(run_blk(fixture("blockout_plan.mossgate.json"), reset=False), 0, "re-run")
    assert_blockout_matches(plan)
    eq(len(fake.STATE.actors), len(plan["actors"]) + 1, "idempotent on the production plan")
    categories = {t for a in level(fake.StaticMeshActor) for t in tags(a)}
    check({"fabled", "fabled:placeholder"} <= categories and any(t.startswith("fabled:") and t not in ("fabled:placeholder",) for t in categories), f"tags: {categories}")


@test
def blk_player_start_height_folder_option_and_no_spawn():
    plan = read("blockout_plan.tiny.json")
    eq(run_blk(fixture("blockout_plan.tiny.json"), "--folder", "/Levels/Greybox/", player_start_half_height=96.0), 0, "exit code")
    assert_blockout_matches(plan, folder="Levels/Greybox", half_height=96.0)   # the real capsule height is read back
    del plan["spawn"]
    eq(run_blk(write_plan(plan)), 0, "plan without a spawn point")
    eq(level(fake.PlayerStart), [], "no PlayerStart without a spawn point")
    check(any("no PlayerStart will be placed" in w for w in warnings()), "warns that no PlayerStart is placed")


@test
def blk_tilted_placeholder_is_lifted_along_its_own_up_axis():
    item = {"location": {"x": 10, "y": 20, "z": 30}, "rotation": {"pitch": 0, "yaw": 0, "roll": 0}, "scale": 2, "placeholder_box_cm": {"x": 100, "y": 100, "z": 300}}
    eq(blk_script.placeholder_scale(item), (2.0, 2.0, 6.0), "scale")
    eq(blk_script.placeholder_location(item), (10.0, 20.0, 330.0), "upright: straight up by half the scaled height")
    item["rotation"]["yaw"] = 123
    for got, want in zip(blk_script.placeholder_location(item), (10.0, 20.0, 330.0)):
        near(got, want, "yaw does not change the lift")
    item["rotation"] = {"pitch": 0, "yaw": 0, "roll": 90}     # rolled clockwise: the box's up axis is world +Y
    for got, want in zip(blk_script.placeholder_location(item), (10.0, 320.0, 30.0)):
        near(got, want, "roll 90 lifts along +Y")
    item["rotation"] = {"pitch": 90, "yaw": 0, "roll": 0}     # nose straight up: the box's up axis is world -X
    for got, want in zip(blk_script.placeholder_location(item), (-290.0, 20.0, 30.0)):
        near(got, want, "pitch 90 lifts along -X")


@test
def blk_level_handling_transaction_progress_and_cancel():
    path = fixture("blockout_plan.tiny.json")
    eq(run_blk(path, has_world=False), 1, "no level open")
    check(any("no level is open" in e and "--map" in e for e in errors()), f"clear message expected: {errors()}")
    eq(fake.STATE.actors, [], "nothing spawned without a level")

    fake.reset(has_world=False)
    fake.STATE.maps.add("/Game/Maps/Blockout")
    eq(blk_script.main(["--plan", path, "--map", "/Game/Maps/Blockout", "--save-level"]), 0, "headless-style run with --map and --save-level")
    eq((fake.STATE.loaded_map, fake.STATE.level_saves, len(fake.STATE.actors)), ("/Game/Maps/Blockout", 1, 4), "map loaded, saved once, actors spawned")
    eq(run_blk(path, "--map", "/Game/Maps/Missing"), 1, "unknown map")
    eq(fake.STATE.actors, [], "nothing spawned when the map does not load")

    eq(run_blk(path), 0, "normal run")
    eq(len(fake.STATE.transactions), 1, "one editor transaction")
    task = fake.STATE.slow_tasks[0]
    eq((task.work, len(task.frames), task.dialog), (4.0, 4, True), "slow task: one frame per item plus the player start")
    check(any("engine version: 5.8.2" in m for m in fake.STATE.messages("log")), "engine version is logged")
    eq(run_blk(path, engine_version="5.2.1-0+++UE5+Release-5.2"), 0, "old engine still runs")
    check(any("older than 5.4" in w for w in warnings()), "old-engine warning")

    eq(run_blk(path, cancel_after=2), 3, "cancelled exit code")
    eq(len(level(fake.StaticMeshActor)), 2, "actors spawned before the cancel")
    check(any("cancelled after 2 of 3" in w for w in warnings()), "cancel warning")


@test
def blk_plain_python_can_only_dry_run():
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    run = lambda *args: subprocess.run([sys.executable, BLK_SCRIPT, *args], capture_output=True, text=True, env=env, cwd=TMP.name)  # noqa: E731
    ok = run("--plan", fixture("blockout_plan.tiny.json"), "--dry-run")
    eq(ok.returncode, 0, f"plain-Python dry run exit code ({ok.stderr.strip()[-200:]})")
    check("plain Python" in ok.stdout and "would spawn 3 actor(s)" in ok.stdout, f"dry-run output: {ok.stdout}")
    real = run("--plan", fixture("blockout_plan.tiny.json"))
    check(real.returncode != 0 and "run this inside Unreal Editor" in real.stderr, f"non-dry-run without Unreal must fail clearly: {real.stderr[-300:]}")


@test
def scripts_keep_their_untested_labels_and_document_both_invocations():
    for path in (SEQ_SCRIPT, BLK_SCRIPT):
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        name = os.path.basename(path)
        for needle in ("UNTESTED IN ENGINE", "UNTESTED DRAFT", "-run=pythonscript -script=", 'py "C:/path/', "Python Editor Script Plugin",
                       "Most likely to need adjusting", "def main(argv=None):"):
            check(needle in text, f"{name}: header/entry point should contain {needle!r}")
        check("import threading" not in text and "concurrent.futures" not in text, f"{name}: must stay on the game thread")


# ================================================================================================ runner

def main():
    passed = failed = 0
    for fn in TESTS:
        fake.reset()
        try:
            fn()
        except AssertionError as exc:
            failed += 1
            print(f"\u2717 {fn.__name__}\n    {exc}")
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"\u2717 {fn.__name__}\n    " + traceback.format_exc().strip().replace("\n", "\n    "))
        else:
            passed += 1
            print(f"\u2713 {fn.__name__}")
    TMP.cleanup()
    print(f"\n{passed} passed, {failed} failed, {passed + failed} total "
          "(against the FAKE unreal module: this checks the scripts' logic, not the real engine API)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
