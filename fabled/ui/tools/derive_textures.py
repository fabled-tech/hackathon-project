"""Derive WebP display copies of the textures embedded in a GLB (build step for the static demo).
Usage: python3 tools/derive_textures.py <in.glb> <out_dir> <cache_dir>  -> prints JSON describing each copy.
Encoding: WebP **lossless** (method 6). Chosen by measurement on the 2048 px bust maps (2026-10-25):
  normal: PNG 16.0 MB (export file) / 4.5 MB (re-encoded PNG) -> WebP lossless 3.73 MB, bit-exact;
          lossy q100/q95/q90 = 1.25/0.82/0.50 MB but max abs error 106-110 and p99 normal-angle error ~10 deg
          (chroma subsampling at UV-island edges), so lossy is rejected for the normal map.
  ORM:    WebP lossless 0.66 MB, bit-exact, smaller than lossy q95 (0.64 MB, max error 146).
Every copy is decoded again and compared to the source pixels; any difference fails the build.
The source GLB is only read. Results are cached by source sha256 so rebuilds are fast."""
import hashlib, io, json, os, shutil, struct, subprocess, sys, tempfile, zlib
import numpy as np
try:
    from PIL import Image
except ImportError:
    Image = None


def _decode_png_rgb(data: bytes):
    """Minimal pure-Python + NumPy PNG RGB/RGBA decoder (filters 0..4)."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError("Not a PNG")
    pos = 8
    w = h = bit_depth = color_type = 0
    idat = bytearray()
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b'IHDR':
            w, h, bit_depth, color_type = struct.unpack('>IIBB', chunk[:10])
        elif ctype == b'IDAT':
            idat.extend(chunk)
        elif ctype == b'IEND':
            break
    channels = {2: 3, 6: 4, 0: 1}[color_type]
    raw = zlib.decompress(bytes(idat))
    stride = w * channels
    rows = np.frombuffer(raw, dtype=np.uint8).reshape(h, 1 + stride)
    out = np.zeros((h, stride), dtype=np.uint8)
    for y in range(h):
        flt = int(rows[y, 0])
        line = rows[y, 1:].copy()
        if flt == 0:
            out[y] = line
        elif flt == 1:
            for i in range(channels, stride):
                line[i] = (int(line[i]) + int(line[i - channels])) & 0xFF
            out[y] = line
        elif flt == 2:
            prev = out[y - 1] if y > 0 else np.zeros(stride, dtype=np.uint8)
            out[y] = (line.astype(np.uint16) + prev.astype(np.uint16)) & 0xFF
        elif flt == 3:
            prev = out[y - 1] if y > 0 else np.zeros(stride, dtype=np.uint8)
            for i in range(stride):
                a = int(line[i - channels]) if i >= channels else 0
                b = int(prev[i])
                line[i] = (int(line[i]) + ((a + b) >> 1)) & 0xFF
            out[y] = line
        elif flt == 4:
            prev = out[y - 1] if y > 0 else np.zeros(stride, dtype=np.uint8)
            for i in range(stride):
                a = int(line[i - channels]) if i >= channels else 0
                b = int(prev[i])
                c = int(prev[i - channels]) if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (int(line[i]) + pr) & 0xFF
            out[y] = line
    img = out.reshape(h, w, channels)
    if channels == 1:
        img = np.repeat(img, 3, axis=2)
    elif channels == 4:
        img = img[:, :, :3]
    mode = 'RGBA' if channels == 4 else 'RGB'
    return img, w, h, mode


src, out_dir, cache = sys.argv[1], sys.argv[2], sys.argv[3]
compare = dict(a.split('=', 1) for a in sys.argv[4:])  # NAME=path/to/export.png: measure convention vs the export file
os.makedirs(out_dir, exist_ok=True); os.makedirs(cache, exist_ok=True)
f = open(src, 'rb').read()
jl = struct.unpack('<I', f[12:16])[0]; j = json.loads(f[20:20 + jl]); b0 = 20 + jl + 8
res = []
for im in j.get('images', []):
    bv = j['bufferViews'][im['bufferView']]; o = b0 + bv.get('byteOffset', 0); data = f[o:o + bv['byteLength']]
    sha = hashlib.sha256(data).hexdigest(); name = im.get('name') or f"image_{len(res)}"
    cached = os.path.join(cache, f'{sha}.webp')
    if Image is not None:
        img = Image.open(io.BytesIO(data)); mode = img.mode; px = np.asarray(img.convert('RGB'))
        width, height = img.width, img.height
        if not os.path.exists(cached):
            tmp = cached + '.tmp'; img.convert('RGB').save(tmp, 'WEBP', lossless=True, quality=100, method=6, exact=True); os.replace(tmp, cached)
        back = np.asarray(Image.open(cached).convert('RGB'))
    else:
        px, width, height, mode = _decode_png_rgb(data)
        cwebp = shutil.which('cwebp') or '/opt/homebrew/bin/cwebp'
        dwebp = shutil.which('dwebp') or '/opt/homebrew/bin/dwebp'
        if not os.path.exists(cached):
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tf:
                tf.write(data)
                tmp_png = tf.name
            tmp_webp = cached + '.tmp'
            try:
                subprocess.run([cwebp, '-quiet', '-lossless', '-z', '6', '-exact', tmp_png, '-o', tmp_webp], check=True)
                os.replace(tmp_webp, cached)
            finally:
                if os.path.exists(tmp_png):
                    os.unlink(tmp_png)
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tf_out:
            tmp_back_png = tf_out.name
        try:
            subprocess.run([dwebp, cached, '-o', tmp_back_png], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            back, _, _, _ = _decode_png_rgb(open(tmp_back_png, 'rb').read())
        finally:
            if os.path.exists(tmp_back_png):
                os.unlink(tmp_back_png)
    if back.shape != px.shape or np.abs(back.astype(int) - px.astype(int)).max() != 0:
        sys.exit(f'WebP copy of {name} is not bit-exact')
    dst = os.path.join(out_dir, f'{name}.webp'); open(dst, 'wb').write(open(cached, 'rb').read())
    cmp = None
    if name in compare and os.path.exists(compare[name]):
        if Image is not None:
            e = np.asarray(Image.open(compare[name]).convert('RGB')).astype(int)
        else:
            e_px, _, _, _ = _decode_png_rgb(open(compare[name], 'rb').read())
            e = e_px.astype(int)
        p = px.astype(int)
        if e.shape == p.shape:
            same = float(np.abs(e - p).mean()); ginv = float(np.abs(np.dstack([e[..., 0], 255 - e[..., 1], e[..., 2]]) - p).mean())
            cmp = {'export_file_bytes': os.path.getsize(compare[name]), 'mean_abs_diff_as_is': round(same, 4), 'mean_abs_diff_green_inverted': round(ginv, 4),
                   'relation': 'identical pixels' if same < 0.05 else 'export file = embedded map with green inverted (DirectX vs OpenGL)' if ginv < 0.5 else 'different'}
    res.append({'name': name, 'export_comparison': cmp, 'file': os.path.basename(dst), 'width': width, 'height': height, 'source_mode': mode,
                'source_embedded_png_bytes': len(data), 'source_sha256': sha, 'webp_bytes': os.path.getsize(dst), 'encoding': 'WebP lossless (method 6), bit-exact vs source pixels'})
print(json.dumps(res))
