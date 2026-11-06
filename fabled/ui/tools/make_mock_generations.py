#!/usr/bin/env python3
"""Procedurally model the meshes the offline mock provider "generates" (CONCEPT MOCKUP).

Self-made and procedural (signed distance fields, meshed with surface nets, numpy only), with no third-party assets, so
they are free to use in the demo. They are dense, fully triangulated, closed meshes with smooth normals, like typical
text-to-3D output, so the Fabled pipeline (retopo, LODs, bake) has real work to do. Unlike samples/fabled_sample_head.glb
they have NO seeded defects: they are meant to look like a plausible generation, not to exercise the checker.

Outputs (into ../samples/mock_generations/), glTF metres, Y up:
  knight_helmet.glb    stylized great helm with eye slits, breaths, rivets and a horsehair crest (~0.42 m tall)
  mushroom_cottage.glb toadstool house with door, windows, spotted cap and chimney   (~0.42 m tall)
  potion_flask.glb     fluted round flask with neck rings, lip and cork               (~0.27 m tall)
  MOCK_INFO.json       triangle/vertex counts and bounds, computed here

Run:  python3 tools/make_mock_generations.py   [--res 150]
"""
import json, os, struct, sys
import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "samples", "mock_generations")

# ---------------------------------------------------------------- SDF primitives (p: (N,3) array, metres)
def length(v): return np.sqrt(np.sum(v * v, axis=-1))
def sphere(p, c, r): return length(p - np.asarray(c)) - r
def ellipsoid(p, c, r):
    q = (p - np.asarray(c)) / np.asarray(r)
    k0 = length(q); k1 = length(q / np.asarray(r))
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
def rbox(p, c, b, r=0.0):
    q = np.abs(p - np.asarray(c)) - (np.asarray(b) - r)
    return length(np.maximum(q, 0.0)) + np.minimum(np.max(q, axis=-1), 0.0) - r
def capsule(p, a, b, r):
    a = np.asarray(a, float); b = np.asarray(b, float)
    pa = p - a; ba = b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0.0, 1.0)
    return length(pa - h[:, None] * ba) - r
def cyl_y(p, c, r, h, round_=0.0):
    """Capped vertical cylinder centred at c, radius r, half-height h, rounded edges."""
    q = p - np.asarray(c)
    d = np.stack([np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - r + round_, np.abs(q[:, 1]) - h + round_], -1)
    return np.minimum(np.maximum(d[:, 0], d[:, 1]), 0.0) + length(np.maximum(d, 0.0)) - round_
def torus_y(p, c, R, r):
    q = p - np.asarray(c)
    return np.sqrt((np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - R) ** 2 + q[:, 1] ** 2) - r
def cyl_axis(p, a, b, r):
    """Capped cylinder between points a and b."""
    a = np.asarray(a, float); b = np.asarray(b, float)
    ba = b - a; pa = p - a; baba = ba @ ba
    paba = pa @ ba
    x = length(pa * baba - paba[:, None] * ba) - r * baba
    y = np.abs(paba - baba * 0.5) - baba * 0.5
    x2, y2 = x * x, y * y * baba
    d = np.where(np.maximum(x, y) < 0.0, -np.minimum(x2, y2), np.where(x > 0, x2, 0) + np.where(y > 0, y2, 0))
    return np.sign(d) * np.sqrt(np.abs(d)) / baba

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)
def smax(a, b, k): return -smin(-a, -b, k)
def ssub(a, b, k): return smax(a, -b, k)          # a minus b, smooth

# ---------------------------------------------------------------- models
def knight_helmet(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    # shell: tall rounded barrel + dome, slightly tapered toward the chin
    taper = 1.0 + 0.10 * np.clip((0.16 - y) / 0.16, 0, 1)
    q = p.copy(); q[:, 0] *= taper; q[:, 2] *= taper
    body = cyl_y(q, (0, 0.13, 0), 0.105, 0.11, round_=0.03)
    dome = ellipsoid(p, (0, 0.235, 0), (0.105, 0.085, 0.105))
    outer = smin(body, dome, 0.03)
    shell = smax(outer, -(y - 0.02), 0.006)                           # solid display piece, flat underside
    # flared neck guard, blended into the shell
    flare = smax(cyl_y(p, (0, 0.03, 0), 0.118, 0.012, 0.008), -(y - 0.02), 0.004)
    shell = smin(shell, flare, 0.02)
    # vertical crest ridge from brow over the top
    ridge = smax(ellipsoid(p, (0, 0.20, 0), (0.012, 0.12, 0.118)), -(z - 0.125), 0.01)
    shell = smin(shell, ridge, 0.01)
    # brow band and visor slits (two horizontal eye slots split by the ridge)
    band = smax(torus_y(p, (0, 0.175, 0), 0.107, 0.009), -z + 0.0, 0.01)
    shell = smin(shell, band, 0.012)
    for sx in (-1, 1):
        slit = rbox(p, (sx * 0.048, 0.152, 0.11), (0.036, 0.0075, 0.05), 0.006)
        shell = ssub(shell, slit, 0.003)
    # breathing holes: a cross of small drills on the right cheek and left cheek
    for sx in (-1, 1):
        for (dy, dxx) in [(0.095, 0.0), (0.075, 0.0), (0.055, 0.0), (0.075, 0.018), (0.075, -0.018)]:
            cx = sx * (0.055 + dxx)
            hole = cyl_axis(p, (cx * 0.7, dy, 0.04), (cx * 1.25, dy, 0.16), 0.005)
            shell = ssub(shell, hole, 0.004)
    # rivets along the brow band
    for a in np.linspace(-1.25, 1.25, 9):
        rv = sphere(p, (np.sin(a) * 0.118, 0.175, np.cos(a) * 0.118), 0.0065)
        shell = smin(shell, rv, 0.004)
    # horsehair crest: a laterally flattened ribbon that rises from the crown and sweeps back and down the nape
    plume = np.full(len(p), 1e9)
    for t in np.linspace(0, 1, 28):
        cy = 0.345 + 0.05 * np.sin(t * np.pi * 0.75) - 0.19 * t ** 2.2
        cz = 0.045 - 0.23 * t
        ry = 0.036 * (1 - 0.55 * t) + 0.009
        plume = smin(plume, ellipsoid(p, (0, cy, cz), (0.013 + 0.007 * (1 - t), ry, ry * 0.9)), 0.012)
    # combed grooves along the crest
    plume = plume + 0.0012 * np.sin(y * 260 + z * 120)
    holder = cyl_y(p, (0, 0.322, 0.03), 0.017, 0.026, 0.005)
    return smin(smin(shell, holder, 0.008), plume, 0.012)

def mushroom_cottage(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    # grassy base disc with a few stones
    base = cyl_y(p, (0, 0.012, 0), 0.19, 0.012, 0.008)
    for a, r in [(0.3, 0.02), (1.4, 0.016), (2.3, 0.022), (3.6, 0.018), (4.6, 0.02), (5.5, 0.015)]:
        base = smin(base, ellipsoid(p, (np.cos(a) * 0.165, 0.026, np.sin(a) * 0.165), (r, r * 0.6, r)), 0.008)
    # stem: bulging, slightly tapered barrel
    rr = 0.085 + 0.012 * np.sin(np.clip(y / 0.22, 0, 1) * np.pi) - 0.015 * np.clip(y / 0.22, 0, 1)
    stem = np.maximum(np.sqrt(x * x + z * z) - rr, np.abs(y - 0.13) - 0.11)
    m = smin(base, stem, 0.02)
    # arched door, recessed with a frame and a little knob
    door_hole = smin(rbox(p, (0, 0.075, 0.09), (0.03, 0.045, 0.04), 0.004), cyl_axis(p, (0, 0.12, 0.05), (0, 0.12, 0.13), 0.03), 0.004)
    frame = smin(rbox(p, (0, 0.075, 0.088), (0.038, 0.052, 0.012), 0.004), cyl_axis(p, (0, 0.12, 0.076), (0, 0.12, 0.1), 0.038), 0.004)
    m = smin(m, frame, 0.006)
    m = ssub(m, door_hole, 0.003)
    door = rbox(p, (0, 0.075, 0.068), (0.027, 0.043, 0.008), 0.003)
    m = smin(m, door, 0.002)
    m = smin(m, sphere(p, (0.018, 0.08, 0.08), 0.005), 0.002)
    # round windows with cross mullions, left and right
    for a in (-1.1, 1.15):
        cx, cz = np.sin(a) * 0.09, np.cos(a) * 0.09
        n = np.array([np.sin(a), 0, np.cos(a)])
        c = np.array([cx, 0.155, cz])
        m = smin(m, torus_like_ring(p, c, n, 0.024, 0.0065), 0.005)
        m = ssub(m, cyl_axis(p, c - n * 0.012, c + n * 0.03, 0.019), 0.003)   # shallow recess, not a through-hole
        t = np.cross(n, [0, 1, 0]); t /= np.linalg.norm(t)
        m = smin(m, capsule(p, c - t * 0.019 - n * 0.008, c + t * 0.019 - n * 0.008, 0.0045), 0.002)
        m = smin(m, capsule(p, c - [0, 0.019, 0] - n * 0.008, c + [0, 0.019, 0] - n * 0.008, 0.0045), 0.002)
    # cap: wide flattened dome with a curled rim and raised spots
    cap = ellipsoid(p, (0, 0.285, 0), (0.2, 0.12, 0.2))
    cap = smax(cap, -(y - 0.235), 0.02)
    cap = smin(cap, torus_y(p, (0, 0.24, 0), 0.178, 0.022), 0.03)
    rng = np.random.default_rng(7)
    for _ in range(16):
        th = rng.uniform(0, 2 * np.pi); ph = rng.uniform(0.15, 1.15)
        d = np.array([np.sin(ph) * np.cos(th), np.cos(ph), np.sin(ph) * np.sin(th)])
        c = np.array([0, 0.285, 0]) + d * np.array([0.2, 0.12, 0.2])
        cap = smin(cap, sphere(p, c, rng.uniform(0.014, 0.026)), 0.012)
    m = smin(m, cap, 0.015)
    # chimney poking out of the cap
    chim = rbox(p, (-0.085, 0.36, -0.06), (0.022, 0.05, 0.022), 0.005)
    chim = smin(chim, rbox(p, (-0.085, 0.41, -0.06), (0.028, 0.008, 0.028), 0.004), 0.004)
    chim = ssub(chim, rbox(p, (-0.085, 0.42, -0.06), (0.014, 0.02, 0.014), 0.002), 0.002)
    return smin(m, chim, 0.01)

def torus_like_ring(p, c, n, R, r):
    """Torus with axis n through c."""
    n = np.asarray(n, float); n = n / np.linalg.norm(n)
    q = p - c
    h = q @ n
    radial = length(q - h[:, None] * n)
    return np.sqrt((radial - R) ** 2 + h ** 2) - r

def potion_flask(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    ang = np.arctan2(z, x)
    rad = np.sqrt(x * x + z * z)
    # round body with 12 soft vertical flutes
    body = sphere(p, (0, 0.085, 0), 0.085)
    flute = 0.0035 * (0.5 + 0.5 * np.cos(ang * 12)) * np.clip(1 - np.abs(y - 0.085) / 0.085, 0, 1)
    body = body + flute
    body = smax(body, -(y - 0.008), 0.01)                               # flat foot
    foot = cyl_y(p, (0, 0.008, 0), 0.05, 0.008, 0.004)
    m = smin(body, foot, 0.01)
    # neck, rings and lip
    neck = cyl_y(p, (0, 0.2, 0), 0.022, 0.05, 0.004)
    m = smin(m, neck, 0.02)
    for yy in (0.185, 0.205):
        m = smin(m, torus_y(p, (0, yy, 0), 0.023, 0.004), 0.003)
    lip = torus_y(p, (0, 0.248, 0), 0.025, 0.006)
    m = smin(m, lip, 0.004)
    # cork: slightly tapered, sitting proud of the lip
    cork = cyl_y(p, (0, 0.262, 0), 0.019 + 0.002 * np.clip((y - 0.25) / 0.025, 0, 1), 0.016, 0.004)
    m = smin(m, cork, 0.002)
    # embossed band with a raised diamond emblem on the front
    band = torus_y(p, (0, 0.11, 0), 0.084, 0.0045)
    m = smin(m, band, 0.009)
    emb = rbox(np.stack([(x + y - 0.085) / 1.4142, (y - x - 0.085) / 1.4142 + 0.085, z], -1), (0, 0.085, 0.08), (0.014, 0.014, 0.012), 0.003)
    return smin(m, emb, 0.004)

MODELS = {
    "knight_helmet": (knight_helmet, (-0.16, -0.01, -0.24), (0.16, 0.45, 0.17)),
    "mushroom_cottage": (mushroom_cottage, (-0.22, -0.01, -0.22), (0.22, 0.44, 0.22)),
    "potion_flask": (potion_flask, (-0.11, -0.01, -0.11), (0.11, 0.29, 0.11)),
}

# ---------------------------------------------------------------- surface nets
EDGES = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]
CORNERS = np.array([[i, j, k] for k in (0, 1) for j in (0, 1) for i in (0, 1)])  # corner c = i + 2j + 4k

def grad(f, pts, h):
    e = np.eye(3) * h * 0.5
    g = np.stack([f(pts + e[a]) - f(pts - e[a]) for a in range(3)], -1)
    return g / np.maximum(length(g)[:, None], 1e-12)

def surface_nets(f, lo, hi, res):
    lo = np.asarray(lo, float); hi = np.asarray(hi, float)
    h = (hi - lo).max() / res
    n = np.ceil((hi - lo) / h).astype(int) + 1
    axes = [lo[a] + np.arange(n[a]) * h for a in range(3)]
    X, Y, Z = np.meshgrid(*axes, indexing="ij")
    F = np.empty(X.size)
    pts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], -1)
    for s in range(0, len(pts), 2_000_000):
        F[s:s + 2_000_000] = f(pts[s:s + 2_000_000])
    F = F.reshape(n)
    # keep samples off the surface: a near-zero node makes neighbouring cells put vertices on the same point (pinched,
    # non-manifold edges after welding). Nudging by 2% of a cell is invisible at this resolution.
    eps = h * 0.02
    F = np.where(np.abs(F) < eps, np.where(F < 0, -eps, eps), F)
    nx, ny, nz = n - 1
    corner_vals = np.stack([F[i:i + nx, j:j + ny, k:k + nz] for i, j, k in CORNERS], -1)  # (nx,ny,nz,8)
    inside = corner_vals < 0
    active = inside.any(-1) & ~inside.all(-1)
    cell_idx = np.argwhere(active)
    cv = corner_vals[active]
    acc = np.zeros((len(cell_idx), 3)); cnt = np.zeros(len(cell_idx))
    for a, b in EDGES:
        fa, fb = cv[:, a], cv[:, b]
        m = (fa < 0) != (fb < 0)
        t = np.where(m, fa / np.where(m, fa - fb, 1.0), 0.0)
        pa, pb = CORNERS[a], CORNERS[b]
        acc += m[:, None] * (pa + t[:, None] * (pb - pa)); cnt += m
    verts = lo + (cell_idx + acc / cnt[:, None]) * h
    vid = -np.ones((nx, ny, nz), np.int64); vid[active] = np.arange(len(cell_idx))
    quads = []
    for axis in range(3):
        sl = [slice(0, n[0] - (axis == 0)), slice(0, n[1] - (axis == 1)), slice(0, n[2] - (axis == 2))]
        a0 = F[tuple(sl)] < 0
        sl1 = [slice(1, None) if ax == axis else s for ax, s in enumerate(sl)]
        a1 = F[tuple(sl1)] < 0
        cross = a0 != a1
        u, v = [ax for ax in range(3) if ax != axis]
        idx = np.argwhere(cross)
        idx = idx[(idx[:, u] > 0) & (idx[:, v] > 0) & (idx[:, u] < n[u] - 1) & (idx[:, v] < n[v] - 1)]
        def cell(du, dv):
            c = idx.copy(); c[:, u] -= du; c[:, v] -= dv
            return vid[c[:, 0], c[:, 1], c[:, 2]]
        q = np.stack([cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)], -1)
        # winding from the sign change: this cyclic order faces +u×v (= +x, -y, +z); outward must point from inside to outside
        base = -1 if axis == 1 else 1
        want = np.where(a0[idx[:, 0], idx[:, 1], idx[:, 2]], 1, -1)
        flip = want != base
        q[flip] = q[flip][:, ::-1]
        q = q[(q >= 0).all(-1)]
        quads.append(q)
    quads = np.concatenate(quads)
    # split each quad along its shorter diagonal (fewer slivers)
    d02 = length(verts[quads[:, 0]] - verts[quads[:, 2]]); d13 = length(verts[quads[:, 1]] - verts[quads[:, 3]])
    a = d02 <= d13
    tris = np.concatenate([quads[a][:, [0, 1, 2]], quads[a][:, [0, 2, 3]], quads[~a][:, [0, 1, 3]], quads[~a][:, [1, 2, 3]]])
    # weld coincident vertices (surface nets can place two cells' vertices at the same point) and drop the triangles that collapse
    key = np.round(verts / (h * 1e-4)).astype(np.int64)
    _, first, remap = np.unique(key, axis=0, return_index=True, return_inverse=True)
    remap = remap.ravel(); verts = verts[first]; tris = remap[tris]
    tris = tris[(tris[:, 0] != tris[:, 1]) & (tris[:, 1] != tris[:, 2]) & (tris[:, 0] != tris[:, 2])]
    used = np.unique(tris); newid = -np.ones(len(verts), np.int64); newid[used] = np.arange(len(used))
    verts = verts[used]; tris = newid[tris]
    verts, tris = split_pinches(verts, tris, h)
    verts, normals, fn = unfold(verts, tris)
    # sanity: the construction above must give outward winding overall (compare with the SDF gradient)
    g = grad(f, verts, h * 0.5)
    agree = np.mean(np.sum(fn * g[tris].sum(1), -1) > 0)
    assert agree > 0.99, f"winding mostly inward ({agree:.3f}); orientation rule is wrong"
    return verts.astype(np.float32), normals.astype(np.float32), tris.astype(np.uint32)

def vertex_normals(verts, tris):
    fn = np.cross(verts[tris[:, 1]] - verts[tris[:, 0]], verts[tris[:, 2]] - verts[tris[:, 0]])
    normals = np.zeros_like(verts)
    for c in range(3): np.add.at(normals, tris[:, c], fn)
    return normals / np.maximum(length(normals)[:, None], 1e-20), fn

def unfold(verts, tris, iters=8):
    """Stored normals are the area-weighted face normals. Surface nets can leave a few folded slivers in tight creases
    (face normal against its own vertex normals); relax only those vertices toward their one-ring average until none remain."""
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]]); e = np.concatenate([e, e[:, ::-1]])
    deg = np.bincount(e[:, 0], minlength=len(verts)).astype(float)
    for _ in range(iters):
        normals, fn = vertex_normals(verts, tris)
        folded = np.sum(fn * normals[tris].sum(1), -1) <= 0
        if not folded.any(): break
        hot = np.zeros(len(verts), bool); hot[tris[folded].ravel()] = True
        nb = np.zeros_like(verts); np.add.at(nb, e[:, 0], verts[e[:, 1]])
        avg = nb / np.maximum(deg, 1)[:, None]
        verts = np.where(hot[:, None], 0.5 * verts + 0.5 * avg, verts)
    normals, fn = vertex_normals(verts, tris)
    return verts, normals, fn

def split_pinches(verts, tris, h):
    """Repair non-manifold edges (two surface sheets meeting in one cell): at each vertex of such an edge, group its faces
    into sheets (faces connected through manifold edges around the vertex), give every extra sheet its own copy of the
    vertex, and move each copy 0.1 cell along its sheet's normal, so the sheets stay apart even after a positional weld."""
    for _ in range(3):
        e = np.sort(np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]]), 1)
        u, c = np.unique(e, axis=0, return_counts=True)
        bad = {tuple(x) for x in u[c > 2]}
        if not bad: break
        hot = sorted({v for ed in bad for v in ed})
        faces_of = {v: [] for v in hot}
        for fi in np.nonzero(np.isin(tris, hot).any(1))[0]:
            for v in tris[fi]:
                if v in faces_of: faces_of[v].append(fi)
        verts = list(verts); tris = tris.copy()
        for v in hot:
            fs = faces_of[v]; parent = {f: f for f in fs}
            def find(a):
                while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
                return a
            by_edge = {}
            for f in fs:
                for w in tris[f]:
                    if w != v:
                        ed = (min(v, w), max(v, w))
                        if ed not in bad: by_edge.setdefault(ed, []).append(f)
            for group in by_edge.values():
                for f in group[1:]: parent[find(f)] = find(group[0])
            comps = {}
            for f in fs: comps.setdefault(find(f), []).append(f)
            if len(comps) < 2: continue
            for k, comp in enumerate(comps.values()):
                pts = np.asarray(verts)[tris[comp]]
                nrm = np.cross(pts[:, 1] - pts[:, 0], pts[:, 2] - pts[:, 0]).sum(0)
                nrm = nrm / max(np.linalg.norm(nrm), 1e-20)
                target = v if k == 0 else len(verts)
                if k: verts.append(np.array(verts[v]))
                verts[target] = verts[target] + nrm * h * 0.1
                for f in comp: tris[f][tris[f] == v] = target
        verts = np.asarray(verts)
    return verts, tris

# ---------------------------------------------------------------- GLB
def write_glb(path, name, pos, nrm, idx):
    def pad(b, c=b"\0"): return b + c * ((4 - len(b) % 4) % 4)
    bin_ = pad(pos.tobytes()) + pad(nrm.tobytes()) + pad(idx.tobytes())
    o1 = len(pad(pos.tobytes())); o2 = o1 + len(pad(nrm.tobytes()))
    gltf = {
        "asset": {"version": "2.0", "generator": "fabled tools/make_mock_generations.py (procedural, CONCEPT MOCKUP)"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
        "materials": [{"name": f"M_{name}", "pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.78, 0.75, 1], "metallicFactor": 0, "roughnessFactor": 0.6}}],
        "buffers": [{"byteLength": len(bin_)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": pos.nbytes, "target": 34962},
                        {"buffer": 0, "byteOffset": o1, "byteLength": nrm.nbytes, "target": 34962},
                        {"buffer": 0, "byteOffset": o2, "byteLength": idx.nbytes, "target": 34963}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
                      {"bufferView": 1, "componentType": 5126, "count": len(nrm), "type": "VEC3"},
                      {"bufferView": 2, "componentType": 5125, "count": idx.size, "type": "SCALAR"}],
    }
    js = pad(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A)); fh.write(js)
        fh.write(struct.pack("<II", len(bin_), 0x004E4942)); fh.write(bin_)

def main():
    res = int(sys.argv[sys.argv.index("--res") + 1]) if "--res" in sys.argv else 150
    os.makedirs(OUT, exist_ok=True)
    info = {"note": "CONCEPT MOCKUP outputs of the offline mock provider. Procedural, self-made (tools/make_mock_generations.py); no license restrictions. Counts computed at generation time.", "resolution": res, "files": {}}
    for name, (f, lo, hi) in MODELS.items():
        v, nrm, t = surface_nets(f, lo, hi, res)
        path = os.path.join(OUT, f"{name}.glb")
        write_glb(path, name, v, nrm, t)
        size = (v.max(0) - v.min(0)).round(4).tolist()
        info["files"][f"{name}.glb"] = {"triangles": int(len(t)), "vertices": int(len(v)), "bbox_size_m": size, "bytes": os.path.getsize(path)}
        print(f"{name}: {len(t):,} tris, {len(v):,} verts, size {size} m, {os.path.getsize(path) / 1e6:.2f} MB")
    with open(os.path.join(OUT, "MOCK_INFO.json"), "w") as fh:
        json.dump(info, fh, indent=2); fh.write("\n")

if __name__ == "__main__":
    main()
