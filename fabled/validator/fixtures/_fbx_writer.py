"""Tiny binary FBX 7.4 writer used ONLY to generate synthetic test fixtures.

It writes the node/property container described publicly (same layout Blender's exporter writes).
The tests cross-read its output with Assimp (assimp_py) when installed, so the validator's FBX
reader is not only checked against this writer.
"""
import struct

import numpy as np

HEADER = b"Kaydara FBX Binary  \x00\x1a\x00"
FOOT_ID = bytes.fromhex("fabcab09d0c8d466b176fb831cf7267e")
FOOT_MAGIC = bytes.fromhex("f85a8c6adef5d97eece90ce3758f290b")


class N:
    def __init__(self, name, *props, children=None):
        self.name = name
        self.props = list(props)
        self.children = children or []

    def add(self, *kids):
        self.children.extend(kids)
        return self


class Arr:
    def __init__(self, code, values):
        self.code = code
        self.values = values


def I(v): return ("I", int(v))
def L(v): return ("L", int(v))
def D(v): return ("D", float(v))
def S(v): return ("S", v)
def C(v): return ("C", bool(v))


def _prop(p):
    if isinstance(p, Arr):
        dt = {"d": "<f8", "i": "<i4", "l": "<i8", "f": "<f4"}[p.code]
        raw = np.asarray(p.values, dtype=dt).tobytes()
        return p.code.encode() + struct.pack("<III", len(p.values), 0, len(raw)) + raw
    code, v = p
    if code == "I": return b"I" + struct.pack("<i", v)
    if code == "L": return b"L" + struct.pack("<q", v)
    if code == "D": return b"D" + struct.pack("<d", v)
    if code == "C": return b"C" + bytes([1 if v else 0])
    if code == "S":
        b = v.encode("utf-8")
        return b"S" + struct.pack("<I", len(b)) + b
    raise ValueError(code)


def _node(n, start):
    props = b"".join(_prop(p) for p in n.props)
    name = n.name.encode()
    pos = start + 13 + len(name) + len(props)
    kids = b""
    for c in n.children:
        cb = _node(c, pos)
        kids += cb
        pos += len(cb)
    if n.children or not n.props:
        kids += b"\x00" * 13
        pos += 13
    return struct.pack("<IIIB", pos, len(n.props), len(props), len(name)) + name + props + kids


def P(name, typ, label, flags, *vals):
    return N("P", S(name), S(typ), S(label), S(flags), *vals)


def write_fbx(path, top_nodes, version=7400):
    out = HEADER + struct.pack("<I", version)
    for n in top_nodes:
        out += _node(n, len(out))
    out += b"\x00" * 13
    out += FOOT_ID
    pad = ((len(out) + 15) & ~15) - len(out)
    out += b"\x00" * (pad or 16)
    out += b"\x00" * 4 + struct.pack("<I", version) + b"\x00" * 120 + FOOT_MAGIC
    with open(path, "wb") as fh:
        fh.write(out)
