"""
Fabled -> Unreal import script (Unreal Editor Python).

STATUS: UNTESTED DRAFT. Written without access to Unreal Editor (no UE install on the build box).
Check every API call against your engine version before relying on it. Targets UE 5.3-5.5, Python
Editor Script Plugin enabled.

What it does
  1. Reads the Fabled pipeline manifest (prototype/ui/INTERFACES.md, section 2) and, if present,
     the UI import profile (scale, skeleton, LOD screen sizes).
  2. Imports the combined FBX (LOD0..n in one file, `_LOD<n>` meshes / LOD group) with
     unreal.AssetImportTask + unreal.FbxImportUI: uniform scale, static or skeletal, LOD import,
     manual LOD screen sizes, materials and textures.
  3. If there is no combined FBX, imports LOD0 and then adds LOD1..n from the per-LOD files.
  4. Logs triangle counts per LOD as Unreal reports them, so they can be compared with the manifest.

Run
  In the editor:   py "C:/path/to/import_fabled_asset.py" --manifest "C:/path/to/out/manifest.json" --dest /Game/Fabled/Demo
  Headless:        UnrealEditor-Cmd.exe MyProject.uproject -run=pythonscript -script="C:/path/import_fabled_asset.py --manifest C:/path/manifest.json"

Options
  --manifest PATH        pipeline manifest.json (required)
  --profile PATH         UI profile.json (optional; defaults to manifest["profile"]["fabled_profile"] if there)
  --dest /Game/...       destination content folder (default /Game/Fabled/<asset name>)
  --name NAME            asset name override
  --scale FLOAT          import uniform scale override (default: 1.0, because the pipeline exports in cm, see note)
  --skeleton /Game/...   skeleton asset override (forces skeletal import)
  --no-materials         skip material/texture import

Units note: the pipeline config has export.unreal_units = "cm" and applies source_units_to_m itself, so the
FBX should already be in Unreal units and the import scale stays 1.0. Only pass --scale if you import a raw
file that was not normalised.

Interchange note: in UE 5.3+ FBX may go through Interchange instead of the legacy FBX importer, and then
FbxImportUI options can be ignored. If the options don't seem to apply, either run
`Interchange.FeatureFlags.Import.FBX 0` in the console (legacy importer) or port the options to an
Interchange pipeline (see TODO at the bottom).
"""
import argparse
import json
import os
import sys

import unreal


def log(msg):
    unreal.log(f"[Fabled] {msg}")


def warn(msg):
    unreal.log_warning(f"[Fabled] {msg}")


def parse_args(argv):
    ap = argparse.ArgumentParser(prog="import_fabled_asset.py")
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--profile")
    ap.add_argument("--dest")
    ap.add_argument("--name")
    ap.add_argument("--scale", type=float)
    ap.add_argument("--skeleton")
    ap.add_argument("--no-materials", action="store_true")
    return ap.parse_args(argv)


def resolve(path, manifest_path):
    """Manifest paths may be relative to the manifest folder or to prototype/ (pipeline rel())."""
    if not path:
        return None
    if os.path.isabs(path) and os.path.exists(path):
        return path
    mdir = os.path.dirname(os.path.abspath(manifest_path))
    for base in (mdir, os.path.abspath(os.path.join(mdir, "..", "..", "..", "..")), os.path.abspath(os.path.join(mdir, ".."))):
        cand = os.path.join(base, path)
        if os.path.exists(cand):
            return cand
    return None


def lods_from_manifest(m):
    raw = (m.get("outputs") or {}).get("lods") or m.get("lods") or []
    out = []
    for i, l in enumerate(raw):
        level = l.get("level")
        if level is None and str(l.get("name", "")).upper().startswith("LOD"):
            level = int(str(l["name"])[3:])
        out.append({
            "level": i if level is None else int(level),
            "path": l.get("path") or l.get("file") or l.get("fbx") or l.get("glb") or l.get("obj"),
            "triangles": l.get("triangles", l.get("tris")),
            "screen_size": l.get("screen_size"),
        })
    return sorted(out, key=lambda x: x["level"])


def build_fbx_options(skeletal, skeleton_asset, scale, import_lods, screen_sizes, materials):
    ui = unreal.FbxImportUI()
    ui.set_editor_property("import_mesh", True)
    ui.set_editor_property("import_as_skeletal", skeletal)
    ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_SKELETAL_MESH if skeletal else unreal.FBXImportType.FBXIT_STATIC_MESH)
    ui.set_editor_property("import_materials", materials)
    ui.set_editor_property("import_textures", materials)
    ui.set_editor_property("import_animations", False)
    ui.set_editor_property("create_physics_asset", False)
    if skeletal and skeleton_asset:
        ui.set_editor_property("skeleton", skeleton_asset)

    # LODs: manual screen sizes from the profile; Unreal's auto distances otherwise.
    if screen_sizes:
        ui.set_editor_property("auto_compute_lod_distances", False)
        for i, s in enumerate(screen_sizes[:8]):
            ui.set_editor_property(f"lod_distance{i}", float(s))
        ui.set_editor_property("lod_number", len(screen_sizes))

    data = ui.skeletal_mesh_import_data if skeletal else ui.static_mesh_import_data
    data.set_editor_property("import_uniform_scale", float(scale))
    data.set_editor_property("convert_scene", True)
    data.set_editor_property("import_mesh_lo_ds", bool(import_lods))
    data.set_editor_property("normal_import_method", unreal.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS_AND_TANGENTS)
    if not skeletal:
        data.set_editor_property("combine_meshes", True)
        data.set_editor_property("auto_generate_collision", True)
        data.set_editor_property("generate_lightmap_u_vs", True)
    return ui


def import_file(path, dest, name, options):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", path)
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("destination_name", name)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    task.set_editor_property("options", options)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = list(task.get_editor_property("imported_object_paths") or [])
    log(f"imported {path} -> {paths}")
    return paths


def find_mesh(paths, skeletal):
    cls = unreal.SkeletalMesh if skeletal else unreal.StaticMesh
    for p in paths:
        a = unreal.EditorAssetLibrary.load_asset(p)
        if isinstance(a, cls):
            return a
    return None


def add_lod_from_file(mesh, lod_index, path, skeletal):
    """Add/replace a LOD from a separate file. API names differ between engine versions."""
    try:
        if skeletal:
            ok = unreal.get_editor_subsystem(unreal.SkeletalMeshEditorSubsystem).import_lod(mesh, lod_index, path)
        elif hasattr(unreal, "EditorStaticMeshLibrary") and hasattr(unreal.EditorStaticMeshLibrary, "import_lod"):
            ok = unreal.EditorStaticMeshLibrary.import_lod(mesh, lod_index, path)
        else:
            ok = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem).import_lod(mesh, lod_index, path)
        log(f"LOD{lod_index} from {path}: {ok}")
    except Exception as exc:  # noqa: BLE001
        warn(f"could not import LOD{lod_index} from {path}: {exc}")


def report_tris(mesh, skeletal, manifest_lods):
    """Log what Unreal counts per LOD next to what the manifest says (no numbers invented)."""
    if skeletal:
        warn("skeletal LOD triangle readback not implemented in this draft")
        return
    sub = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    n = sub.get_lod_count(mesh)
    for i in range(n):
        tris = None
        try:  # API availability varies by engine version; None = could not read, never a guess
            if hasattr(mesh, "get_num_triangles"):
                tris = mesh.get_num_triangles(i)
        except Exception:  # noqa: BLE001
            tris = None
        want = next((l["triangles"] for l in manifest_lods if l["level"] == i), None)
        log(f"LOD{i}: unreal tris={tris} manifest tris={want}")


def main(argv):
    a = parse_args(argv)
    with open(a.manifest, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    if manifest.get("concept_mockup"):
        warn("manifest is marked concept_mockup; this is not real pipeline output")

    profile = {}
    if a.profile:
        with open(a.profile, "r", encoding="utf-8") as fh:
            profile = json.load(fh)
    else:
        profile = (manifest.get("profile") or {}).get("fabled_profile") or manifest.get("profile") or {}

    lods = lods_from_manifest(manifest)
    outputs = manifest.get("outputs") or {}
    combined = resolve(outputs.get("combined_fbx") or manifest.get("combined_fbx"), a.manifest)

    src_name = os.path.splitext(os.path.basename((manifest.get("input") or {}).get("sculpt_path") or "FabledAsset"))[0]
    name = a.name or f"SM_{src_name}"
    dest = a.dest or f"/Game/Fabled/{src_name}"

    skel_path = a.skeleton or ((profile.get("skeleton") or {}).get("asset_path") if (profile.get("skeleton") or {}).get("type") not in (None, "none") else None)
    skeleton = unreal.EditorAssetLibrary.load_asset(skel_path) if skel_path else None
    if skel_path and not skeleton:
        warn(f"skeleton {skel_path} not found; importing as static mesh")
    skeletal = skeleton is not None
    if skeletal:
        name = a.name or f"SK_{src_name}"

    scale = a.scale if a.scale is not None else 1.0
    screen_sizes = [l["screen_size"] for l in lods if l.get("screen_size") is not None] or \
                   [l.get("screen_size") for l in profile.get("lod_budget", []) if l.get("screen_size") is not None]
    materials = not a.no_materials

    log(f"dest={dest} name={name} skeletal={skeletal} scale={scale} lods={len(lods)} combined={combined}")

    if combined:
        opts = build_fbx_options(skeletal, skeleton, scale, True, screen_sizes, materials)
        paths = import_file(combined, dest, name, opts)
        mesh = find_mesh(paths, skeletal)
    else:
        if not lods:
            raise RuntimeError("manifest has neither combined_fbx nor lods")
        lod0 = resolve(lods[0]["path"], a.manifest)
        if not lod0:
            raise RuntimeError(f"LOD0 file not found: {lods[0]['path']}")
        opts = build_fbx_options(skeletal, skeleton, scale, False, screen_sizes, materials)
        paths = import_file(lod0, dest, name, opts)
        mesh = find_mesh(paths, skeletal)
        if mesh:
            for l in lods[1:]:
                p = resolve(l["path"], a.manifest)
                if p:
                    add_lod_from_file(mesh, l["level"], p, skeletal)
                else:
                    warn(f"LOD{l['level']} file not found: {l['path']}")

    if not mesh:
        raise RuntimeError("import produced no mesh asset (check the Output Log)")
    report_tris(mesh, skeletal, lods)
    unreal.EditorAssetLibrary.save_loaded_asset(mesh)
    log(f"done: {mesh.get_path_name()}")
    return mesh


# TODO (Interchange): for UE 5.3+ with Interchange FBX, build an InterchangeGenericAssetsPipeline,
# set common_meshes_properties / mesh_pipeline (import LODs, force skeletal, skeleton) and pass it via
# unreal.InterchangeManager.get_interchange_manager_scripted().import_asset(...) with ImportAssetParameters.
# TODO (materials): create a material instance from a studio master material and connect the baked
# normal / base color textures named in manifest.outputs.textures.

if __name__ == "__main__":
    main(sys.argv[1:])
