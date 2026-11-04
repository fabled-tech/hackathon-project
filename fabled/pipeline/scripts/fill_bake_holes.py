#!/usr/bin/env python3
"""Measure and fill base-colour bake holes (system Python + numpy + Pillow, no Blender).

Holes = texels inside LOD0's UV islands (mask rasterised from work/uv_lod0.npz) that the selected-to-active
bake left black (rays missed the source). They are filled by iterative neighbour averaging (push-pull style
dilation inside the mask), then the islands are dilated outward by margin_px so mip-maps don't bleed black.
Usage: fill_bake_holes.py --out <run>            (fills export/T_<asset>_BC.png in place, writes work/step05b.json)
       fill_bake_holes.py --measure <png> <npz>  (report only)"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

BLACK = 6  # max channel (0-255) at or below which a texel counts as 'no data'


def uv_mask(npz, res):
    d = np.load(npz); uv = d["uv"]
    im = Image.new("L", (res, res), 0); dr = ImageDraw.Draw(im)
    for t in uv:
        dr.polygon([(float(x) * res, (1 - float(y)) * res) for x, y in t], fill=255)
    return np.array(im) > 0


def measure(px, mask):
    blk = px.max(-1) <= BLACK
    return {"uv_mask_texels": int(mask.sum()), "uv_coverage_pct": round(100 * mask.mean(), 2),
            "black_in_uv_mask": int((blk & mask).sum()),
            "black_in_uv_mask_pct": round(100 * (blk & mask).sum() / max(1, mask.sum()), 3),
            "black_whole_texture_pct": round(100 * blk.mean(), 2)}


def _grow(img, have, region, iters):
    img = img.astype(np.float32); have = have.copy(); n = 0
    for _ in range(iters):
        todo = region & ~have
        if not todo.any(): break
        acc = np.zeros_like(img); cnt = np.zeros(have.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            h = np.roll(have, (dy, dx), (0, 1)); v = np.roll(img, (dy, dx), (0, 1))
            acc += v * h[..., None]; cnt += h
        new = todo & (cnt > 0)
        if not new.any(): break
        img[new] = acc[new] / cnt[new][:, None]; have |= new; n += int(new.sum())
    return img, have, n


def fill(px, mask, margin):
    have = (px.max(-1) > BLACK) & mask
    img, have, n_in = _grow(px, have, mask, 4096)
    img, have, n_out = _grow(img, have, np.ones_like(mask), margin)
    return np.clip(img + 0.5, 0, 255).astype(np.uint8), n_in, n_out


if __name__ == "__main__":
    if "--measure" in sys.argv:
        i = sys.argv.index("--measure"); png, npz = sys.argv[i + 1], sys.argv[i + 2]
        px = np.array(Image.open(png).convert("RGB")); print(json.dumps(measure(px, uv_mask(npz, px.shape[0]))))
        sys.exit(0)
    out = sys.argv[sys.argv.index("--out") + 1]
    cfg = json.load(open(os.path.join(out, "config_used.json")))
    s5 = json.load(open(os.path.join(out, "work", "step05.json")))
    bc = (s5.get("base_color") or {}).get("path")
    res = {"enabled": bool(bc)}
    if bc:
        px = np.array(Image.open(bc).convert("RGB"))
        mask = uv_mask(os.path.join(out, "work", "uv_lod0.npz"), px.shape[0])
        res["before_fill"] = measure(px, mask)
        Image.fromarray(px).save(os.path.join(out, "work", "T_BC_raw_bake.png"))
        filled, n_in, n_out = fill(px, mask, cfg["bake"].get("margin_px", 16))
        Image.fromarray(filled).save(bc, optimize=True)
        res.update({"texels_filled_inside_uv": n_in, "texels_dilated_outside_uv": n_out,
                    "after_fill": measure(filled, mask), "raw_bake_copy": "work/T_BC_raw_bake.png",
                    "method": "UV-mask rasterised from LOD0 UVs; black texels (max channel <= %d) inside the mask filled by iterative 8-neighbour averaging; then %d px outward dilation" % (BLACK, cfg["bake"].get("margin_px", 16))})
    json.dump(res, open(os.path.join(out, "work", "step05b.json"), "w"), indent=2)
    print("FILL_BAKE_HOLES", json.dumps(res))
