#!/usr/bin/env python3
"""Run the CLI on every synthetic fixture, write reports/ and reports/SUMMARY.md,
and (if a headless Chrome/Chromium is on PATH) 1920x1080 PNGs of the storyboard pair."""
import glob
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "reports")
PROFILE = os.path.join(ROOT, "profiles", "example_studio.json")


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for path in sorted(glob.glob(os.path.join(ROOT, "fixtures", "synthetic_*.*"))):
        if path.rsplit(".", 1)[-1] not in ("obj", "gltf", "glb", "fbx"):
            continue
        p = subprocess.run([sys.executable, "-m", "fabled_validator", "check", path, "--profile", PROFILE, "--out", OUT],
                           cwd=ROOT, capture_output=True, text=True)
        stem = os.path.basename(path).replace(".", "_")
        rep = json.load(open(os.path.join(OUT, f"{stem}.report.json")))
        fl = [f"{c['id']} ({c['status']})" for c in rep["checks"] if c["status"] in ("warn", "fail")]
        nc = [c["id"] for c in rep["checks"] if c["status"] == "not_checked"]
        rows.append((os.path.basename(path), rep["overall_status"], p.returncode, fl, nc))
        print(p.stdout.strip())
    demo = os.path.join(ROOT, "profiles", "demo_placeholder.json")
    for mdir in sorted(glob.glob(os.path.join(ROOT, "fixtures", "synthetic_pipeline_out*"))):
        sub = os.path.join(OUT, os.path.basename(mdir))
        p = subprocess.run([sys.executable, "-m", "fabled_validator", "check", "--manifest", os.path.join(mdir, "manifest.json"),
                            "--profile", demo, "--out", sub], cwd=ROOT, capture_output=True, text=True)
        rep = json.load(open(glob.glob(os.path.join(sub, "*.report.json"))[0]))
        fl = [f"{c['id']} ({c['status']})" for c in rep["checks"] if c["status"] in ("warn", "fail")]
        nc = [c["id"] for c in rep["checks"] if c["status"] == "not_checked"]
        rows.append((os.path.basename(mdir) + "/manifest.json (demo profile)", rep["overall_status"], p.returncode, fl, nc))
        print(p.stdout.strip())
    with open(os.path.join(OUT, "SUMMARY.md"), "w") as fh:
        fh.write("# Fixture run summary (real output of run_fixtures.py)\n\n| Fixture | Overall | Exit | Flagged checks | Not checked |\n|---|---|---|---|---|\n")
        for n, s, code, fl, nc in rows:
            fh.write(f"| `{n}` | {s} | {code} | {', '.join(fl) or '-'} | {', '.join(nc) or '-'} |\n")
    chrome = next((shutil.which(b) for b in ("google-chrome", "chromium", "chromium-browser") if shutil.which(b)), None)
    if chrome:
        for stem in ("synthetic_storyboard_two_flags_gltf", "synthetic_storyboard_fixed_gltf"):
            html = os.path.join(OUT, f"{stem}.report.html")
            png = os.path.join(OUT, f"{stem}.report_1920x1080.png")
            subprocess.run([chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                            "--window-size=1920,1080", f"--screenshot={png}", "file://" + html], capture_output=True, timeout=120)
            print("screenshot:", png if os.path.exists(png) else "FAILED")
    else:
        print("no headless chrome/chromium found; skipped screenshots")


if __name__ == "__main__":
    main()
