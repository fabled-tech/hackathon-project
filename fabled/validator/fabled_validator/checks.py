"""Every check returns a dict: id, group, title, status (pass|warn|fail|not_checked), message,
measured, expected, items. Checks never report pass for something they could not measure."""
from __future__ import annotations

import math
import os
import re

import numpy as np

from .geometry import analyze
from .profile import UNITS_CM

PASS, WARN, FAIL, NC = "pass", "warn", "fail", "not_checked"
MAX_ITEMS = 25

# Stable order and ids (the UI keys on these ids).
CHECKS = [
    ("scale", "Scale & orientation", "Scale (bounding-box height)"),
    ("up_axis", "Scale & orientation", "Up axis"),
    ("normals", "Normals", "Flipped / inconsistent normals"),
    ("non_manifold", "Geometry", "Non-manifold geometry"),
    ("degenerate_triangles", "Geometry", "Degenerate triangles"),
    ("triangle_budget", "Geometry", "Triangle budget per LOD"),
    ("skeleton_binding", "Skeleton", "Skeleton root & skin binding"),
    ("bone_naming", "Skeleton", "Bone naming"),
    ("texture_files", "Textures & materials", "Missing textures"),
    ("texture_slots", "Textures & materials", "Required texture slots"),
    ("texture_naming", "Textures & materials", "Texture naming"),
    ("texture_size", "Textures & materials", "Texture size (power of two, max res)"),
    ("material_count", "Textures & materials", "Material count"),
    ("uv_layout", "UVs", "UV0 present & in range"),
    ("texel_density", "UVs", "Texel density"),
]
# Only added to a report when a pipeline manifest is given (see manifest.py).
MANIFEST_CHECK = ("manifest", "Pipeline manifest", "Pipeline manifest")
META = {cid: (g, t) for cid, g, t in CHECKS + [MANIFEST_CHECK]}


def result(cid, status, message, measured=None, expected=None, items=None, total_items=None):
    g, t = META[cid]
    items = items or []
    return {
        "id": cid, "group": g, "title": t, "status": status, "message": message,
        "measured": measured or {}, "expected": expected or {},
        "items": items[:MAX_ITEMS], "items_total": total_items if total_items is not None else len(items),
    }


def _fmt(x, nd=1):
    if x is None:
        return "n/a"
    if abs(x) >= 1000:
        return f"{x:,.0f}"
    return f"{x:.{nd}f}"


_COMPATIBLE = {  # name-suffix slot -> property-implied slots that agree with it
    "BaseColor": {"BaseColor", "Other"}, "Normal": {"Normal", "Other"},
    "ORM": {"ORM", "Roughness", "Metallic", "Occlusion", "Other"},
}
UNREAL_ORM_NOTE = ("Packed ORM linked through Roughness/Metallic-type FBX properties. Whether Unreal's FBX importer wires one packed "
                   "texture into separate AO/Roughness/Metallic channels is UNVERIFIED here (no Unreal Editor on this box); "
                   "plan on a material that splits the R/G/B channels.")


def _property_slot(slots):
    s = set(slots)
    if "ORM" in s or {"Roughness", "Metallic"} <= s:
        return "ORM"
    s.discard("Other")
    return s.pop() if len(s) == 1 else ("Other" if not s else "+".join(sorted(s)))


def classify_textures(asset, profile):
    """One entry per (material, file). Slot = profile name suffix (_BC/_N/_ORM) when the file is linked
    to any material property; otherwise the slot implied by the property links. Evidence is kept."""
    suffixes = (profile.get("textures") or {}).get("slot_suffixes") or {}
    for mat in asset.materials:
        groups = {}
        for t in mat.textures:
            groups.setdefault(t.key, []).append(t)
        out = []
        for key, refs in groups.items():
            t = refs[0]
            links, pslots = [], []
            for r in refs:
                for k in r.source_key.split("+"):
                    if k not in links:
                        links.append(k)
                pslots += ["Roughness", "Metallic"] if r.slot == "ORM" and "+" in r.source_key else [r.slot]
            prop = _property_slot(pslots)
            stem = os.path.splitext(t.name)[0]
            by_name = next((sl for sl, suf in suffixes.items() if suf and stem.endswith(suf)), None)
            t.linked_via, t.property_slot = links, prop
            if by_name:
                t.slot = by_name
                t.slot_rule = f"name suffix {suffixes[by_name]} (linked via {', '.join(links)})"
                ok = _COMPATIBLE.get(by_name, {by_name, "Other"})
                if not set(pslots) <= ok:
                    t.slot_conflict = f"name says {by_name}, but it is linked as {prop} via {', '.join(links)}"
            else:
                t.slot = prop
                t.slot_rule = f"property link ({', '.join(links)})"
            out.append(t)
        mat.textures = out


class Context:
    def __init__(self, asset, profile):
        self.asset = asset
        self.profile = profile
        classify_textures(asset, profile)
        self.lod0 = [m for m in asset.meshes if m.lod == min(mm.lod for mm in asset.meshes)]
        P = np.concatenate([m.positions[np.unique(m.tris)] for m in self.lod0])
        self.bbox_min = P.min(axis=0)
        self.bbox_max = P.max(axis=0)
        self.extent = self.bbox_max - self.bbox_min
        self.diag = float(np.linalg.norm(self.extent))
        u = profile["units"]
        if asset.cm_per_unit is not None and u.get("trust_file_units", True):
            self.cm_per_unit = asset.cm_per_unit
            self.unit_basis = asset.unit_source
        else:
            self.cm_per_unit = UNITS_CM[u["assumed_source_units"]]
            why = asset.unit_source if asset.cm_per_unit is None else "profile says not to trust file units"
            self.unit_basis = f"profile assumed_source_units = '{u['assumed_source_units']}' ({why})"
        sc = float(u.get("import_scale", 1.0))
        if sc != 1.0:
            self.cm_per_unit *= sc
            self.unit_basis += f"; import_scale x{sc:g} applied"
        self.topo = [analyze(m, self.diag) for m in asset.meshes]
        self.results = {}

    def used_materials(self):
        idx = set()
        for m in self.asset.meshes:
            idx.update(int(i) for i in np.unique(m.face_material) if i >= 0)
        return sorted(idx)


# ---------------------------------------------------------------- scale / axis
def check_scale(ctx):
    p = ctx.profile["units"]["expected_height_cm"]
    up = ctx.profile["axes"]["up"]
    ai = "XYZ".index(up)
    h_units = float(ctx.extent[ai])
    h_cm = h_units * ctx.cm_per_unit
    lo, hi = p.get("min"), p.get("max")
    measured = {"height_cm": round(h_cm, 3), "height_file_units": round(h_units, 6), "up_axis_used": up,
                "cm_per_file_unit": ctx.cm_per_unit, "unit_basis": ctx.unit_basis,
                "bbox_extent_cm": [round(float(x) * ctx.cm_per_unit, 3) for x in ctx.extent]}
    expected = {"height_cm_min": lo, "height_cm_max": hi}
    if lo is None and hi is None:
        return result("scale", NC, "Profile sets no expected height range.", measured, expected)
    ok = (lo is None or h_cm >= lo) and (hi is None or h_cm <= hi)
    rng = f"{lo:g}–{hi:g} cm" if lo is not None and hi is not None else (f"≥ {lo:g} cm" if lo is not None else f"≤ {hi:g} cm")
    if ok:
        return result("scale", PASS, f"Height {_fmt(h_cm)} cm is inside {rng}.", measured, expected)
    hints = []
    for op, f, why in (("×100", 100.0, "file looks like meters"), ("÷100", 0.01, "values look like centimeters in a meters file"),
                       ("×2.54", 2.54, "file looks like inches"), ("×10", 10.0, "file looks like decimeters"), ("÷10", 0.1, "file looks like millimeters")):
        v = h_cm * f
        if (lo is None or v >= lo) and (hi is None or v <= hi):
            hints.append({"operation": op, "factor": f, "reason": why, "height_cm_after": round(v, 3)})
    measured["fix_hints"] = hints
    msg = f"Height {_fmt(h_cm)} cm is outside {rng}."
    if hints:
        msg += f" Scaling {hints[0]['operation']} gives {_fmt(hints[0]['height_cm_after'])} cm ({hints[0]['reason']})."
    return result("scale", FAIL, msg, measured, expected)


def check_up_axis(ctx):
    up = ctx.profile["axes"]["up"]
    ratio_min = float(ctx.profile["axes"].get("min_up_ratio", 0.9))
    ai = "XYZ".index(up)
    ext = [float(x) for x in ctx.extent]
    others = max(ext[i] for i in range(3) if i != ai)
    ratio = ext[ai] / others if others > 0 else math.inf
    tallest = "XYZ"[int(np.argmax(ext))]
    measured = {"extent_file_units": {"X": round(ext[0], 6), "Y": round(ext[1], 6), "Z": round(ext[2], 6)},
                "tallest_axis": tallest, "up_to_widest_other_ratio": round(ratio, 3) if ratio != math.inf else None,
                "declared_up_axis": ctx.asset.up_axis_declared, "declared_by": ctx.asset.up_axis_source}
    expected = {"up_axis": up, "min_up_ratio": ratio_min}
    decl = ctx.asset.up_axis_declared
    if decl is not None and decl.lstrip("-") != up:
        return result("up_axis", WARN, f"File declares {decl} up, profile expects {up} up ({ctx.asset.up_axis_source}).", measured, expected)
    if ctx.profile.get("asset_type") != "character":
        return result("up_axis", NC, "Height heuristic only applies to asset_type 'character'.", measured, expected)
    if ratio >= ratio_min:
        return result("up_axis", PASS, f"Tallest extent is along {tallest}; {up} extent is {ratio:.2f}× the widest other axis (heuristic).", measured, expected)
    return result("up_axis", WARN, f"Character is taller along {tallest} than {up} ({up} is {ratio:.2f}× the widest other axis) — may be lying down / wrong up axis (heuristic).", measured, expected)


# ---------------------------------------------------------------- geometry
def check_normals(ctx):
    maxf = int(ctx.profile["normals"].get("max_flipped_faces", 0))
    per = []
    tot_w = tot_n = tot_any = tot_conf = tot_inv = tot_both = 0
    have_normals = 0
    for m, t in zip(ctx.asset.meshes, ctx.topo):
        w = t["winding_flipped_mask"]
        n = t["normals_against_mask"]
        anyf = w | n
        have_normals += int(t["has_normals"])
        tot_w += int(w.sum()); tot_n += int(n.sum()); tot_any += int(anyf.sum()); tot_both += int((w & n).sum())
        tot_conf += t["orientation_conflicts"]; tot_inv += t["inverted_components"]
        if anyf.any() or t["orientation_conflicts"]:
            per.append({"mesh": m.name, "faces_flagged": int(anyf.sum()), "winding_flipped": int(w.sum()),
                        "stored_normals_against_face": int(n.sum()), "inconsistent_edges": t["inconsistent_edges"],
                        "fully_inverted_shells": t["inverted_components"], "orientation_conflicts": t["orientation_conflicts"]})
    faces = sum(t["faces"] for t in ctx.topo)
    measured = {"triangles_checked": faces, "faces_flagged": tot_any, "faces_winding_inconsistent": tot_w,
                "faces_stored_normal_against_face": tot_n, "fully_inverted_shells": tot_inv,
                "non_orientable_conflicts": tot_conf, "meshes_with_stored_normals": have_normals,
                "meshes": len(ctx.asset.meshes),
                # additive (schema 0.2.0): the two signals as separate counts; a triangle can be in both
                "reversed_winding": tot_w,
                "stored_normals_against_face": tot_n if have_normals else None,
                "flagged_by_both": tot_both}
    expected = {"max_flipped_faces": maxf}
    if faces == 0:
        return result("normals", NC, "No triangles to check.", measured, expected)
    note = "" if have_normals else " (no stored vertex normals in file; winding only)"
    if tot_any > maxf:
        sn = f"{tot_n:,}" if have_normals else "not measured (no stored vertex normals in file)"
        both = f" ({tot_both:,} in both)" if tot_both else ""
        note2 = note if have_normals else ""
        return result("normals", FAIL, f"{tot_any:,} of {faces:,} triangles flagged — reversed winding: {tot_w:,}; "
                      f"stored normals against face: {sn}{both}{note2}.", measured, expected, per)
    if tot_conf:
        return result("normals", WARN, f"Surface is non-orientable in {tot_conf} place(s){note}.", measured, expected, per)
    return result("normals", PASS, f"All {faces:,} triangles wind consistently with neighbours and stored normals{note}.", measured, expected, per)


def check_non_manifold(ctx):
    allow_open = bool(ctx.profile["geometry"].get("allow_open_boundaries", True))
    per = []
    nme = sum(t["nonmanifold_edges"] for t in ctx.topo)
    be = sum(t["boundary_edges"] for t in ctx.topo)
    for m, t in zip(ctx.asset.meshes, ctx.topo):
        if t["nonmanifold_edges"] or t["boundary_edges"]:
            per.append({"mesh": m.name, "non_manifold_edges": t["nonmanifold_edges"],
                        "faces_on_non_manifold_edges": t["nonmanifold_faces"], "open_boundary_edges": t["boundary_edges"]})
    measured = {"non_manifold_edges": nme, "open_boundary_edges": be,
                "faces_on_non_manifold_edges": sum(t["nonmanifold_faces"] for t in ctx.topo)}
    expected = {"non_manifold_edges": 0, "allow_open_boundaries": allow_open}
    if nme:
        return result("non_manifold", FAIL, f"{nme:,} edge(s) are shared by more than two triangles.", measured, expected, per)
    if be and not allow_open:
        return result("non_manifold", FAIL, f"{be:,} open boundary edge(s); profile requires closed meshes.", measured, expected, per)
    extra = f" {be:,} open boundary edge(s), allowed by profile." if be else " All shells are closed."
    return result("non_manifold", PASS, "No edge is shared by more than two triangles." + extra, measured, expected, per)


def check_degenerate(ctx):
    mx = int(ctx.profile["geometry"].get("max_degenerate_triangles", 0))
    per = []
    d_dup = sum(t["duplicate_index_faces"] for t in ctx.topo)
    d_zero = sum(t["zero_area_faces"] for t in ctx.topo)
    for m, t in zip(ctx.asset.meshes, ctx.topo):
        if t["duplicate_index_faces"] or t["zero_area_faces"]:
            per.append({"mesh": m.name, "repeated_vertex": t["duplicate_index_faces"], "zero_area": t["zero_area_faces"]})
    tot = d_dup + d_zero
    measured = {"degenerate_triangles": tot, "repeated_vertex": d_dup, "zero_area": d_zero}
    expected = {"max_degenerate_triangles": mx}
    if tot > mx:
        return result("degenerate_triangles", FAIL, f"{tot:,} degenerate triangle(s) ({d_dup} repeated-vertex, {d_zero} zero-area).", measured, expected, per)
    return result("degenerate_triangles", PASS, "No zero-area or repeated-vertex triangles." if tot == 0 else f"{tot} degenerate, within limit {mx}.", measured, expected, per)


def check_triangle_budget(ctx):
    budgets = ctx.profile["lods"]["triangle_budgets"]
    min_count = int(ctx.profile["lods"].get("min_count", 1))
    by_lod = {}
    for m in ctx.asset.meshes:
        by_lod[m.lod] = by_lod.get(m.lod, 0) + len(m.tris)
    lods = sorted(by_lod)
    items = []
    status = PASS
    for l in lods:
        b = budgets[l] if l < len(budgets) else None
        st = "no budget" if b is None else ("over" if by_lod[l] > b else "ok")
        items.append({"lod": l, "triangles": by_lod[l], "budget": b, "result": st})
        if st == "over":
            status = FAIL
        elif st == "no budget" and status == PASS:
            status = WARN
    measured = {"lod_count": len(lods), "triangles_per_lod": {f"LOD{l}": by_lod[l] for l in lods}}
    expected = {"triangle_budgets": {f"LOD{i}": b for i, b in enumerate(budgets)}, "min_lod_count": min_count}
    if not budgets:
        return result("triangle_budget", NC, "Profile sets no triangle budgets.", measured, expected, items)
    gaps = [l for l in range(max(lods) + 1) if l not in by_lod]
    msgs = []
    over = [i for i in items if i["result"] == "over"]
    if over:
        msgs.append("; ".join(f"LOD{i['lod']} {i['triangles']:,} > {i['budget']:,}" for i in over))
    if len(lods) < min_count:
        status = FAIL
        msgs.append(f"{len(lods)} LOD(s) found, profile needs {min_count}")
    if gaps:
        status = FAIL if status == FAIL else WARN
        msgs.append("missing LOD" + ",".join(map(str, gaps)))
    nob = [i for i in items if i["result"] == "no budget"]
    if nob:
        msgs.append("no budget for " + ", ".join(f"LOD{i['lod']}" for i in nob))
    if status == PASS:
        msg = "Within budget: " + ", ".join(f"LOD{i['lod']} {i['triangles']:,}/{i['budget']:,}" for i in items) + "."
    else:
        msg = "; ".join(msgs) + "."
    return result("triangle_budget", status, msg, measured, expected, items)


# ---------------------------------------------------------------- skeleton
def _descends(bone, root, parents):
    seen = 0
    while bone is not None and seen < 10000:
        if bone == root:
            return True
        bone = parents.get(bone)
        seen += 1
    return False


def check_skeleton(ctx):
    a = ctx.asset
    sk = ctx.profile["skeleton"]
    root_req = sk.get("root_bone_name")
    expected = {"required": bool(sk.get("required")), "root_bone_name": root_req}
    if a.bone_parents is None:
        return result("skeleton_binding", NC, f"{a.format.upper()} carries no skeleton data, so binding can't be checked.", {}, expected)
    parents = a.bone_parents
    roots = sorted(b for b, p in parents.items() if p is None)
    skinned = [m for m in a.meshes if m.skinned]
    unbound = [m.name for m in skinned if m.skin_index is None]
    static = [m.name for m in a.meshes if not m.skinned]
    measured = {"bone_count": len(parents), "root_bones": roots, "skins": len(a.skins),
                "skinned_meshes": len(skinned), "skinned_meshes_without_skin": len(unbound), "unskinned_meshes": len(static)}
    if not parents and not skinned:
        if sk.get("required"):
            return result("skeleton_binding", FAIL, "No skeleton or skin found; profile requires a skinned character.", measured, expected)
        return result("skeleton_binding", NC, "Skeleton not required by profile; the asset has no bones or skin, so nothing was measured.", measured, expected)
    problems = []
    items = []
    if root_req:
        if root_req not in parents:
            problems.append(f"root bone '{root_req}' not found (top bone{'s' if len(roots) != 1 else ''}: {', '.join(roots) or 'none'})")
        elif parents[root_req] is not None:
            problems.append(f"'{root_req}' exists but is parented under '{parents[root_req]}'")
        elif len(roots) > 1:
            problems.append(f"{len(roots)} top-level bones ({', '.join(roots)}); expected only '{root_req}'")
    if unbound:
        problems.append(f"{len(unbound)} mesh(es) have skin weights but no skin: {', '.join(unbound[:5])}")
        items += [{"mesh": n, "problem": "skin weights but no skin"} for n in unbound]
    for si, s in enumerate(a.skins):
        if root_req and root_req in parents:
            outside = [j for j in s.joints if not _descends(j, root_req, parents)]
            if outside:
                problems.append(f"skin '{s.name}': {len(outside)} joint(s) not under '{root_req}'")
                items += [{"skin": s.name, "joint": j, "problem": f"not under {root_req}"} for j in outside]
        users = [m.name for m in a.meshes if m.skin_index == si]
        items.append({"skin": s.name, "joints": len(s.joints), "bound_meshes": users})
    if sk.get("require_all_meshes_skinned") and static:
        problems.append(f"{len(static)} mesh(es) not skinned: {', '.join(static[:5])}")
    if sk.get("required") and not skinned:
        problems.append("no mesh is skinned")
    if problems:
        return result("skeleton_binding", FAIL, "; ".join(problems) + ".", measured, expected, items)
    msg = f"Root '{root_req}' is the single top bone; {len(skinned)} skinned mesh(es) bound to {len(a.skins)} skin(s) under it." if root_req else \
        f"{len(skinned)} skinned mesh(es) bound to {len(a.skins)} skin(s); profile names no root bone."
    return result("skeleton_binding", PASS, msg, measured, expected, items)


def check_bone_naming(ctx):
    a = ctx.asset
    rx = ctx.profile["skeleton"].get("bone_name_regex")
    expected = {"bone_name_regex": rx}
    if a.bone_parents is None:
        return result("bone_naming", NC, f"{a.format.upper()} carries no bones.", {}, expected)
    names = sorted(a.bone_parents)
    if not names:
        if not ctx.profile["skeleton"].get("required"):
            return result("bone_naming", NC, "Skeleton not required by profile; the asset has no bones to check.", {"bone_count": 0}, expected)
        return result("bone_naming", NC, "Asset has no bones to check.", {"bone_count": 0}, expected)
    if not rx:
        return result("bone_naming", NC, "Profile sets no bone naming regex.", {"bone_count": len(names)}, expected)
    bad = [n for n in names if not re.fullmatch(rx, n)]
    measured = {"bone_count": len(names), "bad_names": len(bad)}
    if bad:
        return result("bone_naming", FAIL, f"{len(bad)} of {len(names)} bone names break the convention: {', '.join(bad[:4])}{'…' if len(bad) > 4 else ''}.",
                      measured, expected, [{"bone": n} for n in bad])
    return result("bone_naming", PASS, f"All {len(names)} bone names match the convention.", measured, expected)


# ---------------------------------------------------------------- materials / textures
def _used_textures(ctx):
    out = []
    seen = set()
    for mi in ctx.used_materials():
        mat = ctx.asset.materials[mi]
        for t in mat.textures:
            out.append((mat, t))
    uniq = []
    for mat, t in out:
        if t.key not in seen:
            seen.add(t.key)
            uniq.append((mat, t))
    return out, uniq


def check_material_count(ctx):
    mx = ctx.profile["materials"].get("max_count")
    used = ctx.used_materials()
    nomat = sum(int((m.face_material < 0).sum()) for m in ctx.asset.meshes)
    measured = {"materials_used": len(used), "materials_defined": len(ctx.asset.materials), "triangles_without_material": nomat,
                "names": [ctx.asset.materials[i].name for i in used]}
    expected = {"max_count": mx}
    if mx is None:
        return result("material_count", NC, "Profile sets no material limit.", measured, expected)
    if len(used) > mx:
        return result("material_count", FAIL, f"{len(used)} materials used, profile allows {mx}.", measured, expected)
    if nomat:
        return result("material_count", WARN, f"{nomat:,} triangle(s) have no material assigned.", measured, expected)
    return result("material_count", PASS, f"{len(used)} material(s) used (max {mx}).", measured, expected)


def check_texture_files(ctx):
    allrefs, uniq = _used_textures(ctx)
    missing = [(m, t) for m, t in uniq if not t.exists]
    measured = {"textures_referenced": len(uniq), "missing": len(missing), "embedded": sum(1 for _, t in uniq if t.embedded)}
    if not uniq:
        return result("texture_files", NC, "No texture references found in used materials.", measured)
    items = [{"material": m.name, "slot": t.slot, "source_key": t.source_key, "file": t.name, "path": t.path, "note": t.note} for m, t in missing]
    if missing:
        return result("texture_files", FAIL, f"{len(missing)} of {len(uniq)} referenced texture(s) missing: {', '.join(t.name for _, t in missing[:3])}.", measured, {}, items)
    return result("texture_files", PASS, f"All {len(uniq)} referenced texture(s) found.", measured)


def _fbx_slot_names(props):
    from .loaders.fbx import FBX_SLOTS
    return [FBX_SLOTS.get(p, "Other") for p in props]


def check_texture_slots(ctx):
    req = ctx.profile["materials"].get("required_texture_slots") or []
    rec = [x for x in (ctx.profile["materials"].get("recommended_texture_slots") or []) if x not in req]
    expected = {"required_texture_slots": req, "recommended_texture_slots": rec}
    used = ctx.used_materials()
    if not req and not rec:
        return result("texture_slots", NC, "Profile requires no texture slots.", {}, expected)
    if not used:
        return result("texture_slots", FAIL, "No material is assigned to any triangle.", {"materials_used": 0}, expected)
    items = []
    for mi in used:
        mat = ctx.asset.materials[mi]
        have = {t.slot for t in mat.textures}
        items.append({"material": mat.name, "slots_present": sorted(have),
                      "missing": [x for x in req if x not in have], "missing_recommended": [x for x in rec if x not in have]})
    bad = [i for i in items if i["missing"]]
    soft = [i for i in items if i["missing_recommended"]]
    links = [{"material": ctx.asset.materials[mi].name, "file": t.name, "slot": t.slot, "linked_via": t.linked_via,
              "property_slot": t.property_slot, "rule": t.slot_rule, **({"conflict": t.slot_conflict} if t.slot_conflict else {})}
             for mi in used for t in ctx.asset.materials[mi].textures]
    conflicts = [l for l in links if l.get("conflict")]
    measured = {"materials_used": len(used), "materials_missing_slots": len(bad), "materials_missing_recommended_slots": len(soft),
                "texture_links": links}
    if ctx.asset.format == "fbx" and any(l["slot"] == "ORM" and {"Roughness", "Metallic"} & set(_fbx_slot_names(l["linked_via"])) for l in links):
        measured["unreal_orm_note"] = UNREAL_ORM_NOTE
    if bad:
        txt = "; ".join(f"{i['material']} missing {', '.join(i['missing'])}" for i in bad[:3])
        return result("texture_slots", FAIL, txt + ".", measured, expected, items)
    if conflicts:
        return result("texture_slots", WARN, "Slot evidence disagrees: " + "; ".join(f"{c['file']}: {c['conflict']}" for c in conflicts[:3]) + ".", measured, expected, items)
    if soft:
        txt = "; ".join(f"{i['material']} has no {', '.join(i['missing_recommended'])}" for i in soft[:3])
        return result("texture_slots", WARN, f"Required slots present ({', '.join(req) or 'none'}); recommended missing: {txt}.", measured, expected, items)
    return result("texture_slots", PASS, f"All {len(used)} material(s) have {', '.join(req + rec)}.", measured, expected, items)


def check_texture_naming(ctx):
    rx = ctx.profile["textures"].get("naming_regex")
    suf = ctx.profile["textures"].get("slot_suffixes") or {}
    expected = {"naming_regex": rx, "slot_suffixes": suf}
    allrefs, uniq = _used_textures(ctx)
    if not allrefs:
        return result("texture_naming", NC, "No texture references to check.", {}, expected)
    if not rx and not suf:
        return result("texture_naming", NC, "Profile sets no naming convention.", {}, expected)
    bad = []
    for mat, t in allrefs:
        reasons = []
        if rx and not re.fullmatch(rx, t.name):
            reasons.append("does not match naming regex")
        link_slot = t.property_slot or t.slot
        if link_slot in suf:
            stem = os.path.splitext(t.name)[0]
            if not stem.endswith(suf[link_slot]):
                reasons.append(f"{link_slot} texture should end with '{suf[link_slot]}'")
        if reasons:
            bad.append({"material": mat.name, "slot": t.slot, "file": t.name, "problems": reasons})
    measured = {"texture_references": len(allrefs), "bad": len(bad)}
    if bad:
        return result("texture_naming", FAIL, f"{len(bad)} texture name(s) break the convention: {', '.join(sorted({b['file'] for b in bad})[:3])}.", measured, expected, bad)
    return result("texture_naming", PASS, f"All {len(allrefs)} texture reference(s) follow the naming convention.", measured, expected)


def _pow2(n):
    return n > 0 and (n & (n - 1)) == 0


def check_texture_size(ctx):
    tp = ctx.profile["textures"]
    mx = tp.get("max_resolution")
    p2 = bool(tp.get("require_power_of_two", True))
    expected = {"require_power_of_two": p2, "max_resolution": mx}
    _, uniq = _used_textures(ctx)
    measured_t = [(m, t) for m, t in uniq if t.width]
    unmeasured = [(m, t) for m, t in uniq if not t.width]
    items = []
    for m, t in measured_t:
        probs = []
        if p2 and not (_pow2(t.width) and _pow2(t.height)):
            probs.append("not power of two")
        if mx and max(t.width, t.height) > mx:
            probs.append(f"exceeds {mx}")
        items.append({"file": t.name, "size": f"{t.width}x{t.height}", "problems": probs})
    for m, t in unmeasured:
        items.append({"file": t.name, "size": None, "problems": ["not measured: " + (t.note or "unknown")]})
    bad = [i for i in items if i["size"] and i["problems"]]
    measured = {"textures_measured": len(measured_t), "textures_not_measured": len(unmeasured),
                "sizes": {t.name: f"{t.width}x{t.height}" for _, t in measured_t}}
    if not uniq:
        return result("texture_size", NC, "No textures referenced.", measured, expected)
    if not measured_t:
        return result("texture_size", NC, "No texture dimensions could be read.", measured, expected, items)
    if bad:
        return result("texture_size", FAIL, "; ".join(f"{b['file']} {b['size']} {' & '.join(b['problems'])}" for b in bad[:3]) + ".", measured, expected, items)
    unknown_fmt = [t for _, t in unmeasured if t.exists]
    tail = ""
    if unmeasured:
        tail = f" {len(unmeasured)} not measured ({'unreadable format' if unknown_fmt else 'file missing, see Missing textures'})."
    if unknown_fmt:
        return result("texture_size", WARN, f"{len(measured_t)} measured texture(s) OK;{tail}", measured, expected, items)
    rng = sorted({max(t.width, t.height) for _, t in measured_t})
    rules = []
    rules.append("power of two" if p2 else "power of two not required")
    rules.append(f"≤ {mx} px" if mx else "no max resolution set")
    return result("texture_size", PASS, f"{len(measured_t)} texture(s) checked: {'; '.join(rules)} (largest {rng[-1]} px).{tail}", measured, expected, items)


# ---------------------------------------------------------------- UVs
def check_uv(ctx):
    up = ctx.profile["uv"]
    tol = float(up.get("tolerance", 1e-4))
    udim = bool(up.get("udim", False))
    expected = {"require_uv0": bool(up.get("require_uv0", True)), "udim": udim, "range": "UDIM tiles 1001-1100" if udim else "[0,1]"}
    no_uv = 0
    oor = 0
    span = 0
    tiles = set()
    total = 0
    per = []
    for m in ctx.asset.meshes:
        F = len(m.tris)
        total += F
        if m.corner_uvs is None:
            no_uv += F
            per.append({"mesh": m.name, "faces_without_uv0": F})
            continue
        uv = m.corner_uvs
        miss = np.isnan(uv).any(axis=(1, 2))
        no_uv += int(miss.sum())
        u = uv[~miss]
        if udim:
            c = u.mean(axis=1)
            tile = np.floor(c)
            rel = u - tile[:, None, :]
            bad = (c[:, 0] < 0) | (c[:, 0] >= 10) | (c[:, 1] < 0)
            mixed = ((rel < -tol) | (rel > 1 + tol)).any(axis=(1, 2)) & ~bad
            for cu, cv in tile[~bad].astype(int):
                tiles.add(int(1001 + cu + 10 * cv))
            nb = int(bad.sum()); ns = int(mixed.sum())
            oor += nb; span += ns
            if miss.any() or nb or ns:
                per.append({"mesh": m.name, "faces_without_uv0": int(miss.sum()), "faces_out_of_udim_range": nb, "faces_straddling_tiles": ns})
        else:
            bad = ((u < -tol) | (u > 1 + tol)).any(axis=(1, 2))
            nb = int(bad.sum())
            oor += nb
            if miss.any() or nb:
                per.append({"mesh": m.name, "faces_without_uv0": int(miss.sum()), "faces_outside_0_1": nb})
    measured = {"triangles": total, "faces_without_uv0": no_uv, ("faces_out_of_range" if not udim else "faces_out_of_udim_range"): oor}
    if udim:
        measured["faces_straddling_tiles"] = span
        measured["udim_tiles"] = sorted(tiles)
    probs = []
    if no_uv and expected["require_uv0"]:
        probs.append(f"{no_uv:,} triangle(s) have no UV0")
    if oor:
        probs.append(f"{oor:,} triangle(s) have UVs outside {'the UDIM range' if udim else '0–1'}")
    if span:
        probs.append(f"{span:,} triangle(s) straddle UDIM tiles")
    if probs:
        return result("uv_layout", FAIL, "; ".join(probs) + ".", measured, expected, per)
    return result("uv_layout", PASS, f"UV0 on all {total:,} triangles, all inside {'UDIM tiles ' + ','.join(map(str, sorted(tiles))) if udim else '0–1'}.", measured, expected, per)


def check_texel_density(ctx):
    td = ctx.profile["texel_density"]
    target = td.get("target_px_per_cm")
    tolp = float(td.get("tolerance_pct", 25))
    sev = td.get("severity", "warn")
    ref_slot = td.get("reference_slot", "BaseColor")
    expected = {"target_px_per_cm": target, "tolerance_pct": tolp, "range_px_per_cm": [round(target * (1 - tolp / 100), 3), round(target * (1 + tolp / 100), 3)] if target else None,
                "reference_slot": ref_slot, "measured_on": "LOD0"}
    cm2 = ctx.cm_per_unit ** 2
    per_mat = {}
    for m in ctx.lod0:
        if m.corner_uvs is None:
            continue
        P = m.positions
        T = m.tris
        cr = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
        wa = 0.5 * np.linalg.norm(cr, axis=1) * cm2
        uv = m.corner_uvs
        e1 = uv[:, 1] - uv[:, 0]
        e2 = uv[:, 2] - uv[:, 0]
        ua = 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
        ok = ~np.isnan(ua) & (wa > 0)
        for mi in np.unique(m.face_material):
            sel = ok & (m.face_material == mi)
            d = per_mat.setdefault(int(mi), {"wa": [], "ua": []})
            d["wa"].append(wa[sel]); d["ua"].append(ua[sel])
    items = []
    unmeasured = []
    for mi, d in sorted(per_mat.items()):
        mat = ctx.asset.materials[mi] if mi >= 0 else None
        name = mat.name if mat else "(no material)"
        tex = None
        if mat:
            cands = [t for t in mat.textures if t.width]
            pref = [t for t in cands if t.slot == ref_slot]
            tex = (pref or cands or [None])[0]
        wa = np.concatenate(d["wa"]) if d["wa"] else np.array([])
        ua = np.concatenate(d["ua"]) if d["ua"] else np.array([])
        if tex is None:
            unmeasured.append({"material": name, "reason": "no texture with known size"})
            continue
        if wa.sum() <= 0 or ua.sum() <= 0:
            unmeasured.append({"material": name, "reason": "no UV area"})
            continue
        px = tex.width * tex.height
        dens = math.sqrt(ua.sum() * px / wa.sum())
        face_d = np.sqrt(ua * px / wa)
        lo, hi = (target * (1 - tolp / 100), target * (1 + tolp / 100)) if target else (None, None)
        items.append({"material": name, "texture": tex.name, "texture_size": f"{tex.width}x{tex.height}",
                      "px_per_cm": round(dens, 3), "face_p5": round(float(np.percentile(face_d, 5)), 3),
                      "face_p95": round(float(np.percentile(face_d, 95)), 3), "surface_cm2": round(float(wa.sum()), 1),
                      "uv_area": round(float(ua.sum()), 5), "in_range": bool(lo <= dens <= hi) if target else None})
    measured = {"materials_measured": len(items), "materials_not_measured": len(unmeasured),
                "px_per_cm": {i["material"]: i["px_per_cm"] for i in items}, "cm_per_file_unit": ctx.cm_per_unit}
    sc = ctx.results.get("scale")
    if not target:
        info = ("; measured (information only): " + ", ".join(f"{i['material']} {i['px_per_cm']:.2f} px/cm" for i in items)) if items else ""
        return result("texel_density", NC, "No studio texel target set" + info + ".", measured, expected, items + unmeasured)
    if sc and sc["status"] == FAIL:
        return result("texel_density", NC, "Skipped until scale passes — world size is wrong, so px/cm would be off by the same factor.", measured, expected, items + unmeasured)
    if not items:
        return result("texel_density", NC, "Can't measure: " + "; ".join(f"{u['material']}: {u['reason']}" for u in unmeasured) if unmeasured else "No UVs on LOD0.", measured, expected, unmeasured)
    out = [i for i in items if not i["in_range"]]
    summary = ", ".join(f"{i['material']} {i['px_per_cm']:.2f}" for i in items) + " px/cm"
    if out:
        return result("texel_density", FAIL if sev == "fail" else WARN, f"Outside {expected['range_px_per_cm'][0]:.2f}–{expected['range_px_per_cm'][1]:.2f} px/cm: " + ", ".join(f"{i['material']} {i['px_per_cm']:.2f}" for i in out) + ".", measured, expected, items + unmeasured)
    if unmeasured:
        return result("texel_density", WARN, f"{summary} in range; {len(unmeasured)} material(s) not measured.", measured, expected, items + unmeasured)
    return result("texel_density", PASS, f"{summary} (target {target:g} ±{tolp:g}%).", measured, expected, items)


RUNNERS = {
    "scale": check_scale, "up_axis": check_up_axis, "normals": check_normals, "non_manifold": check_non_manifold,
    "degenerate_triangles": check_degenerate, "triangle_budget": check_triangle_budget,
    "skeleton_binding": check_skeleton, "bone_naming": check_bone_naming, "texture_files": check_texture_files,
    "texture_slots": check_texture_slots, "texture_naming": check_texture_naming, "texture_size": check_texture_size,
    "material_count": check_material_count, "uv_layout": check_uv, "texel_density": check_texel_density,
}


def run_checks(asset, profile):
    ctx = Context(asset, profile)
    out = []
    for cid, _, _ in CHECKS:
        try:
            r = RUNNERS[cid](ctx)
        except Exception as exc:  # a crashing check must never look like a pass
            r = result(cid, NC, f"Check could not run: {type(exc).__name__}: {exc}")
        ctx.results[cid] = r
        out.append(r)
    stats = {
        "meshes": [{"name": m.name, "lod": m.lod, "triangles": int(len(m.tris)), "vertices": int(len(m.positions)),
                    "skinned": m.skinned, "has_uv0": m.corner_uvs is not None, "has_normals": m.corner_normals is not None} for m in asset.meshes],
        "triangles_total": int(sum(len(m.tris) for m in asset.meshes)),
        "bbox_min": [round(float(x), 6) for x in ctx.bbox_min], "bbox_max": [round(float(x), 6) for x in ctx.bbox_max],
        "materials": [{"name": mt.name, "textures": [{"slot": t.slot, "source_key": t.source_key, "file": t.name, "exists": t.exists,
                                                      "embedded": t.embedded, "size": f"{t.width}x{t.height}" if t.width else None,
                                                      "linked_via": t.linked_via, "slot_rule": t.slot_rule} for t in mt.textures]}
                      for mt in asset.materials],
        "bones": len(asset.bone_parents) if asset.bone_parents is not None else None,
    }
    return out, stats
