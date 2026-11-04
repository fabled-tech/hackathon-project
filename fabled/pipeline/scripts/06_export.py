"""Step 6: FBX export per LOD with Unreal-friendly settings, then re-import each FBX to verify.

Unit strategy (1 Unreal unit = 1 cm): the asset is modelled in metres up to here. For export we switch
the scene to centimetres (unit_settings.scale_length = 0.01) and scale the mesh data by 100, so the FBX
stores vertex positions in cm with UnitScaleFactor = 1.0 and identity object scale. Axes are written
in Blender's native Z-up / -Y-forward (axis_up='Z', axis_forward='-Y'); Unreal's importer converts the
right-handed Z-up file into its left-handed Z-up space. Pivot is the bottom-centre of the bust.
"""
import bpy, os, sys, struct, mathutils
sys.path.insert(0, os.path.dirname(__file__))
from common import *

a = parse_args(); cfg = a["cfg"]; T = Timer(); W = a["work"]; ex = cfg["export"]
asset = cfg["asset_name"]
export_dir = os.path.join(a["out"], "export"); os.makedirs(export_dir, exist_ok=True)
open_blend(os.path.join(W, "05_bake.blend"))
sc = bpy.context.scene
sc.unit_settings.system = "METRIC"; sc.unit_settings.scale_length = 0.01; sc.unit_settings.length_unit = "CENTIMETERS"

FBX_KW = dict(use_selection=True, object_types={"MESH"}, global_scale=1.0, apply_unit_scale=True,
              apply_scale_options="FBX_SCALE_NONE", axis_forward=ex["axis_forward"], axis_up=ex["axis_up"],
              use_space_transform=True, bake_space_transform=False, use_mesh_modifiers=True,
              mesh_smooth_type=ex["mesh_smooth_type"], use_triangles=ex["use_triangles"], use_tspace=ex["use_tspace"],
              use_mesh_edges=False, use_custom_props=False, add_leaf_bones=False, bake_anim=False,
              path_mode="RELATIVE", embed_textures=False, use_metadata=True)

def patch_fbx_exporter_for_lodgroup():
    """Blender's FBX exporter already writes an Empty's 'fbx_type' custom prop as the NodeAttribute class,
    but leaves TypeFlags and the Model type as "Null". Patch both so an Empty with fbx_type="LodGroup"
    is written as a real FBX LodGroup node (what Unreal's 'Import Mesh LODs' looks for)."""
    try:
        import inspect
        import io_scene_fbx.export_fbx_bin as efb
        src = inspect.getsource(efb.fbx_data_empty_elements)
        a_ = 'elem_data_single_string(null, b"TypeFlags", b"Null")'
        if a_ in src:
            exec(src.replace(a_, 'elem_data_single_string(null, b"TypeFlags", fbx_type)'), efb.__dict__)
        src2 = inspect.getsource(efb.fbx_data_object_elements)
        b_ = '    model = elem_data_single_int64(root, b"Model", ob_obj.fbx_uuid)'
        if b_ in src2:
            exec(src2.replace(b_, '    if (not ob_obj.is_bone) and ob_obj.type == "EMPTY" and isinstance(ob_obj.bdata.get("fbx_type"), str):\n'
                              '        obj_type = ob_obj.bdata["fbx_type"].encode()\n' + b_), efb.__dict__)
    except Exception as exc:
        print("Note: FBX LodGroup runtime patch skipped:", exc)


def patch_fbx_exporter_no_box_paths():
    """Keep box paths out of the FBX: Blender writes texture FileName/Path as absolute (base_dst + relative)
    even with path_mode='RELATIVE', and writes the source .blend path as ApplicationNativeFile. Patch both so
    texture fields carry only the path relative to the FBX, and the native-file field only the .blend name."""
    try:
        import inspect
        import io_scene_fbx.export_fbx_bin as efb
        src = inspect.getsource(efb._gen_vid_path)
        a_ = "    fname_abs = os.path.normpath(os.path.abspath(os.path.join(msetts.base_dst, fname_rel)))"
        if a_ in src:
            exec(src.replace(a_, "    fname_abs = fname_rel"), efb.__dict__)
        src2 = inspect.getsource(efb.fbx_header_elements)
        b_ = 'original("p_string", b"ApplicationNativeFile", bpy.data.filepath)'
        if b_ in src2:
            exec(src2.replace(b_, 'original("p_string", b"ApplicationNativeFile", os.path.basename(bpy.data.filepath))'), efb.__dict__)
    except Exception as exc:
        print("Note: FBX path runtime patch skipped:", exc)


patch_fbx_exporter_for_lodgroup()
patch_fbx_exporter_no_box_paths()
files = []
lod_export_objs = []
pre_export_checks = {}
with T("export"):
    for spec in cfg["lods"]:
        src = bpy.data.objects[spec["name"]]
        ob = bpy.data.objects.new(f"SM_{asset}_{spec['name']}", src.data.copy())
        ob.data.name = ob.name
        ob.data.transform(mathutils.Matrix.Scale(100.0, 4))   # metres -> centimetres
        sc.collection.objects.link(ob)
        pre = validator_selfcheck(ob)   # validator's own rules, on the exact mesh being written (cm)
        pre["orientation_conflict_polys"] = len(orientation_conflict_polys(ob))
        if pre["degenerate"] or pre["winding_flipped"] or pre["orientation_conflict_polys"]:
            pre["clean_mesh"] = clean_mesh(ob)
        pre_export_checks[spec["name"]] = {k: v for k, v in pre.items() if not k.startswith("_")}
        select_only(ob)
        path = os.path.join(export_dir, f"SM_{asset}_{spec['name']}.fbx")
        bpy.ops.export_scene.fbx(filepath=path, **FBX_KW)
        files.append({"lod": spec["name"], "path": path, "bytes": os.path.getsize(path), "object": ob.name, "kind": "per_lod_fbx"})
        lod_export_objs.append(ob)
    # combined FBX: LodGroup empty SM_<asset> with children SM_<asset>_LOD0..n
    grp = bpy.data.objects.new(f"SM_{asset}", None); sc.collection.objects.link(grp)
    grp["fbx_type"] = "LodGroup"
    for ob in lod_export_objs:
        ob.parent = grp
    for o in bpy.context.view_layer.objects: o.select_set(False)
    grp.select_set(True)
    for ob in lod_export_objs: ob.select_set(True)
    bpy.context.view_layer.objects.active = grp
    combined = os.path.join(export_dir, f"SM_{asset}.fbx")
    kw = dict(FBX_KW); kw["object_types"] = {"EMPTY", "MESH"}; kw["use_custom_props"] = False
    bpy.ops.export_scene.fbx(filepath=combined, **kw)
    files.append({"lod": "ALL", "path": combined, "bytes": os.path.getsize(combined), "object": grp.name, "kind": "combined_fbx_lodgroup"})

glbs = []
with T("export_glb"):
    # Per-LOD GLB for the three.js viewer: metres, +Y up (glTF spec; the exporter converts Blender Z-up), with a
    # glTF material: OpenGL-convention normal map (green flipped back from the DirectX bake), ORM G/B as
    # metallicRoughness and R as occlusion. Same real-world size as the FBX.
    import numpy as np
    sc.unit_settings.scale_length = 1.0; sc.unit_settings.length_unit = "METERS"
    gdir = os.path.join(export_dir, "gltf"); os.makedirs(gdir, exist_ok=True)
    src_mat = bpy.data.materials[f"M_{asset}"]
    n_img = next(n.image for n in src_mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name.endswith("_N"))
    orm_img = next((n.image for n in src_mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name.endswith("_ORM")), None)
    res_ = n_img.size[0]
    px = np.empty(res_ * res_ * 4, dtype=np.float32); n_img.pixels.foreach_get(px); px = px.reshape(-1, 4)
    if cfg["bake"]["normal_convention"].lower() == "directx":
        px[:, 1] = 1.0 - px[:, 1]
    gl_img = bpy.data.images.new(f"T_{asset}_N", res_, res_, alpha=False); gl_img.colorspace_settings.name = "Non-Color"
    gl_img.pixels.foreach_set(px.ravel())
    gl_path = os.path.join(gdir, f"T_{asset}_N.png")
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_depth = "8"; sc.render.image_settings.color_mode = "RGB"
    gl_img.save_render(gl_path, scene=sc); gl_img.filepath = gl_path; gl_img.source = "FILE"; gl_img.reload()
    src_mat.name = f"M_{asset}_FBX"   # FBX files are already written; free the name for the glTF material
    gm = bpy.data.materials.new(f"M_{asset}"); gm.use_nodes = True; gnt = gm.node_tree
    gb = gnt.nodes["Principled BSDF"]; gb.inputs["Base Color"].default_value = (0.6, 0.6, 0.6, 1)
    bc_img_ = next((n.image for n in src_mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name.endswith("_BC")), None)
    if bc_img_:
        bt_ = gnt.nodes.new("ShaderNodeTexImage"); bt_.image = bc_img_
        gnt.links.new(bt_.outputs["Color"], gb.inputs["Base Color"])
    nt_ = gnt.nodes.new("ShaderNodeTexImage"); nt_.image = gl_img
    nm_ = gnt.nodes.new("ShaderNodeNormalMap"); nm_.uv_map = "UVMap"
    gnt.links.new(nt_.outputs["Color"], nm_.inputs["Color"]); gnt.links.new(nm_.outputs["Normal"], gb.inputs["Normal"])
    if orm_img:
        ot_ = gnt.nodes.new("ShaderNodeTexImage"); ot_.image = orm_img
        sp_ = gnt.nodes.new("ShaderNodeSeparateColor")
        gnt.links.new(ot_.outputs["Color"], sp_.inputs["Color"])
        gnt.links.new(sp_.outputs[1], gb.inputs["Roughness"]); gnt.links.new(sp_.outputs[2], gb.inputs["Metallic"])
        grp_ = bpy.data.node_groups.get("glTF Material Output") or bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        if "Occlusion" not in [i.name for i in grp_.interface.items_tree]:
            grp_.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        gn_ = gnt.nodes.new("ShaderNodeGroup"); gn_.node_tree = grp_
        gnt.links.new(sp_.outputs[0], gn_.inputs["Occlusion"])
    for spec in cfg["lods"]:
        src = bpy.data.objects[spec["name"]]
        keep = list(src.data.materials); src.data.materials.clear(); src.data.materials.append(gm)
        select_only(src)
        gp = os.path.join(export_dir, f"SM_{asset}_{spec['name']}.glb")
        bpy.ops.export_scene.gltf(filepath=gp, export_format="GLB", use_selection=True, export_yup=True,
                                  export_materials="EXPORT", export_image_format="AUTO", export_apply=True,
                                  export_texcoords=True, export_normals=True, export_tangents=True, export_animations=False)
        src.data.materials.clear()
        for m in keep: src.data.materials.append(m)
        glbs.append({"lod": spec["name"], "path": gp, "bytes": os.path.getsize(gp)})


def glb_info(path):
    """Parse a GLB's JSON chunk: POSITION bbox (glTF is metres, +Y up) and material/texture wiring."""
    import json as _json
    data = open(path, "rb").read()
    ln = struct.unpack("<I", data[12:16])[0]; g = _json.loads(data[20:20 + ln])
    mins, maxs = [], []
    for m in g.get("meshes", []):
        for prim in m["primitives"]:
            acc = g["accessors"][prim["attributes"]["POSITION"]]; mins.append(acc["min"]); maxs.append(acc["max"])
    import numpy as _np
    ext = (_np.max(maxs, 0) - _np.min(mins, 0)) * 100 if mins else []
    mat = (g.get("materials") or [{}])[0]
    return {"bbox_cm_xyz_yup": [round(float(v), 3) for v in ext],
            "height_cm_along_Y": round(float(ext[1]), 3) if len(ext) else None,
            "materials": [m.get("name") for m in g.get("materials", [])],
            "has_normal_texture": "normalTexture" in mat,
            "has_base_color_texture": "baseColorTexture" in mat.get("pbrMetallicRoughness", {}),
            "has_metallic_roughness_texture": "metallicRoughnessTexture" in mat.get("pbrMetallicRoughness", {}),
            "has_occlusion_texture": "occlusionTexture" in mat,
            "images": [i.get("name") for i in g.get("images", [])]}


def fbx_global_props(path):
    """Read a few GlobalSettings properties out of a binary FBX (no SDK needed)."""
    data = open(path, "rb").read()
    out = {}
    for name in (b"UnitScaleFactor", b"OriginalUnitScaleFactor", b"UpAxis", b"UpAxisSign",
                 b"FrontAxis", b"FrontAxisSign", b"CoordAxis", b"CoordAxisSign"):
        i = data.find(b"S" + struct.pack("<I", len(name)) + name)
        if i < 0: continue
        p = i + 5 + len(name)
        try:
            for _ in range(3):
                assert data[p:p + 1] == b"S"; n = struct.unpack("<I", data[p + 1:p + 5])[0]; p += 5 + n
            t = data[p:p + 1]
            out[name.decode()] = struct.unpack("<d", data[p + 1:p + 9])[0] if t == b"D" else struct.unpack("<i", data[p + 1:p + 5])[0]
        except Exception:
            pass
    return out


def world_dims_cm(objs):
    import numpy as np
    pts = np.array([list(ob.matrix_world @ mathutils.Vector(c)) for ob in objs for c in ob.bound_box])
    return [round(float(v) * 100, 3) for v in (pts.max(0) - pts.min(0))]


# re-import verification in a clean scene (Blender converts the FBX's cm to scene metres on import)
verify = []
with T("verify_reimport"):
    for f in files:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=f["path"])
        raw = open(f["path"], "rb").read()
        obs = sorted([o for o in bpy.context.scene.objects if o.type == "MESH"], key=lambda o: o.name)
        o = obs[0]
        bpy.context.view_layer.update()
        mats = [m.name for m in o.data.materials if m]
        imgs = sorted({n.image.filepath for m in o.data.materials if m and m.use_nodes
                       for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image})
        # Blender's importer converts FBX cm -> scene metres, so dims_m * 100 = size Unreal should show in cm
        verify.append({"lod": f["lod"], "kind": f["kind"], "is_binary_fbx": raw[:20] == b"Kaydara FBX Binary  ",
                       "fbx_version": int.from_bytes(raw[23:27], "little"),
                       "has_lodgroup_node": b"LodGroup" in raw,
                       "box_paths_in_file": sorted({m.decode(errors="replace") for m in __import__("re").findall(rb"/(?:workspace|home|tmp)/[^\x00\"]{0,200}", raw)}),
                       "texture_files_referenced": sorted({t for t in (f"T_{asset}_BC.png", f"T_{asset}_N.png", f"T_{asset}_ORM.png") if t.encode() in raw}),
                       "mesh_objects_in_file": len(obs), "mesh_names": [x.name for x in obs],
                       "mesh_tris": [tri_count(x) for x in obs],
                       "parents": sorted({x.parent.name for x in obs if x.parent}),
                       "name": o.name, "tris": tri_count(o),
                       "dims_cm_reimported": world_dims_cm(obs),
                       "object_scale": [round(v, 4) for v in o.scale],
                       "uv_layers": [u.name for u in o.data.uv_layers], "materials": mats, "textures": imgs,
                       "fbx_global_settings": fbx_global_props(f["path"])})

for gf in glbs:
    gf["verification"] = glb_info(gf["path"])

out = {"settings": {k: (sorted(v) if isinstance(v, set) else v) for k, v in FBX_KW.items()},
       "scene_units_at_export": {"system": "METRIC", "scale_length": 0.01, "length_unit": "CENTIMETERS"},
       "mesh_scaled_by": 100.0, "pivot": "bottom-centre of asset at origin",
       "files": files, "glb_files": glbs, "pre_export_selfcheck": pre_export_checks, "verification": verify,
       "lodgroup_patch": "Empty SM_<asset> with fbx_type=LodGroup; exporter patched at runtime to write TypeFlags/Model type LodGroup (not yet tested in Unreal)", "core_timings_s": T.t}
write_json(os.path.join(W, "step06.json"), out)
print("STEP06", out)
