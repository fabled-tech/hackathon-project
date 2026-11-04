"""Automated Integration Test Suite for Fabled Pipeline & Pre-Import Validator Engine.

Verifies:
1. End-to-end native engine run (--blender none): all 8 steps, progress.json, manifest.json, FBX with LodGroup.
2. Telemetry streaming contract: atomic updates and stage progression in progress.json.
3. Fallback routing: explicit flags ('none', 'native', 'off') and missing blender paths.
4. Headless Blender execution (when available): binary detection, stages, and multi-platform font resolution.
5. Pre-import validator integration: CLI execution, Schema 0.2.0 output, manifest cross-check (16th check), and error exit codes.
6. Web server API bridge (server.mjs): engine selector dispatch, progress polling, result tails, and validator manifest auto-detection.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(HERE)
FABLED_DIR = os.path.dirname(PIPELINE_DIR)
UI_DIR = os.path.join(FABLED_DIR, "ui")
SERVER_MJS = os.path.join(UI_DIR, "server.mjs")
VALIDATOR_DIR = os.path.join(FABLED_DIR, "validator")
VALIDATOR_PY = os.path.join(VALIDATOR_DIR, ".venv", "bin", "python")
if not os.path.exists(VALIDATOR_PY):
    VALIDATOR_PY = sys.executable

FIXTURES_DIR = os.path.join(VALIDATOR_DIR, "fixtures")
PROFILES_DIR = os.path.join(VALIDATOR_DIR, "profiles")
PIPELINE_CLI = os.path.join(PIPELINE_DIR, "fabled_pipeline.py")

BLENDER_CANDIDATES = [
    os.environ.get("FABLED_BLENDER"),
    "/opt/homebrew/bin/blender",
    shutil.which("blender"),
    "/usr/local/bin/blender",
    "/Applications/Blender.app/Contents/MacOS/Blender",
]
BLENDER_BIN = next((b for b in BLENDER_CANDIDATES if b and os.path.exists(b)), None)


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _http_request(url, method="GET", data=None, headers=None, timeout=30):
    req_headers = headers or {}
    body = None
    if data is not None:
        if isinstance(data, (dict, list)):
            body = json.dumps(data).encode("utf-8")
            if "Content-Type" not in req_headers:
                req_headers["Content-Type"] = "application/json"
        elif isinstance(data, str):
            body = data.encode("utf-8")
        else:
            body = data
    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(content)
            except Exception:
                return resp.status, content
    except urllib.error.HTTPError as e:
        err_content = e.read().decode("utf-8")
        try:
            return e.code, json.loads(err_content)
        except Exception:
            return e.code, err_content


@pytest.fixture
def test_mesh():
    p = os.path.join(FIXTURES_DIR, "synthetic_clean_character.obj")
    assert os.path.exists(p), f"Fixture mesh not found: {p}"
    return p


@pytest.fixture
def demo_profile():
    p = os.path.join(PROFILES_DIR, "demo_placeholder.json")
    assert os.path.exists(p), f"Demo profile not found: {p}"
    return p


@pytest.fixture
def validator_env():
    env = os.environ.copy()
    env["PYTHONPATH"] = VALIDATOR_DIR
    return env


@pytest.fixture(scope="module")
def web_server():
    port = _find_free_port()
    env = os.environ.copy()
    env["PORT"] = str(port)
    env["HOST"] = "127.0.0.1"

    proc = subprocess.Popen(["node", SERVER_MJS], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base_url = f"http://127.0.0.1:{port}"

    # Wait for server ready
    ready = False
    start = time.monotonic()
    while time.monotonic() - start < 15:
        try:
            status_code, data = _http_request(f"{base_url}/api/status", timeout=2)
            if status_code == 200 and isinstance(data, dict):
                ready = True
                break
        except Exception:
            time.sleep(0.2)

    assert ready, f"Web server failed to start on port {port}"
    yield base_url

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


# =============================================================================
# 1. Native Pipeline Integration Tests
# =============================================================================
class TestNativePipeline:
    def test_native_pipeline_end_to_end(self, tmp_path, test_mesh):
        out_dir = tmp_path / "native_e2e"
        cmd = [sys.executable, PIPELINE_CLI, "--input", test_mesh, "--out", str(out_dir), "--blender", "none"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        assert res.returncode == 0, f"Pipeline run failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"

        # 1. Verify telemetry progress.json
        prog_path = out_dir / "progress.json"
        assert prog_path.exists(), "progress.json not generated"
        prog = json.loads(prog_path.read_text())
        assert prog["step"] == 8
        assert prog["total"] == 8
        assert prog["done"] is True
        assert prog["status"] == "ok"
        assert "updated_at" in prog

        # 2. Verify manifest.json
        manifest_path = out_dir / "manifest.json"
        assert manifest_path.exists(), "manifest.json not generated"
        manifest = json.loads(manifest_path.read_text())
        assert manifest["schema"] == "fabled.pipeline.manifest/0.1"
        assert manifest["status"] == "ok"
        assert manifest["tool"]["blender_version"] == "native-numpy-engine-0.1"
        assert manifest["combined_fbx"] == "export/SM_SyntheticCleanCharacter.fbx"

        # 3. Verify combined FBX with LodGroup
        comb_fbx = out_dir / manifest["combined_fbx"]
        assert comb_fbx.exists()
        assert comb_fbx.stat().st_size > 10000

        # FBX LodGroup validation
        fbx_content = comb_fbx.read_bytes()
        assert b"LodGroup" in fbx_content or b"LOD" in fbx_content

        # 4. Verify all 4 LOD files
        assert len(manifest["outputs"]["lods"]) == 4
        for lod in manifest["outputs"]["lods"]:
            lod_file = out_dir / lod["path"]
            assert lod_file.exists(), f"LOD file missing: {lod['path']}"
            assert lod["triangles"] > 0

        # 5. Verify textures and previews
        assert (out_dir / "export" / "T_SyntheticCleanCharacter_N.png").exists()
        assert (out_dir / "export" / "T_SyntheticCleanCharacter_ORM.png").exists()
        assert (out_dir / "previews" / "compare_shaded_highpoly_vs_lod0.png").exists()

    def test_native_fallback_routing_flags(self, tmp_path, test_mesh):
        # Explicit native string identifiers
        for flag in ["native", "off", "0", "stub"]:
            out_dir = tmp_path / f"native_flag_{flag}"
            cmd = [sys.executable, PIPELINE_CLI, "--input", test_mesh, "--out", str(out_dir), "--blender", flag]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            assert res.returncode == 0, f"Failed for --blender {flag}: {res.stderr}"
            manifest = json.loads((out_dir / "manifest.json").read_text())
            assert manifest["tool"]["blender_version"] == "native-numpy-engine-0.1"

    def test_missing_blender_binary_falls_back(self, tmp_path, test_mesh):
        out_dir = tmp_path / "fallback_missing"
        cmd = [sys.executable, PIPELINE_CLI, "--input", test_mesh, "--out", str(out_dir),
               "--blender", "/nonexistent/custom/path/blender"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        assert res.returncode == 0
        assert "falling back to Fabled native" in res.stdout or "running Fabled native" in res.stdout
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["tool"]["blender_version"] == "native-numpy-engine-0.1"

    def test_corrupt_blender_binary_falls_back(self, tmp_path, test_mesh=None):
        if test_mesh is None:
            test_mesh = os.path.join(FIXTURES_DIR, "synthetic_clean_character.obj")
        corrupt_blender = tmp_path / "corrupt_blender"
        corrupt_blender.write_bytes(b"")
        corrupt_blender.chmod(0o755)

        out_dir = tmp_path / "fallback_corrupt"
        cmd = [
            sys.executable,
            PIPELINE_CLI,
            "--input",
            str(test_mesh),
            "--out",
            str(out_dir),
            "--blender",
            str(corrupt_blender),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        assert res.returncode == 0, f"Pipeline run failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert "invalid, 0-byte, or not executable" in res.stdout

        # Assert progress status is "ok"
        prog_file = out_dir / "progress.json"
        assert prog_file.exists(), "progress.json not generated"
        prog = json.loads(prog_file.read_text())
        assert prog["status"] == "ok"
        assert prog["done"] is True

        # Assert output manifest is generated
        manifest_file = out_dir / "manifest.json"
        assert manifest_file.exists(), "manifest.json not generated"
        manifest = json.loads(manifest_file.read_text())
        assert manifest["status"] == "ok"
        assert manifest["tool"]["blender_version"] == "native-numpy-engine-0.1"

        # Assert LOD FBX is generated
        comb_fbx = out_dir / manifest["combined_fbx"]
        assert comb_fbx.exists()
        assert comb_fbx.stat().st_size > 0

    def test_unexecutable_blender_binary_runtime_fallback(self, tmp_path, test_mesh):
        # Non-empty file that passes is_valid_blender_bin (size > 0, X_OK) but fails kernel spawn with OSError
        bad_bin = tmp_path / "bad_blender_bin"
        bad_bin.write_bytes(b"garbage_non_binary_content\n")
        bad_bin.chmod(0o755)

        out_dir = tmp_path / "fallback_runtime_bad_bin"
        cmd = [
            sys.executable,
            PIPELINE_CLI,
            "--input",
            str(test_mesh),
            "--out",
            str(out_dir),
            "--blender",
            str(bad_bin),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        assert res.returncode == 0, f"Pipeline run failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert (
            "Failed to execute Blender binary" in res.stdout
            or "invalid, 0-byte, or not executable" in res.stdout
        )

        prog_file = out_dir / "progress.json"
        assert prog_file.exists(), "progress.json not generated"
        prog = json.loads(prog_file.read_text())
        assert prog["status"] == "ok"
        assert prog["done"] is True

        manifest_file = out_dir / "manifest.json"
        assert manifest_file.exists(), "manifest.json not generated"
        manifest = json.loads(manifest_file.read_text())
        assert manifest["status"] == "ok"

        comb_fbx = out_dir / manifest["combined_fbx"]
        assert comb_fbx.exists()
        assert comb_fbx.stat().st_size > 0

    def test_telemetry_atomic_progression(self, tmp_path, test_mesh):
        out_dir = tmp_path / "telemetry_test"
        cmd = [sys.executable, PIPELINE_CLI, "--input", test_mesh, "--out", str(out_dir), "--blender", "none"]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        prog_file = out_dir / "progress.json"
        observed_steps = set()
        seen_running = False

        start = time.monotonic()
        while proc.poll() is None and time.monotonic() - start < 30:
            if prog_file.exists():
                try:
                    data = json.loads(prog_file.read_text())
                    assert "step" in data
                    assert "total" in data
                    assert "status" in data
                    observed_steps.add(data["step"])
                    if data["status"] == "running":
                        seen_running = True
                except json.JSONDecodeError:
                    pytest.fail("progress.json read yielded invalid JSON (non-atomic write)")
            time.sleep(0.04)

        proc.wait()
        assert proc.returncode == 0
        final_data = json.loads(prog_file.read_text())
        assert final_data["step"] == 8
        assert final_data["done"] is True
        assert len(observed_steps) >= 3


def test_corrupt_blender_binary_falls_back(tmp_path, test_mesh=None):
    """Standalone module-level entrypoint for corrupt blender binary fallback test."""
    TestNativePipeline().test_corrupt_blender_binary_falls_back(tmp_path, test_mesh)


# =============================================================================
# 2. Blender Pipeline Integration Tests
# =============================================================================
class TestBlenderPipeline:
    @pytest.mark.skipif(BLENDER_BIN is None, reason="Headless Blender not installed on host")
    def test_blender_binary_detection(self):
        res = subprocess.run([BLENDER_BIN, "-b", "--version"], capture_output=True, text=True, timeout=15)
        assert res.returncode == 0
        assert "Blender" in res.stdout

    @pytest.mark.skipif(BLENDER_BIN is None, reason="Headless Blender not installed on host")
    def test_blender_pipeline_stages(self, tmp_path, test_mesh):
        pgrep = subprocess.run(["pgrep", "-fl", "[Bb]lender"], capture_output=True, text=True)
        # Filter out this test process, blender-mcp, and wrappers
        other_blender = [
            l for l in pgrep.stdout.splitlines()
            if not any(ign in l for ign in ("blender-mcp", "fabled_pipeline", "pytest", "test_pipeline"))
            and any(b in l for b in ("/blender", "Blender.app", " blender"))
        ]
        if other_blender:
            pytest.skip(f"Another Blender process is active: {other_blender[0]}")

        out_dir = tmp_path / "blender_stages"
        cmd = [
            sys.executable, PIPELINE_CLI,
            "--input", test_mesh,
            "--out", str(out_dir),
            "--blender", BLENDER_BIN,
            "--steps", "01,02,03,04,05,06",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
        assert res.returncode == 0, f"Blender pipeline failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"

        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert (out_dir / manifest["combined_fbx"]).exists()
        assert manifest["tool"]["blender_version"].startswith("Blender")

    def test_step08_font_resolution_on_composites(self):
        # Test multi-platform font resolution functions in post_previews.py
        py_pil = None
        for cand in [shutil.which("python3"), sys.executable, "/usr/bin/python3"]:
            if cand:
                try:
                    if subprocess.run([cand, "-c", "import PIL"], capture_output=True).returncode == 0:
                        py_pil = cand
                        break
                except Exception:
                    pass
        if not py_pil:
            pytest.skip("Pillow (PIL) not found in available Python environments")

        # Test font loading in python environment with PIL
        test_code = f"""
import sys, os
sys.path.insert(0, os.path.join(r'{PIPELINE_DIR}', 'scripts'))
from post_previews import _find_font, _get_font
from PIL import Image, ImageDraw

font_regular = _find_font(bold=False)
font_bold = _find_font(bold=True)
print('font_regular:', font_regular)
print('font_bold:', font_bold)

f_title = _get_font(bold=True, size=30)
f_lab = _get_font(bold=False, size=24)
f_small = _get_font(bold=False, size=17)
assert f_title is not None
assert f_lab is not None
assert f_small is not None

im = Image.new('RGB', (200, 100), (38, 38, 42))
d = ImageDraw.Draw(im)
d.text((10, 10), 'Title Text', font=f_title, fill=(235, 235, 235))
d.text((10, 50), 'Label Text', font=f_lab, fill=(170, 170, 175))
w = d.textlength('Title Text', font=f_title)
assert w > 0
print('FONT_RESOLUTION_SUCCESS')
"""
        res = subprocess.run([py_pil, "-c", test_code], capture_output=True, text=True, timeout=15)
        assert res.returncode == 0, f"Font resolution test failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert "FONT_RESOLUTION_SUCCESS" in res.stdout

        if os.path.exists("/tmp/test_pipeline_blender/work/step01.json") and os.path.exists("/tmp/test_pipeline_blender/previews/raw/hp_wire.png"):
            res2 = subprocess.run([py_pil, os.path.join(PIPELINE_DIR, "scripts", "post_previews.py"), "--out", "/tmp/test_pipeline_blender"],
                                  capture_output=True, text=True, timeout=30)
            assert res2.returncode == 0
            assert "POST_PREVIEWS" in res2.stdout


# =============================================================================
# 3. Pre-Import Validator Integration Tests
# =============================================================================
class TestValidatorIntegration:
    def test_validator_schema_dump(self, validator_env):
        cmd = [VALIDATOR_PY, "-m", "fabled_validator", "schema"]
        res = subprocess.run(cmd, capture_output=True, text=True, env=validator_env, timeout=10)
        assert res.returncode == 0
        schema = json.loads(res.stdout)
        assert schema.get("$id") == "https://fabled.local/schema/report/0.2.0"

    def test_validator_manifest_cross_check_native(self, tmp_path, test_mesh, demo_profile, validator_env):
        out_dir = tmp_path / "native_val"
        subprocess.run([sys.executable, PIPELINE_CLI, "--input", test_mesh, "--out", str(out_dir), "--blender", "none"], check=True)
        manifest_path = out_dir / "manifest.json"

        cmd = [
            VALIDATOR_PY, "-m", "fabled_validator", "check",
            "--manifest", str(manifest_path),
            "--profile", demo_profile,
            "--json-only",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, env=validator_env, timeout=30)
        # Exit code 0 (clean) or 1 (flagged warnings/checks) are valid evaluation results
        assert res.returncode in (0, 1), f"Validator crashed with code {res.returncode}:\n{res.stderr}"

        rep = json.loads(res.stdout)
        assert rep["schema_version"] == "0.2.0"
        assert rep["summary"]["total"] == 16
        mcheck = next(c for c in rep["checks"] if c["id"] == "manifest")
        assert mcheck["status"] in ("pass", "warn")
        assert mcheck["measured"]["problems_fail"] == 0

    def test_validator_manifest_cross_check_blender(self, demo_profile, validator_env):
        blender_manifest = os.path.join(PIPELINE_DIR, "runs", "20261103-195336", "manifest.json")
        if not os.path.exists(blender_manifest):
            pytest.skip("Reference Blender manifest not found")

        cmd = [
            VALIDATOR_PY, "-m", "fabled_validator", "check",
            "--manifest", blender_manifest,
            "--profile", demo_profile,
            "--json-only",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, env=validator_env, timeout=30)
        assert res.returncode in (0, 1)
        rep = json.loads(res.stdout)
        assert rep["schema_version"] == "0.2.0"
        assert rep["manifest"]["readable"] is True
        mcheck = next(c for c in rep["checks"] if c["id"] == "manifest")
        assert mcheck["measured"]["problems_fail"] == 0

    def test_validator_error_exit_code_and_structured_json(self, validator_env, demo_profile):
        cmd = [
            VALIDATOR_PY, "-m", "fabled_validator", "check",
            "--manifest", "/tmp/nonexistent_manifest_xyz.json",
            "--profile", demo_profile,
            "--json-only",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, env=validator_env, timeout=10)
        assert res.returncode == 2
        rep = json.loads(res.stdout)
        assert rep["schema_version"] == "0.2.0"
        assert rep["overall_status"] == "error"
        assert rep["error"]["type"] == "manifest_error"


# =============================================================================
# 4. Web Server API Bridge Integration Tests
# =============================================================================
class TestWebServerApiIntegration:
    def test_server_status_and_engine_capabilities(self, web_server):
        status_code, data = _http_request(f"{web_server}/api/status")
        assert status_code == 200
        assert data["pipeline"]["available"] is True
        assert data["pipeline"]["engines"]["native"] is True
        assert "blender" in data["pipeline"]["engines"]
        assert data["validator"]["supports_manifest"] is True

    def test_server_process_engine_native_e2e(self, web_server, test_mesh):
        # 1. Upload sculpt asset
        mesh_bytes = open(test_mesh, "rb").read()
        status_code, job_data = _http_request(
            f"{web_server}/api/jobs?filename=test_mesh.obj",
            method="POST",
            data=mesh_bytes,
            headers={"Content-Type": "application/octet-stream"},
        )
        assert status_code == 200
        job_id = job_data["job_id"]
        assert job_id

        # 2. Trigger process with engine "native"
        status_code, proc_data = _http_request(
            f"{web_server}/api/jobs/{job_id}/process",
            method="POST",
            data={"engine": "native", "profile": {"name": "NativeTestProfile"}},
        )
        assert status_code == 200
        assert proc_data["ok"] is True
        assert proc_data["started"] is True
        assert proc_data["engine"] == "native"

        # 3. Poll progress until completed
        start = time.monotonic()
        completed = False
        while time.monotonic() - start < 45:
            code, prog_data = _http_request(f"{web_server}/api/jobs/{job_id}/progress")
            if code == 200 and not prog_data.get("running"):
                completed = True
                assert prog_data.get("exit_code") == 0
                assert prog_data["progress"]["done"] is True
                assert prog_data["progress"]["step"] == 8
                break
            time.sleep(0.5)
        assert completed, "Pipeline job timed out"

        # 4. Retrieve result
        code, result_data = _http_request(f"{web_server}/api/jobs/{job_id}/result")
        assert code == 200
        assert result_data["ok"] is True
        assert result_data["exit_code"] == 0
        assert "stdout_tail" in result_data
        assert "stderr_tail" in result_data
        assert result_data.get("output_files") is not None
        assert len(result_data["output_files"]) > 0
        assert result_data["manifest"]["tool"]["blender_version"] == "native-numpy-engine-0.1"

        # 5. Run validator on job (auto-detects manifest)
        code, val_data = _http_request(
            f"{web_server}/api/jobs/{job_id}/validate",
            method="POST",
            data={},
        )
        assert code == 200
        assert val_data["ok"] is True
        assert val_data["target"]["kind"] == "manifest"
        assert val_data["report"]["schema_version"] == "0.2.0"
        assert len(val_data["report"]["checks"]) == 16
