#!/usr/bin/env python3
"""Fabled mesh pipeline CLI: wraps headless Blender (blender -b) step scripts.

    python3 prototype/pipeline/fabled_pipeline.py --input <mesh> --out <dir> [--config cfg.json]

Steps: 01 import+measure, 02 retopo (QuadriFlow -> fallbacks), 03 UVs, 04 LOD chain,
05 normal bake (Cycles CPU), 06 FBX export (+ re-import verification), 07 previews.
Writes <out>/report.json (full metrics) and <out>/manifest.json (for the demo UI).
"""
import argparse, json, os, shutil, subprocess, sys, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PROTOTYPE_ROOT = os.path.dirname(HERE)
SCRIPTS = os.path.join(HERE, "scripts")
VALIDATOR_VENV_PY = os.path.join(PROTOTYPE_ROOT, "validator", ".venv", "bin", "python")


def is_valid_blender_bin(p: str) -> bool:
    return bool(p and os.path.isfile(p) and os.path.getsize(p) > 0 and os.access(p, os.X_OK))


def find_default_blender():
    if os.environ.get("FABLED_BLENDER"):
        return os.environ["FABLED_BLENDER"]
    for cand in (
        shutil.which("blender"),
        shutil.which("Blender"),
        "/Applications/Blender.app/Contents/MacOS/Blender",
        os.path.expanduser("~/Applications/Blender.app/Contents/MacOS/Blender"),
        os.path.expanduser("~/blender/blender-4.5.15-linux-x64/blender"),
    ):
        if cand and is_valid_blender_bin(cand):
            return cand
    return os.path.expanduser("~/blender/blender-4.5.15-linux-x64/blender")


DEFAULT_BLENDER = find_default_blender()


def mem_available_mb():
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) // 1024
    except FileNotFoundError:
        pass
    return 10 ** 9


def rss_mb(pid):
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024
    except FileNotFoundError:
        try:
            out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
            if out:
                return int(out.split()[0]) // 1024
        except Exception:
            pass
    return 0


class Runner:
    def __init__(self, blender, cfg_path, cfg, out, inp=None, progress_cb=None):
        self.blender, self.cfg_path, self.cfg, self.out = blender, cfg_path, cfg, out
        self.inp = inp
        self.progress_cb = progress_cb
        self.logs = os.path.join(out, "logs"); os.makedirs(self.logs, exist_ok=True)
        self.runs = []
        self.fell_back_to_native = False
        self.native_state = None

    def blender_step(self, label, script, extra=(), timeout=None):
        cmd = [self.blender, "-b", "--factory-startup", "-noaudio", "--python-exit-code", "3",
               "--python", os.path.join(SCRIPTS, script), "--",
               "--config", self.cfg_path, "--out", self.out, *extra]
        log_path = os.path.join(self.logs, f"{label}.log")
        lim = self.cfg["limits"]
        ps_log = os.path.join(self.logs, "ps_checks.log")
        if not wait_for_other_blender(ps_log, label):
            rec = {"label": label, "script": script, "returncode": None, "wall_s": 0, "peak_rss_mb": 0,
                   "killed": "not started: another Blender process kept running for 45 min", "log": log_path}
            self.runs.append(rec); return rec
        t0 = time.monotonic(); peak = 0; killed = None
        try:
            with open(log_path, "w") as log:
                log.write("$ " + " ".join(cmd) + "\n"); log.flush()
                p = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
                while p.poll() is None:
                    r = rss_mb(p.pid); peak = max(peak, r)
                    if r > lim["max_rss_mb"]:
                        killed = f"RSS {r} MB > limit {lim['max_rss_mb']} MB"
                    elif mem_available_mb() < lim["min_mem_available_mb"]:
                        killed = f"system MemAvailable < {lim['min_mem_available_mb']} MB (blender RSS {r} MB)"
                    elif timeout and time.monotonic() - t0 > timeout:
                        killed = f"timeout after {timeout}s"
                    if killed:
                        p.kill(); p.wait(); break
                    time.sleep(0.25)
            wall = round(time.monotonic() - t0, 2)
            with open(ps_log, "a") as f:
                f.write(datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z") + f" [{label}] own Blender pid {p.pid} exited rc={p.returncode}\n")
            rec = {"label": label, "script": script, "returncode": p.returncode, "wall_s": wall,
                   "peak_rss_mb": peak, "killed": killed, "log": log_path}
            self.runs.append(rec)
            status = "OK" if p.returncode == 0 and not killed else f"FAIL rc={p.returncode} {killed or ''}"
            print(f"  [{label}] {status}  wall={wall}s  peakRSS={peak}MB", flush=True)
            return rec
        except OSError as e:
            print(f"[fabled_pipeline] WARNING: Failed to execute Blender binary ({e}). Falling back to native engine.", flush=True)
            wall = round(time.monotonic() - t0, 2)
            rec = {"label": label, "script": script, "returncode": -1, "wall_s": wall,
                   "peak_rss_mb": 0, "killed": f"spawn failed: {e}", "log": log_path, "fallback_native": True}
            self.runs.append(rec)
            if self.inp and self.progress_cb and not self.fell_back_to_native:
                self.fell_back_to_native = True
                try:
                    sys.path.insert(0, HERE)
                    from native_pipeline import run_native_pipeline
                    self.native_state = run_native_pipeline(inp=self.inp, out=self.out, cfg=self.cfg, progress_cb=self.progress_cb)
                    rec["returncode"] = 0
                    rec["killed"] = None
                except Exception as ne:
                    print(f"[fabled_pipeline] ERROR: Native pipeline fallback failed ({ne})", flush=True)
            return rec


def wait_for_other_blender(log_path, label, max_wait_s=2700, poll_s=15):
    """RAM safety on the shared box: before EVERY Blender launch, check for other Blender processes,
    wait while any run, never kill them. Each check is appended to logs/ps_checks.log."""
    t0 = time.monotonic()
    pgrep_cmd = ["pgrep", "-fl", "[Bb]lender"] if sys.platform == "darwin" else ["pgrep", "-ax", "blender"]
    while True:
        raw_r = subprocess.run(pgrep_cmd, capture_output=True, text=True).stdout.strip()
        lines = [
            l for l in raw_r.splitlines()
            if not any(ign in l for ign in ("blender-mcp", "fabled_pipeline", "pytest", "test_pipeline"))
            and any(b in l for b in ("/blender", "Blender.app", " blender"))
        ]
        r = "\n".join(lines).strip()
        ts = datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
        with open(log_path, "a") as f:
            if not r:
                f.write(f"{ts} [{label}] {' '.join(pgrep_cmd)}: none -> OK to start\n"); return True
            f.write(f"{ts} [{label}] BUSY: {' ; '.join(l[:160] for l in r.splitlines())} -> waiting\n")
        if time.monotonic() - t0 > max_wait_s:
            with open(log_path, "a") as f: f.write(f"{ts} [{label}] TIMEOUT after {max_wait_s}s\n")
            return False
        time.sleep(poll_s)


PS_LOG = None


def blender_version(blender):
    if (
        not blender
        or str(blender).strip().lower() in ("none", "native", "false", "off", "0", "stub")
        or not is_valid_blender_bin(blender)
    ):
        return "native-numpy-engine-0.1"
    if PS_LOG and not wait_for_other_blender(PS_LOG, "blender --version"):
        return "unknown (other Blender busy)"
    try:
        out = subprocess.run([blender, "-b", "--factory-startup", "--version"], capture_output=True, text=True, timeout=60).stdout
        return out.strip().splitlines()[0] if out else "native-numpy-engine-0.1"
    except Exception:
        return "native-numpy-engine-0.1"


def system_python():
    """Locate Python interpreter with Pillow/PIL installed for post-processing scripts."""
    try:
        import PIL  # noqa: F401
        return sys.executable
    except ImportError:
        for cand in [shutil.which("python3"), "/usr/bin/python3"]:
            if cand and cand != sys.executable:
                try:
                    if subprocess.run([cand, "-c", "import PIL"], capture_output=True).returncode == 0:
                        return cand
                except Exception:
                    pass
        return sys.executable


PLAN = [  # (index, step key, progress name, label)
    (1, "01", "import_measure", "Import + measure sculpt"),
    (2, "02", "retopology", "Retopology (QuadriFlow, fallbacks)"),
    (3, "03", "uv_unwrap", "UV unwrap + pack"),
    (4, "04", "lod_generation", "LOD chain from tri budgets"),
    (5, "05", "texture_bake", "Bake normal (+AO) maps, Cycles CPU"),
    (6, "06", "fbx_export", "FBX/GLB export + re-import check"),
    (7, "07", "previews", "Preview renders"),
    (8, "08", "preview_composites", "Labelled preview composites"),
]


def sanitize_asset_name(name):
    """Unreal-safe asset name: letters/digits only, CamelCased from separators, must start with a letter."""
    import re
    parts = [p for p in re.split(r"[^A-Za-z0-9]+", name) if p]
    n = "".join(p[:1].upper() + p[1:] for p in parts) or "Asset"
    return n if n[0].isalpha() else "A" + n


def freeze_run(out, ts, in_place=False):
    """Copy a successful run to runs/<ts>/ (skip multi-GB intermediate .blend files) and point runs/latest at it.
    Never deletes earlier runs."""
    runs_dir = os.path.join(HERE, "runs"); os.makedirs(runs_dir, exist_ok=True)
    dst = out if in_place else os.path.join(runs_dir, ts)
    if in_place:  # drop the multi-GB intermediate .blend files from the frozen run (JSON/logs are kept)
        for f in os.listdir(os.path.join(out, "work")):
            if f.endswith((".blend", ".blend1")):
                os.remove(os.path.join(out, "work", f))
    else:
        n = 1
        while os.path.exists(dst):
            dst = os.path.join(runs_dir, f"{ts}-{n}"); n += 1
        shutil.copytree(out, dst, ignore=shutil.ignore_patterns("*.blend", "*.blend1", "progress.json.tmp"))
        mp = os.path.join(dst, "manifest.json"); m = json.load(open(mp))
        if m.get("input", {}).get("sculpt_path_abs"):
            m["input"]["sculpt_path"] = os.path.relpath(m["input"]["sculpt_path_abs"], dst)
        m["frozen_from"] = out
        json.dump(m, open(mp, "w"), indent=2)
    link = os.path.join(runs_dir, "latest")
    tmp = link + ".tmp"
    if os.path.lexists(tmp): os.remove(tmp)
    os.symlink(os.path.basename(dst), tmp); os.replace(tmp, link)
    with open(os.path.join(runs_dir, "latest.txt"), "w") as f:
        f.write(dst + "\n")
    return dst


def normalize_config(cfg):
    """Accept UI-generated configs: variable LOD count, optional screen_size, fabled_profile."""
    lods = cfg.get("lods") or []
    if not lods:
        raise SystemExit("config.lods is empty: need at least one LOD budget")
    default_ss = [1.0, 0.5, 0.25, 0.125]
    norm = []
    for i, l in enumerate(lods):
        tgt = l.get("target_tris") or l.get("max_triangles") or l.get("budget_triangles")
        if not tgt:
            raise SystemExit(f"config.lods[{i}] has no target_tris")
        ss = l.get("screen_size")
        if ss is None:
            ss = default_ss[i] if i < len(default_ss) else round(default_ss[-1] / 2 ** (i - 3), 5)
        norm.append({**l, "name": l.get("name") or f"LOD{i}", "target_tris": int(tgt), "screen_size": float(ss)})
    cfg["lods"] = norm
    return cfg


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, help="high-poly mesh (.obj/.ply/.stl/.fbx/.glb)")
    ap.add_argument("--out", default=None, help="output folder (default: runs/<YYYYmmdd-HHMMSS>, frozen automatically)")
    ap.add_argument("--asset-name", default=None, help="asset name used for SM_/T_/M_ names (default: config asset_name, else the input file stem)")
    ap.add_argument("--freeze", action="store_true", help="on success, copy <out> to runs/<timestamp>/ and update runs/latest (automatic when --out is omitted)")
    ap.add_argument("--config", default=os.path.join(HERE, "config", "default.json"))
    ap.add_argument("--validator-profile", default=None, help="validator profile JSON; copied to <out>/validator_profile.json and referenced in the manifest")
    ap.add_argument("--source-meta", default=None, help="JSON with name/url/license/attribution (default: SOURCE.json next to the input, or pipeline/input/SOURCE.json if its 'file' matches)")
    ap.add_argument("--blender", default=DEFAULT_BLENDER)
    ap.add_argument("--steps", default="01,02,03,04,05,06,07,08", help="comma list of steps to run (dev use)")
    a = ap.parse_args()

    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    runs_dir = os.path.join(HERE, "runs")
    if a.out is None:
        out = os.path.join(runs_dir, ts); a.freeze = "in_place"
    else:
        out = os.path.abspath(a.out)
    os.makedirs(os.path.join(out, "work"), exist_ok=True)
    with open(os.path.abspath(a.config)) as f:
        cfg = normalize_config(json.load(f))
    cfg["asset_name"] = sanitize_asset_name(a.asset_name or cfg.get("asset_name") or os.path.splitext(os.path.basename(a.input))[0])
    cfg_path = os.path.join(out, "config_used.json")
    json.dump(cfg, open(cfg_path, "w"), indent=2)
    if a.validator_profile:
        shutil.copy(a.validator_profile, os.path.join(out, "validator_profile.json"))
    src_meta = a.source_meta or next((c for c in (os.path.join(os.path.dirname(os.path.abspath(a.input)), "SOURCE.json"),
                                                  os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(a.input))), "SOURCE.json"),
                                                  os.path.join(HERE, "input", "SOURCE.json")) if os.path.exists(c)), None)
    if src_meta:
        try:
            sm = json.load(open(src_meta))
            if a.source_meta or sm.get("file") in (None, os.path.basename(a.input)):
                shutil.copy(src_meta, os.path.join(out, "SOURCE.json"))
        except Exception:
            pass
    inp = os.path.abspath(a.input)
    R = Runner(a.blender, cfg_path, cfg, out)
    global PS_LOG
    PS_LOG = os.path.join(out, "logs", "ps_checks.log")
    steps = a.steps.split(",")
    total = len(PLAN)
    state_path = os.path.join(out, "work", "driver_state.json")
    state = {"step_runs": {}}
    if os.path.exists(state_path):
        try:
            with open(state_path) as f:
                state = json.load(f)
        except Exception:
            state = {"step_runs": {}}
    if not isinstance(state, dict):
        state = {"step_runs": {}}
    state.setdefault("step_runs", {})
    state["validator_profile"] = bool(a.validator_profile)
    state.pop("failed_step", None); state.pop("error", None)   # a resumed run must not inherit an old failure
    print(f"Fabled pipeline | blender={a.blender}\n input={inp}\n out={out}", flush=True)

    def progress(idx, name, label, status, done=False):
        tmp = os.path.join(out, "progress.json.tmp")
        json.dump({"step": idx, "total": total, "name": name, "label": label, "done": done, "status": status,
                   "updated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds")}, open(tmp, "w"), indent=2)
        os.replace(tmp, os.path.join(out, "progress.json"))

    R.inp = inp
    R.progress_cb = progress

    def run(step, label, script, extra=(), timeout=None):
        rec = R.blender_step(label, script, extra, timeout)
        state["step_runs"].setdefault(step, [])
        state["step_runs"][step] = [r for r in state["step_runs"][step] if r["label"] != label] + [rec]
        json.dump(state, open(state_path, "w"), indent=2)
        return rec["returncode"] == 0 and not rec["killed"]

    def fail(idx, name, label, msg):
        print("PIPELINE STOPPED:", msg, flush=True)
        state["failed_step"] = name; state["error"] = msg
        json.dump(state, open(state_path, "w"), indent=2)
        progress(idx, name, label, "failed", done=True)
        finalize(a, cfg, out, inp, state, failed=msg)
        sys.exit(1)

    if not os.path.exists(inp):
        fail(1, "import_measure", PLAN[0][3], f"input not found: {inp}")
    is_explicit_native = (
        not a.blender
        or str(a.blender).strip().lower() in ("none", "native", "false", "off", "0", "stub")
    )
    blender_invalid = False
    if not is_explicit_native and a.blender:
        if not os.path.exists(a.blender):
            pass
        elif not is_valid_blender_bin(a.blender):
            print(f"[fabled_pipeline] WARNING: Blender binary '{a.blender}' is invalid, 0-byte, or not executable. Falling back to native engine.", flush=True)
            blender_invalid = True
    use_native = is_explicit_native or not os.path.exists(a.blender) or blender_invalid
    if use_native:
        try:
            import numpy  # noqa: F401
        except ImportError:
            if os.path.exists(VALIDATOR_VENV_PY) and os.path.abspath(sys.executable) != os.path.abspath(VALIDATOR_VENV_PY):
                os.execv(VALIDATOR_VENV_PY, [VALIDATOR_VENV_PY, __file__, *sys.argv[1:]])
        if is_explicit_native:
            print(f"Native engine requested (--blender {a.blender}); running Fabled native Python+NumPy mesh pipeline engine.", flush=True)
        elif not os.path.exists(a.blender):
            print(f"Blender binary not found at {a.blender}; running Fabled native Python+NumPy mesh pipeline engine.", flush=True)
        else:
            print(f"Blender binary invalid at {a.blender}; running Fabled native Python+NumPy mesh pipeline engine.", flush=True)
        sys.path.insert(0, HERE)
        from native_pipeline import run_native_pipeline
        try:
            state = run_native_pipeline(inp=inp, out=out, cfg=cfg, progress_cb=progress)
        except Exception as e:
            import traceback; traceback.print_exc()
            fail(1, "native_pipeline", "Native pipeline engine", str(e))
    else:
        for idx, key, name, label in PLAN:
            if R.fell_back_to_native:
                break
            if key not in steps:
                continue
            progress(idx, name, label, "running")
            print(f"Step {idx}/{total} {label}", flush=True)
            ok = True
            if key == "01":
                ok = run(key, "01_import", "01_import.py", ["--input", inp])
            elif key == "02":
                state["step_runs"]["02"] = []
                ok = run(key, "02_prep", "02_retopo.py", ["--stage", "prep"])
                chosen, tried = None, []
                if ok:
                    for method in cfg["retopo"]["method_order"]:
                        to = cfg["retopo"]["quadriflow_timeout_s"] if "quadriflow" in method else None
                        ran = run(key, f"02_{method}", "02_retopo.py", ["--stage", method], timeout=to)
                        sj = os.path.join(out, "work", f"step02_{method}.json")
                        res = json.load(open(sj)) if (ran and os.path.exists(sj)) else {}
                        tried.append({"method": method, "success": bool(res.get("success")),
                                      "error": res.get("error") or (None if ran else (R.runs[-1]["killed"] or f"exit {R.runs[-1]['returncode']}"))})
                        if res.get("success"):
                            chosen = method; break
                state["retopo_method_used"] = chosen; state["retopo_attempts"] = tried
                ok = ok and bool(chosen)
            elif key == "08":
                log = os.path.join(out, "logs", "08_preview_composites.log")
                t0 = time.monotonic()
                with open(log, "w") as lf:
                    rc = subprocess.run([system_python(), os.path.join(SCRIPTS, "post_previews.py"), "--out", out], stdout=lf, stderr=subprocess.STDOUT).returncode
                state["step_runs"]["08"] = [{"label": "08_preview_composites", "returncode": rc, "wall_s": round(time.monotonic() - t0, 2),
                                             "peak_rss_mb": None, "killed": None, "log": log}]
                ok = rc == 0
            else:
                script = {"03": "03_uv.py", "04": "04_lods.py", "05": "05_bake.py", "06": "06_export.py", "07": "07_previews.py"}[key]
                ok = run(key, f"{key}_{name}", script)
                if ok and key == "05":   # measure + fill base-colour bake holes (system Python), before export embeds it
                    with open(os.path.join(out, "logs", "05b_fill_bake_holes.log"), "w") as lf:
                        ok = subprocess.run([system_python(), os.path.join(SCRIPTS, "fill_bake_holes.py"), "--out", out],
                                            stdout=lf, stderr=subprocess.STDOUT).returncode == 0
            if R.fell_back_to_native:
                if R.native_state:
                    state = R.native_state
                break
            json.dump(state, open(state_path, "w"), indent=2)
            if not ok:
                fail(idx, name, label, f"step {idx} ({name}) failed; see {out}/logs/")
            progress(idx, name, label, "ok")
    finalize(a, cfg, out, inp, state)
    if a.validator_profile:
        run_validator(out)
    progress(total, PLAN[-1][2], "Done", "ok", done=True)
    print(f"DONE. manifest: {os.path.join(out, 'manifest.json')}", flush=True)
    if a.freeze:
        dst = freeze_run(out, ts, in_place=(a.freeze == "in_place"))
        print(f"FROZEN: {dst} (runs/latest -> {os.path.basename(dst)})", flush=True)


VALIDATOR_DIR = os.path.join(os.path.dirname(HERE), "validator")


def run_validator(out):
    """Smoke test: run the validator CLI on the combined FBX with the copied profile AND the manifest
    (`check --manifest`, which adds its 'manifest' consistency check). Writes <out>/validator_report.json and
    records the overall result in manifest.json['validator']. Never fails the pipeline run."""
    mp = os.path.join(out, "manifest.json"); m = json.load(open(mp))
    fbx = os.path.join(out, m.get("combined_fbx") or "")
    py = os.path.join(VALIDATOR_DIR, ".venv", "bin", "python")
    py = py if os.path.exists(py) else sys.executable
    cmd = [py, "-m", "fabled_validator", "check", fbx, "--profile", os.path.join(out, "validator_profile.json"),
           "--manifest", mp, "--json-only"]
    res = {"command": " ".join(os.path.relpath(c, out) if c.startswith(out) else c for c in cmd),
           "cwd": "prototype/validator", "report": None}
    t0 = time.monotonic()
    try:
        p = subprocess.run(cmd, cwd=VALIDATOR_DIR, capture_output=True, text=True, timeout=600)
        res["exit_code"] = p.returncode
        rep = json.loads(p.stdout)
        json.dump(rep, open(os.path.join(out, "validator_report.json"), "w"), indent=2)
        res["report"] = "validator_report.json"
        res["overall_status"] = rep.get("overall_status")
        res["complete"] = rep.get("complete")
        cnt = {}
        for c in rep.get("checks", []):
            cnt[c.get("status")] = cnt.get(c.get("status"), 0) + 1
        res["check_counts"] = cnt
        res["failed_checks"] = [c.get("id") or c.get("name") for c in rep.get("checks", []) if c.get("status") == "fail"]
        res["warn_checks"] = [c.get("id") or c.get("name") for c in rep.get("checks", []) if c.get("status") == "warn"]
        if p.stderr.strip():
            res["stderr_tail"] = p.stderr.strip()[-400:]
    except Exception as e:
        res["error"] = str(e)
    res["runtime_s"] = round(time.monotonic() - t0, 2)
    m["validator"] = res
    json.dump(m, open(mp, "w"), indent=2)
    print(f"  [validator] {res.get('overall_status')} {res.get('check_counts')}", flush=True)
    return res


def finalize(a, cfg, out, inp, state, failed=None):
    sys.path.insert(0, HERE)
    from build_manifest import build
    try:
        build(out=out, cfg=cfg, inp=inp, state=state, source_meta_path=a.source_meta,
              blender_version=blender_version(a.blender), failed=failed)
    except Exception as e:  # never lose the run because the manifest builder broke
        import traceback; traceback.print_exc()
        json.dump({"schema": "fabled.pipeline.manifest/0.1", "concept_mockup": False, "status": "failed",
                   "error": f"manifest builder crashed: {e}; original error: {failed}", "warnings": [str(e)]},
                  open(os.path.join(out, "manifest.json"), "w"), indent=2)
        if not failed:
            sys.exit(1)


if __name__ == "__main__":
    main()
