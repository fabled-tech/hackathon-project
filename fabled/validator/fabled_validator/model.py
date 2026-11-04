"""In-memory representation of a parsed asset, shared by every loader and check."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np


class ValidatorError(Exception):
    """Base error. The CLI maps these to exit code 2."""

    kind = "error"


class UnsupportedFormatError(ValidatorError):
    kind = "unsupported_format"


class ParseError(ValidatorError):
    kind = "parse_error"


class ProfileError(ValidatorError):
    kind = "profile_error"


@dataclass
class TextureRef:
    slot: str  # canonical slot: BaseColor, Normal, ORM, Roughness, Metallic, Occlusion, Emissive, Other
    source_key: str  # how the file referenced it, e.g. "map_Kd", "baseColorTexture", "DiffuseColor"
    name: str  # file basename (or image name for embedded images)
    path: Optional[str] = None  # resolved absolute path for external files
    embedded: bool = False
    exists: bool = False
    width: Optional[int] = None
    height: Optional[int] = None
    image_format: Optional[str] = None
    note: Optional[str] = None
    # evidence filled in by checks.classify_textures
    linked_via: list = field(default_factory=list)  # material properties / glTF keys / MTL keywords this file is linked through
    property_slot: Optional[str] = None  # slot implied by those links alone
    slot_rule: Optional[str] = None  # why `slot` was chosen
    slot_conflict: Optional[str] = None  # name suffix and property link disagree

    @property
    def key(self) -> str:
        return self.path or ("embedded:" + self.name)


@dataclass
class Material:
    name: str
    textures: list = field(default_factory=list)  # list[TextureRef]
    note: Optional[str] = None


@dataclass
class Mesh:
    name: str
    positions: np.ndarray  # (V,3) float64, world space, file units
    tris: np.ndarray  # (F,3) int64 indices into positions
    face_material: np.ndarray  # (F,) int64 index into Asset.materials, -1 = none
    corner_normals: Optional[np.ndarray] = None  # (F,3,3) or None
    corner_uvs: Optional[np.ndarray] = None  # (F,3,2) UV0, bottom-left origin, or None
    uv_missing_faces: int = 0  # faces that have no UV0 even though others do
    lod: int = 0
    skinned: bool = False  # carries skin weights / is deformed by a skin
    skin_index: Optional[int] = None  # which Asset.skins entry it is bound to (None = unbound)


@dataclass
class Skin:
    name: str
    joints: list  # bone names


@dataclass
class Asset:
    path: str
    format: str  # obj | gltf | glb | fbx
    meshes: list = field(default_factory=list)
    materials: list = field(default_factory=list)
    skins: list = field(default_factory=list)
    bone_parents: Optional[dict] = None  # bone name -> parent bone name (None for roots); None = format has no skeleton
    cm_per_unit: Optional[float] = None  # from file metadata; None = file declares no units
    unit_source: str = ""
    up_axis_declared: Optional[str] = None  # e.g. "Y" or "-Z"; None = not declared
    up_axis_source: str = ""
    referenced_files: list = field(default_factory=list)  # [{"path","role","exists"}]
    notes: list = field(default_factory=list)
