"""Step 1: import the high-poly sculpt, normalise units/pivot, measure it."""
import bpy, bmesh, os, sys, math
sys.path.insert(0, os.path.dirname(__file__))
from common import *

a = parse_args(); cfg = a["cfg"]; T = Timer()
bpy.ops.wm.read_factory_settings(use_empty=True)
src = os.path.abspath(a["input"]); ext = os.path.splitext(src)[1].lower()

prof = cfg.get("fabled_profile") or {}
up = str(prof.get("up_axis") or cfg.get("source_up_axis") or "Y").upper()
if up not in ("Y", "Z"):
    raise SystemExit(f"unsupported up_axis {up!r} (expected Y or Z)")
# Y-up source: Blender's importers rotate Y-up -> Z-up (forward -Z). Z-up source: no rotation.
axes = dict(forward_axis="NEGATIVE_Z", up_axis="Y") if up == "Y" else dict(forward_axis="Y", up_axis="Z")
with T("import"):
    if ext == ".obj":
        bpy.ops.wm.obj_import(filepath=src, **axes)
    elif ext == ".ply":
        bpy.ops.wm.ply_import(filepath=src, **axes)
    elif ext == ".stl":
        bpy.ops.wm.stl_import(filepath=src, **axes)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=src)  # FBX carries its own axis system
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=src)  # glTF is Y-up by spec; importer converts
    else:
        raise SystemExit(f"unsupported input format {ext}")

imported_types = sorted({o.type for o in bpy.context.scene.objects})
has_armature = "ARMATURE" in imported_types or any(m.type == "ARMATURE" for o in bpy.context.scene.objects for m in getattr(o, "modifiers", []))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no mesh objects imported")
with T("normalise"):
    if len(meshes) > 1:
        select_only(meshes[0])
        for o in meshes[1:]:
            o.select_set(True)
        bpy.ops.object.join()
    hp = bpy.context.view_layer.objects.active or meshes[0]
    for o in list(bpy.context.scene.objects):
        if o != hp:
            bpy.data.objects.remove(o)
    raw_dims_units = list(hp.dimensions)
    select_only(hp)
    # bake importer axis conversion into the mesh, then convert units -> metres
    s = cfg["source_units_to_m"]
    tgt_h = cfg.get("target_height_cm")   # optional: rescale to a chosen real-world height (source size not trusted)
    height_override = None
    if tgt_h:
        bpy.context.view_layer.update()
        import mathutils as _mu   # world-space Z extent (importer's Y-up->Z-up rotation lives in matrix_world)
        _z = [(hp.matrix_world @ _mu.Vector(c)).z for c in hp.bound_box]
        raw_h = max(_z) - min(_z)
        s = (tgt_h / 100.0) / raw_h
        height_override = {"target_height_cm": tgt_h, "raw_height_source_units": round(raw_h, 5),
                           "height_cm_if_source_units_to_m_used": round(raw_h * cfg["source_units_to_m"] * 100, 2),
                           "effective_source_units_to_m": round(s, 6)}
    hp.scale = [v * s for v in hp.scale]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # pivot = bottom-centre (Unreal-friendly: asset sits on the ground at origin)
    import numpy as np
    me = hp.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    mn, mx = co.min(0), co.max(0)
    off = np.array([-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]], dtype=np.float32)
    co += off; me.vertices.foreach_set("co", co.ravel()); me.update()
    del co
    hp.name = "HP_source"; me.name = "HP_source"
    src_mats = []
    for m in me.materials:
        if m is None: continue
        imgs = [{"name": n.image.name, "size": list(n.image.size), "colorspace": n.image.colorspace_settings.name,
                 "packed": n.image.packed_file is not None,
                 "linked_to": sorted({l.to_socket.name for l in n.outputs["Color"].links})}
                for n in (m.node_tree.nodes if m.use_nodes else []) if n.type == "TEX_IMAGE" and n.image]
        src_mats.append({"name": m.name, "images": imgs})
    if not cfg.get("keep_source_materials"):
        me.materials.clear()
    else:
        for im in bpy.data.images:
            if im.packed_file is None and im.source == "FILE":
                try: im.pack()
                except Exception: pass

with T("measure"):
    st = mesh_stats(hp); topo = topology_check(hp)
    if st["tris"] <= 1_000_000:
        bm_ = bmesh.new(); bm_.from_mesh(hp.data); parts_raw = loose_parts_bm(bm_); bm_.free()
        topo["loose_parts_unwelded"] = len(parts_raw)
        topo["welded"] = weld_report(hp, max(hp.dimensions) * cfg.get("measure_weld_fraction", 1e-5))

h_cm = hp.dimensions[2] * 100
lo, hi = cfg["expected_height_cm_range"]
ref = cfg.get("reference_dims_cm")  # optional catalogue dims [H, W, D] to compare against
ref_cmp = None
if ref:
    got = [hp.dimensions[2] * 100, hp.dimensions[0] * 100, hp.dimensions[1] * 100]
    ref_cmp = {"reference_HWD_cm": ref, "mesh_HWD_cm": [round(v, 2) for v in got],
               "ratio_mesh_over_reference": [round(g / r, 3) for g, r in zip(got, ref)]}
scale_check = {
    "up_axis_used": up,
    "reference_comparison": ref_cmp,
    "source_units_to_m": s,
    "height_override": height_override,
    "raw_dims_source_units": [round(v, 4) for v in raw_dims_units],
    "height_cm_after_conversion": round(h_cm, 2),
    "expected_height_cm_range": [lo, hi],
    "status": "ok" if lo <= h_cm <= hi else "FLAG",
    "note": cfg.get("_source_units_note", ""),
}
with T("save"):
    save_blend(os.path.join(a["work"], "01_source.blend"))

write_json(os.path.join(a["work"], "step01.json"), {
    "input_path": src, "input_bytes": os.path.getsize(src), "input_format": ext,
    "highpoly": {**st, **topo}, "source_materials": src_mats, "source_has_armature": has_armature, "imported_object_types": imported_types,
    "source_uv_layers": [u.name for u in hp.data.uv_layers], "source_color_attributes": [c.name for c in hp.data.color_attributes],
    "materials_kept_on_bake_source": bool(cfg.get("keep_source_materials")), "scale_check": scale_check, "core_timings_s": T.t})
print("STEP01 DONE", st, topo, scale_check)
