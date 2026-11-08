#!/usr/bin/env python3
"""Procedurally generate the SculptLine demo sample sculpt (a stylized bust-like head).

Self-made, procedurally generated, no third-party assets: free to use in the demo.
Outputs (into ../samples/):
  fabled_sample_head.glb  icosphere level 7  (327,680 tris)
  fabled_sample_head.obj  icosphere level 6  (81,920 tris)

Two issues are seeded ON PURPOSE so the pre-import check has something real to catch:
  1. Units: the head is ~35 units tall. glTF units are meters, so it reads as ~35 m
     (an authored-in-centimeters mismatch). Setting the profile scale to 0.01 fixes it.
  2. Flipped normals: one patch (the left "ear" region) has reversed triangle winding.
Run:  python3 tools/make_sample_sculpt.py
"""
import json, struct, os, sys
import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "samples")

def icosphere(level):
    t = (1 + 5 ** 0.5) / 2
    v = [(-1,t,0),(1,t,0),(-1,-t,0),(1,-t,0),(0,-1,t),(0,1,t),(0,-1,-t),(0,1,-t),(t,0,-1),(t,0,1),(-t,0,-1),(-t,0,1)]
    f = [(0,11,5),(0,5,1),(0,1,7),(0,7,10),(0,10,11),(1,5,9),(5,11,4),(11,10,2),(10,7,6),(7,1,8),
         (3,9,4),(3,4,2),(3,2,6),(3,6,8),(3,8,9),(4,9,5),(2,4,11),(6,2,10),(8,6,7),(9,8,1)]
    verts = [np.array(p, float) / np.linalg.norm(p) for p in v]
    faces = f
    for _ in range(level):
        cache = {}
        def mid(a, b):
            k = (a, b) if a < b else (b, a)
            if k not in cache:
                m = verts[a] + verts[b]
                verts.append(m / np.linalg.norm(m)); cache[k] = len(verts) - 1
            return cache[k]
        nf = []
        for a, b, c in faces:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        faces = nf
    return np.array(verts, np.float64), np.array(faces, np.int64)

def sculpt(v):
    rng = np.random.default_rng(7)
    r = np.ones(len(v))
    # sculpted-skin detail: ridged multi-octave sum of random directional sinusoids
    for octave in range(6):
        freq = 4.0 * (2.0 ** octave); amp = 0.05 / (1.85 ** octave)
        for _ in range(7):
            d = rng.normal(size=3); d /= np.linalg.norm(d)
            ph = rng.uniform(0, 2 * np.pi)
            r += amp * (0.5 - np.abs(np.sin(freq * (v @ d) + ph))) / 3.5
    def bump(c, s, h, aniso=(1, 1, 1)):
        c = np.array(c, float); c /= np.linalg.norm(c)
        dd = (v - c) / np.array(aniso, float)
        return h * np.exp(-np.sum(dd ** 2, axis=1) / (2 * s * s))
    r += bump((0, -0.02, 1), 0.10, 0.30, (0.7, 1.4, 1))   # nose
    r += bump((0, -0.16, 1), 0.07, 0.10)                   # nose tip
    r += bump((0.30, 0.36, 0.9), 0.13, 0.12, (1.6, 0.7, 1))   # brow R
    r += bump((-0.30, 0.36, 0.9), 0.13, 0.12, (1.6, 0.7, 1))  # brow L
    r -= bump((0.31, 0.17, 0.93), 0.085, 0.16)  # eye socket R
    r -= bump((-0.31, 0.17, 0.93), 0.085, 0.16) # eye socket L
    r += bump((0.31, 0.16, 0.94), 0.045, 0.09)  # eyeball R
    r += bump((-0.31, 0.16, 0.94), 0.045, 0.09) # eyeball L
    r += bump((0.42, -0.12, 0.85), 0.14, 0.06)  # cheek R
    r += bump((-0.42, -0.12, 0.85), 0.14, 0.06) # cheek L
    r -= bump((0, -0.36, 0.94), 0.05, 0.07, (3.5, 0.5, 1))   # mouth line
    r += bump((0, -0.31, 0.95), 0.06, 0.05, (2.5, 0.6, 1))   # upper lip
    r += bump((0, -0.42, 0.92), 0.06, 0.05, (2.2, 0.6, 1))   # lower lip
    r += bump((0, -0.62, 0.78), 0.14, 0.10)  # chin
    r += bump((1, 0.08, 0), 0.10, 0.20, (0.6, 1.5, 1))   # ear R
    r += bump((-1, 0.08, 0), 0.10, 0.20, (0.6, 1.5, 1))  # ear L
    p = v * r[:, None]
    p[:, 0] *= 0.80; p[:, 1] *= 1.0; p[:, 2] *= 0.90   # head proportions
    p[:, 0] *= 1 - 0.25 * np.clip(-p[:, 1], 0, None)    # jaw taper
    return p * 17.5   # ~35 units tall: seeded units issue (reads as metres in glTF)

def flip_patch(p, f):
    cen = p[f].mean(axis=1)
    sel = np.linalg.norm(cen - np.array([-0.80 * 17.5 * 1.15, 0.08 * 17.5, 0]), axis=1) < 3.2
    f = f.copy(); f[sel] = f[sel][:, ::-1]
    return f, int(sel.sum())

def vertex_normals(p, f):
    n = np.zeros_like(p)
    fn = np.cross(p[f[:, 1]] - p[f[:, 0]], p[f[:, 2]] - p[f[:, 0]])
    for k in range(3): np.add.at(n, f[:, k], fn)
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    return n

def write_glb(path, p, f, n):
    pos = p.astype(np.float32).tobytes(); nor = n.astype(np.float32).tobytes(); idx = f.astype(np.uint32).tobytes()
    bin_ = pos + nor + idx
    gltf = {
        "asset": {"version": "2.0", "generator": "fabled make_sample_sculpt.py (procedural, self-made)"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "FabledSampleHead"}],
        "meshes": [{"name": "FabledSampleHead", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2}]}],
        "buffers": [{"byteLength": len(bin_)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos), "byteLength": len(nor), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos) + len(nor), "byteLength": len(idx), "target": 34963}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(p), "type": "VEC3",
             "min": p.min(0).astype(np.float32).tolist(), "max": p.max(0).astype(np.float32).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": len(p), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5125, "count": f.size, "type": "SCALAR"}],
    }
    js = json.dumps(gltf).encode(); js += b" " * (-len(js) % 4); bin_ += b"\0" * (-len(bin_) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A)); fh.write(js)
        fh.write(struct.pack("<II", len(bin_), 0x004E4942)); fh.write(bin_)

def write_obj(path, p, f, n):
    with open(path, "w") as fh:
        fh.write("# Fabled demo sample sculpt (procedural, self-made). Seeded issues: units + flipped patch.\n")
        fh.write("o FabledSampleHead\n")
        fh.write("".join(f"v {a:.5f} {b:.5f} {c:.5f}\n" for a, b, c in p))
        fh.write("".join(f"vn {a:.4f} {b:.4f} {c:.4f}\n" for a, b, c in n))
        fh.write("".join(f"f {a}//{a} {b}//{b} {c}//{c}\n" for a, b, c in (f + 1)))

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    info = {}
    for level, ext in ((7, "glb"), (6, "obj")):
        v, f = icosphere(level)
        p = sculpt(v)
        f, nflip = flip_patch(p, f)
        n = vertex_normals(p, f)
        path = os.path.join(OUT, f"fabled_sample_head.{ext}")
        (write_glb if ext == "glb" else write_obj)(path, p, f, n)
        info[os.path.basename(path)] = {"vertices": int(len(p)), "triangles": int(len(f)),
            "flipped_triangles_seeded": nflip, "bbox_size_units": (p.max(0) - p.min(0)).round(3).tolist(),
            "bytes": os.path.getsize(path)}
        print(path, info[os.path.basename(path)])
    with open(os.path.join(OUT, "SAMPLE_INFO.json"), "w") as fh:
        json.dump({"note": "Counts computed by make_sample_sculpt.py at generation time. Procedural, self-made; no license restrictions.",
                   "files": info}, fh, indent=2)
