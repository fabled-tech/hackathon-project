"""Fabled Forge → Unreal level blockout builder.  **UNTESTED DRAFT** (never executed in an editor from the build box).

Reads a `fabled.blockout_plan/0.1` JSON exported by the Fabled Forge workspace and spawns one actor per placed item in
the open level. If the asset already exists at its Fabled content path (/Game/Fabled/<Asset>/<Asset>, where
../unreal/import_fabled_asset.py puts it) a StaticMeshActor with that mesh is spawned; otherwise a placeholder cube
is scaled to the budgeted footprint and height so the layout reads before any art exists. Re-running the script
replaces the actors in its folder, so boxes become meshes as assets are imported. Run inside the Unreal Editor:

    py "C:/path/blockout_from_layout.py" --plan "C:/path/blockout_plan.json" --folder Fabled/Blockout

Requires the Python Editor Script Plugin (UE 5.6+). Nothing here touches the network.

Follow-up (not in this draft): drive the same plan into a *running* editor over the Remote Control API
(HTTP on port 30010, `PUT /remote/object/call` on an EditorActorSubsystem) so a browser session can place actors live.
"""
import argparse
import json

import unreal  # type: ignore

CUBE = "/Engine/BasicShapes/Cube.Cube"  # 100 cm cube
CUBE_CM = 100.0


def _clear_folder(actor_subsystem, folder):
    for actor in actor_subsystem.get_all_level_actors():
        if str(actor.get_folder_path()) == folder:
            actor_subsystem.destroy_actor(actor)


def build(plan_path, folder):
    with open(plan_path, "r", encoding="utf-8") as fh:
        plan = json.load(fh)
    if plan.get("schema") != "fabled.blockout_plan/0.1":
        raise SystemExit(f"[Fabled] unexpected schema {plan.get('schema')!r}")
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    _clear_folder(actors, folder)
    cube = unreal.EditorAssetLibrary.load_asset(CUBE)
    spawned, real = 0, 0
    for item in plan["actors"]:
        loc = unreal.Vector(item["location"]["x"], item["location"]["y"], item["location"]["z"])
        rot = unreal.Rotator(roll=item["rotation"]["roll"], pitch=item["rotation"]["pitch"], yaw=item["rotation"]["yaw"])
        mesh = unreal.EditorAssetLibrary.load_asset(item["mesh_path"]) if unreal.EditorAssetLibrary.does_asset_exist(item["mesh_path"]) else None
        actor = actors.spawn_actor_from_class(unreal.StaticMeshActor, loc, rot)
        comp = actor.static_mesh_component
        if mesh is not None:
            comp.set_static_mesh(mesh)
            actor.set_actor_scale3d(unreal.Vector(item["scale"], item["scale"], item["scale"]))
            real += 1
        else:
            box = item["placeholder_box_cm"]
            comp.set_static_mesh(cube)
            actor.set_actor_scale3d(unreal.Vector(box["x"] / CUBE_CM * item["scale"], box["y"] / CUBE_CM * item["scale"], box["z"] / CUBE_CM * item["scale"]))
            actor.set_actor_location(unreal.Vector(loc.x, loc.y, loc.z + box["z"] * item["scale"] / 2.0), False, False)  # cube pivot is centred
        actor.set_actor_label(item["label"])
        actor.set_folder_path(folder)
        actor.tags.append(unreal.Name(f"fabled:{item['category']}"))
        spawned += 1
    sp = plan.get("spawn")
    if sp:
        ps = actors.spawn_actor_from_class(unreal.PlayerStart, unreal.Vector(sp["x"], sp["y"], sp["z"] + 90), unreal.Rotator(0, 0, sp.get("yaw", 0)))
        ps.set_actor_label("PlayerStart_Fabled")
        ps.set_folder_path(folder)
    unreal.log(f"[Fabled] done: {spawned} actors in '{folder}' ({real} real meshes, {spawned - real} placeholder boxes)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--folder", default="Fabled/Blockout")
    args = ap.parse_args()
    build(args.plan, args.folder)
