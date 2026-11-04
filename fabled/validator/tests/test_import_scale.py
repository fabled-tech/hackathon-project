import json
from fabled_validator import validate

def _run(tmp_path, profile_path, asset, scale):
    p = json.load(open(profile_path))
    p["units"]["import_scale"] = scale
    f = tmp_path / "p.json"; f.write_text(json.dumps(p))
    r = validate(str(asset), str(f))
    return {c["id"]: c for c in r["checks"]}

def test_import_scale_fixes_meters_obj(tmp_path):
    base = "fixtures/synthetic_wrong_scale_meters.obj"
    assert _run(tmp_path, "profiles/example_studio.json", base, 1.0)["scale"]["status"] == "fail"
    assert _run(tmp_path, "profiles/example_studio.json", base, 100.0)["scale"]["status"] == "pass"

def test_import_scale_rejects_nonpositive(tmp_path):
    p = json.load(open("profiles/example_studio.json"))
    p["units"]["import_scale"] = 0
    f = tmp_path / "p.json"; f.write_text(json.dumps(p))
    r = validate("fixtures/synthetic_clean_character.obj", str(f))
    assert r["overall_status"] == "error"
    assert r["error"]["type"] == "profile_error"
    assert "import_scale" in r["error"]["message"]


def test_texel_no_target_reports_measured_as_info(tmp_path):
    p = json.load(open("profiles/example_studio.json"))
    p["texel_density"]["target_px_per_cm"] = None
    f = tmp_path / "p.json"; f.write_text(json.dumps(p))
    r = validate("fixtures/synthetic_clean_character.obj", str(f))
    c = {c["id"]: c for c in r["checks"]}["texel_density"]
    assert c["status"] == "not_checked"
    assert c["message"].startswith("No studio texel target set")
    assert "px/cm" in c["message"] and c["measured"]["materials_measured"] >= 1
