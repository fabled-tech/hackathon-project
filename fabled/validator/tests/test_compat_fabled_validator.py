"""The deprecated `fabled_validator` name (pre-SculptLine rebrand) keeps working as an alias of `sculptline_validator`."""
import json
import os
import subprocess
import sys

import pytest

from conftest import FIX, PROFILE, ROOT


def _shape(obj):
    """Structure of a JSON value: dict keys (recursively) and list element shapes, without the values."""
    if isinstance(obj, dict):
        return {k: _shape(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_shape(v) for v in obj]
    return type(obj).__name__


def _run(module, *args, cwd=ROOT):
    return subprocess.run([sys.executable, "-m", module, *args], cwd=cwd, capture_output=True, text=True,
                          env={**os.environ, "PYTHONPATH": ROOT})


@pytest.mark.parametrize("asset, code", [("synthetic_storyboard_fixed.gltf", 0), ("synthetic_storyboard_two_flags.gltf", 1)])
def test_old_cli_json_only_matches_new_cli(asset, code):
    args = ("check", os.path.join(FIX, asset), "--profile", PROFILE, "--json-only")
    new, old = _run("sculptline_validator", *args), _run("fabled_validator", *args)
    assert new.returncode == old.returncode == code
    new_rep, old_rep = json.loads(new.stdout), json.loads(old.stdout)  # stdout is pure JSON for both
    assert _shape(old_rep) == _shape(new_rep)
    for k in ("overall_status", "summary", "schema_version", "tool"):
        assert old_rep[k] == new_rep[k]
    assert new_rep["tool"]["name"] == "sculptline_validator"
    assert "DeprecationWarning" in old.stderr and "sculptline_validator" in old.stderr
    assert "DeprecationWarning" not in new.stderr


def test_old_cli_error_and_usage_exit_codes(tmp_path):
    err = _run("fabled_validator", "check", str(tmp_path / "nope.obj"), "--profile", PROFILE, "--json-only")
    assert err.returncode == 2 and json.loads(err.stdout)["overall_status"] == "error"
    usage = _run("fabled_validator", "check", os.path.join(FIX, "synthetic_storyboard_fixed.gltf"), "--profile", PROFILE)
    assert usage.returncode == 2 and usage.stdout == ""  # --out required without --json-only
    assert _run("fabled_validator", "schema").stdout == _run("sculptline_validator", "schema").stdout


def test_old_import_name_is_the_same_package():
    import fabled_validator
    import sculptline_validator
    from fabled_validator.loaders.common import merge_orm as old_merge
    from fabled_validator.model import ParseError as OldParseError
    from sculptline_validator.loaders.common import merge_orm
    from sculptline_validator.model import ParseError

    assert fabled_validator.validate is sculptline_validator.validate
    assert fabled_validator.exit_code_for is sculptline_validator.exit_code_for
    assert fabled_validator.__version__ == sculptline_validator.__version__
    assert old_merge is merge_orm and OldParseError is ParseError  # same module objects, not copies


def test_schema_accepts_old_and_new_tool_name():
    jsonschema = pytest.importorskip("jsonschema")
    from sculptline_validator import validate
    schema = json.load(open(os.path.join(ROOT, "schema", "report.schema.json")))
    rep = validate(os.path.join(FIX, "synthetic_storyboard_fixed.gltf"), PROFILE)
    assert rep["tool"]["name"] == "sculptline_validator"
    jsonschema.validate(rep, schema)
    rep["tool"]["name"] = "fabled_validator"  # reports written before the rebrand
    jsonschema.validate(rep, schema)
    rep["tool"]["name"] = "something_else"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(rep, schema)
