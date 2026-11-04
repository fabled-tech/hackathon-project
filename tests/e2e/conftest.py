"""
E2E Test Suite Fixtures & Configuration for Fabled Capability Showcase
Provides shared fixtures, ephemeral server management, CLI invocation helpers,
and path constants for opaque-box testing.
"""

import os
import sys
import json
import time
import socket
import subprocess
import tempfile
import shutil
from pathlib import Path
import urllib.request
import urllib.error
import pytest

# Project root directory
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FABLED_DIR = PROJECT_ROOT / "fabled"
PIPELINE_DIR = FABLED_DIR / "pipeline"
VALIDATOR_DIR = FABLED_DIR / "validator"
UI_DIR = FABLED_DIR / "ui"
STUDIO_DIR = FABLED_DIR / "FabledStudio"

# Validator Python executable
VALIDATOR_VENV_PY = VALIDATOR_DIR / ".venv" / "bin" / "python"
if not VALIDATOR_VENV_PY.exists():
    VALIDATOR_VENV_PY = Path(sys.executable)

def find_free_port():
    """Find an available ephemeral TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def project_paths():
    """Returns dictionary of key workspace paths."""
    return {
        "root": PROJECT_ROOT,
        "fabled": FABLED_DIR,
        "pipeline": PIPELINE_DIR,
        "validator": VALIDATOR_DIR,
        "ui": UI_DIR,
        "studio": STUDIO_DIR,
        "fixtures": VALIDATOR_DIR / "fixtures",
        "profiles": VALIDATOR_DIR / "profiles",
        "sample_head": UI_DIR / "samples" / "fabled_sample_head.glb",
        "pipeline_output": PIPELINE_DIR / "output",
        "pipeline_config": PIPELINE_DIR / "config" / "default.json",
        "validator_venv_py": VALIDATOR_VENV_PY,
    }


@pytest.fixture(scope="session")
def ui_server(project_paths):
    """
    Spins up an ephemeral instance of fabled/ui/server.mjs.
    Yields the base URL (e.g. http://127.0.0.1:5200) and tears down on completion.
    """
    port = find_free_port()
    host = "127.0.0.1"
    base_url = f"http://{host}:{port}"

    env = os.environ.copy()
    env["PORT"] = str(port)
    env["HOST"] = host
    env["PYTHON"] = sys.executable

    server_proc = subprocess.Popen(
        ["node", str(UI_DIR / "server.mjs")],
        cwd=str(UI_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    # Wait for server to become responsive
    max_wait = 10.0
    start = time.time()
    started = False
    while time.time() - start < max_wait:
        try:
            with urllib.request.urlopen(f"{base_url}/api/status", timeout=1.0) as resp:
                if resp.status == 200:
                    started = True
                    break
        except Exception:
            time.sleep(0.1)

    if not started:
        stdout, stderr = server_proc.communicate(timeout=2)
        server_proc.kill()
        raise RuntimeError(f"UI Server failed to start on port {port}. stdout: {stdout}, stderr: {stderr}")

    yield base_url

    # Teardown
    server_proc.terminate()
    try:
        server_proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        server_proc.kill()


@pytest.fixture
def http_client(ui_server):
    """Convenience helper for HTTP requests against ui_server."""
    class Client:
        def __init__(self, base_url):
            self.base_url = base_url

        def get(self, endpoint):
            url = f"{self.base_url}{endpoint}"
            req = urllib.request.Request(url, method="GET")
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = resp.read()
                    content_type = resp.headers.get("Content-Type", "")
                    if "json" in content_type:
                        return resp.status, json.loads(data.decode("utf-8"))
                    return resp.status, data
            except urllib.error.HTTPError as e:
                err_data = e.read()
                try:
                    return e.code, json.loads(err_data.decode("utf-8"))
                except Exception:
                    return e.code, err_data

        def post(self, endpoint, data=None, is_json=True):
            url = f"{self.base_url}{endpoint}"
            body = None
            headers = {}
            if data is not None:
                if is_json:
                    body = json.dumps(data).encode("utf-8")
                    headers["Content-Type"] = "application/json; charset=utf-8"
                elif isinstance(data, (bytes, bytearray)):
                    body = data
                    headers["Content-Type"] = "application/octet-stream"
                elif isinstance(data, str):
                    body = data.encode("utf-8")
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    resp_data = resp.read()
                    content_type = resp.headers.get("Content-Type", "")
                    if "json" in content_type:
                        return resp.status, json.loads(resp_data.decode("utf-8"))
                    return resp.status, resp_data
            except urllib.error.HTTPError as e:
                err_data = e.read()
                try:
                    return e.code, json.loads(err_data.decode("utf-8"))
                except Exception:
                    return e.code, err_data

    return Client(ui_server)


@pytest.fixture
def run_validator():
    """Helper to execute fabled_validator CLI with specified arguments."""
    def _run(args, cwd=None):
        env = os.environ.copy()
        env["PYTHONPATH"] = str(VALIDATOR_DIR)
        cmd = [str(VALIDATOR_VENV_PY), "-m", "fabled_validator"] + list(args)
        proc = subprocess.run(
            cmd,
            cwd=str(cwd or VALIDATOR_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        report_json = None
        if proc.stdout:
            try:
                report_json = json.loads(proc.stdout)
            except Exception:
                pass
        return {
            "returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "report": report_json,
        }
    return _run


@pytest.fixture
def run_pipeline():
    """Helper to execute fabled_pipeline.py CLI with specified arguments."""
    def _run(args, cwd=None, timeout=60):
        cmd = [sys.executable, str(PIPELINE_DIR / "fabled_pipeline.py")] + list(args)
        proc = subprocess.run(
            cmd,
            cwd=str(cwd or PIPELINE_DIR),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        }
    return _run
