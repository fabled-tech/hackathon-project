"""Pipeline manifest (`fabled.pipeline.manifest/0.1`) reading and the `manifest` check.

Canonical shape: prototype/ui/INTERFACES.md section 2. Contract rule from the project lead:
every path in the manifest is relative to the manifest's own directory. Field-name variants the
UI reader accepts (tris/tri_count, target_tris/max_triangles, file/fbx/glb/obj, name "LOD0",
top-level "lods") are accepted here too, and unknown extra fields are ignored.
"""
from __future__ import annotations

import json
import os
import re

import numpy as np

from .checks import FAIL, NC, PASS, WARN, result
from .loaders import load_asset
from .model import ValidatorError

SCHEMA_ID = "fabled.pipeline.manifest/0.1"
TEX_SLOTS = {"base_color": "BC", "basecolor": "BC", "BaseColor": "BC", "normal": "N", "Normal": "N", "orm": "ORM", "ORM": "ORM"}
TEX_RE = r"^T_[A-Za-z0-9]+_(BC|N|ORM)\.(png|tga|jpg|jpeg)$"
COMBINED_RE = r"^SM_([A-Za-z0-9]+)\.fbx$"
UNITS_CM = {"mm": 0.1, "millimeters": 0.1, "cm": 1.0, "centimeters": 1.0, "m": 100.0, "meters": 100.0}


class Manifest:
    def __init__(self, path):
        self.path = os.path.abspath(path)
        self.dir = os.path.dirname(self.path)
        self.data = None
        self.error = None
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                self.data = json.load(fh)
            if not isinstance(self.data, dict):
                raise ValueError("top level is not a JSON object")
        except FileNotFoundError:
            self.error = f"Manifest not found: {self.path}"
        except (ValueError, UnicodeDecodeError) as exc:
            self.error = f"Manifest is not valid JSON: {exc}"
            self.data = None

    # --- tolerant field access
    @property
    def ok(self):
        return self.data is not None

    def outputs(self):
        o = self.data.get("outputs")
        return o if isinstance(o, dict) else {}

    def schema(self):
        return self.data.get("schema") if self.ok else None

    def combined_fbx(self):
        if not self.ok:
            return None
        return self.outputs().get("combined_fbx") or self.data.get("combined_fbx")

    def export_up_axis(self):
        """(field path, value) of export_up_axis at top level or under outputs, else (None, None)."""
        if not self.ok:
            return None, None
        if self.data.get("export_up_axis") is not None:
            return "export_up_axis", self.data["export_up_axis"]
        if self.outputs().get("export_up_axis") is not None:
            return "outputs.export_up_axis", self.outputs()["export_up_axis"]
        return None, None

    def resolve(self, p):
        if p is None:
            return None
        p = str(p).replace("\\", "/")
        return os.path.abspath(p if os.path.isabs(p) else os.path.join(self.dir, p))

    def asset_name(self):
        if not self.ok:
            return None
        for k in ("asset", "asset_name"):
            if isinstance(self.data.get(k), str):
                return self.data[k]
        c = self.combined_fbx()
        m = re.match(COMBINED_RE, os.path.basename(c)) if c else None
        return m.group(1) if m else None

    def lods(self):
        raw = self.outputs().get("lods")
        if raw is None:
            raw = self.data.get("lods")
        out = []
        for i, l in enumerate(raw if isinstance(raw, list) else []):
            if not isinstance(l, dict):
                continue
            level = l.get("level")
            if level is None and isinstance(l.get("name"), str):
                m = re.search(r"(\d+)$", l["name"])
                level = int(m.group(1)) if m else None
            if level is None:
                level = i
            path = next((l[k] for k in ("path", "file", "fbx", "glb", "obj") if l.get(k)), None)
            tris = next((l[k] for k in ("triangles", "tris", "tri_count") if l.get(k) is not None), None)
            budget = next((l[k] for k in ("budget_triangles", "target_tris", "max_triangles") if l.get(k) is not None), None)
            out.append({"level": int(level), "name": l.get("name") or f"LOD{level}", "path": path, "triangles": tris,
                        "budget_triangles": budget, "has_uvs": l.get("has_uvs")})
        return out

    def textures(self):
        t = self.outputs().get("textures")
        if t is None:
            t = self.data.get("textures")
        items = []
        if isinstance(t, dict):
            for slot, v in t.items():
                for p in (v if isinstance(v, list) else [v]):
                    if p:
                        items.append((slot, p if isinstance(p, str) else (p.get("path") if isinstance(p, dict) else None)))
        elif isinstance(t, list):
            for v in t:
                if isinstance(v, dict) and v.get("path"):
                    items.append((v.get("slot", "?"), v["path"]))
                elif isinstance(v, dict):  # per-material form: {"material": ..., "base_color": ..., "normal": ..., "orm": ...}
                    for slot, p in v.items():
                        if slot != "material" and isinstance(p, str) and p:
                            items.append((slot, p))
                elif isinstance(v, str):
                    items.append(("?", v))
        return items

    def summary(self):
        return {"path": self.path, "schema": self.schema(), "asset_name": self.asset_name(),
                "combined_fbx": self.resolve(self.combined_fbx()) if self.combined_fbx() else None,
                "lod_count": len(self.lods()) if self.ok else 0, "readable": self.ok, "error": self.error}


def _tris_by_lod(asset):
    d = {}
    for m in asset.meshes:
        d[m.lod] = d.get(m.lod, 0) + int(len(m.tris))
    return d


def _has_uvs(asset):
    return all(m.corner_uvs is not None and not np.isnan(m.corner_uvs).any() for m in asset.meshes)


def _end(text):
    return text if text.endswith((".", "!", "?")) else text + "."


def _axis(v):
    return str(v).strip().upper().lstrip("+")


def _units_cm(v):
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        return UNITS_CM.get(v.strip().lower())
    if isinstance(v, dict):
        for k in ("cm_per_unit", "unit_scale_factor"):
            if isinstance(v.get(k), (int, float)):
                return float(v[k])
        for k in ("unit", "length_unit", "units"):
            if isinstance(v.get(k), str):
                return UNITS_CM.get(v[k].strip().lower())
    return None


def check_manifest(man: Manifest, profile: dict, checked_asset_path, cache: dict):
    """Return one check result dict for the manifest."""
    fails, warns, items = [], [], []
    measured = {"manifest_path": man.path}
    expected = {"schema": SCHEMA_ID, "paths": "relative to the manifest's directory"}

    def load(path):
        if path not in cache:
            try:
                cache[path] = (load_asset(path), None)
            except ValidatorError as exc:
                cache[path] = (None, str(exc))
        return cache[path]

    if not man.ok:
        return result("manifest", FAIL, man.error, measured, expected)
    d = man.data
    sch = d.get("schema")
    measured["schema"] = sch
    if sch != SCHEMA_ID:
        fails.append(f"schema is {sch!r}, expected '{SCHEMA_ID}'")

    def note_abs(label, p):
        if isinstance(p, str) and os.path.isabs(p):
            warns.append(f"{label} is an absolute path ({p}); the contract says paths are relative to the manifest folder")

    # --- pipeline status / steps / warnings / mockup flag
    st = d.get("status")
    if st is not None:
        measured["status"] = st
        if str(st).lower() not in ("ok", "success"):
            warns.append(f"pipeline status is '{st}'")
    steps = d.get("steps") if isinstance(d.get("steps"), list) else []
    failed = [s.get("name", "?") for s in steps if isinstance(s, dict) and str(s.get("status", "")).lower() == "failed"]
    other = [f"{s.get('name', '?')}={s.get('status')}" for s in steps if isinstance(s, dict) and str(s.get("status", "")).lower() in ("manual", "not_implemented")]
    measured["steps"] = {str(s.get("name", "?")): s.get("status") for s in steps if isinstance(s, dict)}
    if failed:
        fails.append(f"pipeline step(s) failed: {', '.join(failed)}")
    if other:
        warns.append(f"steps not automated: {', '.join(other)}")
    pw = [w if isinstance(w, str) else json.dumps(w) for w in (d.get("warnings") or [])] if isinstance(d.get("warnings"), list) else []
    measured["pipeline_warnings"] = pw
    if pw:
        # quoted in full, every one (no length cut, no "first N only")
        warns.append(f"pipeline warnings ({len(pw)}): " + " | ".join(pw))
    if d.get("concept_mockup") is True:
        warns.append("manifest is marked concept_mockup: true")

    # --- combined FBX
    cf = man.combined_fbx()
    combined = None
    comb_tris = {}
    if not cf:
        fails.append("outputs.combined_fbx is missing")
    else:
        note_abs("combined_fbx", cf)
        cp = man.resolve(cf)
        measured["combined_fbx"] = cp
        if not re.match(COMBINED_RE, os.path.basename(cp)):
            warns.append(f"combined FBX name '{os.path.basename(cp)}' does not follow SM_<Asset>.fbx")
        if not os.path.isfile(cp):
            fails.append(f"combined FBX not found: {cf}")
        else:
            combined, err = load(cp)
            if combined is None:
                fails.append(f"combined FBX could not be read: {err}")
            else:
                comb_tris = _tris_by_lod(combined)
                measured["combined_triangles_per_lod"] = {f"LOD{k}": v for k, v in sorted(comb_tris.items())}
                unnamed = [m.name for m in combined.meshes if not re.search(r"(?:^|[_\-. ])LOD\d+$", m.name)]
                if unnamed:
                    warns.append(f"combined FBX mesh(es) without _LOD<n> suffix: {', '.join(unnamed[:3])}")
                if checked_asset_path and os.path.abspath(checked_asset_path) != cp:
                    warns.append(f"validated {os.path.basename(checked_asset_path)}, but the manifest's combined_fbx is {os.path.basename(cp)}")
                # up axis / units vs the FBX (only if the manifest declares them)
                # export_up_axis (top level or under outputs) is the exported FBX's axis and is the one
                # compared; up_axis is then the SOURCE axis (info only). Without export_up_axis, the
                # older contract applies: up_axis is compared with the FBX.
                exp_key, exp_axis = man.export_up_axis()
                if exp_axis is not None:
                    decl = combined.up_axis_declared
                    measured["fbx_up_axis"] = decl
                    measured["export_up_axis"] = exp_axis
                    measured["export_up_axis_field"] = exp_key
                    measured["axis_compared"] = exp_key
                    if d.get("up_axis") is not None:
                        measured["source_up_axis"] = d["up_axis"]
                    if decl is None or _axis(exp_axis) != decl:
                        warns.append(f"manifest {exp_key} '{exp_axis}' vs FBX declares '{decl}'")
                elif d.get("up_axis") is not None:
                    decl = combined.up_axis_declared
                    measured["fbx_up_axis"] = decl
                    measured["axis_compared"] = "up_axis"
                    if decl is None or _axis(d["up_axis"]) != decl:
                        warns.append(f"manifest up_axis '{d['up_axis']}' vs FBX declares '{decl}'")
                if d.get("units") is not None:
                    mu = _units_cm(d["units"])
                    measured["fbx_cm_per_unit"] = combined.cm_per_unit
                    if mu is None or combined.cm_per_unit is None or abs(mu - combined.cm_per_unit) > 1e-6:
                        warns.append(f"manifest units {json.dumps(d['units'])} vs FBX UnitScaleFactor {combined.cm_per_unit}")

    # --- LODs
    lods = man.lods()
    measured["lod_count"] = len(lods)
    if not lods:
        fails.append("manifest lists no LODs (outputs.lods)")
    budgets = profile["lods"].get("triangle_budgets") or []
    for l in lods:
        row = {"lod": l["level"], "path": l["path"], "manifest_triangles": l["triangles"],
               "combined_fbx_triangles": comb_tris.get(l["level"]) if combined else None, "file_triangles": None,
               "budget_triangles": l["budget_triangles"], "profile_budget": budgets[l["level"]] if l["level"] < len(budgets) else None,
               "has_uvs_manifest": l["has_uvs"], "has_uvs_measured": None, "problems": []}
        tag = f"LOD{l['level']}"
        if combined is not None:
            if l["level"] not in comb_tris:
                fails.append(f"{tag} not in combined FBX"); row["problems"].append("missing in combined FBX")
            elif l["triangles"] is not None and int(l["triangles"]) != comb_tris[l["level"]]:
                fails.append(f"{tag} manifest says {int(l['triangles']):,} triangles, combined FBX has {comb_tris[l['level']]:,}")
                row["problems"].append("triangle mismatch vs combined FBX")
        if not l["path"]:
            fails.append(f"{tag} has no path"); row["problems"].append("no path")
        else:
            note_abs(f"{tag} path", l["path"])
            lp = man.resolve(l["path"])
            if not os.path.isfile(lp):
                fails.append(f"{tag} file not found: {l['path']}"); row["problems"].append("file missing")
            else:
                la, err = load(lp)
                if la is None:
                    fails.append(f"{tag} file could not be read: {err}"); row["problems"].append("unreadable")
                else:
                    ft = sum(int(len(m.tris)) for m in la.meshes)
                    row["file_triangles"] = ft
                    row["has_uvs_measured"] = _has_uvs(la)
                    if l["triangles"] is not None and int(l["triangles"]) != ft:
                        fails.append(f"{tag} manifest says {int(l['triangles']):,} triangles, {os.path.basename(lp)} has {ft:,}")
                        row["problems"].append("triangle mismatch vs LOD file")
                    if l["has_uvs"] is not None and bool(l["has_uvs"]) != row["has_uvs_measured"]:
                        warns.append(f"{tag} has_uvs={l['has_uvs']} but measured UVs: {row['has_uvs_measured']}")
                        row["problems"].append("has_uvs mismatch")
        if l["triangles"] is None:
            warns.append(f"{tag} has no triangle count in manifest")
        if l["budget_triangles"] is not None and row["profile_budget"] is not None and int(l["budget_triangles"]) != int(row["profile_budget"]):
            warns.append(f"{tag} manifest budget {int(l['budget_triangles']):,} ≠ profile budget {int(row['profile_budget']):,}")
            row["problems"].append("budget differs from profile")
        items.append(row)
    levels = [l["level"] for l in lods]
    if len(set(levels)) != len(levels):
        fails.append("duplicate LOD levels in manifest")

    # --- textures
    texs = man.textures()
    measured["textures_listed"] = len(texs)
    for slot, p in texs:
        if not p:
            continue
        note_abs(f"texture {slot}", p)
        tp = man.resolve(p)
        name = os.path.basename(tp)
        probs = []
        if not os.path.isfile(tp):
            fails.append(f"texture not found: {p}"); probs.append("file missing")
        if not re.match(TEX_RE, name):
            fails.append(f"texture name '{name}' does not follow T_<Name>_<BC|N|ORM>"); probs.append("bad name")
        elif slot in TEX_SLOTS and not os.path.splitext(name)[0].endswith("_" + TEX_SLOTS[slot]):
            fails.append(f"texture '{name}' listed as {slot} should end with _{TEX_SLOTS[slot]}"); probs.append("suffix/slot mismatch")
        items.append({"texture_slot": slot, "path": p, "exists": os.path.isfile(tp), "problems": probs})

    measured["problems_fail"] = len(fails)
    measured["problems_warn"] = len(warns)
    # additive: each problem as its own string (the message joins all of them; nothing is dropped)
    measured["problems_fail_list"] = fails
    measured["problems_warn_list"] = warns
    if fails:
        msg = _end("; ".join(fails))
        if warns:
            msg += " Also: " + _end("; ".join(warns))
        return result("manifest", FAIL, msg, measured, expected, items)
    if warns:
        return result("manifest", WARN, _end("; ".join(warns)), measured, expected, items)
    lod_txt = ", ".join(f"LOD{r['lod']} {r['file_triangles']:,}" for r in items if "lod" in r and r.get("file_triangles") is not None)
    return result("manifest", PASS, f"{len(lods)} LOD file(s) found and triangle counts match the manifest ({lod_txt}); textures present and named correctly.", measured, expected, items)
