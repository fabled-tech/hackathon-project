"""CLI: python -m fabled_validator check <asset> --profile <profile.json> --out <dir> [--json-only]"""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import __version__
from .html_report import render_html
from .report import exit_code_for, validate

ICON = {"pass": "PASS", "warn": "WARN", "fail": "FAIL", "not_checked": "----"}


def _write(report, out_dir, html=True):
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.basename(report["asset"]["path"] or "no_asset").replace(".", "_")
    jp = os.path.join(out_dir, f"{stem}.report.json")
    with open(jp, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")
    paths = [jp]
    if html:
        hp = os.path.join(out_dir, f"{stem}.report.html")
        with open(hp, "w", encoding="utf-8") as fh:
            fh.write(render_html(report))
        paths.append(hp)
    return paths


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m fabled_validator", description="Fabled pre-import check (v0)")
    ap.add_argument("--version", action="version", version=f"fabled_validator {__version__}")
    sub = ap.add_subparsers(dest="cmd")
    c = sub.add_parser("check", help="check one asset against an import profile")
    c.add_argument("asset", nargs="?", help="asset to check; optional when --manifest is given (then its combined_fbx is used)")
    c.add_argument("--profile", required=True)
    c.add_argument("--manifest", help="pipeline manifest.json (fabled.pipeline.manifest/0.1); adds the 'manifest' check")
    c.add_argument("--out", help="directory for <asset>.report.json and <asset>.report.html")
    c.add_argument("--json-only", action="store_true", help="print the JSON report to stdout (for the UI); writes files only if --out is also given")
    c.add_argument("--no-html", action="store_true", help="with --out, skip the HTML report")
    sub.add_parser("schema", help="print the report JSON schema")
    args = ap.parse_args(argv)

    if args.cmd == "schema":
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(here, "schema", "report.schema.json"), encoding="utf-8") as fh:
            sys.stdout.write(fh.read())
        return 0
    if args.cmd != "check":
        ap.print_help(sys.stderr)
        return 2
    if not args.json_only and not args.out:
        print("error: --out is required unless --json-only is given", file=sys.stderr)
        return 2

    if not args.asset and not args.manifest:
        print("error: give an asset path, or --manifest to check the manifest's combined_fbx", file=sys.stderr)
        return 2
    rep = validate(args.asset, args.profile, manifest_path=args.manifest)
    code = exit_code_for(rep)
    written = []
    if args.out:
        written = _write(rep, args.out, html=not args.no_html)
    if args.json_only:
        json.dump(rep, sys.stdout, indent=2)
        sys.stdout.write("\n")
        for p in written:
            print(f"wrote {p}", file=sys.stderr)
        return code
    if rep["overall_status"] == "error":
        print(f"ERROR ({rep['error']['type']}): {rep['error']['message']}", file=sys.stderr)
    else:
        s = rep["summary"]
        print(f"{rep['asset']['file_name']}  vs  {rep['profile']['name']}" + (f"  (manifest {rep['manifest']['path']})" if rep.get("manifest") else ""))
        for ch in rep["checks"]:
            print(f"  [{ICON[ch['status']]}] {ch['title']}: {ch['message']}")
        print(f"overall: {rep['overall_status'].upper()}  (pass {s['pass']}, warn {s['warn']}, fail {s['fail']}, not checked {s['not_checked']})")
    for p in written:
        print(f"wrote {p}")
    return code
