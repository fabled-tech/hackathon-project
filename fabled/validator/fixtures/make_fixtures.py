#!/usr/bin/env python3
"""Generate SYNTHETIC test fixtures for the Fabled pre-import check.

Everything here is a programmatic box-figure "character proxy" (no real art). File names start
with `synthetic_` so reports label them as synthetic test assets.

    python fixtures/make_fixtures.py          # writes into fixtures/
"""
import base64
import contextlib
import json
import shutil
import os
import struct
import sys
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _fbx_writer import Arr, C, D, I, L, N, P, S, write_fbx  # noqa: E402

TEX_DIR = os.path.join(HERE, "textures")
TARGET_PX_PER_CM = 10.24  # what the generator aims UVs at; the validator measures the real result

# name, center (cm), size (cm), material, bone  -- Y up, feet at y=0, 180 cm tall
PARTS = [
    ("leg_l", (-10, 44, 0), (14, 88, 16), "M_Body", "thigh_l"),
    ("leg_r", (10, 44, 0), (14, 88, 16), "M_Body", "thigh_r"),
    ("torso", (0, 120, 0), (40, 60, 24), "M_Body", "spine_01"),
    ("arm_l", (-27, 118, 0), (10, 60, 10), "M_Body", "upperarm_l"),
    ("arm_r", (27, 118, 0), (10, 60, 10), "M_Body", "upperarm_r"),
    ("head", (0, 166.5, 0), (20, 27, 22), "M_Head", "head"),
]
BONES = [  # name, parent, head position (cm)
    ("root", None, (0, 0, 0)),
    ("pelvis", "root", (0, 90, 0)),
    ("spine_01", "pelvis", (0, 120, 0)),
    ("head", "spine_01", (0, 153, 0)),
    ("thigh_l", "pelvis", (-10, 88, 0)),
    ("thigh_r", "pelvis", (10, 88, 0)),
    ("upperarm_l", "spine_01", (-27, 148, 0)),
    ("upperarm_r", "spine_01", (27, 148, 0)),
]
MATERIALS = {  # material -> (BaseColor, Normal, ORM, texture resolution used for UV packing)
    "M_Body": ("T_Body_BC.png", "T_Body_N.png", "T_Body_ORM.png", 2048),
    "M_Head": ("T_Head_BC.png", "T_Head_N.png", "T_Head_ORM.png", 1024),
}
SIDES = [  # outward normal, u axis, v axis with u x v = normal (CCW from outside)
    ((1, 0, 0), (0, 1, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    ((0, 1, 0), (0, 0, 1), (1, 0, 0)), ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
    ((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (0, 1, 0), (1, 0, 0)),
]
SIDE_NAMES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]


# ------------------------------------------------------------------ textures
def write_png(path, w, h, rgb):
    row = b"\x00" + bytes(rgb) * w
    raw = row * h
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + \
        chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(data)


def make_textures():
    os.makedirs(TEX_DIR, exist_ok=True)
    spec = {
        "T_Body_BC.png": (2048, 2048, (176, 132, 96)), "T_Body_N.png": (2048, 2048, (128, 128, 255)),
        "T_Body_ORM.png": (2048, 2048, (255, 160, 0)), "T_Head_BC.png": (1024, 1024, (196, 150, 120)),
        "T_Head_N.png": (1024, 1024, (128, 128, 255)), "T_Head_ORM.png": (1024, 1024, (255, 140, 0)),
        # deliberately bad textures for the uv/texture-issues fixture
        "body_normal_final.png": (1000, 1000, (128, 128, 255)),  # bad name + not power of two
        "T_HeadHuge_BC.png": (8192, 8, (196, 150, 120)),  # wider than max_resolution 4096
    }
    for name, (w, h, c) in spec.items():
        write_png(os.path.join(TEX_DIR, name), w, h, c)
    return spec


# ------------------------------------------------------------------ geometry
def pack_uvs(charts, tex_res):
    """Shelf-pack charts (w,h in cm) at a uniform texel density. Returns offsets, uv-per-cm."""
    s = TARGET_PX_PER_CM / tex_res
    pad = 8.0 / tex_res
    order = sorted(range(len(charts)), key=lambda i: -charts[i][1])
    while True:
        x = y = pad
        row = 0.0
        offs = {}
        ok = True
        for i in order:
            w, h = charts[i][0] * s, charts[i][1] * s
            if x + w + pad > 1:
                x = pad
                y += row + pad
                row = 0.0
            offs[i] = (x, y)
            x += w + pad
            row = max(row, h)
            if y + h + pad > 1:
                ok = False
                break
        if ok:
            return offs, s
        s *= 0.97


def build_character(n, name):
    """Return mesh dict: pos, uv, nrm lists; faces [(corners, material, part, side)]; pos_bone."""
    mesh = {"name": name, "pos": [], "uv": [], "nrm": [], "faces": [], "pos_bone": []}
    pidx = {}
    charts = {m: [] for m in MATERIALS}
    for pi, (part, c, size, mat, bone) in enumerate(PARTS):
        for si, (nv, uv_, vv) in enumerate(SIDES):
            ku, kv = [ax.index(1) for ax in (uv_, vv)]
            charts[mat].append((pi, si, size[ku], size[kv]))
    packing = {}
    for mat, ch in charts.items():
        offs, s = pack_uvs([(w, h) for (_, _, w, h) in ch], MATERIALS[mat][3])
        for i, (pi, si, w, h) in enumerate(ch):
            packing[(pi, si)] = (offs[i], s)
    for pi, (part, c, size, mat, bone) in enumerate(PARTS):
        c = np.array(c, float)
        size = np.array(size, float)
        for si, (nv, uv_, vv) in enumerate(SIDES):
            nv, uv_, vv = (np.array(a, float) for a in (nv, uv_, vv))
            kn = int(np.argmax(np.abs(nv)))
            ku, kv = int(np.argmax(uv_)), int(np.argmax(vv))
            (ox, oy), s = packing[(pi, si)]
            mesh["nrm"].append(tuple(nv))
            ni = len(mesh["nrm"]) - 1
            grid = {}
            for a in range(n + 1):
                for b in range(n + 1):
                    fa, fb = a / n, b / n
                    p = c + nv * size[kn] / 2 + uv_ * (fa - 0.5) * size[ku] + vv * (fb - 0.5) * size[kv]
                    key = tuple(np.round(p, 6))
                    if key not in pidx:
                        pidx[key] = len(mesh["pos"])
                        mesh["pos"].append(tuple(p))
                        mesh["pos_bone"].append(bone)
                    mesh["uv"].append((ox + fa * size[ku] * s, oy + fb * size[kv] * s))
                    grid[(a, b)] = (pidx[key], len(mesh["uv"]) - 1, ni)
            for a in range(n):
                for b in range(n):
                    q00, q10, q11, q01 = grid[(a, b)], grid[(a + 1, b)], grid[(a + 1, b + 1)], grid[(a, b + 1)]
                    mesh["faces"].append([(q00, q10, q11), mat, part, si])
                    mesh["faces"].append([(q00, q11, q01), mat, part, si])
    return mesh


def character(lods=((0, 8), (1, 2))):
    return [build_character(n, f"SK_Character_LOD{l}") for l, n in lods]


def flip_faces(mesh, part="arm_r", side=0):
    k = 0
    for f in mesh["faces"]:
        if f[2] == part and f[3] == side:
            a, b, c = f[0]
            f[0] = (a, c, b)  # reverse winding, keep stored outward normals
            k += 1
    return k


# ------------------------------------------------------------------ writers
def write_obj(path, meshes, unit_scale=1.0, mtl_name=None, mtl_text=None, header=""):
    mtl_name = mtl_name or os.path.splitext(os.path.basename(path))[0] + ".mtl"
    lines = ["# SYNTHETIC TEST FIXTURE generated by fabled validator fixtures/make_fixtures.py", "# box-figure character proxy, not real art"]
    if header:
        lines.append("# " + header)
    lines.append(f"mtllib {mtl_name}")
    vo = to = no = 0
    for m in meshes:
        lines.append(f"o {m['name']}")
        lines += [f"v {x * unit_scale:.6f} {y * unit_scale:.6f} {z * unit_scale:.6f}" for x, y, z in m["pos"]]
        lines += [f"vt {u:.6f} {v:.6f}" for u, v in m["uv"]]
        lines += [f"vn {x:.6f} {y:.6f} {z:.6f}" for x, y, z in m["nrm"]]
        cur = None
        for corners, mat, *_ in m["faces"]:
            if mat != cur:
                lines.append(f"usemtl {mat}")
                cur = mat
            lines.append("f " + " ".join(f"{p + 1 + vo}/{t + 1 + to}/{q + 1 + no}" for p, t, q in corners))
        vo += len(m["pos"]); to += len(m["uv"]); no += len(m["nrm"])
    with open(path, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    with open(os.path.join(os.path.dirname(path), mtl_name), "w") as fh:
        fh.write(mtl_text if mtl_text is not None else default_mtl())


def default_mtl(overrides=None):
    overrides = overrides or {}
    out = ["# SYNTHETIC TEST FIXTURE material library"]
    for mat, (bc, nm, orm, _) in MATERIALS.items():
        o = overrides.get(mat, {})
        bc, nm, orm = o.get("bc", bc), o.get("n", nm), o.get("orm", orm)
        out += [f"newmtl {mat}", "Kd 0.8 0.8 0.8"]
        if bc: out.append(f"map_Kd textures/{bc}")
        if nm: out.append(f"map_Bump -bm 1.0 textures/{nm}")
        if orm: out += [f"map_Pr textures/{orm}", f"map_Pm textures/{orm}"]
        out.append("")
    return "\n".join(out)


def _bone_world():
    return {b: np.array(p, float) for b, _, p in BONES}


def write_gltf(path, meshes, unit_scale, mode, bones=None, texture_mode="uri", tex_dir=None):
    """mode: 'sidecar' | 'datauri' | 'glb'. unit_scale: multiply cm values by this (0.01 = proper meters)."""
    bones = bones or BONES
    bone_names = [b[0] for b in bones]
    orig_names = [b[0] for b in BONES]
    rename = dict(zip(orig_names, bone_names))
    bw = _bone_world()
    blob = bytearray()
    views, accessors = [], []

    def add(arr, comp, typ, target=None, minmax=False):
        a = np.ascontiguousarray(arr)
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(a.tobytes())
        v = {"buffer": 0, "byteOffset": off, "byteLength": a.nbytes}
        if target:
            v["target"] = target
        views.append(v)
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": int(a.shape[0]), "type": typ}
        if minmax:
            acc["min"] = [float(x) for x in a.min(axis=0)]
            acc["max"] = [float(x) for x in a.max(axis=0)]
        accessors.append(acc)
        return len(accessors) - 1

    images, textures = [], []
    tex_index = {}
    for fname in sorted({f for v in MATERIALS.values() for f in v[:3]}):
        if mode == "glb":
            with open(os.path.join(tex_dir or TEX_DIR, fname), "rb") as fh:
                data = np.frombuffer(fh.read(), dtype=np.uint8)
            while len(blob) % 4:
                blob.append(0)
            off = len(blob)
            blob.extend(data.tobytes())
            views.append({"buffer": 0, "byteOffset": off, "byteLength": int(data.nbytes)})
            images.append({"name": fname, "mimeType": "image/png", "bufferView": len(views) - 1})
        else:
            images.append({"name": fname, "uri": f"textures/{fname}"})
        textures.append({"source": len(images) - 1, "sampler": 0})
        tex_index[fname] = len(textures) - 1
    mats = []
    mat_index = {}
    for mat, (bc, nm, orm, _) in MATERIALS.items():
        mat_index[mat] = len(mats)
        mats.append({"name": mat, "pbrMetallicRoughness": {"baseColorTexture": {"index": tex_index[bc]},
                                                            "metallicRoughnessTexture": {"index": tex_index[orm]}},
                     "normalTexture": {"index": tex_index[nm]}, "occlusionTexture": {"index": tex_index[orm]}})

    nodes = []
    # bones first
    bone_node = {}
    for i, (b, parent, p) in enumerate(BONES):
        bone_node[b] = i
        local = np.array(p, float) - (bw[parent] if parent else 0)
        nodes.append({"name": rename[b], "translation": [float(x) * unit_scale for x in local]})
    for b, parent, _ in BONES:
        if parent:
            nodes[bone_node[parent]].setdefault("children", []).append(bone_node[b])
    ibm = np.zeros((len(BONES), 16), np.float32)
    for i, (b, _, _) in enumerate(BONES):
        m = np.eye(4)
        m[:3, 3] = -bw[b] * unit_scale
        ibm[i] = m.T.reshape(-1)
    ibm_acc = add(ibm, 5126, "MAT4")
    gmeshes = []
    mesh_nodes = []
    for m in meshes:
        prims = []
        for mat in MATERIALS:
            verts = {}
            P, NRM, UV, J, W, IDX = [], [], [], [], [], []
            for corners, fm, *_ in m["faces"]:
                if fm != mat:
                    continue
                for cnr in corners:
                    if cnr not in verts:
                        verts[cnr] = len(P)
                        p, t, q = cnr
                        P.append(np.array(m["pos"][p]) * unit_scale)
                        NRM.append(m["nrm"][q])
                        u, v = m["uv"][t]
                        UV.append((u, 1.0 - v))
                        J.append((bone_node[m["pos_bone"][p]], 0, 0, 0))
                        W.append((1.0, 0, 0, 0))
                    IDX.append(verts[cnr])
            if not IDX:
                continue
            prims.append({"attributes": {
                "POSITION": add(np.array(P, np.float32), 5126, "VEC3", 34962, minmax=True),
                "NORMAL": add(np.array(NRM, np.float32), 5126, "VEC3", 34962),
                "TEXCOORD_0": add(np.array(UV, np.float32), 5126, "VEC2", 34962),
                "JOINTS_0": add(np.array(J, np.uint16), 5123, "VEC4", 34962),
                "WEIGHTS_0": add(np.array(W, np.float32), 5126, "VEC4", 34962)},
                "indices": add(np.array(IDX, np.uint32), 5125, "SCALAR", 34963), "material": mat_index[mat], "mode": 4})
        gmeshes.append({"name": m["name"], "primitives": prims})
        nodes.append({"name": m["name"], "mesh": len(gmeshes) - 1, "skin": 0})
        mesh_nodes.append(len(nodes) - 1)
    gl = {
        "asset": {"version": "2.0", "generator": "fabled validator fixtures/make_fixtures.py (SYNTHETIC TEST FIXTURE)"},
        "scene": 0, "scenes": [{"name": "synthetic", "nodes": [bone_node["root"]] + mesh_nodes}],
        "nodes": nodes, "meshes": gmeshes, "materials": mats, "textures": textures, "images": images,
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "skins": [{"name": "SK_Character_Skin", "joints": list(range(len(BONES))), "inverseBindMatrices": ibm_acc, "skeleton": bone_node["root"]}],
        "accessors": accessors, "bufferViews": views,
    }
    while len(blob) % 4:
        blob.append(0)
    if mode == "sidecar":
        binname = os.path.splitext(os.path.basename(path))[0] + ".bin"
        with open(os.path.join(os.path.dirname(path), binname), "wb") as fh:
            fh.write(blob)
        gl["buffers"] = [{"byteLength": len(blob), "uri": binname}]
    elif mode == "datauri":
        gl["buffers"] = [{"byteLength": len(blob), "uri": "data:application/octet-stream;base64," + base64.b64encode(bytes(blob)).decode()}]
    else:
        gl["buffers"] = [{"byteLength": len(blob)}]
    if mode == "glb":
        js = json.dumps(gl, separators=(",", ":")).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(blob)
        with open(path, "wb") as fh:
            fh.write(struct.pack("<4sII", b"glTF", 2, total))
            fh.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
            fh.write(struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    else:
        with open(path, "w") as fh:
            json.dump(gl, fh, indent=1)


def write_fbx_character(path, meshes, unit_scale_factor=1.0, skeleton=True):
    """Values are written in cm; UnitScaleFactor declares cm per unit (1.0 = cm, 100 = meters)."""
    ids = iter(range(1000000, 9999999))
    objects, conns = N("Objects"), N("Connections")
    oo = lambda c, p: conns.add(N("C", S("OO"), L(c), L(p)))
    op = lambda c, p, prop: conns.add(N("C", S("OP"), L(c), L(p), S(prop)))
    bw = _bone_world()
    bone_id = {}
    for b, parent, p in (BONES if skeleton else []):
        bid = next(ids)
        bone_id[b] = bid
        local = np.array(p, float) - (bw[parent] if parent else 0)
        objects.add(N("Model", L(bid), S(f"{b}\x00\x01Model"), S("LimbNode")).add(
            N("Version", I(232)), N("Properties70").add(P("Lcl Translation", "Lcl Translation", "", "A", *(D(x) for x in local)))))
        na = next(ids)
        objects.add(N("NodeAttribute", L(na), S("\x00\x01NodeAttribute"), S("LimbNode")).add(N("TypeFlags", S("Skeleton"))))
        oo(na, bid)
    for b, parent, _ in (BONES if skeleton else []):
        oo(bone_id[b], bone_id[parent] if parent else 0)
    mat_id = {}
    tex_id = {}
    for mat, (bc, nm, orm, _) in MATERIALS.items():
        mid = next(ids)
        mat_id[mat] = mid
        objects.add(N("Material", L(mid), S(f"{mat}\x00\x01Material"), S("")).add(N("Version", I(102)), N("ShadingModel", S("phong")), N("MultiLayer", I(0)), N("Properties70")))
        for fname, props in ((bc, ["DiffuseColor"]), (nm, ["NormalMap"]), (orm, ["ShininessExponent", "ReflectionFactor"])):
            if fname not in tex_id:
                tid = next(ids)
                tex_id[fname] = tid
                stem = os.path.splitext(fname)[0]
                objects.add(N("Texture", L(tid), S(f"{stem}\x00\x01Texture"), S("")).add(
                    N("Type", S("TextureVideoClip")), N("Version", I(202)), N("TextureName", S(f"{stem}\x00\x01Texture")),
                    N("FileName", S(f"textures/{fname}")), N("RelativeFilename", S(f"textures/{fname}"))))
            for prop in props:
                op(tex_id[fname], mid, prop)
    mats = list(MATERIALS)
    for m in meshes:
        gid, mid, skid = next(ids), next(ids), next(ids)
        pos = np.array(m["pos"], float).reshape(-1)
        pvi, nrm, uvidx, matidx = [], [], [], []
        for corners, fm, *_ in m["faces"]:
            for k, (p, t, q) in enumerate(corners):
                pvi.append(p if k < 2 else ~p)
                nrm.extend(m["nrm"][q])
                uvidx.append(t)
            matidx.append(mats.index(fm))
        le = lambda t: N("LayerElement").add(N("Type", S(t)), N("TypedIndex", I(0)))
        objects.add(N("Geometry", L(gid), S(f"{m['name']}\x00\x01Geometry"), S("Mesh")).add(
            N("Vertices", Arr("d", pos)), N("PolygonVertexIndex", Arr("i", pvi)), N("GeometryVersion", I(124)),
            N("LayerElementNormal", I(0)).add(N("Version", I(101)), N("Name", S("")), N("MappingInformationType", S("ByPolygonVertex")),
                                               N("ReferenceInformationType", S("Direct")), N("Normals", Arr("d", nrm))),
            N("LayerElementUV", I(0)).add(N("Version", I(101)), N("Name", S("UVMap")), N("MappingInformationType", S("ByPolygonVertex")),
                                           N("ReferenceInformationType", S("IndexToDirect")), N("UV", Arr("d", np.array(m["uv"]).reshape(-1))),
                                           N("UVIndex", Arr("i", uvidx))),
            N("LayerElementMaterial", I(0)).add(N("Version", I(101)), N("Name", S("")), N("MappingInformationType", S("ByPolygon")),
                                                 N("ReferenceInformationType", S("IndexToDirect")), N("Materials", Arr("i", matidx))),
            N("Layer", I(0)).add(N("Version", I(100)), le("LayerElementNormal"), le("LayerElementUV"), le("LayerElementMaterial"))))
        objects.add(N("Model", L(mid), S(f"{m['name']}\x00\x01Model"), S("Mesh")).add(
            N("Version", I(232)), N("Properties70"), N("Shading", C(True)), N("Culling", S("CullingOff"))))
        oo(mid, 0)
        oo(gid, mid)
        for mat in mats:
            oo(mat_id[mat], mid)
        if not skeleton:
            continue
        objects.add(N("Deformer", L(skid), S("\x00\x01Deformer"), S("Skin")).add(N("Version", I(101)), N("Link_DeformAcuracy", D(50.0))))
        oo(skid, gid)
        for b, _, _ in BONES:
            idx = [i for i, bb in enumerate(m["pos_bone"]) if bb == b]
            if not idx:
                continue  # 'root' carries no weights (normal for UE skeletons)
            cid = next(ids)
            link = np.eye(4)
            link[3, :3] = bw[b]
            objects.add(N("Deformer", L(cid), S("\x00\x01SubDeformer"), S("Cluster")).add(
                N("Version", I(100)), N("UserData", S(""), S("")), N("Indexes", Arr("i", idx)), N("Weights", Arr("d", [1.0] * len(idx))),
                N("Transform", Arr("d", np.linalg.inv(link).reshape(-1))), N("TransformLink", Arr("d", link.reshape(-1)))))
            oo(cid, skid)
            oo(bone_id[b], cid)
    gs = N("GlobalSettings").add(N("Version", I(1000)), N("Properties70").add(
        P("UpAxis", "int", "Integer", "", I(1)), P("UpAxisSign", "int", "Integer", "", I(1)),
        P("FrontAxis", "int", "Integer", "", I(2)), P("FrontAxisSign", "int", "Integer", "", I(1)),
        P("CoordAxis", "int", "Integer", "", I(0)), P("CoordAxisSign", "int", "Integer", "", I(1)),
        P("UnitScaleFactor", "double", "Number", "", D(unit_scale_factor)),
        P("OriginalUnitScaleFactor", "double", "Number", "", D(unit_scale_factor))))
    hdr = N("FBXHeaderExtension").add(N("FBXHeaderVersion", I(1003)), N("FBXVersion", I(7400)),
                                      N("Creator", S("fabled validator fixtures/make_fixtures.py (SYNTHETIC TEST FIXTURE)")))
    write_fbx(path, [hdr, gs, N("Documents").add(N("Count", I(0))), N("References"), N("Definitions").add(N("Version", I(100))), objects, conns])


# ------------------------------------------------------------------ synthetic pipeline output
PIPE_ASSET = "SyntheticProxy"
PIPE_LODS = ((0, 8), (1, 4), (2, 2), (3, 1))  # subdivisions per box side -> 4608, 1152, 288, 72 triangles
PIPE_BUDGETS = [60000, 30000, 15000, 7500]  # = profiles/demo_placeholder.json lods.triangle_budgets


@contextlib.contextmanager
def single_material(name, bc, nm, orm, res):
    global MATERIALS, PARTS
    saved = MATERIALS, PARTS
    MATERIALS = {name: (bc, nm, orm, res)}
    PARTS = [(p, c, sz, name, b) for p, c, sz, _, b in saved[1]]
    try:
        yield
    finally:
        MATERIALS, PARTS = saved


def make_pipeline_out(root):
    """Mimic what prototype/pipeline should write: <out>/manifest.json + SM_<Asset>.fbx (meshes _LOD0.._LOD3)
    + one file per LOD + textures. Static meshes (no skeleton), like the real pipeline."""
    out = os.path.join(root, "synthetic_pipeline_out")
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, "textures"))
    a = PIPE_ASSET
    tex = {s: f"T_{a}_{s}.png" for s in ("BC", "N", "ORM")}
    for s, col in (("BC", (176, 132, 96)), ("N", (128, 128, 255)), ("ORM", (255, 160, 0))):
        write_png(os.path.join(out, "textures", tex[s]), 2048, 2048, col)
    with single_material(f"M_{a}", tex["BC"], tex["N"], tex["ORM"], 2048):
        meshes = [build_character(n, f"_LOD{l}") for l, n in PIPE_LODS]
        write_fbx_character(os.path.join(out, f"SM_{a}.fbx"), meshes, 1.0, skeleton=False)
        lods = []
        for (l, n), m in zip(PIPE_LODS, meshes):
            single = build_character(n, f"SM_{a}_LOD{l}")
            if l < 3:
                fname = f"SM_{a}_LOD{l}.fbx"
                write_fbx_character(os.path.join(out, fname), [single], 1.0, skeleton=False)
                fmt = "fbx"
            else:  # one GLB so the per-LOD measurement covers a second format
                fname = f"SM_{a}_LOD{l}.glb"
                write_gltf(os.path.join(out, fname), [single], 0.01, "glb", tex_dir=os.path.join(out, "textures"))
                fmt = "glb"
            lods.append({"level": l, "name": f"LOD{l}", "path": fname, "format": fmt, "triangles": len(m["faces"]),
                         "vertices": len(m["pos"]), "budget_triangles": PIPE_BUDGETS[l], "screen_size": [1.0, 0.5, 0.25, 0.12][l],
                         "has_uvs": True})
    manifest = {
        "schema": "fabled.pipeline.manifest/0.1",
        "concept_mockup": False,
        "job_id": "synthetic-fixture-0001",
        "created_at": "2026-10-25T22:00:00-07:00",
        "tool": {"name": "fabled validator fixtures/make_fixtures.py (SYNTHETIC TEST FIXTURE)", "version": "0.1"},
        "input": {"sculpt_path": None, "format": None, "triangles": None, "vertices": None,
                  "source_url": None, "license": "synthetic test fixture (no source sculpt)"},
        "profile": {"name": "DEMO PLACEHOLDER VALUES - not a real studio spec", "lods": [{"name": f"LOD{i}", "target_tris": b} for i, b in enumerate(PIPE_BUDGETS)]},
        "outputs": {"lods": lods, "combined_fbx": f"SM_{a}.fbx", "uv_layout_png": None,
                    "textures": {"base_color": f"textures/{tex['BC']}", "normal": f"textures/{tex['N']}", "orm": f"textures/{tex['ORM']}"}},
        "previews": [],
        "steps": [{"name": "synthetic_generation", "status": "automated", "method": "make_fixtures.py"}],
        "warnings": [],
    }
    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    # variant 1: manifest claims a wrong LOD1 triangle count
    bad = out + "_tri_mismatch"
    if os.path.isdir(bad):
        shutil.rmtree(bad)
    shutil.copytree(out, bad)
    m2 = json.loads(json.dumps(manifest))
    m2["outputs"]["lods"][1]["triangles"] += 100
    with open(os.path.join(bad, "manifest.json"), "w") as fh:
        json.dump(m2, fh, indent=2)
    # variant 2: LOD2 file missing on disk
    miss = out + "_missing_lod"
    if os.path.isdir(miss):
        shutil.rmtree(miss)
    shutil.copytree(out, miss)
    os.remove(os.path.join(miss, manifest["outputs"]["lods"][2]["path"]))
    return [(os.path.basename(out), "synthetic pipeline output that matches its manifest (4 LODs, combined SM_SyntheticProxy.fbx)"),
            (os.path.basename(bad), f"same, but manifest LOD1 triangles = {m2['outputs']['lods'][1]['triangles']} (real: {manifest['outputs']['lods'][1]['triangles']})"),
            (os.path.basename(miss), f"same, but {manifest['outputs']['lods'][2]['path']} deleted")]


# ------------------------------------------------------------------ fixture set
def main():
    out = HERE
    make_textures()
    log = []

    def rec(name, what):
        log.append((name, what))

    # 1. clean OBJ (cm)
    write_obj(os.path.join(out, "synthetic_clean_character.obj"), character())
    rec("synthetic_clean_character.obj", "clean box-figure proxy, centimeters, 2 LODs, 2 materials")
    # 2. wrong scale: authored in meters
    write_obj(os.path.join(out, "synthetic_wrong_scale_meters.obj"), character(), unit_scale=0.01,
              header="authored in METERS; profile assumes cm for OBJ")
    rec("synthetic_wrong_scale_meters.obj", "same proxy written in meters (1.8 units tall)")
    # 3. flipped faces
    ms = character()
    k = flip_faces(ms[0])
    write_obj(os.path.join(out, "synthetic_flipped_faces.obj"), ms, header=f"{k} LOD0 triangles on arm_r +X side have reversed winding")
    rec("synthetic_flipped_faces.obj", f"{k} triangles (arm_r +X side, LOD0) with reversed winding")
    # 4. missing texture
    write_obj(os.path.join(out, "synthetic_missing_texture.obj"), character(),
              mtl_text=default_mtl({"M_Body": {"n": "T_Vendor_N.png"}}), header="M_Body normal map points at a file that does not exist")
    rec("synthetic_missing_texture.obj", "M_Body normal map references textures/T_Vendor_N.png (not on disk)")
    # 5. geometry issues: non-manifold fin + degenerate triangles
    ms = character()
    m0 = ms[0]
    (a, b, _), mat, *_ = next(f for f in m0["faces"] if f[2] == "torso" and f[3] == 4)
    pa, pb = np.array(m0["pos"][a[0]]), np.array(m0["pos"][b[0]])
    tip = tuple((pa + pb) / 2 + np.array([0, 0, 6.0]))

    def newv(p, nrm=(0, 0, 1)):
        m0["pos"].append(tuple(p)); m0["pos_bone"].append("spine_01")
        m0["uv"].append((0.5, 0.5)); m0["nrm"].append(tuple(nrm))
        return (len(m0["pos"]) - 1, len(m0["uv"]) - 1, len(m0["nrm"]) - 1)
    t = newv(tip)
    fin_n = np.cross(pb - pa, np.array(tip) - pa)
    m0["nrm"][t[2]] = tuple(fin_n / np.linalg.norm(fin_n))
    m0["faces"].append([(a, b, (t[0], t[1], t[2])), mat, "fin", -1])  # third face on edge a-b
    z1, z2, z3 = newv((0, 120, 0)), newv((1, 120, 0)), newv((2, 120, 0))
    m0["faces"].append([(z1, z2, z3), "M_Body", "degenerate", -1])  # collinear, zero area
    z4, z5, z6 = newv((0, 121, 0)), newv((1, 121, 0)), newv((1.5, 121, 0))
    m0["faces"].append([(z4, z5, z6), "M_Body", "degenerate", -1])
    r1, r2 = newv((0, 122, 0)), newv((1, 122, 1))
    m0["faces"].append([(r1, r1, r2), "M_Body", "degenerate", -1])  # repeated vertex
    write_obj(os.path.join(out, "synthetic_geometry_issues.obj"), ms, header="1 non-manifold fin triangle + 3 degenerate triangles")
    rec("synthetic_geometry_issues.obj", "one extra triangle on an existing torso edge (non-manifold) + 2 zero-area + 1 repeated-vertex triangle")
    # 6. UV + texture issues
    ms = character()
    for m in ms[:1]:
        shifted = set()
        for f in m["faces"]:
            if f[2] == "torso" and f[3] == 4:
                for (_, ti, _) in f[0]:
                    shifted.add(ti)
        for ti in shifted:
            u, v = m["uv"][ti]
            m["uv"][ti] = (u + 1.0, v)
    write_obj(os.path.join(out, "synthetic_uv_texture_issues.obj"), ms,
              mtl_text=default_mtl({"M_Body": {"n": "body_normal_final.png", "orm": None}, "M_Head": {"bc": "T_HeadHuge_BC.png"}}),
              header="torso front UVs shifted +1 in U; badly named non-pow2 normal; no ORM on M_Body; 8192px head base color")
    rec("synthetic_uv_texture_issues.obj", "torso +Z UVs shifted to u>1; M_Body normal 'body_normal_final.png' 1000x1000; M_Body has no ORM; M_Head base color 8192x8")
    # 7. clean GLB (embedded textures, skin)
    write_gltf(os.path.join(out, "synthetic_clean_character.glb"), character(), 0.01, "glb")
    rec("synthetic_clean_character.glb", "clean proxy in meters, skinned to 8-bone skeleton, textures embedded")
    # 8. wrong root bone (data-URI buffer)
    bones = [("hips" if b == "root" else b, p, pos) for b, p, pos in BONES]
    write_gltf(os.path.join(out, "synthetic_wrong_root_bone.gltf"), character(), 0.01, "datauri", bones=bones)
    rec("synthetic_wrong_root_bone.gltf", "skeleton root named 'hips' instead of 'root' (embedded base64 buffer)")
    # 9. bad bone names
    ren = {"pelvis": "Pelvis", "spine_01": "spine.001", "upperarm_l": "mixamorig:LeftArm"}
    bones = [(ren.get(b, b), p, pos) for b, p, pos in BONES]
    write_gltf(os.path.join(out, "synthetic_bad_bone_names.gltf"), character(), 0.01, "sidecar", bones=bones)
    rec("synthetic_bad_bone_names.gltf", "3 bones break the naming regex: Pelvis, spine.001, mixamorig:LeftArm")
    # 10/11. storyboard pair
    ms = character()
    k = flip_faces(ms[0])
    write_gltf(os.path.join(out, "synthetic_storyboard_two_flags.gltf"), ms, 1.0, "sidecar")
    rec("synthetic_storyboard_two_flags.gltf", f"storyboard case: centimeter values written into a meters (glTF) file + {k} flipped triangles")
    write_gltf(os.path.join(out, "synthetic_storyboard_fixed.gltf"), character(), 0.01, "sidecar")
    rec("synthetic_storyboard_fixed.gltf", "storyboard case after fix: converted to meters, winding restored")
    # 12/13. FBX
    write_fbx_character(os.path.join(out, "synthetic_clean_character.fbx"), character(), 1.0)
    rec("synthetic_clean_character.fbx", "clean proxy, binary FBX 7.4, UnitScaleFactor 1 (cm), skinned")
    write_fbx_character(os.path.join(out, "synthetic_wrong_unit_scale.fbx"), character(), 100.0)
    rec("synthetic_wrong_unit_scale.fbx", "centimeter values but UnitScaleFactor 100 (file claims meters)")
    for n, w in make_pipeline_out(out):
        rec(n + "/", w)
    with open(os.path.join(out, "FIXTURES.md"), "w") as fh:
        fh.write("# Synthetic test fixtures\n\nGenerated by `python fixtures/make_fixtures.py`. All are programmatic box-figure proxies, not real art.\n\n")
        fh.write("| File | What is deliberately wrong |\n|---|---|\n")
        for n, w in log:
            fh.write(f"| `{n}` | {w} |\n")
        fh.write("\nTextures in `textures/` are solid-colour PNGs. Their pixel dimensions are realistic (1024-2048 px) so texel density can be measured, but the files are a few KB each because a solid colour compresses to almost nothing.\n")
    for n, w in log:
        print(f"{n:42s} {w}")


if __name__ == "__main__":
    main()
