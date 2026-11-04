"""Builds <out>/report.json (full metrics) and <out>/manifest.json (fabled.pipeline.manifest/0.1, for the demo UI).

PATH RULE: every path in manifest.json is relative to <out> (the --out folder). Fields ending in _abs are
absolute and informational only."""
import datetime, json, os

SCHEMA = "fabled.pipeline.manifest/0.1"
TOOL_VERSION = "0.1"
RETOPO_TEXT = {
    "quadriflow": "Retopology ran QuadriFlow (automatic quad remesh) on a decimated, repaired proxy of the sculpt. It is not artist retopo: edge loops do not follow facial anatomy or deformation lines. Fine for a static prop, not yet for an animated character.",
    "voxel_quadriflow": "Retopology ran voxel remesh + QuadriFlow on a decimated proxy (QuadriFlow alone was rejected). Automatic quads, not artist retopo; loops ignore anatomy/deformation.",
    "voxel_decimate": "QuadriFlow failed on this input, so retopology FELL BACK to voxel remesh + collapse decimation: LOD0 is a triangle mesh, not quads, and not artist retopo.",
    "source_cleanup": "The source was already below the LOD0 budget, so it was NOT retopologised: LOD0 is the source surface welded and repaired (non-manifold faces removed, holes filled), keeping the source's own (generated) triangle topology.",
    None: "Retopology did not complete.",
}


def manual_steps(method, s3, s5=None, cfg=None):
    s5 = s5 or {}; cfg = cfg or {}
    bc = s5.get("base_color")
    tex_line = ("Base colour is transferred from the source texture by a Cycles bake onto the new UVs; it inherits any blotches/seams of the source texture and needs an artist pass. ORM roughness/metallic are constants; only AO (R) is baked."
                if bc else "No base colour: the source has no colour texture. ORM roughness/metallic are constants; only AO (R) is baked.")
    units_line = (cfg.get("_units_manual_step") or
                  "Source units are inferred (inches) from catalogue dimensions; needs human confirmation (see SOURCE.json).")
    return [
        RETOPO_TEXT.get(method, RETOPO_TEXT[None]),
        f"UV seams come from Smart UV Project (angle-based), not artist-placed: {s3.get('island_count', '?')} islands, {s3.get('uv_utilization_pct', '?')}% of UV space used.",
        "LOD1+ are collapse-decimated from LOD0 (triangles) and reuse LOD0's normal map/ORM; no per-LOD bake.",
        tex_line,
        "The FBX references T_*_ORM.png in the roughness/metallic slots (Blender's exporter has no packed-ORM/AO slot); the Unreal material must pick R/G/B channels. No Unreal material graph is generated.",
        "Unreal import (scale, LodGroup pickup, material hookup) has NOT been tested in Unreal Editor.",
        "No collision mesh, no lightmap UV channel, no skeleton/skinning (static mesh only).",
        units_line,
    ]


def _j(p, default=None):
    try:
        return json.load(open(p))
    except Exception:
        return default


def build(out, cfg, inp, state, source_meta_path=None, blender_version="unknown", failed=None):
    W = os.path.join(out, "work")
    r = lambda p: os.path.relpath(p, out) if p else None
    s1 = _j(os.path.join(W, "step01.json"), {})
    s2p = _j(os.path.join(W, "step02_prep.json"), {})
    method = state.get("retopo_method_used")
    s2 = _j(os.path.join(W, f"step02_{method}.json"), {}) if method else {}
    s3 = _j(os.path.join(W, "step03.json"), {})
    s4 = _j(os.path.join(W, "step04.json"), {})
    s5 = _j(os.path.join(W, "step05.json"), {})
    s6 = _j(os.path.join(W, "step06.json"), {})
    s5b = _j(os.path.join(W, "step05b.json"), {})
    s7 = _j(os.path.join(W, "step07.json"), {})
    previews = _j(os.path.join(W, "previews_index.json"), [])
    asset = cfg["asset_name"]
    prof = cfg.get("fabled_profile") or {}

    # ---- source metadata (driver copies the matching SOURCE.json into <out>)
    src = None
    cands = [os.path.join(out, "SOURCE.json")] + ([source_meta_path] if source_meta_path else [])
    cands += [
        os.path.join(os.path.dirname(inp), "SOURCE.json"), os.path.join(os.path.dirname(os.path.dirname(inp)), "SOURCE.json"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "input", "SOURCE.json")]
    for c in cands:
        d = _j(c) if c else None
        if d and (c == cands[0] or source_meta_path or d.get("file") in (None, os.path.basename(inp))):
            src = d; break
    src = src or {}

    # ---- steps / runtimes
    runs = state.get("step_runs", {})
    rt = lambda k: round(sum(x["wall_s"] for x in runs.get(k, [])), 2) if runs.get(k) else None
    peak = lambda k: max([x["peak_rss_mb"] or 0 for x in runs.get(k, [])] or [0]) or None
    failed_step = state.get("failed_step")
    def st(name, key, method_s, data_ok):
        if failed_step == name:
            return {"name": name, "status": "failed", "method": method_s, "runtime_s": rt(key)}
        if not data_ok:
            return None
        return {"name": name, "status": "automated", "method": method_s, "runtime_s": rt(key), "peak_rss_mb": peak(key)}
    retopo_m = {"quadriflow": "quadriflow (on 200k-tri repaired proxy)", "voxel_quadriflow": "voxel remesh + quadriflow",
                "voxel_decimate": "voxel remesh + collapse decimate (fallback)",
                "source_cleanup": "no retopo: welded + repaired source (source below LOD0 budget)"}.get(method, "quadriflow -> fallbacks")
    ao_on = bool(s5.get("orm"))
    steps = [x for x in [
        st("import_measure", "01", f"Blender importer ({s1.get('input_format','?')}), up axis {s1.get('scale_check',{}).get('up_axis_used','?')}, units x{cfg.get('source_units_to_m')}", bool(s1)),
        st("retopology", "02", retopo_m, bool(s2.get("success"))),
        st("uv_unwrap", "03", "smart_uv_project + pack_islands", bool(s3)),
        st("lod_generation", "04", "collapse decimate from LOD0 to tri budgets", bool(s4)),
        st("texture_bake", "05", "Cycles CPU: normal (tangent, DirectX)" + (" + base colour transfer (DIFFUSE colour)" if s5.get("base_color") else "") + (" + AO -> ORM.R" if ao_on else ""), bool(s5)),
        st("fbx_export", "06", "binary FBX 7400, cm, Z-up/-Y fwd, LodGroup combined + per-LOD FBX/GLB", bool(s6)),
        st("previews", "07", "Cycles CPU renders + Pillow composites", bool(s7)),
    ] if x]
    if failed_step in ("preview_composites",):
        steps.append({"name": "preview_composites", "status": "failed", "method": "Pillow", "runtime_s": rt("08")})
    steps += [
        {"name": "material_setup_unreal", "status": "manual", "method": "FBX references T_*_N / T_*_ORM; Unreal material graph not generated", "runtime_s": None},
        {"name": "skinning", "status": "not_implemented", "method": "static meshes only" + ("; the source has no rig/armature" if not s1.get("source_has_armature") else "; source armature ignored"), "runtime_s": None},
        {"name": "unreal_import_test", "status": "not_implemented", "method": "not run (no Unreal Editor on this box)", "runtime_s": None},
    ]

    # ---- warnings
    warnings = []
    if failed:
        warnings.append(f"Run failed: {failed}")
    sc = s1.get("scale_check") or {}
    if sc:
        if sc.get("status") != "ok":
            warnings.append(f"Scale check FLAG: height {sc.get('height_cm_after_conversion')} cm outside expected {sc.get('expected_height_cm_range')} cm.")
        ho = sc.get("height_override")
        if ho:
            warnings.append(f"Source size not trusted: at its file units the source is {ho['height_cm_if_source_units_to_m_used']} cm tall; it was rescaled to a chosen height of {ho['target_height_cm']} cm (effective source_units_to_m={ho['effective_source_units_to_m']}). " + (cfg.get("_source_units_note") or ""))
        else:
            warnings.append(f"Source units inferred, not documented: source_units_to_m={cfg.get('source_units_to_m')} -> height {sc.get('height_cm_after_conversion')} cm. " + (cfg.get("_source_units_note") or ""))
    hp_ = s1.get("highpoly") or {}
    wl = hp_.get("welded") or {}
    if wl and (wl.get("non_manifold_edges") or wl.get("boundary_edges") or (wl.get("loose_parts") or 1) > 1):
        warnings.append(f"Source topology is not clean (after welding coincident verts): {wl.get('non_manifold_edges')} non-manifold edges, {wl.get('boundary_edges')} open boundary edges, {wl.get('non_manifold_verts')} non-manifold verts, {wl.get('loose_parts')} separate parts (vert counts {wl.get('loose_part_vert_counts')}). Unwelded as imported: {hp_.get('boundary_edges')} boundary edges, {hp_.get('loose_parts_unwelded')} parts.")
    if cfg["lods"] and hp_.get("tris") and hp_["tris"] <= cfg["lods"][0]["target_tris"] * 1.05:
        warnings.append(f"Source is already low-poly ({hp_['tris']:,} tris), at or below the LOD0 budget ({cfg['lods'][0]['target_tris']:,}); LOD budgets were set relative to the source, not to a 'high-poly to game-res' reduction.")
    if s1.get("input_format") in (".glb", ".gltf", ".fbx") and not s1.get("source_has_armature"):
        warnings.append("Static mesh only: the source has no rig/armature and the pipeline does not do skinning (step 'skinning' = not_implemented).")
    sk = (prof.get("skeleton") or {}).get("type", "none")
    if sk and sk != "none":
        warnings.append(f"fabled_profile.skeleton.type='{sk}' was ignored: the pipeline outputs static meshes only (skinning not implemented).")
    if ao_on:
        o = s5["orm"]["channels"]
        warnings.append(f"ORM roughness (G={o['g']['constant']}) and metallic (B={o['b']['constant']}) are constants, not measured; only R (AO) is baked.")
    bc_ = s5.get("base_color")
    if bc_:
        warnings.append(f"Base colour is a bake transfer of the source texture ({', '.join(bc_.get('source_textures', []))}) onto LOD0's new UVs: it carries the source texture's blotches/baked-in lighting, and texels whose rays missed the source were black" + (f" ({(s5b.get('before_fill') or {}).get('black_in_uv_mask_pct')}% of the UV-covered area in the raw bake; {(s5b.get('after_fill') or {}).get('black_in_uv_mask_pct')}% after neighbour fill + dilation; filled texels are guessed colour, not source data)." if s5b.get('enabled') else f" ({bc_.get('pct_texels_black')}% of the texture is black, including empty UV space)."))
    elif s5:
        warnings.append("No base colour texture: " + (s5.get("base_color_note") or "the source has no colour data") + ", so base_color is null.")
    for l in s4.get("lods", []):
        if not l.get("within_tolerance"):
            warnings.append(f"{l['name']} misses its budget: {l['actual_tris']} vs {l['target_tris']} tris ({l['delta_pct']:+.1f}%).")
    if s3.get("flipped_uv_faces"):
        warnings.append(f"LOD0 has {s3['flipped_uv_faces']} UV-flipped faces (Smart UV Project).")
    if s2p.get("proxy_repair", {}).get("faces_removed_nonmanifold"):
        warnings.append(f"Retopo proxy needed repair: {s2p['proxy_repair']['faces_removed_nonmanifold']} faces on non-manifold edges removed and holes filled before QuadriFlow (bake still uses the untouched sculpt).")
    for a_ in state.get("retopo_attempts", []):
        if not a_["success"]:
            warnings.append(f"Retopo method {a_['method']} failed: {a_['error']}")
    rn = _j(os.path.join(out, "REVIEW_NOTES.json"), {}) or {}
    for n_ in rn.get("warnings", []):
        warnings.append("[manual review of previews] " + n_)
    warnings.append("Unreal import not tested: the LodGroup in the combined FBX is written via a runtime patch to Blender's exporter and has only been verified by re-importing into Blender.")

    # ---- outputs
    fbx_by_lod = {f["lod"]: f for f in s6.get("files", [])}
    glb_by_lod = {f["lod"]: f for f in s6.get("glb_files", [])}
    ver_comb = next((v for v in s6.get("verification", []) if v.get("kind") == "combined_fbx_lodgroup"), {})
    out_lods, top_lods = [], []
    for i, l in enumerate(s4.get("lods", [])):
        spec = cfg["lods"][i] if i < len(cfg["lods"]) else {}
        f = fbx_by_lod.get(l["name"], {}); g = glb_by_lod.get(l["name"], {})
        out_lods.append({"level": i, "name": l["name"], "mesh_name": f"SM_{asset}_{l['name']}",
                         "path": r(f.get("path")), "format": "fbx", "glb": r(g.get("path")),
                         "triangles": l["actual_tris"], "vertices": l["verts"], "budget_triangles": l["target_tris"],
                         "delta_pct": l["delta_pct"], "within_tolerance": l["within_tolerance"],
                         "screen_size": spec.get("screen_size"), "has_uvs": True, "uv_islands": l.get("uv_islands"),
                         "fbx_bytes": f.get("bytes"), "glb_bytes": g.get("bytes"), "source": l.get("source")})
        top_lods.append({"level": i, "path": r(f.get("path")), "triangles": l["actual_tris"], "budget_triangles": l["target_tris"]})
    comb = fbx_by_lod.get("ALL", {})
    nrm = s5.get("texture_path"); orm = (s5.get("orm") or {}).get("path")
    tex_obj = {"base_color": r((s5.get("base_color") or {}).get("path")), "normal": r(nrm), "orm": r(orm)}
    uv_png = next((p["path"] for p in previews if "uv_layout" in p["path"]), None)
    validator_profile = "validator_profile.json" if os.path.exists(os.path.join(out, "validator_profile.json")) else None
    status = "failed" if failed else "ok"
    job_id = os.path.basename(os.path.dirname(out)) if os.path.basename(out) == "out" else os.path.basename(out)

    manifest = {
        "schema": SCHEMA, "concept_mockup": False, "job_id": job_id,
        "created_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "asset": asset, "status": status, "error": failed,
        "path_rule": "all paths are relative to the --out folder (this manifest's directory); *_abs fields are absolute",
        "up_axis": sc.get("up_axis_used") or prof.get("up_axis") or cfg.get("source_up_axis"),
        "export_up_axis": ({0: "X", 1: "Y", 2: "Z"}.get((ver_comb.get("fbx_global_settings") or {}).get("UpAxis"))) if ver_comb else None,
        "axes_note": "up_axis = the SOURCE file's up axis (rotated to Z-up on import). export_up_axis = the exported FBX's up axis, read back from its GlobalSettings.UpAxis. GLBs are +Y up per the glTF spec.",
        "exported_size": {
            "fbx_bbox_cm_xyz_zup": ver_comb.get("dims_cm_reimported"),
            "fbx_height_cm": (ver_comb.get("dims_cm_reimported") or [None, None, None])[2],
            "glb_lod0_bbox_cm_xyz_yup": ((s6.get("glb_files") or [{}])[0].get("verification") or {}).get("bbox_cm_xyz_yup"),
            "glb_lod0_height_cm": ((s6.get("glb_files") or [{}])[0].get("verification") or {}).get("height_cm_along_Y"),
            "reference": (sc.get("reference_comparison") or {}),
        },
        "fbx_texture_files_referenced": ver_comb.get("texture_files_referenced"),
        "units": {"unit_scale_factor": (ver_comb.get("fbx_global_settings") or {}).get("UnitScaleFactor"),
                  "unit_scale_factor_source": "read back from export/SM_<asset>.fbx GlobalSettings" if ver_comb else None,
                  "unreal_units": "cm",
                  "source_units_to_m": sc.get("source_units_to_m", cfg.get("source_units_to_m")),
                  "source_units_to_m_note": ("effective scale actually applied at import (rescaled to target_height_cm=%s); config value was %s" % (cfg.get("target_height_cm"), cfg.get("source_units_to_m"))) if sc.get("height_override") else "as configured",
                  "config_source_units_to_m": cfg.get("source_units_to_m"),
                  "target_height_cm": cfg.get("target_height_cm")},
        "combined_fbx": r(comb.get("path")),
        "combined_fbx_is_binary": ver_comb.get("is_binary_fbx"),
        "combined_fbx_has_lodgroup": ver_comb.get("has_lodgroup_node"),
        "lods": top_lods,
        "profile": validator_profile,
        "pipeline_config": "config_used.json",
        "textures": [{"material": s5.get("material", f"M_{asset}"), **tex_obj}] if s5 else [],
        "orm_channels": (s5.get("orm") or {}).get("channels"),
        "base_color_bake_holes": ({"black_in_uv_mask_pct_raw_bake": (s5b.get("before_fill") or {}).get("black_in_uv_mask_pct"),
                                   "black_in_uv_mask_pct_after_fill": (s5b.get("after_fill") or {}).get("black_in_uv_mask_pct"),
                                   "method": s5b.get("method"), "raw_bake_copy": s5b.get("raw_bake_copy")} if s5b.get("enabled") else None),
        "pre_export_selfcheck": s6.get("pre_export_selfcheck"),
        "detail_geometry": (s2.get("keep_detail") or None),
        "source": {"name": src.get("name"), "url": src.get("url"), "license": src.get("license"),
                   "license_url": src.get("license_url"), "attribution": src.get("attribution"),
                   "record_urls": src.get("record_urls"),
                   "source_json": "SOURCE.json" if os.path.exists(os.path.join(out, "SOURCE.json")) else None,
                   "units_needs_human_confirmation": (src.get("units") or {}).get("needs_human_confirmation")},
        "tool": {"name": "fabled-pipeline", "version": TOOL_VERSION, "blender_version": blender_version},
        "input": {"sculpt_path": r(inp), "sculpt_path_abs": inp, "format": s1.get("input_format", os.path.splitext(inp)[1]).lstrip("."),
                  "bytes": s1.get("input_bytes"),
                  "triangles": (s1.get("highpoly") or {}).get("tris"), "vertices": (s1.get("highpoly") or {}).get("verts"),
                  "dims_cm": [round(v * 100, 2) for v in (s1.get("highpoly") or {}).get("dims_m", [])],
                  "source_url": src.get("url"), "license": src.get("license"), "attribution": src.get("attribution")},
        "outputs": {"lods": out_lods, "combined_fbx": r(comb.get("path")), "uv_layout_png": uv_png,
                    "textures": tex_obj, "previews": previews},
        "stages": {
            "highpoly": {k: (s1.get("highpoly") or {}).get(k) for k in ("tris", "verts", "non_manifold_edges", "boundary_edges", "loose_parts_unwelded", "welded")},
            "source_materials": s1.get("source_materials"),
            "retopo_proxy": {k: (s2p.get("proxy") or {}).get(k) for k in ("tris", "verts")},
            "lod0_retopo_quads": {k: (s2.get("lod0") or {}).get(k) for k in ("faces", "quads", "tris", "verts")},
            "uv": {k: s3.get(k) for k in ("island_count", "overlap_pixels_between_islands", "flipped_uv_faces", "uv_utilization_pct", "texel_density_px_per_cm_at_bake_res")},
            "bake": {"resolution": s5.get("resolution"), "normal_convention": s5.get("normal_convention"),
                     "bake_source_tris": s5.get("bake_source_tris"), "bake_target_tris": s5.get("bake_target_tris")},
        },
        "steps": steps,
        "runtimes_s": {k: rt(k) for k in sorted(runs)},
        "runtimes_note": "Wall-clock seconds on this machine (8 vCPU, ~15 GB RAM, CPU only), including Blender start-up and .blend load per step. Not a comparison with artist time.",
        "warnings": warnings,
        "manual_steps": manual_steps(method, s3, s5, cfg),
        "report": "report.json",
    }
    report = {"manifest_summary": {k: manifest[k] for k in ("asset", "status", "error", "created_at")},
              "blender_version": blender_version, "input": manifest["input"], "source": src,
              "config_used": cfg, "driver": state,
              "step01_import": s1, "step02_prep": s2p, "step02_retopo": s2, "retopo_method_used": method,
              "step03_uv": s3, "step04_lods": s4, "step05_bake": s5, "step06_export": s6, "step07_previews": s7,
              "previews": previews, "warnings": warnings, "manual_steps": manual_steps(method, s3, s5, cfg),
              "output_files": _files(out)}
    json.dump(report, open(os.path.join(out, "report.json"), "w"), indent=2)
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=2)
    print("manifest:", os.path.join(out, "manifest.json"))


def _files(out):
    res = []
    for sub in ("export", "previews", "previews/raw"):
        d = os.path.join(out, sub)
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                p = os.path.join(d, f)
                if os.path.isfile(p):
                    res.append({"path": os.path.relpath(p, out), "bytes": os.path.getsize(p)})
    return res
