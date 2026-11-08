"""SculptLine rebrand compatibility: the deprecated fabled_pipeline.py shim and FABLED_* env fallbacks keep working."""
import json
import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(HERE)
ROOT_DIR = os.path.dirname(PIPELINE_DIR)
NEW_CLI = os.path.join(PIPELINE_DIR, "sculptline_pipeline.py")
OLD_CLI = os.path.join(PIPELINE_DIR, "fabled_pipeline.py")
FIXTURE_MESH = os.path.join(ROOT_DIR, "validator", "fixtures", "synthetic_clean_character.obj")


def _clean_env(**extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("SCULPTLINE_", "FABLED_"))}
    env.update(extra)
    return env


def _default_blender(env):
    """What the driver picks as its --blender default under the given environment."""
    code = "import sys; sys.path.insert(0, sys.argv[1]); import sculptline_pipeline as p; print(p.DEFAULT_BLENDER)"
    res = subprocess.run([sys.executable, "-c", code, PIPELINE_DIR], capture_output=True, text=True, env=env, timeout=30)
    assert res.returncode == 0, res.stderr
    return res.stdout.strip()


def test_old_cli_help_still_works():
    old = subprocess.run([sys.executable, OLD_CLI, "--help"], capture_output=True, text=True, timeout=30)
    new = subprocess.run([sys.executable, NEW_CLI, "--help"], capture_output=True, text=True, timeout=30)
    assert old.returncode == new.returncode == 0
    assert "--input" in old.stdout and "SculptLine" in old.stdout
    assert old.stdout == new.stdout


def test_old_cli_passes_exit_code_through(tmp_path):
    old = subprocess.run([sys.executable, OLD_CLI], capture_output=True, text=True, timeout=30)  # missing --input
    new = subprocess.run([sys.executable, NEW_CLI], capture_output=True, text=True, timeout=30)
    assert old.returncode == new.returncode == 2
    codes = []
    for cli in (OLD_CLI, NEW_CLI):  # input not found -> step 01 fails -> exit 1
        r = subprocess.run([sys.executable, cli, "--input", str(tmp_path / "missing.obj"), "--out", str(tmp_path / os.path.basename(cli)),
                            "--blender", "native"], capture_output=True, text=True, timeout=60)
        codes.append(r.returncode)
    assert codes[0] == codes[1] == 1


def test_old_cli_native_run(tmp_path):
    out = tmp_path / "out"
    res = subprocess.run([sys.executable, OLD_CLI, "--input", FIXTURE_MESH, "--out", str(out), "--blender", "native"],
                         capture_output=True, text=True, timeout=120)
    assert res.returncode == 0, res.stdout[-2000:] + res.stderr[-2000:]
    assert "SculptLine pipeline |" in res.stdout
    m = json.loads((out / "manifest.json").read_text())
    assert m["schema"] == "fabled.pipeline.manifest/0.1"  # wire-format id unchanged on purpose
    assert m["tool"]["name"] == "SculptLine pipeline"


def test_old_module_import_reexports_new():
    sys.path.insert(0, PIPELINE_DIR)
    import fabled_pipeline
    import sculptline_pipeline
    assert fabled_pipeline.wait_for_other_blender is sculptline_pipeline.wait_for_other_blender
    assert fabled_pipeline.env is sculptline_pipeline.env


@pytest.mark.parametrize("env_vars, expected", [
    ({"SCULPTLINE_BLENDER": "/opt/new/blender", "FABLED_BLENDER": "/opt/old/blender"}, "/opt/new/blender"),
    ({"FABLED_BLENDER": "/opt/old/blender"}, "/opt/old/blender"),
    ({"SCULPTLINE_BLENDER": "/opt/new/blender"}, "/opt/new/blender"),
    ({"SCULPTLINE_BLENDER": "", "FABLED_BLENDER": "/opt/old/blender"}, "/opt/old/blender"),  # empty = unset
])
def test_blender_lookup_prefers_sculptline_env(env_vars, expected):
    assert _default_blender(_clean_env(**env_vars)) == expected


def test_env_helper_order(monkeypatch):
    sys.path.insert(0, PIPELINE_DIR)
    import sculptline_pipeline as p
    monkeypatch.delenv("SCULPTLINE_X_TEST", raising=False)
    monkeypatch.delenv("FABLED_X_TEST", raising=False)
    assert p.env("X_TEST", "dflt") == "dflt"
    monkeypatch.setenv("FABLED_X_TEST", "old")
    assert p.env("X_TEST") == "old"
    monkeypatch.setenv("SCULPTLINE_X_TEST", "new")
    assert p.env("X_TEST") == "new"
