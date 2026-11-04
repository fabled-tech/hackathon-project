"""glTF 2.0 loader: .gltf (embedded data URIs or sidecar .bin) and .glb. Pure Python + numpy.

glTF is meters and +Y up by specification, so units and up axis come from the spec.
"""
from __future__ import annotations

import base64
import json
import os
import struct
import urllib.parse

import numpy as np

from ..model import Asset, Material, Mesh, ParseError, Skin
from .common import embedded_texture, external_texture, lod_from_name

COMP_DTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
COMP_NORM = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def _decode_uri(uri: str, base_dir: str):
    if uri.startswith("data:"):
        header, _, payload = uri.partition(",")
        if ";base64" in header:
            return base64.b64decode(payload), None
        return urllib.parse.unquote_to_bytes(payload), None
    path = os.path.join(base_dir, urllib.parse.unquote(uri))
    return None, os.path.abspath(path)


def _read_glb(data: bytes):
    if len(data) < 20:
        raise ParseError("GLB file too short")
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ParseError("not a GLB file (bad magic)")
    if version != 2:
        raise ParseError(f"GLB container version {version}; only glTF 2.0 is supported")
    off = 12
    js = None
    binchunk = None
    while off + 8 <= min(length, len(data)):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8 : off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942 and binchunk is None:
            binchunk = bytes(chunk)
        off += 8 + clen
    if js is None:
        raise ParseError("GLB has no JSON chunk")
    return js, binchunk


def _quat_to_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def _node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T  # column-major
    m = np.eye(4)
    s = node.get("scale", [1, 1, 1])
    r = node.get("rotation", [0, 0, 0, 1])
    t = node.get("translation", [0, 0, 0])
    m[:3, :3] = _quat_to_mat(r) @ np.diag(s)
    m[:3, 3] = t
    return m


class _Reader:
    def __init__(self, js, buffers):
        self.js = js
        self.buffers = buffers

    def accessor(self, idx):
        acc = self.js["accessors"][idx]
        ct = acc["componentType"]
        dt = np.dtype(COMP_DTYPE[ct]).newbyteorder("<")
        nc = NCOMP[acc["type"]]
        count = acc["count"]
        if "bufferView" in acc:
            bv = self.js["bufferViews"][acc["bufferView"]]
            buf = self.buffers[bv["buffer"]]
            if buf is None:
                raise ParseError(f"buffer {bv['buffer']} could not be loaded")
            off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            stride = bv.get("byteStride") or dt.itemsize * nc
            need = off + stride * (count - 1) + dt.itemsize * nc if count else off
            if need > len(buf):
                raise ParseError(f"accessor {idx} reads past the end of its buffer")
            arr = np.ndarray((count, nc), dtype=dt, buffer=buf, offset=off, strides=(stride, dt.itemsize)).copy()
        else:
            arr = np.zeros((count, nc), dtype=dt)
        if "sparse" in acc:
            sp = acc["sparse"]
            ii = sp["indices"]
            vv = sp["values"]
            ibv = self.js["bufferViews"][ii["bufferView"]]
            idt = np.dtype(COMP_DTYPE[ii["componentType"]]).newbyteorder("<")
            ib = self.buffers[ibv["buffer"]]
            ind = np.frombuffer(ib, dtype=idt, count=sp["count"], offset=ibv.get("byteOffset", 0) + ii.get("byteOffset", 0))
            vbv = self.js["bufferViews"][vv["bufferView"]]
            vb = self.buffers[vbv["buffer"]]
            vals = np.frombuffer(vb, dtype=dt, count=sp["count"] * nc, offset=vbv.get("byteOffset", 0) + vv.get("byteOffset", 0)).reshape(-1, nc)
            arr[ind.astype(np.int64)] = vals
        if acc.get("normalized") and ct in COMP_NORM:
            arr = np.maximum(arr.astype(np.float64) / COMP_NORM[ct], -1.0)
        return arr


def load_gltf(path: str) -> Asset:
    path = os.path.abspath(path)
    base = os.path.dirname(path)
    with open(path, "rb") as fh:
        data = fh.read()
    is_glb = data[:4] == b"glTF"
    fmt = "glb" if is_glb else "gltf"
    try:
        if is_glb:
            js, binchunk = _read_glb(data)
        else:
            js = json.loads(data.decode("utf-8"))
            binchunk = None
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ParseError(f"glTF JSON could not be parsed: {exc}") from exc
    ver = str(js.get("asset", {}).get("version", ""))
    if not ver.startswith("2"):
        raise ParseError(f"glTF asset.version is '{ver}'; only glTF 2.0 is supported")

    asset = Asset(path=path, format=fmt, bone_parents={}, cm_per_unit=100.0,
                  unit_source="glTF 2.0 spec: 1 unit = 1 meter",
                  up_axis_declared="Y", up_axis_source="glTF 2.0 spec: +Y up")
    gen = js.get("asset", {}).get("generator")
    if gen:
        asset.notes.append(f"generator: {gen}")
    for ext in js.get("extensionsRequired", []) or []:
        asset.notes.append(f"extension required but not interpreted by v0: {ext}")

    buffers = []
    for i, b in enumerate(js.get("buffers", [])):
        if "uri" not in b:
            if is_glb and i == 0:
                buffers.append(binchunk)
                continue
            buffers.append(None)
            continue
        raw, p = _decode_uri(b["uri"], base)
        if p:
            ok = os.path.isfile(p)
            asset.referenced_files.append({"path": p, "role": "buffer (.bin)", "exists": ok})
            if not ok:
                raise ParseError(f"glTF buffer file not found: {p}")
            with open(p, "rb") as fh:
                raw = fh.read()
        buffers.append(raw)
    rd = _Reader(js, buffers)

    # ---------- images / textures / materials
    images = js.get("images", [])
    textures = js.get("textures", [])
    img_cache = {}

    def tex_ref(tex_index, slot, key):
        if tex_index is None or tex_index >= len(textures):
            from ..model import TextureRef
            return TextureRef(slot=slot, source_key=key, name=f"texture[{tex_index}]", exists=False, note="texture index out of range")
        src = textures[tex_index].get("source")
        if src is None:
            for e in (textures[tex_index].get("extensions") or {}).values():
                if isinstance(e, dict) and "source" in e:
                    src = e["source"]
        if src is None or src >= len(images):
            from ..model import TextureRef
            return TextureRef(slot=slot, source_key=key, name=f"texture[{tex_index}]", exists=False, note="texture has no image source")
        img = images[src]
        if "uri" in img and not img["uri"].startswith("data:"):
            t = external_texture(slot, key, urllib.parse.unquote(img["uri"]), base)
            asset.referenced_files.append({"path": t.path, "role": f"texture ({key})", "exists": t.exists})
            return t
        name = img.get("name") or (f"image[{src}]")
        if src not in img_cache:
            if "uri" in img:
                raw, _ = _decode_uri(img["uri"], base)
            elif "bufferView" in img:
                bv = js["bufferViews"][img["bufferView"]]
                buf = buffers[bv["buffer"]] or b""
                o = bv.get("byteOffset", 0)
                raw = buf[o : o + bv["byteLength"]]
            else:
                raw = None
            img_cache[src] = raw
        return embedded_texture(slot, key, name, img_cache[src])

    for i, m in enumerate(js.get("materials", [])):
        mat = Material(name=m.get("name") or f"material[{i}]")
        pbr = m.get("pbrMetallicRoughness", {})
        if "baseColorTexture" in pbr:
            mat.textures.append(tex_ref(pbr["baseColorTexture"].get("index"), "BaseColor", "baseColorTexture"))
        if "normalTexture" in m:
            mat.textures.append(tex_ref(m["normalTexture"].get("index"), "Normal", "normalTexture"))
        mr_index = pbr.get("metallicRoughnessTexture", {}).get("index")
        if mr_index is not None:
            mat.textures.append(tex_ref(mr_index, "ORM", "metallicRoughnessTexture"))
        if "occlusionTexture" in m and m["occlusionTexture"].get("index") != mr_index:
            mat.textures.append(tex_ref(m["occlusionTexture"].get("index"), "Occlusion", "occlusionTexture"))
        if "emissiveTexture" in m:
            mat.textures.append(tex_ref(m["emissiveTexture"].get("index"), "Emissive", "emissiveTexture"))
        asset.materials.append(mat)

    # ---------- node hierarchy
    nodes = js.get("nodes", [])
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    scenes = js.get("scenes", [])
    if scenes:
        roots = scenes[js.get("scene", 0)].get("nodes", [])
    else:
        roots = [i for i in range(len(nodes)) if i not in parent]
    world = {}
    stack = [(r, np.eye(4)) for r in roots]
    while stack:
        ni, pm = stack.pop()
        if ni in world:
            continue
        wm = pm @ _node_matrix(nodes[ni])
        world[ni] = wm
        for c in nodes[ni].get("children", []):
            stack.append((c, wm))

    def node_name(i):
        return nodes[i].get("name") or f"node[{i}]"

    # ---------- skins / bones
    joint_nodes = set()
    for si, s in enumerate(js.get("skins", [])):
        jn = s.get("joints", [])
        joint_nodes.update(jn)
        asset.skins.append(Skin(name=s.get("name") or f"skin[{si}]", joints=[node_name(j) for j in jn]))
    for j in joint_nodes:
        p = parent.get(j)
        while p is not None and p not in joint_nodes:
            p = parent.get(p)  # skip non-joint helper nodes between joints
        asset.bone_parents[node_name(j)] = node_name(p) if p is not None else None

    # ---------- meshes
    meshes = js.get("meshes", [])
    for ni, wm in world.items():
        n = nodes[ni]
        if "mesh" not in n:
            continue
        mdef = meshes[n["mesh"]]
        label = n.get("name") or mdef.get("name") or f"mesh[{n['mesh']}]"
        lod = lod_from_name(n.get("name", "")) if lod_from_name(n.get("name", "")) else lod_from_name(mdef.get("name", ""))
        nm = wm[:3, :3]
        try:
            nmat = np.linalg.inv(nm).T
        except np.linalg.LinAlgError:
            nmat = nm
        det_neg = np.linalg.det(nm) < 0
        pos_all, tri_all, mat_all, nrm_all, uv_all = [], [], [], [], []
        any_uv = False
        any_nrm = True
        uv_missing = 0
        skinned = False
        voff = 0
        for pi, prim in enumerate(mdef.get("primitives", [])):
            mode = prim.get("mode", 4)
            attrs = prim.get("attributes", {})
            if "POSITION" not in attrs:
                continue
            if mode not in (4, 5, 6):
                asset.notes.append(f"{label} primitive {pi}: mode {mode} (points/lines) ignored")
                continue
            pos = rd.accessor(attrs["POSITION"]).astype(np.float64)
            if "indices" in prim:
                idx = rd.accessor(prim["indices"]).reshape(-1).astype(np.int64)
            else:
                idx = np.arange(len(pos), dtype=np.int64)
            if mode == 4:
                tris = idx[: len(idx) // 3 * 3].reshape(-1, 3)
            elif mode == 5:
                t = [(idx[i], idx[i + 1], idx[i + 2]) if i % 2 == 0 else (idx[i + 1], idx[i], idx[i + 2]) for i in range(len(idx) - 2)]
                tris = np.asarray(t, dtype=np.int64).reshape(-1, 3)
            else:
                tris = np.asarray([(idx[0], idx[i], idx[i + 1]) for i in range(1, len(idx) - 1)], dtype=np.int64).reshape(-1, 3)
            if len(tris) and (tris.max() >= len(pos) or tris.min() < 0):
                raise ParseError(f"{label} primitive {pi}: index out of range")
            if det_neg:
                tris = tris[:, [0, 2, 1]]  # spec: negative-determinant transforms reverse winding
            wp = pos @ wm[:3, :3].T + wm[:3, 3]
            pos_all.append(wp)
            tri_all.append(tris + voff)
            mat_all.append(np.full(len(tris), prim.get("material", -1), dtype=np.int64))
            if "NORMAL" in attrs:
                nr = rd.accessor(attrs["NORMAL"]).astype(np.float64) @ nmat.T
                nrm_all.append(nr[tris])
            else:
                any_nrm = False
                nrm_all.append(np.full((len(tris), 3, 3), np.nan))
            if "TEXCOORD_0" in attrs:
                uv = rd.accessor(attrs["TEXCOORD_0"]).astype(np.float64)
                uv = np.stack([uv[:, 0], 1.0 - uv[:, 1]], axis=1)  # to bottom-left origin (OBJ/FBX convention)
                uv_all.append(uv[tris])
                any_uv = True
            else:
                uv_all.append(np.full((len(tris), 3, 2), np.nan))
                uv_missing += len(tris)
            if "JOINTS_0" in attrs:
                skinned = True
            voff += len(pos)
        if not tri_all:
            continue
        asset.meshes.append(Mesh(
            name=label,
            positions=np.concatenate(pos_all),
            tris=np.concatenate(tri_all),
            face_material=np.concatenate(mat_all),
            corner_normals=np.concatenate(nrm_all) if any(not np.isnan(a).all() for a in nrm_all) else None,
            corner_uvs=np.concatenate(uv_all) if any_uv else None,
            uv_missing_faces=uv_missing,
            lod=lod,
            skinned=skinned,
            skin_index=n.get("skin"),
        ))
    if not asset.meshes:
        raise ParseError("glTF contains no triangle meshes in the default scene")
    return asset
