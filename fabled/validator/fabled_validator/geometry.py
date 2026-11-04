"""Topology and orientation analysis on triangle meshes (numpy)."""
from __future__ import annotations

from collections import deque

import numpy as np


def weld(positions, tris, tol):
    """Merge vertices that share a position (within tol) so UV/normal seams don't look like holes."""
    if tol <= 0:
        tol = 1e-9
    q = np.round(positions / tol).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    return inv.reshape(-1)[tris], int(inv.max()) + 1 if len(inv) else 0


def analyze(mesh, diag):
    """Return a dict of per-face masks and counts for one mesh. diag = bbox diagonal of the asset."""
    P = mesh.positions
    T = mesh.tris
    F = len(T)
    tol = max(diag, 1e-9) * 1e-6
    wt, nv = weld(P, T, tol)
    p0, p1, p2 = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    cr = np.cross(p1 - p0, p2 - p0)
    area = 0.5 * np.linalg.norm(cr, axis=1)
    dup = (wt[:, 0] == wt[:, 1]) | (wt[:, 1] == wt[:, 2]) | (wt[:, 0] == wt[:, 2])
    area_eps = (max(diag, 1e-9) * 1e-7) ** 2
    zero = (~dup) & (area <= area_eps)
    valid = ~dup

    fidx = np.nonzero(valid)[0]
    t = wt[fidx]
    a = t.reshape(-1)
    b = t[:, [1, 2, 0]].reshape(-1)
    ef = np.repeat(fidx, 3)
    lo = np.minimum(a, b)
    hi = np.maximum(a, b)
    fwd = a < b
    key = lo.astype(np.int64) * (nv + 1) + hi
    order = np.argsort(key, kind="stable")
    ks = key[order]
    if len(ks):
        _, start, counts = np.unique(ks, return_index=True, return_counts=True)
    else:
        start = counts = np.array([], dtype=np.int64)
    nonmanifold = int((counts > 2).sum())
    boundary = int((counts == 1).sum())
    open_face = np.zeros(F, dtype=bool)
    for sel in (counts == 1, counts > 2):
        idxs = start[sel]
        cs = counts[sel]
        for s0, c in zip(idxs, cs):
            open_face[ef[order[s0 : s0 + c]]] = True
    nm_faces = np.zeros(F, dtype=bool)
    for s0, c in zip(start[counts > 2], counts[counts > 2]):
        nm_faces[ef[order[s0 : s0 + c]]] = True
    two = counts == 2
    i0 = order[start[two]]
    i1 = order[start[two] + 1]
    f0 = ef[i0]
    f1 = ef[i1]
    flip_rel = fwd[i0] == fwd[i1]  # same direction on a shared edge = inconsistent winding
    inconsistent_edges = int(flip_rel.sum())

    # BFS orientation propagation
    src = np.concatenate([f0, f1])
    dst = np.concatenate([f1, f0])
    rel = np.concatenate([flip_rel, flip_rel])
    o = np.argsort(src, kind="stable")
    src, dst, rel = src[o], dst[o], rel[o]
    indptr = np.zeros(F + 1, dtype=np.int64)
    np.add.at(indptr, src + 1, 1)
    indptr = np.cumsum(indptr)
    orient = np.full(F, -1, dtype=np.int8)
    comp = np.full(F, -1, dtype=np.int64)
    conflicts = 0
    ncomp = 0
    dst_l = dst.tolist()
    rel_l = rel.astype(np.int8).tolist()
    ip = indptr.tolist()
    orient_l = [-1] * F
    comp_l = [-1] * F
    for f in fidx.tolist():
        if orient_l[f] != -1:
            continue
        orient_l[f] = 0
        comp_l[f] = ncomp
        dq = deque([f])
        while dq:
            x = dq.popleft()
            ox = orient_l[x]
            for k in range(ip[x], ip[x + 1]):
                y = dst_l[k]
                want = ox ^ rel_l[k]
                if orient_l[y] == -1:
                    orient_l[y] = want
                    comp_l[y] = ncomp
                    dq.append(y)
                elif orient_l[y] != want:
                    conflicts += 1
        ncomp += 1
    orient = np.array(orient_l, dtype=np.int8)
    comp = np.array(comp_l, dtype=np.int64)
    conflicts //= 2

    gnorm = cr
    has_n = mesh.corner_normals is not None
    against = np.zeros(F, dtype=bool)
    if has_n:
        cn = np.nansum(mesh.corner_normals, axis=1)
        nn_ok = ~np.isnan(mesh.corner_normals).any(axis=(1, 2)) & (np.linalg.norm(cn, axis=1) > 1e-12)
        d = np.einsum("ij,ij->i", cn, gnorm)
        against = nn_ok & valid & ~zero & (d < 0)

    sv = np.einsum("ij,ij->i", p0, np.cross(p1, p2)) / 6.0
    flipped = np.zeros(F, dtype=bool)
    inverted_components = 0
    if ncomp:
        comp_open = np.zeros(ncomp, dtype=bool)
        np.logical_or.at(comp_open, comp[valid], open_face[valid])
        for c in range(ncomp):
            m = comp == c
            g1 = m & (orient == 1)
            g0 = m & (orient == 0)
            if not comp_open[c]:
                vol = sv[g0].sum() - sv[g1].sum()
                bad = g1 if vol >= 0 else g0
                if vol < 0 and not g1.any():
                    inverted_components += 1
            else:
                if has_n:
                    s0 = int((against & g0).sum()) - int((~against & g0 & ~zero).sum())
                    s1 = int((against & g1).sum()) - int((~against & g1 & ~zero).sum())
                    bad = g0 if s0 > s1 else g1
                else:
                    bad = g1 if g0.sum() >= g1.sum() else g0
            flipped |= bad
    flipped &= valid & ~zero
    return {
        "faces": F,
        "duplicate_index_faces": int(dup.sum()),
        "zero_area_faces": int(zero.sum()),
        "degenerate_mask": dup | zero,
        "nonmanifold_edges": nonmanifold,
        "nonmanifold_faces": int(nm_faces.sum()),
        "boundary_edges": boundary,
        "inconsistent_edges": inconsistent_edges,
        "orientation_conflicts": conflicts,
        "components": ncomp,
        "inverted_components": inverted_components,
        "winding_flipped_mask": flipped,
        "normals_against_mask": against,
        "has_normals": has_n,
        "area": area,
    }
