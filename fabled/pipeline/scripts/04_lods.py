"""Step 4: LOD chain. LOD0 = retopo mesh; LOD1..N = collapse-decimated from LOD0 (UVs carried over),
each driven by the explicit tri budget in config["lods"]."""
import bpy, bmesh, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from common import *

a = parse_args(); cfg = a["cfg"]; T = Timer(); W = a["work"]
open_blend(os.path.join(W, "03_uv.blend"))
lod0 = bpy.data.objects["LOD0"]
tol = cfg["lod_tolerance"]
lods = []
flips = {}
flats = {}
detail_log = {}
clean_log = {}
for i, spec in enumerate(cfg["lods"]):
    with T(spec["name"]):
        if i == 0:
            ob = lod0
        else:
            ob = bpy.data.objects.new(spec["name"], lod0.data.copy())
            ob.data.name = spec["name"]
            bpy.context.scene.collection.objects.link(ob)
            det_ob = None; det_t = 0
            if "fabled_detail" in ob.data.attributes:
                # kept detail pieces (whiskers, bell): carried unchanged while they fit keep_fraction of the budget,
                # dropped otherwise; the body alone is decimated (collapse would shred thin strips)
                d_ = np.empty(len(ob.data.polygons), dtype=np.int32)
                ob.data.attributes["fabled_detail"].data.foreach_get("value", d_)
                lt_ = np.empty(len(ob.data.polygons), dtype=np.int32); ob.data.polygons.foreach_get("loop_total", lt_)
                det_t = int((lt_[d_ == 1] - 2).sum())
                keepd = det_t and det_t <= cfg["retopo"].get("keep_detail", {}).get("keep_fraction_of_lod_budget", 0.25) * spec["target_tris"]
                bm_ = bmesh.new(); bm_.from_mesh(ob.data); lay_ = bm_.faces.layers.int.get("fabled_detail")
                if keepd:
                    det_ob = bpy.data.objects.new(spec["name"] + "_detail", ob.data.copy())
                    bpy.context.scene.collection.objects.link(det_ob)
                    bmd = bmesh.new(); bmd.from_mesh(det_ob.data); ld_ = bmd.faces.layers.int.get("fabled_detail")
                    bmesh.ops.delete(bmd, geom=[f for f in bmd.faces if f[ld_] == 0], context="FACES")
                    bmd.to_mesh(det_ob.data); bmd.free()
                bmesh.ops.delete(bm_, geom=[f for f in bm_.faces if f[lay_] == 1], context="FACES")
                bm_.to_mesh(ob.data); bm_.free()
                detail_log[spec["name"]] = {"detail_tris": det_t, "kept": bool(keepd)}
            body_target = spec["target_tris"] - (det_t if det_ob else 0)
            decimate_to(ob, int(body_target * 0.995), tol=0.0)
            if det_ob:
                select_only(ob); det_ob.select_set(True); bpy.context.view_layer.objects.active = ob
                bpy.ops.object.join()
            for p in ob.data.polygons:
                p.use_smooth = True
            clean_log[spec["name"]] = clean_mesh(ob)
            flats[spec["name"]] = flatten_faces_with_opposing_normals(ob)
        st = mesh_stats(ob)
        sc_ = validator_selfcheck(ob)
        uvm = uv_metrics(ob, 1024, cfg["bake"]["resolution"])
    actual = st["tris"]; tgt = spec["target_tris"]
    lods.append({"name": spec["name"], "object": ob.name, "target_tris": tgt, "actual_tris": actual,
                 "delta_pct": round(100.0 * (actual - tgt) / tgt, 2),
                 "within_tolerance": (1 - tol) * tgt <= actual <= tgt,
                 "verts": st["verts"], "dims_m": st["dims_m"],
                 "uv_islands": uvm["island_count"], "uv_overlap_pixels_1024": uvm["overlap_pixels_between_islands"],
                 "uv_flipped_faces": uvm["flipped_uv_faces"],
                 "selfcheck": {k: v for k, v in sc_.items() if not k.startswith("_")},
                 "source": "retopo (step 02)" if i == 0 else "collapse-decimated from LOD0"})
with T("save"):
    save_blend(os.path.join(W, "04_lods.blend"))
write_json(os.path.join(W, "step04.json"), {"lod_tolerance": tol, "lods": lods, "normals_flipped_by_recalc": flips, "faces_set_flat_opposing_normals": flats, "detail_per_lod": detail_log, "clean_mesh": clean_log, "core_timings_s": T.t})
for l in lods: print("LOD", l)
