"""Load and validate a studio import profile (JSON). See README 'Import profile' for every field."""
from __future__ import annotations

import copy
import json
import re

from .model import ProfileError

UNITS_CM = {"mm": 0.1, "cm": 1.0, "m": 100.0, "in": 2.54, "ft": 30.48}
SLOTS = {"BaseColor", "Normal", "ORM", "Roughness", "Metallic", "Occlusion", "Emissive", "Opacity"}

DEFAULTS = {
    "profile_name": None,
    "asset_type": "character",
    "units": {"assumed_source_units": "cm", "trust_file_units": True, "import_scale": 1.0, "expected_height_cm": {"min": None, "max": None}},
    "axes": {"up": "Y", "min_up_ratio": 0.9},
    "lods": {"triangle_budgets": [], "min_count": 1, "name_pattern": r"(?i)(?:^|[_\-. ])LOD(\d+)$"},
    "materials": {"max_count": None, "required_texture_slots": [], "recommended_texture_slots": []},
    "textures": {"naming_regex": None, "slot_suffixes": {}, "require_power_of_two": True, "max_resolution": None},
    "uv": {"require_uv0": True, "udim": False, "tolerance": 1e-4},
    "texel_density": {"target_px_per_cm": None, "tolerance_pct": 25, "severity": "warn", "reference_slot": "BaseColor"},
    "geometry": {"max_degenerate_triangles": 0, "allow_open_boundaries": True},
    "normals": {"max_flipped_faces": 0},
    "skeleton": {"required": False, "root_bone_name": None, "bone_name_regex": None, "require_all_meshes_skinned": False},
}


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_profile(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except FileNotFoundError as exc:
        raise ProfileError(f"Profile not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ProfileError(f"Profile is not valid JSON: {exc}") from exc
    return normalize_profile(raw)


def normalize_profile(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ProfileError("Profile must be a JSON object")
    p = _merge(DEFAULTS, {k: v for k, v in raw.items() if not k.startswith("_")})
    errs = []
    if not p.get("profile_name"):
        errs.append("profile_name is required")
    u = p["units"]
    if u["assumed_source_units"] not in UNITS_CM:
        errs.append(f"units.assumed_source_units must be one of {sorted(UNITS_CM)}")
    sc = u.get("import_scale", 1.0)
    if isinstance(sc, bool) or not isinstance(sc, (int, float)) or sc <= 0:
        errs.append("units.import_scale must be a positive number")
    h = u["expected_height_cm"]
    if h.get("min") is not None and h.get("max") is not None and h["min"] > h["max"]:
        errs.append("units.expected_height_cm.min > max")
    up = str(p["axes"]["up"]).upper()
    if up not in ("X", "Y", "Z"):
        errs.append("axes.up must be X, Y or Z")
    p["axes"]["up"] = up
    b = p["lods"]["triangle_budgets"]
    if not isinstance(b, list) or not all(isinstance(x, int) and x > 0 for x in b):
        errs.append("lods.triangle_budgets must be a list of positive integers (LOD0..LODn)")
    for s in list(p["materials"]["required_texture_slots"]) + list(p["materials"].get("recommended_texture_slots") or []):
        if s not in SLOTS:
            errs.append(f"materials.required_texture_slots: unknown slot '{s}' (known: {sorted(SLOTS)})")
    for key, rx in (("textures.naming_regex", p["textures"]["naming_regex"]),
                    ("skeleton.bone_name_regex", p["skeleton"]["bone_name_regex"]),
                    ("lods.name_pattern", p["lods"]["name_pattern"])):
        if rx:
            try:
                re.compile(rx)
            except re.error as exc:
                errs.append(f"{key} is not a valid regex: {exc}")
    if p["texel_density"]["severity"] not in ("warn", "fail"):
        errs.append("texel_density.severity must be 'warn' or 'fail'")
    if errs:
        raise ProfileError("Invalid profile: " + "; ".join(errs))
    return p
