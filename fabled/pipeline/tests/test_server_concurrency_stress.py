"""Adversarial Concurrency & Server API Stress Verification Test Suite.

Stress-tests:
1. Ephemeral server.mjs instance lifecycle on dynamic isolated ports.
2. Concurrent job uploads under multi-threaded load.
3. Concurrent telemetry reads (progress.json race condition checks under heavy polling).
4. Alternating engine execution (concurrent native and blender pipeline runs).
5. Robustness of POST /api/jobs/:id/validate against missing jobs, deleted assets,
   malformed JSON, type mismatches, and edge-case profiles.
6. Non-blocking and concurrency safety of wait_for_other_blender() in fabled_pipeline.py.
"""
from __future__ import annotations

import concurrent.futures
import datetime
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
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
FIXTURES_DIR = os.path.join(VALIDATOR_DIR, "fixtures")
TEST_MESH = os.path.join(FIXTURES_DIR, "synthetic_clean_character.obj")

BLENDER_CANDIDATES = [
    os.environ.get("FABLED_BLENDER"),
    "/opt/homebrew/bin/blender",
    shutil.which("blender"),
    "/usr/local/bin/blender",
    "/Applications/Blender.app/Contents/MacOS/Blender",
]
BLENDER_BIN = next((b for b in BLENDER_CANDIDATES if b and os.path.exists(b)), None)


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _http_request(url: str, method: str = "GET", data=None, headers=None, timeout: float = 30):
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


@pytest.fixture(scope="module")
def ephemeral_server():
    port = _find_free_port()
    env = os.environ.copy()
    env["PORT"] = str(port)
    env["HOST"] = "127.0.0.1"
    env["PYTHON"] = os.path.join(VALIDATOR_DIR, ".venv", "bin", "python")

    proc = subprocess.Popen(["node", SERVER_MJS], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base_url = f"http://127.0.0.1:{port}"

    # Poll /api/status until ready
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

    assert ready, f"Ephemeral server failed to start on port {port}"
    yield base_url

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


class TestServerConcurrencyStress:
    """Stress-tests concurrent uploads, alternating engines, and telemetry race conditions."""

    def test_concurrent_job_uploads(self, ephemeral_server):
        """Upload 12 jobs concurrently to test thread safety and ID uniqueness."""
        mesh_bytes = open(TEST_MESH, "rb").read()
        num_jobs = 12

        def upload_single_job(i: int):
            status_code, data = _http_request(
                f"{ephemeral_server}/api/jobs?filename=mesh_concurrent_{i}.obj",
                method="POST",
                data=mesh_bytes,
                headers={"Content-Type": "application/octet-stream"},
                timeout=15,
            )
            return i, status_code, data

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_jobs) as pool:
            futures = [pool.submit(upload_single_job, i) for i in range(num_jobs)]
            results = [f.result() for f in futures]

        job_ids = set()
        for i, code, resp in results:
            assert code == 200, f"Upload {i} failed with status {code}: {resp}"
            assert isinstance(resp, dict)
            job_id = resp.get("job_id")
            assert job_id, f"Upload {i} missing job_id"
            assert job_id not in job_ids, f"Duplicate job_id generated: {job_id}"
            job_ids.add(job_id)
            assert os.path.exists(resp["input_path"])

        assert len(job_ids) == num_jobs

    def test_telemetry_race_condition_hammer(self, ephemeral_server):
        """Hammer /api/jobs/:id/progress with high-frequency concurrent requests while a job is running."""
        # 1. Upload a sculpt
        mesh_bytes = open(TEST_MESH, "rb").read()
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs?filename=telemetry_stress.obj",
            method="POST",
            data=mesh_bytes,
            headers={"Content-Type": "application/octet-stream"},
        )
        assert code == 200
        job_id = resp["job_id"]

        # 2. Trigger native process
        code, pdata = _http_request(
            f"{ephemeral_server}/api/jobs/{job_id}/process",
            method="POST",
            data={"engine": "native"},
        )
        assert code == 200 and pdata.get("ok") is True

        # 3. Hammer progress endpoint from 16 worker threads
        errors = []
        progress_snapshots = []
        stop_hammer = False

        def hammer_worker(worker_id: int):
            req_count = 0
            while not stop_hammer and req_count < 100:
                req_count += 1
                try:
                    c, r = _http_request(f"{ephemeral_server}/api/jobs/{job_id}/progress", timeout=5)
                    if c != 200:
                        errors.append((worker_id, c, r))
                    elif not isinstance(r, dict):
                        errors.append((worker_id, "non_dict_json", r))
                    else:
                        prog = r.get("progress")
                        if prog is not None:
                            # Assert required fields in progress object
                            for k in ("step", "total", "name", "label", "done", "status"):
                                if k not in prog:
                                    errors.append((worker_id, f"missing_field_{k}", prog))
                            progress_snapshots.append(prog.get("step"))
                except Exception as e:
                    errors.append((worker_id, "exception", str(e)))
                time.sleep(0.01)

        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            futures = [pool.submit(hammer_worker, i) for i in range(16)]

            # Wait for job to finish
            t0 = time.monotonic()
            job_done = False
            while time.monotonic() - t0 < 30:
                c, r = _http_request(f"{ephemeral_server}/api/jobs/{job_id}/progress", timeout=5)
                if c == 200 and not r.get("running") and r.get("exit_code") is not None:
                    job_done = True
                    break
                time.sleep(0.2)

            stop_hammer = True
            concurrent.futures.wait(futures)

        assert job_done, "Native job did not complete in 30s"
        assert len(errors) == 0, f"Race condition errors detected during progress polling: {errors[:5]}"
        assert len(progress_snapshots) > 10, "Not enough progress snapshots collected"

    def test_alternating_engine_concurrent_runs(self, ephemeral_server):
        """Dispatch concurrent jobs alternating between native and blender engines."""
        mesh_bytes = open(TEST_MESH, "rb").read()

        # Job A: Native engine
        code_a, resp_a = _http_request(
            f"{ephemeral_server}/api/jobs?filename=job_a_native.obj",
            method="POST",
            data=mesh_bytes,
        )
        assert code_a == 200
        job_a = resp_a["job_id"]

        # Job B: Native engine (second concurrent native)
        code_b, resp_b = _http_request(
            f"{ephemeral_server}/api/jobs?filename=job_b_native.obj",
            method="POST",
            data=mesh_bytes,
        )
        assert code_b == 200
        job_b = resp_b["job_id"]

        # Trigger both concurrently
        def start_job(jid: str, engine: str):
            return _http_request(
                f"{ephemeral_server}/api/jobs/{jid}/process",
                method="POST",
                data={"engine": engine, "profile": {"name": f"Profile_{engine}"}},
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            fut_a = pool.submit(start_job, job_a, "native")
            fut_b = pool.submit(start_job, job_b, "native")
            res_a = fut_a.result()
            res_b = fut_b.result()

        assert res_a[0] == 200 and res_a[1].get("ok") is True
        assert res_b[0] == 200 and res_b[1].get("ok") is True

        # Wait for both jobs to complete
        for jid in (job_a, job_b):
            t0 = time.monotonic()
            done = False
            while time.monotonic() - t0 < 45:
                c, r = _http_request(f"{ephemeral_server}/api/jobs/{jid}/progress", timeout=5)
                if c == 200 and not r.get("running"):
                    assert r.get("exit_code") == 0
                    assert r["progress"]["step"] == 8
                    assert r["progress"]["done"] is True
                    done = True
                    break
                time.sleep(0.5)
            assert done, f"Job {jid} timed out"

            # Check result
            rc, result = _http_request(f"{ephemeral_server}/api/jobs/{jid}/result")
            assert rc == 200 and result["ok"] is True
            assert result["manifest"]["tool"]["blender_version"] == "native-numpy-engine-0.1"

    @pytest.mark.skipif(not BLENDER_BIN, reason="Blender binary not available on host")
    def test_concurrent_native_and_blender_runs(self, ephemeral_server):
        """Dispatch concurrent jobs with alternating engines: one blender and one native."""
        mesh_bytes = open(TEST_MESH, "rb").read()

        # Job 1: Blender engine
        code_1, resp_1 = _http_request(
            f"{ephemeral_server}/api/jobs?filename=job_blender.obj",
            method="POST",
            data=mesh_bytes,
        )
        assert code_1 == 200
        job_blender = resp_1["job_id"]

        # Job 2: Native engine
        code_2, resp_2 = _http_request(
            f"{ephemeral_server}/api/jobs?filename=job_native.obj",
            method="POST",
            data=mesh_bytes,
        )
        assert code_2 == 200
        job_native = resp_2["job_id"]

        # Launch both concurrently
        def start_job(jid: str, engine: str):
            return _http_request(
                f"{ephemeral_server}/api/jobs/{jid}/process",
                method="POST",
                data={"engine": engine, "profile": {"name": f"Profile_{engine}"}},
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            fut_b = pool.submit(start_job, job_blender, "blender")
            fut_n = pool.submit(start_job, job_native, "native")
            res_b = fut_b.result()
            res_n = fut_n.result()

        assert res_b[0] == 200 and res_b[1].get("ok") is True
        assert res_b[1].get("engine") == "blender"
        assert res_n[0] == 200 and res_n[1].get("ok") is True
        assert res_n[1].get("engine") == "native"

        # Verify that native completes quickly while blender is running
        t0 = time.monotonic()
        native_done = False
        blender_running_observed = False
        while time.monotonic() - t0 < 30:
            cn, rn = _http_request(f"{ephemeral_server}/api/jobs/{job_native}/progress", timeout=5)
            cb, rb = _http_request(f"{ephemeral_server}/api/jobs/{job_blender}/progress", timeout=5)

            if cb == 200 and rb.get("running"):
                blender_running_observed = True

            if cn == 200 and not rn.get("running"):
                assert rn.get("exit_code") == 0
                assert rn["progress"]["step"] == 8
                native_done = True
                break
            time.sleep(0.3)

        assert native_done, "Native job did not complete concurrently"
        assert blender_running_observed, "Blender job was not observed running concurrently"

        # Terminate background blender job so it does not linger on shared host
        subprocess.run(["pkill", "-9", "-f", f"{job_blender}"], capture_output=True)


class TestValidatorStress:
    """Stress-tests POST /api/jobs/:id/validate against malformed payloads and edge-cases."""

    def test_validate_nonexistent_and_bad_job_id(self, ephemeral_server):
        # 1. Nonexistent but syntactically valid job ID
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs/00000000-00000000/validate",
            method="POST",
            data={},
        )
        assert code == 404
        assert "unknown job" in str(resp)

        # 2. Syntactically invalid job ID (path injection or illegal characters)
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs/../../etc/passwd/validate",
            method="POST",
            data={},
        )
        assert code in (400, 404)

    def test_validate_malformed_json_payloads(self, ephemeral_server):
        # Create a job first
        mesh_bytes = open(TEST_MESH, "rb").read()
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs?filename=test_malformed.obj",
            method="POST",
            data=mesh_bytes,
        )
        assert code == 200
        job_id = resp["job_id"]

        # 1. Truncated / malformed JSON
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs/{job_id}/validate",
            method="POST",
            data=b'{"malformed": true, "unclosed: ',
            headers={"Content-Type": "application/json"},
        )
        assert code == 400
        assert "error" in resp

        # 2. Array instead of dict for lod_budget
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs/{job_id}/validate",
            method="POST",
            data={"lod_budget": "not_an_array_string"},
        )
        assert code == 400
        assert "error" in resp

        # 3. Numeric lod_budget
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs/{job_id}/validate",
            method="POST",
            data={"lod_budget": 12345},
        )
        assert code == 400
        assert "error" in resp

        # 4. Empty string body should be handled gracefully (defaults to {})
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs/{job_id}/validate",
            method="POST",
            data="",
            headers={"Content-Type": "application/json"},
        )
        assert code == 200
        assert resp["ok"] is True
        assert resp["report"]["schema_version"] == "0.2.0"

    def test_validate_missing_underlying_asset(self, ephemeral_server):
        # Create a job, then delete the asset from disk
        mesh_bytes = open(TEST_MESH, "rb").read()
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs?filename=to_be_deleted.obj",
            method="POST",
            data=mesh_bytes,
        )
        assert code == 200
        job_id = resp["job_id"]
        input_path = resp["input_path"]
        assert os.path.exists(input_path)

        # Delete the underlying file
        os.remove(input_path)
        assert not os.path.exists(input_path)

        # Validate should not crash; it should return exit_code 2 with a structured error report
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs/{job_id}/validate",
            method="POST",
            data={},
        )
        assert code == 200
        assert resp["ok"] is True
        assert resp["exit_code"] == 2
        assert resp["report"]["schema_version"] == "0.2.0"
        assert resp["report"]["overall_status"] == "error"

    def test_validate_edge_case_profiles(self, ephemeral_server):
        # Create a valid job
        mesh_bytes = open(TEST_MESH, "rb").read()
        code, resp = _http_request(
            f"{ephemeral_server}/api/jobs?filename=edge_profile.obj",
            method="POST",
            data=mesh_bytes,
        )
        assert code == 200
        job_id = resp["job_id"]

        edge_profiles = [
            # 1. Extreme budget
            {"name": "UltraBudget", "lod_budget": [{"level": 0, "max_triangles": 1000000000}]},
            # 2. Extreme scale and units
            {"name": "MicroScale", "units": "mm", "scale": 0.0001},
            # 3. Zero height range
            {"name": "ZeroHeight", "asset_class": {"id": "character", "height_cm": [0, 0]}},
            # 4. Unknown asset class
            {"name": "UnknownClass", "asset_class": {"id": "custom_alien_class", "height_cm": [10, 500]}},
            # 5. Non-standard skeleton
            {"name": "CustomSkel", "skeleton": {"type": "quadruped", "root_bone_name": "Root"}},
        ]

        for prof in edge_profiles:
            code, r = _http_request(
                f"{ephemeral_server}/api/jobs/{job_id}/validate",
                method="POST",
                data=prof,
            )
            assert code == 200, f"Profile {prof['name']} failed with status {code}: {r}"
            assert r["ok"] is True
            assert r["report"]["schema_version"] == "0.2.0"
            assert isinstance(r["report"]["checks"], list)


class TestWaitForOtherBlender:
    """Stress-tests wait_for_other_blender non-blocking check and concurrency safety."""

    def test_wait_for_other_blender_idle_immediate_return(self, tmp_path, monkeypatch):
        sys.path.insert(0, PIPELINE_DIR)
        import subprocess
        from fabled_pipeline import wait_for_other_blender

        orig_run = subprocess.run
        def mock_idle(cmd, *args, **kwargs):
            if "pgrep" in cmd[0]:
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
            return orig_run(cmd, *args, **kwargs)

        monkeypatch.setattr(subprocess, "run", mock_idle)

        log_path = str(tmp_path / "ps_idle.log")
        t0 = time.monotonic()
        ok = wait_for_other_blender(log_path, "idle_check", max_wait_s=5, poll_s=1)
        dur = time.monotonic() - t0

        assert ok is True
        assert dur < 0.1, f"Expected immediate non-blocking return, took {dur:.2f}s"
        with open(log_path) as f:
            log_text = f.read()
        assert "none -> OK to start" in log_text

    def test_wait_for_other_blender_ignores_unrelated_processes(self, tmp_path, monkeypatch):
        """Verify that helper processes like blender-mcp or pytest are ignored."""
        sys.path.insert(0, PIPELINE_DIR)
        import subprocess
        from fabled_pipeline import wait_for_other_blender

        orig_run = subprocess.run
        def mock_mcp(cmd, *args, **kwargs):
            if "pgrep" in cmd[0]:
                output = (
                    "5719 /bin/python /bin/blender-mcp --transport stdio\n"
                    "6001 /venv/bin/pytest fabled/pipeline/tests\n"
                    "6002 python fabled_pipeline.py --input test.obj"
                )
                return subprocess.CompletedProcess(cmd, 0, stdout=output, stderr="")
            return orig_run(cmd, *args, **kwargs)

        monkeypatch.setattr(subprocess, "run", mock_mcp)

        log_path = str(tmp_path / "ps_ignored.log")
        t0 = time.monotonic()
        ok = wait_for_other_blender(log_path, "ignored_check", max_wait_s=3, poll_s=1)
        dur = time.monotonic() - t0

        assert ok is True
        assert dur < 0.1, f"blender-mcp/pytest was not ignored; wait took {dur:.2f}s"
        with open(log_path) as f:
            log_text = f.read()
        assert "none -> OK to start" in log_text

    def test_wait_for_other_blender_waits_for_active_blender(self, tmp_path, monkeypatch):
        """Verify that an active Blender process is detected, waited on, and cleared."""
        sys.path.insert(0, PIPELINE_DIR)
        import subprocess
        from fabled_pipeline import wait_for_other_blender

        call_count = 0
        orig_run = subprocess.run
        def mock_busy_then_clear(cmd, *args, **kwargs):
            nonlocal call_count
            if "pgrep" in cmd[0]:
                call_count += 1
                if call_count <= 2:
                    return subprocess.CompletedProcess(cmd, 0, stdout="12345 /opt/homebrew/bin/blender -b", stderr="")
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
            return orig_run(cmd, *args, **kwargs)

        monkeypatch.setattr(subprocess, "run", mock_busy_then_clear)

        log_path = str(tmp_path / "ps_busy.log")
        t0 = time.monotonic()
        ok = wait_for_other_blender(log_path, "busy_check", max_wait_s=5, poll_s=0.1)
        dur = time.monotonic() - t0

        assert ok is True
        assert call_count >= 3
        with open(log_path) as f:
            log_text = f.read()
        assert "BUSY: 12345 /opt/homebrew/bin/blender -b -> waiting" in log_text
        assert "OK to start" in log_text

    def test_wait_for_other_blender_timeout(self, tmp_path, monkeypatch):
        """Verify timeout after max_wait_s when Blender remains busy."""
        sys.path.insert(0, PIPELINE_DIR)
        import subprocess
        from fabled_pipeline import wait_for_other_blender

        orig_run = subprocess.run
        def mock_always_busy(cmd, *args, **kwargs):
            if "pgrep" in cmd[0]:
                return subprocess.CompletedProcess(cmd, 0, stdout="99999 /Applications/Blender.app/Contents/MacOS/Blender", stderr="")
            return orig_run(cmd, *args, **kwargs)

        monkeypatch.setattr(subprocess, "run", mock_always_busy)

        log_path = str(tmp_path / "ps_timeout.log")
        t0 = time.monotonic()
        ok = wait_for_other_blender(log_path, "timeout_check", max_wait_s=0.5, poll_s=0.1)
        dur = time.monotonic() - t0

        assert ok is False
        assert dur >= 0.5
        with open(log_path) as f:
            log_text = f.read()
        assert "BUSY:" in log_text
        assert "TIMEOUT after 0.5s" in log_text
