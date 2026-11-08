from __future__ import annotations

import datetime as _dt
import hashlib
import os

from . import __version__, SCHEMA_VERSION
from .checks import run_checks
from .loaders import load_asset
from .model import ValidatorError
from .profile import load_profile

EXIT_OK, EXIT_FLAGS, EXIT_ERROR = 0, 1, 2
# report tool.name; reports written before the SculptLine rebrand say "fabled_validator" (still schema-valid)
TOOL_NAME = "sculptline_validator"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _now():
    utc = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0)
    local = utc.astimezone()
    return utc.isoformat().replace("+00:00", "Z"), local.isoformat(), local.strftime("%Y-%m-%d %H:%M %Z")


def _asset_block(asset_path):
    if not asset_path:
        return {"path": None, "file_name": None, "format": None, "sha256": None, "size_bytes": None,
                "synthetic_fixture": False, "referenced_files": []}
    ap = os.path.abspath(asset_path)
    return {"path": ap, "file_name": os.path.basename(ap), "format": os.path.splitext(ap)[1].lstrip(".").lower() or None,
            "sha256": sha256_file(ap) if os.path.isfile(ap) else None,
            "size_bytes": os.path.getsize(ap) if os.path.isfile(ap) else None,
            "synthetic_fixture": any(part.startswith("synthetic_") for part in ap.split(os.sep)[-2:]), "referenced_files": []}


def _base(asset_path, profile_path):
    utc, local, local_disp = _now()
    prof = {"name": None, "path": os.path.abspath(profile_path) if profile_path else None,
            "sha256": sha256_file(profile_path) if profile_path and os.path.isfile(profile_path) else None}
    return {"schema_version": SCHEMA_VERSION, "tool": {"name": TOOL_NAME, "version": __version__},
            "generated_at": utc, "generated_at_local": local, "generated_at_display": local_disp,
            "asset": _asset_block(asset_path), "profile": prof, "manifest": None}


def _error(rep, kind, message):
    rep.update({"overall_status": "error", "complete": False,
                "summary": {"pass": 0, "warn": 0, "fail": 0, "not_checked": 0, "total": 0, "flagged": 0},
                "checks": [], "asset_stats": None, "notes": [], "error": {"type": kind, "message": message}})
    return rep


def validate(asset_path=None, profile_path=None, manifest_path=None) -> dict:
    """Validate one asset against one import profile and return the report dict.

    asset_path may be None when manifest_path is given: the manifest's outputs.combined_fbx is used.
    Never raises for bad input: unreadable/unsupported assets, invalid profiles, or a manifest with
    no usable asset yield a report with overall_status 'error'. See schema/report.schema.json.
    """
    from .manifest import Manifest, check_manifest

    rep = _base(asset_path, profile_path)
    man = Manifest(manifest_path) if manifest_path else None
    if man is not None:
        rep["manifest"] = man.summary()
    if not profile_path:
        return _error(rep, "profile_error", "No profile given (--profile is required).")
    try:
        profile = load_profile(profile_path)
    except ValidatorError as exc:
        return _error(rep, exc.kind, str(exc))
    rep["profile"]["name"] = profile["profile_name"]
    if not asset_path:
        if man is None:
            return _error(rep, "error", "No asset given. Pass an asset path, or --manifest to use its combined_fbx.")
        cf = man.combined_fbx() if man.ok else None
        if not cf:
            why = man.error or "the manifest has no outputs.combined_fbx"
            return _error(rep, "manifest_error", f"No asset to check: {why}.")
        asset_path = man.resolve(cf)
        rep["asset"] = _asset_block(asset_path)
        if not os.path.isfile(asset_path):
            return _error(rep, "manifest_error", f"No asset to check: the manifest's combined_fbx '{cf}' was not found at {asset_path}.")
    cache = {}
    try:
        asset = load_asset(asset_path)
    except ValidatorError as exc:
        return _error(rep, exc.kind, str(exc))
    cache[os.path.abspath(asset_path)] = (asset, None)
    rep["asset"]["format"] = asset.format
    rep["asset"]["referenced_files"] = asset.referenced_files
    checks, stats = run_checks(asset, profile)
    if man is not None:
        checks.append(check_manifest(man, profile, asset_path, cache))
    summary = {k: sum(1 for c in checks if c["status"] == k) for k in ("pass", "warn", "fail", "not_checked")}
    summary["total"] = len(checks)
    summary["flagged"] = summary["warn"] + summary["fail"]
    overall = "fail" if summary["fail"] else ("warn" if summary["warn"] else "pass")
    rep.update({"overall_status": overall, "complete": summary["not_checked"] == 0, "summary": summary,
                "checks": checks, "asset_stats": stats, "notes": asset.notes, "error": None})
    return rep


def exit_code_for(report: dict) -> int:
    s = report.get("overall_status")
    if s == "error":
        return EXIT_ERROR
    return EXIT_OK if s == "pass" else EXIT_FLAGS
