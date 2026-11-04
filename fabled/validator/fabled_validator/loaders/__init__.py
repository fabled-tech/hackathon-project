"""Format loaders. Each returns a fabled_validator.model.Asset."""
from __future__ import annotations

import os

from ..model import UnsupportedFormatError

SUPPORTED = (".obj", ".gltf", ".glb", ".fbx")


def load_asset(path: str):
    ext = os.path.splitext(path)[1].lower()
    if not os.path.isfile(path):
        from ..model import ParseError

        raise ParseError(f"Asset file not found: {path}")
    if ext == ".obj":
        from .obj import load_obj

        return load_obj(path)
    if ext in (".gltf", ".glb"):
        from .gltf import load_gltf

        return load_gltf(path)
    if ext == ".fbx":
        from .fbx import load_fbx

        return load_fbx(path)
    raise UnsupportedFormatError(
        f"Unsupported file type '{ext or '(none)'}'. v0 reads .obj (+.mtl), .gltf, .glb and binary .fbx."
    )
