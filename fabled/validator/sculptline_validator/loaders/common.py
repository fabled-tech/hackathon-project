from __future__ import annotations

import os
import re

import numpy as np

from ..images import image_size, image_size_from_path
from ..model import TextureRef

LOD_RE = re.compile(r"(?i)(?:^|[_\-. ])LOD(\d+)$")


def lod_from_name(name: str) -> int:
    m = LOD_RE.search(name or "")
    return int(m.group(1)) if m else 0


def external_texture(slot: str, source_key: str, ref: str, base_dir: str, alt_paths=()) -> TextureRef:
    ref_norm = ref.replace("\\", "/")
    candidates = [ref_norm if os.path.isabs(ref_norm) else os.path.join(base_dir, ref_norm)]
    candidates += [p for p in alt_paths if p]
    chosen = None
    for c in candidates:
        if os.path.isfile(c):
            chosen = c
            break
    path = os.path.abspath(chosen or candidates[0])
    t = TextureRef(slot=slot, source_key=source_key, name=os.path.basename(ref_norm), path=path, exists=chosen is not None)
    if t.exists:
        t.width, t.height, t.image_format = image_size_from_path(path)
        if t.width is None:
            t.note = "image header not recognised (PNG, JPEG and TGA are read in v0)"
    else:
        t.note = "file not found (looked in: " + "; ".join(os.path.abspath(c) for c in candidates) + ")"
    return t


def embedded_texture(slot: str, source_key: str, name: str, data: bytes) -> TextureRef:
    t = TextureRef(slot=slot, source_key=source_key, name=name, embedded=True, exists=data is not None and len(data) > 0)
    if t.exists:
        t.width, t.height, t.image_format = image_size(data)
        if t.width is None:
            t.note = "embedded image header not recognised (PNG, JPEG and TGA are read in v0)"
    else:
        t.note = "embedded image data is empty or unreadable"
    return t


def merge_orm(textures: list) -> list:
    """If Roughness and Metallic point at the same file, treat it as one packed ORM texture."""
    r = [t for t in textures if t.slot == "Roughness"]
    m = [t for t in textures if t.slot == "Metallic"]
    if r and m and r[0].key == m[0].key:
        out = [t for t in textures if t is not r[0] and t is not m[0]]
        merged = r[0]
        merged.slot = "ORM"
        merged.source_key = f"{r[0].source_key}+{m[0].source_key}"
        out.append(merged)
        return out
    return textures


def fan_triangulate(polys):
    """polys: list of lists of corner records. Returns list of 3-tuples of corners."""
    out = []
    for p in polys:
        for i in range(1, len(p) - 1):
            out.append((p[0], p[i], p[i + 1]))
    return out


def as_f64(a):
    return np.ascontiguousarray(np.asarray(a, dtype=np.float64))
