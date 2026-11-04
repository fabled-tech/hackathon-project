"""Step 2: build the game-res base mesh (LOD0) from the sculpt.

Stages (each run as its own Blender process by the driver, so a hung QuadriFlow can be killed):
  prep              -> optional cap on bake-source tris + a decimated proxy for retopo
  quadriflow        -> QuadriFlow directly on the proxy
  voxel_quadriflow  -> voxel remesh proxy (makes it manifold), then QuadriFlow
  voxel_decimate    -> voxel remesh proxy, then collapse-decimate to LOD0 budget (fallback)
"""
import bpy, bmesh, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from common import *

a = parse_args(); cfg = a["cfg"]; T = Timer(); stage = a["stage"]; W = a["work"]
lod0_target = cfg["lods"][0]["target_tris"]
out = {"stage": stage}


def voxel_remesh(obj, height):
    m = obj.modifiers.new("Remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = height * cfg["retopo"]["voxel_size_fraction_of_height"]
    m.adaptivity = 0.0
    m.use_smooth_shade = True
    apply_modifier(obj, m)
    out["voxel_size_m"] = round(height * cfg["retopo"]["voxel_size_fraction_of_height"], 6)
    out["after_voxel"] = {**mesh_stats(obj), **topology_check(obj)}


def quadriflow(obj):
    """QuadriFlow with two fixes found on this asset:
    - Blender's QuadriFlow pre-check rejects this real-world-sized proxy as 'not manifold' even though it
      is manifold (0 non-manifold edges/verts); scaling the mesh up (to ~10-200 m) for the solve makes it
      pass, so we try increasing solve heights and scale back afterwards (logged per attempt).
    - QuadriFlow only approximates target_faces, so we re-run once with a corrected target if the
      result misses the LOD0 tri budget by more than lod_tolerance/2."""
    import mathutils
    h = max(obj.dimensions)
    src_me = obj.data.copy()
    tol = cfg["lod_tolerance"]
    aim = lod0_target * (1.0 - tol / 2)          # budgets are maxima: aim inside [budget*(1-tol), budget]
    target_q = max(100, int(aim // 2))
    attempts = []
    solve_heights = cfg["retopo"].get("quadriflow_solve_heights_m", [1.0, 10.0, 50.0, 200.0])
    hi = 0
    while len([x for x in attempts if "FINISHED" in x["result"]]) < 3 and len(attempts) < 3 + len(solve_heights):
        k = solve_heights[hi] / h
        me = src_me.copy(); old = obj.data; obj.data = me
        if old.users == 0: bpy.data.meshes.remove(old)
        obj.data.transform(mathutils.Matrix.Scale(k, 4))
        before = len(obj.data.polygons)
        select_only(obj)
        try:
            res = bpy.ops.object.quadriflow_remesh(
                use_mesh_symmetry=False, use_preserve_sharp=False, use_preserve_boundary=True,
                preserve_attributes=False, smooth_normals=False, mode="FACES",
                target_faces=int(target_q), seed=cfg["retopo"]["quadriflow_seed"])
        except RuntimeError as e:
            res = {"CANCELLED"}; out["error"] = str(e).strip()
        obj.data.transform(mathutils.Matrix.Scale(1.0 / k, 4))
        obj.data.update(); bpy.context.view_layer.update()
        st = mesh_stats(obj)
        rec = {"solve_height_m": solve_heights[hi], "target_faces": int(target_q), "result": sorted(res), "faces": st["faces"], "tris": st["tris"]}
        attempts.append(rec)
        ok = "FINISHED" in res and st["faces"] != before and st["quads"] > 0.9 * st["faces"]
        if not ok:
            rec["result"] = ["CANCELLED"]
            hi += 1
            if hi >= len(solve_heights):
                out["error"] = (f"QuadriFlow rejected the mesh at every solve scale {solve_heights} m "
                                "('mesh needs to be manifold and have consistent normals')")
                out["quadriflow_attempts"] = attempts
                return False
            continue
        out["quadriflow_solve_scale"] = round(k, 4); out["quadriflow_solve_height_m"] = solve_heights[hi]
        rec["mesh"] = obj.data.copy()
        if lod0_target * (1.0 - tol) <= st["tris"] <= lod0_target:
            break
        target_q = target_q * aim / st["tris"]
    attempts_ok = [x for x in attempts if "mesh" in x]
    under = [r for r in attempts_ok if r["tris"] <= lod0_target]
    best = max(under, key=lambda r: r["tris"]) if under else min(attempts_ok, key=lambda r: r["tris"])
    old = obj.data; obj.data = best["mesh"]
    for r in attempts:
        r["kept"] = r is best
        m = r.pop("mesh", None)
        if m is not None and m is not obj.data and m.users == 0: bpy.data.meshes.remove(m)
    if old.users == 0: bpy.data.meshes.remove(old)
    out["quadriflow_attempts"] = attempts
    bpy.data.meshes.remove(src_me)
    bpy.context.view_layer.update()
    return True


def extract_detail(hp, lod0, height, kd):
    """Thin/small source features the remesher loses (whiskers, bell, ear tips): source faces farther than
    distance_fraction*height from the remeshed surface, grouped into edge-connected pieces; pieces with
    >= min_faces are kept as separate geometry (welded source faces, original shape)."""
    from mathutils.bvhtree import BVHTree
    bm0 = bmesh.new(); bm0.from_mesh(lod0.data); tree = BVHTree.FromBMesh(bm0)
    bm = bmesh.new(); bm.from_mesh(hp.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=height * 1e-5)
    bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
    thr = kd.get("distance_fraction_of_height", 0.01) * height
    far = set(); dist = {}
    for f in bm.faces:
        cc = f.calc_center_median(); loc, nrm, _i, d = tree.find_nearest(cc)
        if d is not None and d > thr:
            far.add(f.index); dist[f.index] = d if (cc - loc).dot(nrm) >= 0 else -d   # negative = inside the body
    seen = set(); keep = []; pieces = []
    for fi in sorted(far):
        if fi in seen: continue
        st = [fi]; seen.add(fi); comp = []
        while st:
            x = st.pop(); comp.append(x)
            for e in bm.faces[x].edges:
                for g in e.link_faces:
                    if g.index in far and g.index not in seen: seen.add(g.index); st.append(g.index)
        c = [round(float(v) / height, 3) for v in np.mean([bm.faces[i].calc_center_median()[:] for i in comp], 0)]
        md = max(abs(dist[i]) for i in comp) / height
        inside = sum(1 for i in comp if dist[i] < 0) / len(comp)
        rec = {"faces": len(comp), "centroid_over_height": c, "max_distance_over_height": round(md, 4), "inside_fraction": round(inside, 2)}
        # keep protruding features (whiskers, bell); drop near-parallel surface patches (the remesher's own
        # shrinkage, which would z-fight / show back faces) and debris lying near the ground plane
        if len(comp) < kd.get("min_faces", 8): rec["kept"] = False; rec["why"] = "too small"
        elif inside > 0.5: rec["kept"] = False; rec["why"] = "inside the remeshed body (hidden)"
        elif md < kd.get("min_protrusion_fraction_of_height", 0.0): rec["kept"] = False; rec["why"] = "surface patch, not protruding"
        elif c[2] < kd.get("drop_below_height_fraction", -1.0): rec["kept"] = False; rec["why"] = "debris near ground"
        else: rec["kept"] = True
        pieces.append(rec)
        if rec["kept"]: keep += comp
    vidx = sorted({v.index for i in keep for v in bm.faces[i].verts})
    remap = {v: k for k, v in enumerate(vidx)}
    verts = [tuple(bm.verts[v].co) for v in vidx]
    faces = [tuple(remap[v.index] for v in bm.faces[i].verts) for i in keep]
    tris = sum(len(f) - 2 for f in faces)
    bm.free(); bm0.free()
    pieces.sort(key=lambda r: -r["faces"])
    return {"distance_threshold_m": round(thr, 6), "min_faces": kd.get("min_faces", 8), "far_faces": len(far),
            "pieces_total": len(pieces), "pieces_kept": sum(1 for p in pieces if p["kept"]), "tris": tris,
            "pieces": pieces[:40], "verts": verts, "faces": faces}


def append_detail(obj, det):
    """Append kept detail pieces to obj and tag them with face attribute fabled_detail=1 (LOD step uses it).
    The source pieces have non-manifold edges (whisker fins share an edge between 3+ faces); for each such edge
    the smallest faces beyond two are deleted so the result is manifold (validator 'non_manifold' check)."""
    me = obj.data
    if "fabled_detail" not in me.attributes:
        me.attributes.new("fabled_detail", "INT", "FACE")
    bm = bmesh.new(); bm.from_mesh(me)
    lay = bm.faces.layers.int.get("fabled_detail")
    for f in bm.faces: f[lay] = 0
    nv = [bm.verts.new(c) for c in det["verts"]]
    new_faces = []
    for f in det["faces"]:
        try:
            nf = bm.faces.new([nv[i] for i in f]); nf[lay] = 1; nf.smooth = True; new_faces.append(nf)
        except ValueError:
            pass
    removed = 0
    for _ in range(6):
        bad = [e for e in bm.edges if len(e.link_faces) > 2]
        if not bad: break
        kill = set()
        for e in bad:
            fs = sorted(e.link_faces, key=lambda f: f.calc_area())
            kill.update(fs[:len(fs) - 2])
        bmesh.ops.delete(bm, geom=list(kill), context="FACES"); removed += len(kill)
        loose = [v for v in bm.verts if not v.link_faces]
        if loose: bmesh.ops.delete(bm, geom=loose, context="VERTS")
    det["nonmanifold_faces_removed"] = removed
    bm.to_mesh(me); bm.free(); me.update()


if stage == "prep":
    open_blend(os.path.join(W, "01_source.blend"))
    hp = bpy.data.objects["HP_source"]
    cap = cfg["bake_source_max_tris"]
    full = tri_count(hp)
    out["source_tris"] = full
    with T("read_arrays"):
        V, F = mesh_tri_arrays(hp.data)
    with T("cap_bake_source"):
        if cap and full > cap:
            v2, f2 = quadric_decimate_arrays(V, F, cap)
            old_me = hp.data
            hp.data = mesh_from_arrays("HP_bake", v2, f2)
            bpy.data.meshes.remove(old_me)
            V, F = v2, f2
            out["bake_source_decimated"] = True
        else:
            out["bake_source_decimated"] = False
    hp.name = "HP_bake"
    out["bake_source"] = mesh_stats(hp)
    with T("proxy_quadric_decimate"):
        if len(F) > cfg["retopo_proxy_tris"]:
            pv, pf = quadric_decimate_arrays(V, F, cfg["retopo_proxy_tris"])
            out["proxy_decimated"] = True
        else:   # source is already below the proxy size (e.g. a low-poly character): use it as-is
            pv, pf = V, F
            out["proxy_decimated"] = False
        del V, F
        proxy = bpy.data.objects.new("RetopoProxy", mesh_from_arrays("RetopoProxy", pv, pf))
        bpy.context.scene.collection.objects.link(proxy)
        for p in proxy.data.polygons:
            p.use_smooth = True
    wf = cfg["retopo"].get("weld_distance_fraction_of_height")
    if wf:   # importers split verts at UV seams; weld so the proxy is one connected surface per part
        out["proxy_weld_distance_m"] = round(max(proxy.dimensions) * wf, 8)
        out["proxy_verts_welded"] = weld(proxy, max(proxy.dimensions) * wf)
    out["proxy_raw"] = {**mesh_stats(proxy), **topology_check(proxy)}
    with T("proxy_watertight_repair"):
        out["proxy_repair"] = make_watertight(proxy)
    out["proxy"] = {**mesh_stats(proxy), **topology_check(proxy)}
    with T("save"):
        save_blend(os.path.join(W, "02_prep.blend"))
else:
    open_blend(os.path.join(W, "02_prep.blend"))
    hp = bpy.data.objects["HP_bake"]; proxy = bpy.data.objects["RetopoProxy"]
    lod0 = bpy.data.objects.new("LOD0", proxy.data.copy())
    bpy.context.scene.collection.objects.link(lod0)
    height = hp.dimensions[2]
    ok = False
    with T("retopo"):
        if stage == "quadriflow":
            ok = quadriflow(lod0)
        elif stage == "voxel_quadriflow":
            voxel_remesh(lod0, height); ok = quadriflow(lod0)
        elif stage == "source_cleanup":
            # low-poly source already at/below the LOD0 budget: keep its shape, use the welded + repaired proxy
            if tri_count(lod0) > lod0_target:
                decimate_to(lod0, int(lod0_target * 0.99), tol=0.0)
            ok = True
        elif stage == "voxel_decimate":
            voxel_remesh(lod0, height)
            decimate_to(lod0, lod0_target, tol=0.02)
            ok = True
        else:
            raise SystemExit("unknown stage " + stage)
    kd = cfg["retopo"].get("keep_detail") or {}
    if ok and kd.get("enabled") and stage != "source_cleanup":
        with T("keep_detail"):
            det = extract_detail(hp, lod0, height, kd)
            out["keep_detail"] = {k: v for k, v in det.items() if k not in ("verts", "faces")}
            if det["faces"]:
                body_budget = int(lod0_target * 0.99) - det["tris"]
                if det["tris"] > kd.get("max_fraction_of_lod0", 0.3) * lod0_target:
                    out["keep_detail"]["dropped"] = "detail exceeds max_fraction_of_lod0 of the LOD0 budget"
                else:
                    if tri_count(lod0) > body_budget:
                        # re-run the remesher with a smaller target so body + kept detail fits the LOD0 budget
                        out["keep_detail"]["body_tris_first_pass"] = tri_count(lod0)
                        old_me = lod0.data; lod0.data = proxy.data.copy(); bpy.data.meshes.remove(old_me)
                        lod0_target = body_budget
                        if stage == "voxel_quadriflow": voxel_remesh(lod0, height)
                        ok = quadriflow(lod0) if "quadriflow" in stage else True
                        if stage == "voxel_decimate":
                            voxel_remesh(lod0, height); decimate_to(lod0, body_budget, tol=0.0)
                        lod0_target = cfg["lods"][0]["target_tris"]
                        if tri_count(lod0) > body_budget:
                            out["keep_detail"]["body_decimated_from_tris"] = tri_count(lod0)
                            decimate_to(lod0, body_budget, tol=0.0)
                    out["keep_detail"]["body_tris"] = tri_count(lod0)
                    append_detail(lod0, det)
                    out["keep_detail"]["appended"] = True
                    out["keep_detail"]["nonmanifold_faces_removed"] = det.get("nonmanifold_faces_removed")
    out["success"] = bool(ok)
    if ok and tri_count(lod0) > lod0_target:
        # budgets are hard maxima: if the remesher overshot, collapse-decimate down (loses pure quads; logged)
        out["over_budget_decimated_from_tris"] = tri_count(lod0)
        decimate_to(lod0, int(lod0_target * 0.99), tol=0.0)
    if ok:
        out["normals_flipped_by_recalc"] = recalc_outside(lod0)
        for p in lod0.data.polygons:
            p.use_smooth = True
        lod0.data.name = "LOD0"
        out["lod0"] = {**mesh_stats(lod0), **topology_check(lod0)}
        bpy.data.objects.remove(proxy)
        with T("save"):
            save_blend(os.path.join(W, "02_retopo.blend"))
out["core_timings_s"] = T.t
write_json(os.path.join(W, f"step02_{stage}.json"), out)
print("STEP02", stage, out)
