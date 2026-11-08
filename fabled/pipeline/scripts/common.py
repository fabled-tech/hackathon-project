"""Shared helpers for the SculptLine Blender step scripts (run inside `blender -b --python`)."""
import bpy, bmesh, json, os, sys, time
import numpy as np


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = {}
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-")
        if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            args[k] = argv[i + 1]; i += 2
        else:
            args[k] = True; i += 1
    with open(args["config"]) as f:
        args["cfg"] = json.load(f)
    args["work"] = os.path.join(args["out"], "work")
    os.makedirs(args["work"], exist_ok=True)
    return args


def tri_count(obj):
    me = obj.data
    lt = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_total", lt)
    return int((lt - 2).sum())


def _dims(me):
    co = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    return [round(float(v), 5) for v in (co.max(0) - co.min(0))] if len(co) else [0, 0, 0]


def mesh_stats(obj):
    me = obj.data
    lt = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_total", lt)
    return {
        "verts": len(me.vertices),
        "faces": len(me.polygons),
        "tris": int((lt - 2).sum()),
        "quads": int((lt == 4).sum()),
        "ngons": int((lt > 4).sum()),
        "dims_m": _dims(me),
    }


def topology_check(obj):
    """Edge-use counts via numpy (cheap even on multi-million-tri meshes)."""
    me = obj.data
    ne = len(me.edges)
    ei = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("edge_index", ei)
    use = np.bincount(ei, minlength=ne)
    ev = np.empty(ne * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    used_v = np.zeros(len(me.vertices), dtype=bool); used_v[ev] = True
    return {"non_manifold_edges": int((use > 2).sum()), "boundary_edges": int((use == 1).sum()),
            "wire_edges": int((use == 0).sum()), "loose_verts": int((~used_v).sum())}


def select_only(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifier(obj, mod):
    select_only(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def decimate_to(obj, target_tris, tol=0.03, max_iter=3):
    """Collapse-decimate obj (in place) towards target triangle count."""
    for _ in range(max_iter):
        cur = tri_count(obj)
        if cur <= target_tris * (1 + tol):
            break
        m = obj.modifiers.new("Decimate", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = max(1e-4, min(1.0, target_tris / cur))
        m.use_collapse_triangulate = True
        apply_modifier(obj, m)
    return tri_count(obj)


def write_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def open_blend(path):
    bpy.ops.wm.open_mainfile(filepath=path)


def save_blend(path):
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=False)


class Timer:
    def __init__(self):
        self.t = {}
    def __call__(self, name):
        timer = self
        class _C:
            def __enter__(s): s.t0 = time.time()
            def __exit__(s, *a): timer.t[name] = round(time.time() - s.t0, 3)
        return _C()


VENDOR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vendor")


def mesh_tri_arrays(me):
    """(verts float32 Nx3, tris int32 Mx3) of a mesh; triangulates via loop_triangles if needed."""
    co = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get("co", co)
    lt = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get("loop_total", lt)
    if (lt == 3).all():
        tris = np.empty(len(me.polygons) * 3, dtype=np.int32); me.polygons.foreach_get("vertices", tris)
    else:
        me.calc_loop_triangles()
        tris = np.empty(len(me.loop_triangles) * 3, dtype=np.int32); me.loop_triangles.foreach_get("vertices", tris)
    return co.reshape(-1, 3), tris.reshape(-1, 3)


def mesh_from_arrays(name, verts, tris):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts)); me.vertices.foreach_set("co", verts.astype(np.float32).ravel())
    n = len(tris)
    me.loops.add(n * 3); me.loops.foreach_set("vertex_index", tris.astype(np.int32).ravel())
    me.polygons.add(n)
    me.polygons.foreach_set("loop_start", np.arange(0, n * 3, 3, dtype=np.int32))
    me.update(calc_edges=True); me.validate(verbose=False)
    return me


def _numpy_cluster_decimate(verts, tris, target_tris):
    """Pure-NumPy vertex-clustering fallback when fast_simplification C++ extension is unavailable (e.g. macOS arm64)."""
    verts = np.asarray(verts, dtype=np.float32)
    tris = np.asarray(tris, dtype=np.int32)
    if len(tris) <= target_tris:
        return verts.copy(), tris.copy()
    mn = verts.min(axis=0)
    mx = verts.max(axis=0)
    span = float(np.max(mx - mn)) or 1.0
    lo, hi = 4, 2048
    best_cid, best_n = None, 0
    while lo <= hi:
        mid = (lo + hi) // 2
        inv = mid / span
        ijk = np.floor((verts - mn) * inv).astype(np.int64)
        keys = ijk[:, 0] + (mid + 2) * (ijk[:, 1] + (mid + 2) * ijk[:, 2])
        _, inv_idx = np.unique(keys, return_inverse=True)
        c_tris = inv_idx[tris]
        valid = (c_tris[:, 0] != c_tris[:, 1]) & (c_tris[:, 1] != c_tris[:, 2]) & (c_tris[:, 0] != c_tris[:, 2])
        cnt = int(valid.sum())
        if cnt <= target_tris:
            best_cid = inv_idx
            best_n = int(inv_idx.max()) + 1 if len(inv_idx) else 0
            lo = mid + 1
        else:
            hi = mid - 1
    if best_cid is None:
        return verts.copy(), tris[:target_tris].copy()
    out_v = np.zeros((best_n, 3), dtype=np.float64)
    counts = np.bincount(best_cid, minlength=best_n).reshape(-1, 1)
    np.add.at(out_v, best_cid, verts)
    out_v = (out_v / np.maximum(counts, 1)).astype(np.float32)
    c_tris = best_cid[tris]
    valid = (c_tris[:, 0] != c_tris[:, 1]) & (c_tris[:, 1] != c_tris[:, 2]) & (c_tris[:, 0] != c_tris[:, 2])
    c_tris = c_tris[valid]
    s_tris = np.sort(c_tris, axis=1)
    _, uniq_idx = np.unique(s_tris, axis=0, return_index=True)
    out_f = c_tris[np.sort(uniq_idx)].astype(np.int32)
    return out_v, out_f


def quadric_decimate_arrays(verts, tris, target_tris):
    """Memory-light quadric decimation (fast-simplification, vendored) for multi-million-tri sculpts,
    where Blender's Decimate modifier needs >8 GB RAM. Falls back to NumPy clustering on macOS arm64."""
    if VENDOR not in sys.path:
        sys.path.insert(0, VENDOR)
    try:
        import fast_simplification
        red = max(0.0, min(0.9999, 1.0 - target_tris / len(tris)))
        v, f = fast_simplification.simplify(verts, tris, target_reduction=red, agg=7)
        return v, f
    except Exception:
        return _numpy_cluster_decimate(verts, tris, target_tris)


def make_watertight(obj, max_passes=4):
    """Repair a scan/sculpt proxy so remeshers accept it: drop faces on non-manifold edges/verts,
    fill holes, unify normals. Returns repair stats. Intended for the ~200k proxy, not the full sculpt."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    stats = {"faces_removed_nonmanifold": 0, "holes_filled_faces": 0, "passes": 0}
    for _ in range(max_passes):
        stats["passes"] += 1
        bad = set()
        for e in bm.edges:
            if len(e.link_faces) > 2:
                bad.update(e.link_faces)
        for v in bm.verts:
            if v.link_faces and not v.is_manifold and not v.is_boundary:
                bad.update(v.link_faces)
        if bad:
            bmesh.ops.delete(bm, geom=list(bad), context="FACES")
            stats["faces_removed_nonmanifold"] += len(bad)
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        # bowtie verts on boundary: split them
        bowties = [v for v in bm.verts if v.is_boundary and len([e for e in v.link_edges if e.is_boundary]) > 2]
        if bowties:
            bmesh.ops.delete(bm, geom=list({f for v in bowties for f in v.link_faces}), context="FACES")
            loose = [v for v in bm.verts if not v.link_faces]
            if loose: bmesh.ops.delete(bm, geom=loose, context="VERTS")
        boundary = [e for e in bm.edges if e.is_boundary]
        if boundary:
            res = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
            newf = res["faces"]
            stats["holes_filled_faces"] += len(newf)
            if newf:
                bmesh.ops.triangulate(bm, faces=newf, quad_method="BEAUTY", ngon_method="BEAUTY")
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        nonman = sum(1 for e in bm.edges if not e.is_manifold)
        if nonman == 0:
            break
    # keep only the largest connected piece? (no: report pieces instead)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    stats.update(topology_check(obj))
    return stats


def uv_metrics(obj, R=2048, bake_res=2048, npz_path=None):
    """UV islands, flips, inter-island overlap (rasterised at R x R), utilisation, texel density."""
    import math
    me = obj.data
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    island = [-1] * len(bm.faces); n_isl = 0
    def same(a, b): return (a - b).length_squared < 1e-12
    for f0 in bm.faces:
        if island[f0.index] != -1: continue
        stack = [f0]; island[f0.index] = n_isl
        while stack:
            f = stack.pop()
            for l in f.loops:
                r = l.link_loop_radial_next
                if r == l or island[r.face.index] != -1: continue
                if same(l[uvl].uv, r.link_loop_next[uvl].uv) and same(l.link_loop_next[uvl].uv, r[uvl].uv):
                    island[r.face.index] = n_isl; stack.append(r.face)
        n_isl += 1
    uv = np.array([[l[uvl].uv[:] for l in f.loops] for f in bm.faces], dtype=np.float64)  # (F,3,2)
    xyz = np.array([[l.vert.co[:] for l in f.loops] for f in bm.faces], dtype=np.float64)
    bm.free()
    isl = np.array(island, dtype=np.int32)
    e1, e2 = uv[:, 1] - uv[:, 0], uv[:, 2] - uv[:, 0]
    sarea = 0.5 * (e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    flipped = int((sarea < 0).sum())
    uv_area = float(np.abs(sarea).sum())
    surf_area_m2 = float(0.5 * np.linalg.norm(np.cross(xyz[:, 1] - xyz[:, 0], xyz[:, 2] - xyz[:, 0]), axis=1).sum())
    out_of_bounds = int(((uv < 0) | (uv > 1)).any(axis=(1, 2)).sum())
    # rasterise per island to find inter-island overlap
    owner = np.full((R, R), -1, dtype=np.int32)
    overlap = np.zeros((R, R), dtype=bool)
    P = uv * R - 0.5
    for i in range(len(P)):
        t = P[i]
        x0, y0 = np.floor(t.min(0)).astype(int); x1, y1 = np.ceil(t.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, R - 1), min(y1, R - 1)
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        (ax, ay), (bx, by), (cx, cy) = t
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12: continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
        inside = (w0 >= 0) & (w1 >= 0) & (w0 + w1 <= 1)
        if not inside.any(): continue
        sub = owner[y0:y1 + 1, x0:x1 + 1]; ov = overlap[y0:y1 + 1, x0:x1 + 1]
        clash = inside & (sub != -1) & (sub != isl[i])
        ov |= clash
        sub[inside & (sub == -1)] = isl[i]
    covered = int((owner != -1).sum())

    if npz_path:
        np.savez_compressed(npz_path, uv=uv.astype(np.float32), island=isl)
    return {
        "island_count": n_isl,
        "flipped_uv_faces": flipped,
        "faces_outside_0_1": out_of_bounds,
        "overlap_pixels_between_islands": int(overlap.sum()),
        "overlap_check_resolution": R,
        "uv_utilization_pct": round(100.0 * covered / (R * R), 2),
        "uv_area_sum": round(uv_area, 5),
        "surface_area_cm2": round(surf_area_m2 * 1e4, 2),
        "texel_density_px_per_cm_at_bake_res": round(math.sqrt(uv_area * bake_res * bake_res / (surf_area_m2 * 1e4)), 2),
    }


def recalc_outside(obj):
    """Make face winding consistent and pointing outward; returns how many faces changed direction."""
    me = obj.data
    before = np.empty(len(me.polygons) * 3, dtype=np.float32); me.polygons.foreach_get("normal", before)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()
    after = np.empty(len(me.polygons) * 3, dtype=np.float32); me.polygons.foreach_get("normal", after)
    return int(((before.reshape(-1, 3) * after.reshape(-1, 3)).sum(1) < 0).sum())


def flatten_faces_with_opposing_normals(obj, passes=4):
    """Smooth-shaded faces on tight folds can get corner normals pointing against the face normal
    (Unreal/validators flag these as flipped). Mark such faces flat so their exported normals = face normal."""
    me = obj.data; total = 0
    for _ in range(passes):
        nl = len(me.loops)
        cn = np.empty(nl * 3, dtype=np.float32); me.corner_normals.foreach_get("vector", cn); cn = cn.reshape(-1, 3)
        fn = np.empty(len(me.polygons) * 3, dtype=np.float32); me.polygons.foreach_get("normal", fn); fn = fn.reshape(-1, 3)
        ls = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get("loop_start", ls)
        lt = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get("loop_total", lt)
        face_of_loop = np.repeat(np.arange(len(me.polygons)), lt)
        bad_loops = (cn * fn[face_of_loop]).sum(1) <= 0.0
        bad = np.unique(face_of_loop[bad_loops])
        sm = np.empty(len(me.polygons), dtype=bool); me.polygons.foreach_get("use_smooth", sm)
        bad = bad[sm[bad]]
        if len(bad) == 0:
            break
        sm[bad] = False; me.polygons.foreach_set("use_smooth", sm); me.update()
        total += int(len(bad))
    return total


def loose_parts_bm(bm):
    """Connected components (by shared vertices) of a bmesh."""
    seen = set(); parts = []
    for v in bm.verts:
        if v.index in seen: continue
        st = [v]; seen.add(v.index); n = 0
        while st:
            x = st.pop(); n += 1
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen:
                    seen.add(y.index); st.append(y)
        parts.append(n)
    return sorted(parts, reverse=True)


def weld_report(obj, dist):
    """Topology of a welded COPY (glTF/FBX importers split vertices at UV/normal seams, which inflates
    boundary-edge and loose-part counts). Does not modify obj. For meshes < ~1M tris."""
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    v0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.verts.index_update()
    parts = loose_parts_bm(bm)
    r = {"weld_distance_m": dist, "verts_before": v0, "verts_after": len(bm.verts),
         "non_manifold_edges": sum(1 for e in bm.edges if len(e.link_faces) > 2),
         "boundary_edges": sum(1 for e in bm.edges if len(e.link_faces) == 1),
         "non_manifold_verts": sum(1 for v in bm.verts if not v.is_manifold),
         "loose_parts": len(parts), "loose_part_vert_counts": parts[:12]}
    bm.free()
    return r


def weld(obj, dist):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    n1 = len(bm.verts)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    return n0 - n1


# ---------------------------------------------------------------- mesh hygiene (pass 2)
_VALIDATOR_GEOM = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                               "validator", "sculptline_validator", "geometry.py")


def _validator_analyze():
    """Load the validator's own geometry.analyze (read-only import by file path; pure numpy) so the pipeline
    checks winding/degenerates with exactly the validator's rules before export."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("_fv_geometry", _VALIDATOR_GEOM)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod.analyze


class _M:
    pass


def validator_selfcheck(obj, diag=None):
    """Same metrics as the validator's 'normals' and 'degenerate_triangles' checks, on obj's triangulated mesh
    (scale-invariant, so metres vs the FBX's cm doesn't matter). Returns counts + face masks over loop_triangles."""
    me = obj.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    co = np.empty(len(me.vertices) * 3, dtype=np.float64); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    tv = np.empty(nt * 3, dtype=np.int64); me.loop_triangles.foreach_get("vertices", tv); tv = tv.reshape(-1, 3)
    tl = np.empty(nt * 3, dtype=np.int64); me.loop_triangles.foreach_get("loops", tl); tl = tl.reshape(-1, 3)
    tp = np.empty(nt, dtype=np.int64); me.loop_triangles.foreach_get("polygon_index", tp)
    cn = np.empty(len(me.loops) * 3, dtype=np.float64); me.corner_normals.foreach_get("vector", cn); cn = cn.reshape(-1, 3)
    # the FBX stores per-corner positions after splitting; analyze welds by position, so pass split corners
    m = _M(); m.positions = co[tv].reshape(-1, 3); m.tris = np.arange(nt * 3).reshape(-1, 3)
    m.corner_normals = cn[tl]; m.name = obj.name
    if diag is None:
        diag = float(np.linalg.norm(co.max(0) - co.min(0))) if len(co) else 1.0
    r = _validator_analyze()(m, diag)
    return {"tris": nt, "degenerate": int(r["degenerate_mask"].sum()), "repeated_vertex": r["duplicate_index_faces"],
            "zero_area": r["zero_area_faces"], "winding_flipped": int(r["winding_flipped_mask"].sum()),
            "normals_against": int(r["normals_against_mask"].sum()), "inverted_shells": r["inverted_components"],
            "_deg_polys": sorted(set(tp[r["degenerate_mask"]].tolist())),
            "_flip_polys": sorted(set(tp[r["winding_flipped_mask"]].tolist()))}


def clean_mesh(obj, rel_dist=5e-6, min_shell_faces=4, max_passes=4):
    """Remove what the validator flags, at the source: merge near-coincident verts, dissolve degenerate
    (repeated-vertex / zero-area) faces, delete duplicate faces and tiny shells (2-3-face 'pillows' that
    decimation leaves behind and that read as inverted closed shells), recalc outward winding, then re-check with
    the validator's own analyzer and flip/delete anything still flagged. Returns a log of what it did."""
    me = obj.data
    diag = float(np.linalg.norm(np.array(obj.dimensions)))
    dist = diag * rel_dist
    log = {"before": {k: v for k, v in validator_selfcheck(obj, diag).items() if not k.startswith("_")},
           "verts_merged": 0, "degenerate_dissolved": 0, "duplicate_faces_deleted": 0, "tiny_shell_faces_deleted": 0,
           "flagged_faces_flipped": 0, "flagged_faces_deleted": 0, "passes": 0}
    for _ in range(max_passes):
        log["passes"] += 1
        bm = bmesh.new(); bm.from_mesh(me)
        n0 = len(bm.verts)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
        log["verts_merged"] += n0 - len(bm.verts)
        f0 = len(bm.faces)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=dist)
        log["degenerate_dissolved"] += max(0, f0 - len(bm.faces))
        big = [f for f in bm.faces if len(f.verts) > 3]   # dissolving can merge tris into ngons: keep it all-tris
        if big:
            bmesh.ops.triangulate(bm, faces=big, quad_method="BEAUTY", ngon_method="BEAUTY")
            log["retriangulated_faces"] = log.get("retriangulated_faces", 0) + len(big)
        seen = {}; dup = []
        for f in bm.faces:
            k = tuple(sorted(v.index for v in f.verts))
            if k in seen: dup.append(f)
            else: seen[k] = f
        if dup:
            bmesh.ops.delete(bm, geom=dup, context="FACES"); log["duplicate_faces_deleted"] += len(dup)
        bm.faces.ensure_lookup_table()
        seenf = set(); tiny = []
        for f in bm.faces:
            if f.index in seenf: continue
            st = [f]; seenf.add(f.index); comp = []
            while st:
                x = st.pop(); comp.append(x)
                for e in x.edges:
                    for g in e.link_faces:
                        if g.index not in seenf: seenf.add(g.index); st.append(g)
            if len(comp) < min_shell_faces: tiny += comp
        if tiny:
            bmesh.ops.delete(bm, geom=tiny, context="FACES"); log["tiny_shell_faces_deleted"] += len(tiny)
        loose = [v for v in bm.verts if not v.link_faces]
        if loose: bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free(); me.update()
        chk = validator_selfcheck(obj, diag)
        if chk["degenerate"] == 0 and chk["winding_flipped"] == 0:
            break
        # still flagged: flip winding-flipped faces, delete degenerate ones, then loop (re-merge/re-check)
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        flip = [bm.faces[i] for i in chk["_flip_polys"] if i < len(bm.faces)]
        if flip:
            bmesh.ops.reverse_faces(bm, faces=flip); log["flagged_faces_flipped"] += len(flip)
        deg = [bm.faces[i] for i in chk["_deg_polys"] if i < len(bm.faces)]
        if deg:
            bmesh.ops.delete(bm, geom=deg, context="FACES"); log["flagged_faces_deleted"] += len(deg)
        bm.to_mesh(me); bm.free(); me.update()
        if flip and not deg:
            chk = validator_selfcheck(obj, diag)
            if chk["degenerate"] == 0 and chk["winding_flipped"] == 0:
                break
    log["orientation_conflict_faces_removed"] = remove_orientation_conflicts(obj)
    log["after"] = {k: v for k, v in validator_selfcheck(obj, diag).items() if not k.startswith("_")}
    return log


def orientation_conflict_polys(obj, rel_tol=1e-6, scales=(1.0, 100.0)):
    """Polygons touching a non-orientable conflict (Moebius-like twist after the validator welds coincident
    positions). Whichever side the validator calls 'reversed' there depends on traversal order, so the robust fix
    is to remove the twisted sliver faces. Checked at metre and centimetre scale (the validator welds by
    quantised position, so rounding cells differ with units)."""
    from collections import deque
    me = obj.data; me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    co = np.empty(len(me.vertices) * 3, dtype=np.float64); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    tv = np.empty(nt * 3, dtype=np.int64); me.loop_triangles.foreach_get("vertices", tv); tv = tv.reshape(-1, 3)
    tp = np.empty(nt, dtype=np.int64); me.loop_triangles.foreach_get("polygon_index", tp)
    diag = float(np.linalg.norm(co.max(0) - co.min(0))) if len(co) else 1.0
    bad = set()
    for sc in scales:
        P = co * sc; tol = diag * sc * rel_tol
        _, inv = np.unique(np.round(P / tol).astype(np.int64), axis=0, return_inverse=True)
        w = inv.reshape(-1)[tv]
        valid = ~((w[:, 0] == w[:, 1]) | (w[:, 1] == w[:, 2]) | (w[:, 0] == w[:, 2]))
        edges = {}
        for f in np.nonzero(valid)[0]:
            a, b, c = w[f]
            for x, y in ((a, b), (b, c), (c, a)):
                edges.setdefault((min(x, y), max(x, y)), []).append((f, x < y))
        adj = {}
        for k, lst in edges.items():
            if len(lst) == 2:
                (f0, d0), (f1, d1) = lst; rel = int(d0 == d1)
                adj.setdefault(f0, []).append((f1, rel)); adj.setdefault(f1, []).append((f0, rel))
        orient = {}
        for s in np.nonzero(valid)[0]:
            if s in orient: continue
            orient[s] = 0; dq = deque([s])
            while dq:
                x = dq.popleft()
                for y, rel in adj.get(x, []):
                    want = orient[x] ^ rel
                    if y not in orient:
                        orient[y] = want; dq.append(y)
                    elif orient[y] != want:
                        bad.update((int(tp[x]), int(tp[y])))
    return sorted(bad)


def remove_orientation_conflicts(obj, max_passes=4):
    removed = 0
    for _ in range(max_passes):
        bad = orientation_conflict_polys(obj)
        if not bad: break
        bm = bmesh.new(); bm.from_mesh(obj.data); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in bad if i < len(bm.faces)], context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose: bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(obj.data); bm.free(); obj.data.update(); removed += len(bad)
    return removed
