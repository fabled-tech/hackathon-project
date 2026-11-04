"""Minimal pure-Python reader for the *binary* FBX container (versions 7100-7700).

It returns the raw node tree only; fbx.py interprets geometry, materials and bones.
Format reference: the public description of the binary FBX layout used by Blender's
io_scene_fbx and other open-source readers. No Autodesk SDK involved.
"""
from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field

import numpy as np

from ..model import ParseError, UnsupportedFormatError

MAGIC = b"Kaydara FBX Binary  \x00"
_ARR = {b"f": np.float32, b"d": np.float64, b"l": np.int64, b"i": np.int32, b"b": np.bool_}


@dataclass
class FbxNode:
    name: str
    props: list
    children: list = field(default_factory=list)

    def find(self, name):
        for c in self.children:
            if c.name == name:
                return c
        return None

    def find_all(self, name):
        return [c for c in self.children if c.name == name]


def _read_prop(data, off):
    t = data[off : off + 1]
    off += 1
    if t == b"Y":
        return struct.unpack_from("<h", data, off)[0], off + 2
    if t == b"C":
        return bool(data[off]), off + 1
    if t == b"I":
        return struct.unpack_from("<i", data, off)[0], off + 4
    if t == b"F":
        return struct.unpack_from("<f", data, off)[0], off + 4
    if t == b"D":
        return struct.unpack_from("<d", data, off)[0], off + 8
    if t == b"L":
        return struct.unpack_from("<q", data, off)[0], off + 8
    if t in (b"S", b"R"):
        n = struct.unpack_from("<I", data, off)[0]
        raw = bytes(data[off + 4 : off + 4 + n])
        return (raw.decode("utf-8", "replace") if t == b"S" else raw), off + 4 + n
    if t in _ARR:
        n, enc, clen = struct.unpack_from("<III", data, off)
        off += 12
        raw = data[off : off + clen]
        if enc == 1:
            raw = zlib.decompress(raw)
        arr = np.frombuffer(raw, dtype=np.dtype(_ARR[t]).newbyteorder("<") if t != b"b" else np.bool_, count=n)
        return arr, off + clen
    raise ParseError(f"FBX: unknown property type {t!r} at byte {off - 1}")


def _read_node(data, off, wide):
    if wide:
        end, nprops, _plen = struct.unpack_from("<QQQ", data, off)
        off += 24
    else:
        end, nprops, _plen = struct.unpack_from("<III", data, off)
        off += 12
    nlen = data[off]
    off += 1
    if end == 0:
        return None, off
    name = bytes(data[off : off + nlen]).decode("ascii", "replace")
    off += nlen
    props = []
    for _ in range(nprops):
        v, off = _read_prop(data, off)
        props.append(v)
    node = FbxNode(name, props)
    while off < end:
        child, off = _read_node(data, off, wide)
        if child is None:
            break
        node.children.append(child)
    return node, end


def parse_fbx_bytes(data: bytes):
    if not data.startswith(MAGIC):
        head = data[:200].lstrip()
        if head.startswith(b";") or b"FBXHeaderExtension" in data[:2000]:
            raise UnsupportedFormatError(
                "This is an ASCII FBX. v0 reads binary FBX only (FBX 7.x binary, the default for Maya, Max and Blender exports). "
                "Re-export as binary FBX, or as glTF/GLB.")
        raise ParseError("not an FBX file (missing 'Kaydara FBX Binary' header)")
    version = struct.unpack_from("<I", data, 23)[0]
    if version < 7100:
        raise UnsupportedFormatError(f"FBX version {version} is older than 7.1; v0 reads FBX 7.1-7.7 binary only")
    wide = version >= 7500
    off = 27
    top = []
    try:
        while off < len(data):
            node, off = _read_node(data, off, wide)
            if node is None:
                break
            top.append(node)
    except (struct.error, IndexError, zlib.error, ValueError) as exc:
        raise ParseError(f"FBX binary structure could not be read: {exc}") from exc
    return version, FbxNode("__root__", [], top)
