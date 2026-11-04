#!/usr/bin/env python3
"""Labelled preview composites for the demo UI (system Python + Pillow, no Blender).
Reads raw renders from <out>/previews/raw and metrics from <out>/work/step*.json."""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def _find_font(bold=False):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


FONT_PATH = _find_font(bold=False)
FONTB_PATH = _find_font(bold=True)


def _get_font(bold=False, size=20):
    p = FONTB_PATH if bold else FONT_PATH
    if p:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()


f_title = _get_font(bold=True, size=30)
f_lab = _get_font(bold=False, size=24)
f_small = _get_font(bold=False, size=17)
BG = (38, 38, 42); FG = (235, 235, 235); SUB = (170, 170, 175)


def main(out):
    W = os.path.join(out, "work"); RAW = os.path.join(out, "previews", "raw"); PV = os.path.join(out, "previews")
    cfg = json.load(open(os.path.join(out, "config_used.json")))
    j = lambda n: json.load(open(os.path.join(W, n)))
    s1, s4, s5 = j("step01.json"), j("step04.json"), j("step05.json")
    s2 = {}
    for m in cfg["retopo"]["method_order"]:
        p = os.path.join(W, f"step02_{m}.json")
        if os.path.exists(p) and json.load(open(p)).get("success"):
            s2 = json.load(open(p)); break
    method = {"source_cleanup": "source cleanup (weld+repair)", "quadriflow": "QuadriFlow", "voxel_quadriflow": "voxel remesh + QuadriFlow", "voxel_decimate": "voxel remesh + decimate"}.get(s2.get("stage"), "?")
    _src = {}
    try:
        _src = json.load(open(os.path.join(out, "SOURCE.json")))
    except Exception:
        pass
    _srcs = (f"source: {_src.get('credit_line') or _src.get('url')}, {_src.get('license')}" if _src else "source: see manifest")
    FOOT = f"Real pipeline output (not a mockup) | Blender headless | {_srcs} | tri counts measured by the pipeline"
    hp_tris = s1["highpoly"]["tris"]
    SRC = cfg.get("previews", {}).get("source_label", "High-poly sculpt"); SRCS = cfg.get("previews", {}).get("source_label_short", "High-poly")
    SRCNOTE = cfg.get("previews", {}).get("source_note", "source scan, untouched")
    lods = {l["name"]: l for l in s4["lods"]}
    names = [l["name"] for l in s4["lods"]]
    made = []

    def panel(img_name, w):
        im = Image.open(os.path.join(RAW, img_name + ".png")).convert("RGBA")
        return im.resize((w, w), Image.LANCZOS)

    def compose(fname, title, items, w=640, label="", top=70, bottom=96):
        cw = w * len(items); canvas = Image.new("RGB", (cw, top + w + bottom), BG); d = ImageDraw.Draw(canvas)
        d.text((20, 18), title, font=f_title, fill=FG)
        for i, (img, l1, l2) in enumerate(items):
            if isinstance(img, Image.Image):
                p = img.convert("RGBA").resize((w, w), Image.LANCZOS)
            else:
                p = panel(img, w)
            canvas.paste(p, (i * w, top), p)
            d.text((i * w + 16, top + w + 8), l1, font=f_lab, fill=FG)
            d.text((i * w + 16, top + w + 40), l2, font=f_small, fill=SUB)
        fs = 17
        foot_font = _get_font(bold=False, size=fs)
        while fs > 9 and d.textlength(FOOT, font=foot_font) > cw - 30:
            fs -= 1
            foot_font = _get_font(bold=False, size=fs)
        d.text((20, top + w + bottom - 26), FOOT, font=foot_font, fill=(120, 120, 125))
        path = os.path.join(PV, fname); canvas.save(path, optimize=True)
        made.append({"path": os.path.relpath(path, out), "label": label or title})

    l0, ln = lods[names[0]], lods[names[-1]]
    lt = lambda l: f"{l['actual_tris']:,} tris (budget {l['target_tris']:,})"
    compose("compare_shaded_highpoly_vs_lod0.png", f"Before / after: {SRC.lower()} vs game-res LOD0",
            [("hp_shaded", f"{SRC}: {hp_tris:,} tris", SRCNOTE),
             ("lod0_shaded_normalmap", f"{names[0]}: {lt(l0)}", f"{method} retopo + baked normal map")],
            label=f"Shaded before/after: {SRCS.lower()} ({hp_tris:,} tris) vs {names[0]} + normal map ({l0['actual_tris']:,} tris)")
    compose("compare_wire_highpoly_lod0_lodN.png", f"Wireframe: {SRCS.lower()} vs {names[0]} vs {names[-1]}",
            [("hp_wire", f"{SRCS}: {hp_tris:,} tris", ("wire too dense to read at this size" if hp_tris > 200000 else "source topology")),
             ("lod0_wire", f"{names[0]}: {lt(l0)}", f"{method} (quads shown)"),
             (f"{names[-1].lower()}_wire", f"{names[-1]}: {lt(ln)}", "collapse-decimated from LOD0")], w=560,
            label=f"Wireframe: {SRCS.lower()} vs {names[0]} vs {names[-1]}")
    compose("lod_strip_wire.png", "LOD chain (target vs actual triangles)",
            [(f"{n.lower()}_wire", f"{n}: {lods[n]['actual_tris']:,} tris", f"budget {lods[n]['target_tris']:,} ({lods[n]['delta_pct']:+.1f}%)") for n in names],
            w=440, label="LOD strip " + " / ".join(f"{n} {lods[n]['actual_tris']:,}" for n in names))
    compose("closeup_wire_highpoly_vs_lod0.png", f"Close-up wireframe: {SRCS.lower()} vs LOD0",
            [("closeup_hp_wire", f"{SRCS}: {hp_tris:,} tris", "close-up"),
             ("closeup_lod0_wire", f"{names[0]}: {l0['actual_tris']:,} tris", f"{method} quads")],
            label=f"Close-up wireframe: {SRCS.lower()} vs LOD0")
    nm = Image.open(s5["texture_path"]).convert("RGB")
    compose("normal_map_on_lod0.png", "Baked normal map on LOD0 (close-up)",
            [("closeup_lod0_shaded_no_normalmap", f"{names[0]} without normal map", f"{l0['actual_tris']:,} tris"),
             ("closeup_lod0_shaded_normalmap", f"{names[0]} + baked normal map", f"same {l0['actual_tris']:,} tris"),
             ("closeup_hp_shaded", f"{SRCS} reference", f"{hp_tris:,} tris")], w=560,
            label=f"Normal map effect on LOD0 (close-up): without / with / {SRCS.lower()} reference")
    bc = s5.get("base_color") or {}
    if bc.get("path") and os.path.exists(os.path.join(RAW, "lod0_textured.png")):
        compose("compare_textured_source_vs_lod0.png", f"Before / after: source vs {names[0]} with baked base colour",
                [("hp_textured", f"Source: {hp_tris:,} tris", "original mesh + original texture"),
                 ("lod0_textured", f"{names[0]}: {lt(l0)}", f"{method} + baked BC + normal map")],
                label=f"Textured before/after: source ({hp_tris:,} tris) vs {names[0]} + baked BC ({l0['actual_tris']:,} tris)")
        bct = Image.open(bc["path"]).convert("RGB")
        compose("base_color_on_lod0.png", f"Baked base colour on {names[0]}",
                [("lod0_textured", f"{names[0]} front", f"{l0['actual_tris']:,} tris"),
                 ("lod0_textured_back", f"{names[0]} back", "same mesh"),
                 (bct, f"T_{cfg['asset_name']}_BC.png", f"{bc['resolution']} px, transferred from source")], w=560,
                label=f"Baked base colour on {names[0]} (front, back) and the BC texture")
        compose("compare_textured_source_vs_lod0_back.png", "Back view: source vs LOD0 (baked BC)",
                [("hp_textured_back", "Source (back)", f"{hp_tris:,} tris"),
                 ("lod0_textured_back", f"{names[0]} (back)", f"{l0['actual_tris']:,} tris")],
                label="Textured back view: source vs LOD0")
        bth = bct.resize((1024, 1024), Image.LANCZOS); bp = os.path.join(PV, "base_color_texture_1024.png"); bth.save(bp, optimize=True)
        made.append({"path": os.path.relpath(bp, out), "label": f"Baked base colour ({bc['resolution']} px source), downscaled"})
    if os.path.exists(os.path.join(RAW, "closeup_lod0_textured.png")):
        s2k = s2.get("keep_detail") or {}
        dnote = (f"+ {s2k.get('pieces_kept')} kept detail pieces ({s2k.get('tris')} tris)" if s2k.get("appended") else "no detail geometry kept")
        items = [("closeup_hp_textured", f"{SRCS} (close-up)", f"{hp_tris:,} tris"),
                 ("closeup_lod0_textured", f"{names[0]} (close-up)", f"{l0['actual_tris']:,} tris, {dnote}")]
        if os.path.exists(os.path.join(RAW, "closeup_lod1_textured.png")):
            l1 = lods[names[1]]
            items.append(("closeup_lod1_textured", f"{names[1]} (close-up)", f"{l1['actual_tris']:,} tris"))
        compose("face_closeup_whiskers_bell.png", "Face close-up: whiskers and bell", items, w=560,
                label="Face close-up (whiskers, bell): source vs " + " vs ".join(n for n in names[:len(items) - 1]))
    cmp_run = cfg.get("previews", {}).get("compare_with_run")
    if cmp_run and os.path.isdir(os.path.join(cmp_run, "previews", "raw")):
        craw = os.path.join(cmp_run, "previews", "raw")
        cm = json.load(open(os.path.join(cmp_run, "manifest.json")))
        c_l0 = cm["outputs"]["lods"][0]["triangles"]; cid = os.path.basename(os.path.normpath(cmp_run))
        for view, suf in (("front", ""), ("back", "_back")):
            a_ = os.path.join(craw, f"lod0_textured{suf}.png"); b_ = f"lod0_textured{suf}"
            if os.path.exists(a_) and os.path.exists(os.path.join(RAW, b_ + ".png")):
                compose(f"compare_pass1_vs_pass2_lod0_{view}.png", f"{names[0]} textured, {view}: previous run vs this run",
                        [(Image.open(a_), f"Pass 1 {names[0]}: {c_l0:,} tris", cid),
                         (b_, f"Pass 2 {names[0]}: {l0['actual_tris']:,} tris", os.path.basename(os.path.normpath(out)))],
                        label=f"{names[0]} textured {view}: pass 1 ({cid}) vs pass 2")
    # normal map texture thumbnail + UV layout
    thumb = nm.resize((1024, 1024), Image.LANCZOS); tp = os.path.join(PV, "normal_map_texture_1024.png"); thumb.save(tp, optimize=True)
    orm_p = (s5.get("orm") or {}).get("path")
    if orm_p and os.path.exists(orm_p):
        ao = Image.open(orm_p).convert("RGB").split()[0].resize((1024, 1024), Image.LANCZOS)
        ap = os.path.join(PV, "ao_map_texture_1024.png"); ao.save(ap, optimize=True)
        made.append({"path": os.path.relpath(ap, out), "label": "Baked ambient occlusion (ORM red channel), downscaled"})
    made.append({"path": os.path.relpath(tp, out), "label": f"Baked tangent-space normal map ({s5['resolution']} px source, {s5['normal_convention']} green), downscaled"})
    uvd = np.load(os.path.join(W, "uv_lod0.npz")); uv, isl = uvd["uv"], uvd["island"]
    R = 1024; im = Image.new("RGB", (R, R), (24, 24, 28)); d = ImageDraw.Draw(im)
    rng = np.random.default_rng(1); cols = (rng.random((isl.max() + 1, 3)) * 150 + 70).astype(int)
    for t, k in zip(uv, isl):
        pts = [(float(x) * R, (1 - float(y)) * R) for x, y in t]
        d.polygon(pts, fill=tuple(cols[k] // 2), outline=tuple(cols[k]))
    up = os.path.join(PV, "uv_layout_lod0.png"); im.save(up, optimize=True)
    s3 = j("step03.json")
    made.append({"path": os.path.relpath(up, out), "label": f"LOD0 UV layout: {s3['island_count']} islands, {s3['uv_utilization_pct']}% of 0-1 space used, {s3['overlap_pixels_between_islands']} overlap px"})
    for name, label in (("hp_shaded", f"{SRC}, shaded (raw render, transparent)"),
                        ("lod0_shaded_normalmap", "LOD0 + normal map, shaded (raw render, transparent)"),
                        ("lod0_wire", "LOD0 wireframe (raw render, transparent)"),
                        (f"{names[-1].lower()}_wire", f"{names[-1]} wireframe (raw render, transparent)")):
        made.append({"path": os.path.relpath(os.path.join(RAW, name + ".png"), out), "label": label})
    json.dump(made, open(os.path.join(W, "previews_index.json"), "w"), indent=2)
    print("POST_PREVIEWS", len(made))


if __name__ == "__main__":
    if "--out" not in sys.argv:
        print("Usage: post_previews.py --out <out_dir>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[sys.argv.index("--out") + 1])
