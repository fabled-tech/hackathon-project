"""Fabled Shots → Unreal Sequencer builder.  **UNTESTED DRAFT** (never executed in an editor from the build box).

Reads a `fabled.sequencer_plan/0.1` JSON exported by the Fabled Shots workspace and builds a Level Sequence:
one spawnable CineCameraActor per shot, keyed focal length, a start→end transform for the camera move, and a camera
cut track covering each shot's frame range. Run it from the Unreal Editor (UE 5.6+; written against the 5.7/5.8 API
names seen in Epic's docs as of Nov 2026):

    py "C:/path/build_sequence_from_shotlist.py" --plan "C:/path/sequencer_plan.json" --dest /Game/Fabled/Previs

Requires: Python Editor Script Plugin, Sequencer Scripting plugin. Nothing here touches the network.

Things to verify on first run (the API has moved between versions):
  * `unreal.LevelSequenceEditorSubsystem.create_camera(spawnable=True)` returns (binding, camera actor); on 5.4 and
    older the function lives on `unreal.LevelSequenceEditorBlueprintLibrary` or does not exist.
  * Focal length keys go on the CineCameraComponent's `CurrentFocalLength` float channel via a
    `MovieSceneFloatTrack`; property names are case-sensitive.
  * Transform keys: `MovieScene3DTransformSection.get_channels()` returns 9 double channels in 5.x (location xyz,
    rotation xyz, scale xyz). Older versions used float channels.
  * If camera cuts do not show, open the sequence once in the editor and re-run; Camera Cut track creation is cached.
"""
import argparse
import json
import math

import unreal  # type: ignore

FPS_DEFAULT = 24


def _frame(n):
    return unreal.FrameNumber(int(n))


def _look_at_rotation(cam, target):
    dx, dy, dz = target["x"] - cam["x"], target["y"] - cam["y"], target["z"] - cam["z"]
    yaw = math.degrees(math.atan2(dy, dx))
    pitch = math.degrees(math.atan2(dz, math.hypot(dx, dy)))
    return unreal.Rotator(roll=0.0, pitch=pitch, yaw=yaw)


def build(plan_path, dest_path, sequence_name=None):
    with open(plan_path, "r", encoding="utf-8") as fh:
        plan = json.load(fh)
    if plan.get("schema") != "fabled.sequencer_plan/0.1":
        raise SystemExit(f"[Fabled] unexpected schema {plan.get('schema')!r}")
    fps = int(plan.get("fps") or FPS_DEFAULT)
    name = sequence_name or f"LS_{plan.get('title', 'FabledPrevis').replace(' ', '')}"

    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    seq = asset_tools.create_asset(name, dest_path, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    if seq is None:
        raise SystemExit("[Fabled] could not create the Level Sequence (does the asset already exist?)")
    seq.set_display_rate(unreal.FrameRate(numerator=fps, denominator=1))
    seq.set_playback_start(0)
    seq.set_playback_end(int(plan["total_frames"]))

    # Open it so the editor subsystem can add spawnable cameras.
    unreal.LevelSequenceEditorBlueprintLibrary.open_level_sequence(seq)
    subsystem = unreal.get_editor_subsystem(unreal.LevelSequenceEditorSubsystem)
    cut_track = seq.add_track(unreal.MovieSceneCameraCutTrack)

    for shot in plan["shots"]:
        binding, camera = subsystem.create_camera(spawnable=True)  # VERIFY: signature per engine version
        camera.set_actor_label(f"CAM_{shot['id']}")
        start, end = _frame(shot["start_frame"]), _frame(shot["end_frame"])

        # Focal length
        cine = camera.get_cine_camera_component()
        comp_binding = seq.add_possessable(cine)
        comp_binding.set_parent(binding)
        focal_track = comp_binding.add_track(unreal.MovieSceneFloatTrack)
        focal_track.set_property_name_and_path("CurrentFocalLength", "CurrentFocalLength")
        focal_section = focal_track.add_section()
        focal_section.set_range(start, end)
        focal_section.get_channels()[0].add_key(start, float(shot["focal_length_mm"]))

        # Transform: start and end of the camera move, aimed at the look-at mark.
        xf_track = binding.add_track(unreal.MovieScene3DTransformTrack)
        xf_section = xf_track.add_section()
        xf_section.set_range(start, end)
        channels = xf_section.get_channels()  # [loc x,y,z, rot x,y,z, scale x,y,z]
        for frame, pos in ((start, shot["camera_start"]), (end, shot["camera_end"])):
            rot = _look_at_rotation(pos, shot["look_at"])
            for ch, value in zip(channels[:6], (pos["x"], pos["y"], pos["z"], rot.roll, rot.pitch, rot.yaw)):
                ch.add_key(frame, float(value))
        for ch in channels[6:9]:
            ch.add_key(start, 1.0)

        # Camera cut
        cut = cut_track.add_section()
        cut.set_range(start, end)
        cut.set_camera_binding_id(unreal.MovieSceneObjectBindingID(guid=binding.get_id()))  # VERIFY: helper differs by version
        unreal.log(f"[Fabled] {shot['id']}: frames {shot['start_frame']}-{shot['end_frame']} {shot['focal_length_mm']}mm  {shot.get('label', '')}")

    unreal.EditorAssetLibrary.save_loaded_asset(seq)
    unreal.log(f"[Fabled] done: {dest_path}/{name}  ({len(plan['shots'])} shots, {plan['total_frames']} frames @ {fps} fps)")
    return seq


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--dest", default="/Game/Fabled/Previs")
    ap.add_argument("--name", default=None)
    args = ap.parse_args()
    build(args.plan, args.dest, args.name)
