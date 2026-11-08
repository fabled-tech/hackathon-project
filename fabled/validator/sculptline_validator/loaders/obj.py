"""Wavefront OBJ + MTL loader (pure Python + numpy).

OBJ carries no units, no up axis and no skeleton; the checks treat those accordingly.
"""
from __future__ import annotations

import os

import numpy as np

from ..model import Asset, Material, Mesh, ParseError
from .common import external_texture, lod_from_name, merge_orm

# MTL keyword -> canonical slot
MTL_SLOTS = {
    "map_kd": "BaseColor",
    "map_bump": "Normal",
    "bump": "Normal",
    "norm": "Normal",
    "map_norm": "Normal",
    "map_pr": "Roughness",
    "map_pm": "Metallic",
    "map_ke": "Emissive",
    "map_d": "Opacity",
    "map_ka": "Other",
    "map_ks": "Other",
    "map_ns": "Other",
    "disp": "Other",
}
# options that take N numeric args, so we can find the filename at the end of the line
_OPT_ARGS = {"-blendu": 1, "-blendv": 1, "-bm": 1, "-boost": 1, "-cc": 1, "-clamp": 1, "-imfchan": 1,
             "-mm": 2, "-o": 3, "-s": 3, "-t": 3, "-texres": 1, "-type": 1}


def _texture_filename(tokens):
    i = 0
    while i < len(tokens) and tokens[i].startswith("-") and tokens[i] in _OPT_ARGS:
        n = _OPT_ARGS[tokens[i]]
        i += 1
        taken = 0
        while taken < n and i < len(tokens) - 1:
            try:
                float(tokens[i])
            except ValueError:
                if tokens[i] not in ("on", "off", "r", "g", "b", "m", "l", "z"):
                    break
            i += 1
            taken += 1
    return " ".join(tokens[i:]) if i < len(tokens) else None


def parse_mtl(path: str, asset: Asset):
    mats = {}
    order = []
    base = os.path.dirname(path)
    cur = None
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            kw = parts[0].lower()
            if kw == "newmtl":
                name = " ".join(parts[1:])
                cur = Material(name=name)
                mats[name] = cur
                order.append(name)
            elif cur is not None and kw in MTL_SLOTS:
                fname = _texture_filename(parts[1:])
                if not fname:
                    continue
                t = external_texture(MTL_SLOTS[kw], parts[0], fname, base)
                cur.textures.append(t)
                asset.referenced_files.append({"path": t.path, "role": f"texture ({cur.name} {parts[0]})", "exists": t.exists})
    for m in mats.values():
        m.textures = merge_orm(m.textures)
    return mats, order


def load_obj(path: str) -> Asset:
    asset = Asset(path=os.path.abspath(path), format="obj", bone_parents=None,
                  cm_per_unit=None, unit_source="OBJ declares no units",
                  up_axis_declared=None, up_axis_source="OBJ declares no up axis")
    base = os.path.dirname(os.path.abspath(path))
    V, VT, VN = [], [], []
    objects = []  # [name, faces(list of (corners, mat_name))]
    cur_obj = None
    cur_mat = None
    mtl_mats = {}
    mtl_order = []
    stem = os.path.splitext(os.path.basename(path))[0]

    def ensure_obj(name=None):
        nonlocal cur_obj
        if cur_obj is None or name is not None:
            cur_obj = [name or stem, []]
            objects.append(cur_obj)
        return cur_obj

    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for lineno, raw in enumerate(fh, 1):
            line = raw.strip()
            if not line or line[0] == "#":
                continue
            parts = line.split()
            kw = parts[0]
            try:
                if kw == "v":
                    V.append((float(parts[1]), float(parts[2]), float(parts[3])))
                elif kw == "vt":
                    VT.append((float(parts[1]), float(parts[2]) if len(parts) > 2 else 0.0))
                elif kw == "vn":
                    VN.append((float(parts[1]), float(parts[2]), float(parts[3])))
                elif kw == "f":
                    obj = ensure_obj()
                    corners = []
                    for tok in parts[1:]:
                        sp = tok.split("/")
                        vi = int(sp[0])
                        vi = vi - 1 if vi > 0 else len(V) + vi
                        ti = None
                        ni = None
                        if len(sp) > 1 and sp[1]:
                            ti = int(sp[1])
                            ti = ti - 1 if ti > 0 else len(VT) + ti
                        if len(sp) > 2 and sp[2]:
                            ni = int(sp[2])
                            ni = ni - 1 if ni > 0 else len(VN) + ni
                        corners.append((vi, ti, ni))
                    if len(corners) >= 3:
                        obj[1].append((corners, cur_mat))
                elif kw in ("o", "g"):
                    name = " ".join(parts[1:]) or stem
                    if kw == "g" and cur_obj is not None and cur_obj[0] == name:
                        continue
                    # 'g' right after 'o' with no faces yet: rename instead of splitting
                    if cur_obj is not None and not cur_obj[1]:
                        cur_obj[0] = name
                    else:
                        ensure_obj(name)
                elif kw == "usemtl":
                    cur_mat = " ".join(parts[1:])
                elif kw == "mtllib":
                    for lib in parts[1:]:
                        lp = os.path.join(base, lib)
                        exists = os.path.isfile(lp)
                        asset.referenced_files.append({"path": os.path.abspath(lp), "role": "material library (.mtl)", "exists": exists})
                        if exists:
                            m, o = parse_mtl(lp, asset)
                            mtl_mats.update(m)
                            mtl_order += o
                        else:
                            asset.notes.append(f"mtllib '{lib}' not found; materials referenced by usemtl have no texture data")
            except (ValueError, IndexError) as exc:
                raise ParseError(f"OBJ line {lineno}: could not parse '{line[:80]}' ({exc})") from exc

    if not V:
        raise ParseError("OBJ contains no vertices")
    Va = np.asarray(V, dtype=np.float64)
    VTa = np.asarray(VT, dtype=np.float64) if VT else None
    VNa = np.asarray(VN, dtype=np.float64) if VN else None

    mat_index = {}
    for name in mtl_order:
        mat_index[name] = len(asset.materials)
        asset.materials.append(mtl_mats[name])

    for name, faces in objects:
        if not faces:
            continue
        tri_v, tri_t, tri_n, tri_m = [], [], [], []
        for corners, mname in faces:
            if mname is None:
                mi = -1
            else:
                if mname not in mat_index:
                    mat_index[mname] = len(asset.materials)
                    asset.materials.append(Material(name=mname, note="used by usemtl but not defined in any .mtl"))
                mi = mat_index[mname]
            for i in range(1, len(corners) - 1):
                c = (corners[0], corners[i], corners[i + 1])
                tri_v.append([x[0] for x in c])
                tri_t.append([x[1] for x in c])
                tri_n.append([x[2] for x in c])
                tri_m.append(mi)
        tv = np.asarray(tri_v, dtype=np.int64)
        if tv.min() < 0 or tv.max() >= len(Va):
            raise ParseError(f"OBJ object '{name}' has a face index out of range")
        used, inv = np.unique(tv, return_inverse=True)
        tris = inv.reshape(-1, 3)
        uv_rows = [r for r in tri_t]
        has_uv = np.array([all(x is not None for x in r) for r in uv_rows])
        corner_uvs = None
        missing_uv = int((~has_uv).sum())
        if VTa is not None and has_uv.any():
            idx = np.array([[x if x is not None else 0 for x in r] for r in uv_rows], dtype=np.int64)
            corner_uvs = VTa[idx]
            corner_uvs[~has_uv] = np.nan
        elif VTa is None or not has_uv.any():
            missing_uv = len(tri_v)
        corner_normals = None
        has_n = np.array([all(x is not None for x in r) for r in tri_n])
        if VNa is not None and has_n.any():
            idx = np.array([[x if x is not None else 0 for x in r] for r in tri_n], dtype=np.int64)
            corner_normals = VNa[idx]
            corner_normals[~has_n] = np.nan
        asset.meshes.append(Mesh(name=name, positions=Va[used], tris=tris,
                                 face_material=np.asarray(tri_m, dtype=np.int64),
                                 corner_normals=corner_normals, corner_uvs=corner_uvs,
                                 uv_missing_faces=missing_uv, lod=lod_from_name(name)))
    if not asset.meshes:
        raise ParseError("OBJ contains no faces")
    return asset
