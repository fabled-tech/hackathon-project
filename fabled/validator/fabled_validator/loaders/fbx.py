"""Interpret a binary FBX node tree: meshes, materials, texture filenames, bones and skins.

Limits (v0): binary FBX only; Lcl Translation/Rotation/Scaling are applied but pivots,
pre/post rotation and geometric transforms are not; NURBS/patches ignored; only the first UV
and normal layer are read; animation is ignored.
"""
from __future__ import annotations

import math
import os

import numpy as np

from ..model import Asset, Material, Mesh, ParseError, Skin
from .common import embedded_texture, external_texture, lod_from_name, merge_orm
from .fbx_binary import parse_fbx_bytes

# FBX material property -> canonical slot. Roughness/metal follow Blender's FBX exporter.
FBX_SLOTS = {
    "DiffuseColor": "BaseColor",
    "Maya|baseColor": "BaseColor",
    "Maya|TEX_color_map": "BaseColor",
    "NormalMap": "Normal",
    "Bump": "Normal",
    "Maya|normalCamera": "Normal",
    "Maya|TEX_normal_map": "Normal",
    "ShininessExponent": "Roughness",
    "Maya|specularRoughness": "Roughness",
    "ReflectionFactor": "Metallic",
    "Maya|metalness": "Metallic",
    "EmissiveColor": "Emissive",
    "TransparentColor": "Opacity",
}
AXES = "XYZ"


def _name(s):
    return s.split("\x00\x01")[0] if isinstance(s, str) else str(s)


def _p70(node):
    out = {}
    if node is None:
        return out
    p = node.find("Properties70")
    if p is None:
        return out
    for pn in p.find_all("P"):
        if pn.props:
            out[pn.props[0]] = pn.props[4:]
    return out


def _rot(deg):
    rx, ry, rz = (math.radians(a) for a in deg)
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    X = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Y = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Z = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Z @ Y @ X  # eEulerXYZ: X applied first


def _local(props):
    t = props.get("Lcl Translation", [0, 0, 0])
    r = props.get("Lcl Rotation", [0, 0, 0])
    s = props.get("Lcl Scaling", [1, 1, 1])
    m = np.eye(4)
    m[:3, :3] = _rot(r) @ np.diag(s)
    m[:3, 3] = t
    return m


def _layer(geom, lname, dname, iname, npoly_corners, poly_of_corner, corner_vertex):
    el = geom.find(lname)
    if el is None:
        return None
    mapping = (el.find("MappingInformationType").props[0] if el.find("MappingInformationType") else "ByPolygonVertex")
    ref = (el.find("ReferenceInformationType").props[0] if el.find("ReferenceInformationType") else "Direct")
    dn = el.find(dname)
    if dn is None:
        return None
    width = 2 if lname == "LayerElementUV" else 3
    vals = np.asarray(dn.props[0], dtype=np.float64).reshape(-1, width)
    if mapping in ("ByPolygonVertex",):
        key = np.arange(npoly_corners)
    elif mapping in ("ByVertice", "ByVertex", "ByControlPoint"):
        key = corner_vertex
    elif mapping == "ByPolygon":
        key = poly_of_corner
    elif mapping == "AllSame":
        key = np.zeros(npoly_corners, dtype=np.int64)
    else:
        return None
    if ref in ("IndexToDirect", "Index"):
        ix = el.find(iname)
        if ix is None:
            return None
        idx = np.asarray(ix.props[0], dtype=np.int64)[key]
    else:
        idx = key
    out = np.full((npoly_corners, width), np.nan)
    ok = (idx >= 0) & (idx < len(vals))
    out[ok] = vals[idx[ok]]
    return out


def load_fbx(path: str) -> Asset:
    path = os.path.abspath(path)
    base = os.path.dirname(path)
    with open(path, "rb") as fh:
        data = fh.read()
    version, root = parse_fbx_bytes(data)
    asset = Asset(path=path, format="fbx", bone_parents={})
    asset.notes.append(f"FBX binary version {version}")

    gs = _p70(root.find("GlobalSettings"))
    if "UnitScaleFactor" in gs:
        asset.cm_per_unit = float(gs["UnitScaleFactor"][0])
        asset.unit_source = f"FBX GlobalSettings UnitScaleFactor = {asset.cm_per_unit:g} (cm per unit)"
    else:
        asset.unit_source = "FBX file has no UnitScaleFactor"
    if "UpAxis" in gs:
        ax = int(gs["UpAxis"][0])
        sign = int(gs.get("UpAxisSign", [1])[0])
        asset.up_axis_declared = ("-" if sign < 0 else "") + AXES[ax]
        asset.up_axis_source = f"FBX GlobalSettings UpAxis={ax} UpAxisSign={sign}"
    else:
        asset.up_axis_source = "FBX file has no UpAxis"

    objects = root.find("Objects")
    if objects is None:
        raise ParseError("FBX has no Objects section")
    objs = {}
    for o in objects.children:
        if o.props:
            objs[o.props[0]] = o
    children = {}  # parent id -> [(child id, prop)]
    parents = {}  # child id -> [(parent id, prop)]
    conns = root.find("Connections")
    for c in (conns.find_all("C") if conns else []):
        if len(c.props) >= 3:
            prop = c.props[3] if len(c.props) > 3 else None
            children.setdefault(c.props[2], []).append((c.props[1], prop))
            parents.setdefault(c.props[1], []).append((c.props[2], prop))

    def kind(oid):
        o = objs.get(oid)
        return (o.name, o.props[2] if o is not None and len(o.props) > 2 else "") if o is not None else (None, None)

    # ---- world transforms of models
    world = {}

    def model_world(mid, depth=0):
        if mid in world:
            return world[mid]
        o = objs[mid]
        m = _local(_p70(o))
        par = [p for p, _ in parents.get(mid, []) if kind(p)[0] == "Model"]
        if par and depth < 256:
            m = model_world(par[0], depth + 1) @ m
        world[mid] = m
        return m

    # ---- bones
    bone_types = ("LimbNode", "Root")
    bone_ids = [oid for oid, o in objs.items() if o.name == "Model" and len(o.props) > 2 and o.props[2] in bone_types]
    bone_names = {bid: _name(objs[bid].props[1]) for bid in bone_ids}
    for bid in bone_ids:
        par = [p for p, _ in parents.get(bid, []) if p in bone_names]
        asset.bone_parents[bone_names[bid]] = bone_names[par[0]] if par else None

    # ---- textures
    tex_cache = {}

    def texture_ref(tid, slot, prop):
        if tid in tex_cache:
            t0 = tex_cache[tid]
            from dataclasses import replace
            return replace(t0, slot=slot, source_key=prop)
        o = objs[tid]
        rel = o.find("RelativeFilename")
        absf = o.find("FileName")
        relp = rel.props[0] if rel is not None and rel.props else ""
        absp = absf.props[0] if absf is not None and absf.props else ""
        # embedded media via Video.Content
        for vid, _ in children.get(tid, []):
            vo = objs.get(vid)
            if vo is not None and vo.name == "Video":
                content = vo.find("Content")
                if content is not None and content.props and isinstance(content.props[0], (bytes, bytearray)) and len(content.props[0]) > 0:
                    t = embedded_texture(slot, prop, os.path.basename((relp or absp).replace("\\", "/")) or _name(o.props[1]), bytes(content.props[0]))
                    tex_cache[tid] = t
                    return t
        ref = relp or absp
        if not ref:
            from ..model import TextureRef
            t = TextureRef(slot=slot, source_key=prop, name=_name(o.props[1]), exists=False, note="Texture node has no file name")
        else:
            alt = [absp] if absp and relp else []
            t = external_texture(slot, prop, ref, base, alt_paths=alt)
            asset.referenced_files.append({"path": t.path, "role": f"texture ({prop})", "exists": t.exists})
        tex_cache[tid] = t
        return t

    mat_index = {}

    def material_index(mid):
        if mid in mat_index:
            return mat_index[mid]
        mo = objs[mid]
        mat = Material(name=_name(mo.props[1]))
        for cid, prop in children.get(mid, []):
            if kind(cid)[0] == "Texture" and prop:
                mat.textures.append(texture_ref(cid, FBX_SLOTS.get(prop, "Other"), prop))
        mat.textures = merge_orm(mat.textures)
        mat_index[mid] = len(asset.materials)
        asset.materials.append(mat)
        return mat_index[mid]

    # ---- skins: geometry id -> skin index
    geom_skin = {}
    for oid, o in objs.items():
        if o.name == "Deformer" and len(o.props) > 2 and o.props[2] == "Skin":
            joints = []
            for cid, _ in children.get(oid, []):
                co = objs.get(cid)
                if co is not None and co.name == "Deformer" and co.props[2] == "Cluster":
                    for bid, _ in children.get(cid, []):
                        if bid in bone_names:
                            joints.append(bone_names[bid])
            for gid, _ in parents.get(oid, []):
                if kind(gid)[0] == "Geometry":
                    geom_skin[gid] = len(asset.skins)
            asset.skins.append(Skin(name=_name(o.props[1]) or f"skin[{len(asset.skins)}]", joints=joints))

    # ---- meshes
    for mid, o in objs.items():
        if o.name != "Model" or len(o.props) < 3 or o.props[2] != "Mesh":
            continue
        label = _name(o.props[1])
        geoms = [c for c, _ in children.get(mid, []) if kind(c) == ("Geometry", "Mesh")]
        mats = [material_index(c) for c, _ in children.get(mid, []) if kind(c)[0] == "Material"]
        p70 = _p70(o)
        for k in ("GeometricTranslation", "GeometricRotation", "PreRotation", "RotationPivot", "ScalingPivot"):
            if k in p70 and any(abs(float(v)) > 1e-9 for v in p70[k][:3]):
                asset.notes.append(f"{label}: {k} is set; v0 ignores it, so bounding box may be off")
        wm = model_world(mid)
        for gid in geoms:
            g = objs[gid]
            vn = g.find("Vertices")
            pn = g.find("PolygonVertexIndex")
            if vn is None or pn is None:
                continue
            verts = np.asarray(vn.props[0], dtype=np.float64).reshape(-1, 3)
            pvi = np.asarray(pn.props[0], dtype=np.int64)
            ends = pvi < 0
            corner_vertex = np.where(ends, ~pvi, pvi)
            if len(corner_vertex) and (corner_vertex.max() >= len(verts)):
                raise ParseError(f"FBX geometry for '{label}' has a vertex index out of range")
            poly_id = np.concatenate([[0], np.cumsum(ends)[:-1]]).astype(np.int64)
            ncorner = len(pvi)
            nrm = _layer(g, "LayerElementNormal", "Normals", "NormalsIndex", ncorner, poly_id, corner_vertex)
            uv = _layer(g, "LayerElementUV", "UV", "UVIndex", ncorner, poly_id, corner_vertex)
            # material per polygon
            lm = g.find("LayerElementMaterial")
            poly_mat = None
            npoly = int(ends.sum())
            if lm is not None and lm.find("Materials") is not None:
                arr = np.asarray(lm.find("Materials").props[0], dtype=np.int64)
                mapping = lm.find("MappingInformationType").props[0] if lm.find("MappingInformationType") else "AllSame"
                poly_mat = np.full(npoly, arr[0] if len(arr) else 0) if mapping == "AllSame" else arr[:npoly]
            # polygons -> fan triangles (corner indices)
            starts = np.concatenate([[0], np.nonzero(ends)[0][:-1] + 1]) if npoly else np.array([], dtype=np.int64)
            stops = np.nonzero(ends)[0] + 1
            tri_c, tri_p = [], []
            for pi, (a, b) in enumerate(zip(starts, stops)):
                for k in range(a + 1, b - 1):
                    tri_c.append((a, k, k + 1))
                    tri_p.append(pi)
            if not tri_c:
                continue
            tc = np.asarray(tri_c, dtype=np.int64)
            tp = np.asarray(tri_p, dtype=np.int64)
            wp = verts @ wm[:3, :3].T + wm[:3, 3]
            if poly_mat is not None and mats:
                local = poly_mat[tp]
                fm = np.array([mats[i] if 0 <= i < len(mats) else -1 for i in local], dtype=np.int64)
            elif mats:
                fm = np.full(len(tc), mats[0], dtype=np.int64)
            else:
                fm = np.full(len(tc), -1, dtype=np.int64)
            nmat = np.linalg.inv(wm[:3, :3]).T
            cn = (nrm @ nmat.T)[tc] if nrm is not None else None
            cu = uv[tc] if uv is not None else None
            asset.meshes.append(Mesh(
                name=label, positions=wp, tris=corner_vertex[tc], face_material=fm,
                corner_normals=cn, corner_uvs=cu,
                uv_missing_faces=0 if cu is not None else len(tc),
                lod=lod_from_name(label), skinned=gid in geom_skin, skin_index=geom_skin.get(gid)))
    if not asset.meshes:
        raise ParseError("FBX contains no polygon meshes")
    return asset
