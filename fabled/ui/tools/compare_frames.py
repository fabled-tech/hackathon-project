"""Metrics + side-by-side for the downsizing check (frames from tools/render_compare.mjs).
Writes screenshots/demo_downsize_compare_LOD0.png and screenshots/demo_downsize_metrics.json."""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'screenshots')
def L(k):  # frames are RGBA (transparent background): composite on the app's cream background
    im = Image.open(os.path.join(D, f'demo_downsize_LOD0_{k}.png')).convert('RGBA'); bgc = Image.new('RGBA', im.size, (246, 239, 226, 255))
    return np.asarray(Image.alpha_composite(bgc, im).convert('RGB')).astype(np.float64)
a, b, r, n, x = L('a_original_png_glb'), L('b_webp_stripped_glb'), L('r_gltfloader_reference'), L('n_no_maps'), L('x_green_flipped_control')
bg = np.all(np.abs(a - a[0, 0]) < 1, axis=2) & np.all(np.abs(b - b[0, 0]) < 1, axis=2)
fg = ~bg

def ssim(x, y):  # global-window-free SSIM on luminance, 8x8 blocks, standard constants
    lx = x @ [0.299, 0.587, 0.114]; ly = y @ [0.299, 0.587, 0.114]; C1, C2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    h, w = (lx.shape[0] // 8) * 8, (lx.shape[1] // 8) * 8
    bx = lx[:h, :w].reshape(h // 8, 8, w // 8, 8).transpose(0, 2, 1, 3).reshape(-1, 64); by = ly[:h, :w].reshape(h // 8, 8, w // 8, 8).transpose(0, 2, 1, 3).reshape(-1, 64)
    mx, my = bx.mean(1), by.mean(1); vx, vy = bx.var(1), by.var(1); cxy = ((bx - mx[:, None]) * (by - my[:, None])).mean(1)
    return float((((2 * mx * my + C1) * (2 * cxy + C2)) / ((mx ** 2 + my ** 2 + C1) * (vx + vy + C2))).mean())

def m(x, y):
    d = np.abs(x - y); return {'max_abs': float(d.max()), 'mean_abs_object': float(d[fg].mean()), 'pixels_differing': int((d.max(2) > 0).sum()), 'ssim': round(ssim(x, y), 6)}

# banding: in smooth gradient regions, count distinct luminance steps vs a smooth fit; compare a vs b
def banding(x, box):
    y0, y1, x0, x1 = box; lum = (x[y0:y1, x0:x1] @ [0.299, 0.587, 0.114])
    gy, gx = np.gradient(lum); g = np.hypot(gx, gy)
    flat_runs = float(((g == 0)).mean())  # fraction of pixels with exactly zero local gradient (plateaus = banding signature)
    return {'unique_levels': int(len(np.unique(np.round(lum)))), 'zero_gradient_fraction': round(flat_runs, 4), 'lum_range': [float(lum.min()), float(lum.max())]}

H, W, _ = a.shape
ys, xs = np.where(fg); cy, cx = int(ys.mean()), int(xs.mean())
crops = {'brow_eyes': (130, 250, 410, 570), 'mouth_cheek': (300, 420, 330, 450), 'plinth_flat_face': (720, 860, 270, 430)}  # smooth shading areas (chosen on the 900x900 frame)
out = {'b_webp_stripped_vs_a_original': m(a, b), 'a_app_path_vs_r_gltfloader_reference': m(a, r), 'a_with_maps_vs_n_without_maps': m(a, n), 'control_green_flipped_vs_r_reference': m(x, r),
       'banding': {k: {'a_original': banding(a, bx), 'b_webp_stripped': banding(b, bx), 'box_y0_y1_x0_x1': bx} for k, bx in crops.items()}, 'object_pixels': int(fg.sum()), 'size': [W, H]}
json.dump(out, open(os.path.join(D, 'demo_downsize_metrics.json'), 'w'), indent=2)
# composite: a | b | 4x amplified |a-b| ; second row: zoomed crops a vs b
def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()
diff = np.clip(np.abs(a - b) * 16, 0, 255).astype(np.uint8)
row1 = [Image.fromarray(a.astype(np.uint8)), Image.fromarray(b.astype(np.uint8)), Image.fromarray(255 - diff)]
labels1 = ['A  original GLB + embedded PNG maps', 'B  stripped GLB + WebP lossless maps', '|A-B| x16 (white = identical)']
Z = 3; crop_imgs = []; labels2 = []
for k, (y0, y1, x0, x1) in crops.items():
    for tag, img in (('A', a), ('B', b)):
        crop_imgs.append(Image.fromarray(img[y0:y1, x0:x1].astype(np.uint8)).resize(((x1 - x0) * Z, (y1 - y0) * Z), Image.NEAREST)); labels2.append(f'{tag} {k} (3x nearest)')
cw = sum(c.width for c in crop_imgs) + 10 * (len(crop_imgs) - 1)
Wc = max(W * 3 + 20, cw); Hc = 40 + H + 50 + max(c.height for c in crop_imgs) + 40
canvas = Image.new('RGB', (Wc, Hc), (246, 239, 226)); dr = ImageDraw.Draw(canvas); f = font(18)
x = 0
for im, lb in zip(row1, labels1): canvas.paste(im, (x, 40)); dr.text((x + 8, 10), lb, fill=(60, 40, 25), font=f); x += W + 10
x = 0; y = 40 + H + 50
for im, lb in zip(crop_imgs, labels2): canvas.paste(im, (x, y)); dr.text((x + 4, y - 26), lb, fill=(60, 40, 25), font=font(15)); x += im.width + 10
mm = out['b_webp_stripped_vs_a_original']
dr.text((8, Hc - 30), f"B vs A: max abs diff {mm['max_abs']:.0f}, mean abs (object) {mm['mean_abs_object']:.4f}, differing pixels {mm['pixels_differing']}, SSIM {mm['ssim']}  ·  900x900, same camera/lights/material, three.js r169 (SwiftShader)", fill=(60, 40, 25), font=font(15))
canvas.save(os.path.join(D, 'demo_downsize_compare_LOD0.png'))
print(json.dumps(out, indent=1))
