import json
import os
import shutil
import subprocess
import sys

import pytest

from conftest import FIX, ROOT
from sculptline_validator import exit_code_for, validate

DEMO = os.path.join(ROOT, "profiles", "demo_placeholder.json")
EXAMPLE = os.path.join(ROOT, "profiles", "example_studio.json")
PIPE = os.path.join(FIX, "synthetic_pipeline_out")


def mcheck(rep):
    return next(c for c in rep["checks"] if c["id"] == "manifest")


def by_id(rep):
    return {c["id"]: c for c in rep["checks"]}


@pytest.fixture
def pipe_copy(tmp_path):
    """Copy of the passing pipeline folder; returns (dir, edit) where edit(fn) mutates manifest.json."""
    d = tmp_path / "out"
    shutil.copytree(PIPE, d)

    def edit(fn):
        mp = d / "manifest.json"
        m = json.loads(mp.read_text())
        fn(m)
        mp.write_text(json.dumps(m))
        return str(mp)
    return d, edit


# ---------------------------------------------------------------- fixtures
def test_pipeline_out_passes_with_asset_from_manifest():
    rep = validate(None, DEMO, manifest_path=os.path.join(PIPE, "manifest.json"))
    m = mcheck(rep)
    assert m["status"] == "pass", m["message"]
    assert m["measured"]["combined_triangles_per_lod"] == {"LOD0": 4608, "LOD1": 1152, "LOD2": 288, "LOD3": 72}
    assert [r["file_triangles"] for r in m["items"] if "lod" in r] == [4608, 1152, 288, 72]
    assert rep["asset"]["file_name"] == "SM_SyntheticProxy.fbx"
    assert rep["manifest"]["asset_name"] == "SyntheticProxy" and rep["manifest"]["schema"] == "fabled.pipeline.manifest/0.1"
    assert rep["overall_status"] == "pass" and exit_code_for(rep) == 0
    assert rep["checks"][-1]["id"] == "manifest" and len(rep["checks"]) == 16


def test_tri_mismatch_fails_and_shows_both_numbers():
    rep = validate(None, DEMO, manifest_path=os.path.join(FIX, "synthetic_pipeline_out_tri_mismatch", "manifest.json"))
    m = mcheck(rep)
    assert m["status"] == "fail"
    assert "LOD1 manifest says 1,252 triangles, combined FBX has 1,152" in m["message"]
    assert "SM_SyntheticProxy_LOD1.fbx has 1,152" in m["message"]
    assert exit_code_for(rep) == 1


def test_missing_lod_file_fails():
    rep = validate(None, DEMO, manifest_path=os.path.join(FIX, "synthetic_pipeline_out_missing_lod", "manifest.json"))
    m = mcheck(rep)
    assert m["status"] == "fail" and "LOD2 file not found: SM_SyntheticProxy_LOD2.fbx" in m["message"]
    others = [c for c in rep["checks"] if c["id"] != "manifest"]
    assert all(c["status"] in ("pass", "not_checked") for c in others)


# ---------------------------------------------------------------- asset selection / errors
def test_positional_asset_differs_from_combined_warns():
    rep = validate(os.path.join(PIPE, "SM_SyntheticProxy_LOD0.fbx"), DEMO, manifest_path=os.path.join(PIPE, "manifest.json"))
    m = mcheck(rep)
    assert rep["asset"]["file_name"] == "SM_SyntheticProxy_LOD0.fbx"
    assert m["status"] == "warn" and "but the manifest's combined_fbx is SM_SyntheticProxy.fbx" in m["message"]


def test_unreadable_manifest_with_asset_still_runs_other_checks(tmp_path):
    bad = tmp_path / "manifest.json"
    bad.write_text("{not json")
    rep = validate(os.path.join(PIPE, "SM_SyntheticProxy.fbx"), DEMO, manifest_path=str(bad))
    assert mcheck(rep)["status"] == "fail" and "not valid JSON" in mcheck(rep)["message"]
    assert len(rep["checks"]) == 16 and by_id(rep)["scale"]["status"] == "pass"


def test_no_asset_available_is_error(tmp_path):
    rep = validate(None, DEMO, manifest_path=str(tmp_path / "nope.json"))
    assert rep["overall_status"] == "error" and rep["error"]["type"] == "manifest_error" and exit_code_for(rep) == 2
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"schema": "fabled.pipeline.manifest/0.1", "outputs": {"lods": []}}))
    rep = validate(None, DEMO, manifest_path=str(p))
    assert rep["error"]["type"] == "manifest_error" and "combined_fbx" in rep["error"]["message"]
    p.write_text(json.dumps({"schema": "fabled.pipeline.manifest/0.1", "outputs": {"combined_fbx": "SM_Gone.fbx"}}))
    rep = validate(None, DEMO, manifest_path=str(p))
    assert rep["error"]["type"] == "manifest_error" and "SM_Gone.fbx" in rep["error"]["message"]


# ---------------------------------------------------------------- individual rules
@pytest.mark.parametrize("mutate,status,needle", [
    (lambda m: m.__setitem__("schema", "fabled.pipeline.manifest/9"), "fail", "schema is 'fabled.pipeline.manifest/9'"),
    (lambda m: m["steps"].append({"name": "normal_bake", "status": "failed"}), "fail", "pipeline step(s) failed: normal_bake"),
    (lambda m: m["steps"].append({"name": "uv_unwrap", "status": "manual"}), "warn", "steps not automated: uv_unwrap=manual"),
    (lambda m: m["warnings"].append("LOD3 over target by 4%"), "warn", "pipeline warnings (1): LOD3 over target by 4%"),
    (lambda m: m.__setitem__("status", "partial"), "warn", "pipeline status is 'partial'"),
    (lambda m: m.__setitem__("concept_mockup", True), "warn", "concept_mockup"),
    (lambda m: m["outputs"]["lods"][0].__setitem__("budget_triangles", 20000), "warn", "LOD0 manifest budget 20,000 ≠ profile budget 60,000"),
    (lambda m: m["outputs"]["lods"][2].__setitem__("has_uvs", False), "warn", "LOD2 has_uvs=False but measured UVs: True"),
    (lambda m: m.__setitem__("up_axis", "Z"), "warn", "manifest up_axis 'Z' vs FBX declares 'Y'"),
    (lambda m: m.__setitem__("units", "m"), "warn", "vs FBX UnitScaleFactor 1.0"),
    (lambda m: m["outputs"]["textures"].__setitem__("orm", "textures/T_Missing_ORM.png"), "fail", "texture not found: textures/T_Missing_ORM.png"),
    (lambda m: m["outputs"]["textures"].__setitem__("normal", "textures/T_SyntheticProxy_BC.png"), "fail", "listed as normal should end with _N"),
    (lambda m: m["outputs"]["textures"].__setitem__("normal", "textures/normal_final.png"), "fail", "does not follow T_<Name>_<BC|N|ORM>"),
])
def test_manifest_rules(pipe_copy, mutate, status, needle):
    d, edit = pipe_copy
    rep = validate(None, DEMO, manifest_path=edit(mutate))
    m = mcheck(rep)
    assert m["status"] == status, m["message"]
    assert needle in m["message"]


def test_per_material_texture_list_form(pipe_copy):
    d, edit = pipe_copy

    def f(m):
        t = m["outputs"].pop("textures")
        m["textures"] = [{"material": "M_SyntheticProxy", **t}]
    assert mcheck(validate(None, DEMO, manifest_path=edit(f)))["status"] == "pass"
    m = mcheck(validate(None, DEMO, manifest_path=edit(lambda m: m["textures"][0].__setitem__("orm", "textures/T_Nope_ORM.png"))))
    assert m["status"] == "fail" and "T_Nope_ORM.png" in m["message"]


def test_all_pipeline_warnings_are_quoted_in_full(pipe_copy):
    d, edit = pipe_copy
    ws = [f"w{i} " + "x" * 500 for i in range(5)]
    m = mcheck(validate(None, DEMO, manifest_path=edit(lambda m: m["warnings"].extend(ws))))
    assert m["status"] == "warn"
    assert m["message"].startswith("pipeline warnings (5): ") and all(w in m["message"] for w in ws)
    assert "…" not in m["message"]
    assert m["measured"]["pipeline_warnings"] == ws
    assert m["measured"]["problems_warn_list"] == ["pipeline warnings (5): " + " | ".join(ws)]


def test_every_manifest_problem_is_in_the_message(pipe_copy):
    d, edit = pipe_copy

    def f(m):
        m["steps"] += [{"name": f"s{i}", "status": "failed"} for i in range(1)]
        for k in ("orm", "normal"):
            m["outputs"]["textures"][k] = f"textures/T_Gone{k}_{'ORM' if k == 'orm' else 'N'}.png"
        m["outputs"]["lods"][0]["has_uvs"] = False
        m["status"] = "partial"
        m["warnings"] = ["a", "b"]
    m = mcheck(validate(None, DEMO, manifest_path=edit(f)))
    meas = m["measured"]
    assert m["status"] == "fail" and len(meas["problems_fail_list"]) >= 3 and len(meas["problems_warn_list"]) >= 3
    assert all(p in m["message"] for p in meas["problems_fail_list"] + meas["problems_warn_list"])
    assert "more)" not in m["message"]


def test_matching_up_axis_and_units_pass(pipe_copy):
    d, edit = pipe_copy
    m = mcheck(validate(None, DEMO, manifest_path=edit(lambda m: m.update(up_axis="Y", units="cm"))))
    assert m["status"] == "pass" and m["measured"]["fbx_up_axis"] == "Y"


def test_paths_are_relative_to_manifest_dir_not_cwd(pipe_copy, tmp_path):
    d, edit = pipe_copy
    mp = edit(lambda m: None)
    r = subprocess.run([sys.executable, "-m", "sculptline_validator", "check", "--manifest", mp, "--profile", DEMO, "--json-only"],
                       cwd=str(tmp_path), capture_output=True, text=True, env={**os.environ, "PYTHONPATH": ROOT})
    assert r.returncode == 0, r.stderr
    assert mcheck(json.loads(r.stdout))["status"] == "pass"


def test_absolute_path_warns(pipe_copy):
    d, edit = pipe_copy
    m = mcheck(validate(None, DEMO, manifest_path=edit(lambda m: m["outputs"]["lods"][0].__setitem__("path", str(d / "SM_SyntheticProxy_LOD0.fbx")))))
    assert m["status"] == "warn" and "absolute path" in m["message"]


def test_tolerates_field_variants_and_extra_fields(pipe_copy):
    d, edit = pipe_copy

    def variant(m):
        lods = m["outputs"].pop("lods")
        m["lods"] = [{"name": l["name"], "file": l["path"], "tris": l["triangles"], "target_tris": l["budget_triangles"], "extra": 1} for l in lods]
        m["something_new"] = {"x": 1}
    m = mcheck(validate(None, DEMO, manifest_path=edit(variant)))
    assert m["status"] == "pass", m["message"]


# ---------------------------------------------------------------- demo profile
def test_demo_profile_skeleton_not_checked_on_static_mesh():
    rep = validate(os.path.join(PIPE, "SM_SyntheticProxy.fbx"), DEMO)
    c = by_id(rep)
    assert rep["profile"]["name"] == "DEMO PLACEHOLDER VALUES - not a real studio spec"
    assert c["skeleton_binding"]["status"] == "not_checked" and "not required by profile" in c["skeleton_binding"]["message"]
    assert c["bone_naming"]["status"] == "not_checked" and "not required by profile" in c["bone_naming"]["message"]
    # the example profile (skeleton required) fails the same static mesh instead
    assert by_id(validate(os.path.join(PIPE, "SM_SyntheticProxy.fbx"), EXAMPLE))["skeleton_binding"]["status"] == "fail"


def test_demo_profile_still_measures_a_real_skeleton():
    c = by_id(validate(os.path.join(FIX, "synthetic_wrong_root_bone.gltf"), DEMO))["skeleton_binding"]
    assert c["status"] == "fail"  # bones exist, so they are measured even when not required


def test_demo_profile_normal_required_bc_orm_recommended(tmp_path):
    # Normal-only materials, like the current real pipeline output
    obj = tmp_path / "synthetic_n_only.obj"
    shutil.copy(os.path.join(FIX, "synthetic_clean_character.obj"), obj)
    shutil.copytree(os.path.join(FIX, "textures"), tmp_path / "textures")
    mtl = "newmtl M_Body\nmap_Bump textures/T_Body_N.png\nnewmtl M_Head\nmap_Bump textures/T_Head_N.png\n"
    (tmp_path / "synthetic_clean_character.mtl").write_text(mtl)
    c = by_id(validate(str(obj), DEMO))["texture_slots"]
    assert c["status"] == "warn" and "recommended missing" in c["message"]
    (tmp_path / "synthetic_clean_character.mtl").write_text("newmtl M_Body\nmap_Kd textures/T_Body_BC.png\nnewmtl M_Head\nmap_Kd textures/T_Head_BC.png\n")
    c = by_id(validate(str(obj), DEMO))["texture_slots"]
    assert c["status"] == "fail" and "missing Normal" in c["message"]


# ---------------------------------------------------------------- contract
def test_reports_match_schema_and_old_shape_still_valid():
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.load(open(os.path.join(ROOT, "schema", "report.schema.json")))
    for d in ("synthetic_pipeline_out", "synthetic_pipeline_out_tri_mismatch", "synthetic_pipeline_out_missing_lod"):
        rep = validate(None, DEMO, manifest_path=os.path.join(FIX, d, "manifest.json"))
        assert rep["schema_version"] == "0.2.0"
        jsonschema.validate(rep, schema)
    err = validate(None, DEMO, manifest_path="/nonexistent/manifest.json")
    jsonschema.validate(err, schema)
    old = validate(os.path.join(FIX, "synthetic_storyboard_fixed.gltf"), EXAMPLE)
    assert old["manifest"] is None and "manifest" not in [c["id"] for c in old["checks"]]
    old["schema_version"] = "0.1.0"
    del old["manifest"]
    jsonschema.validate(old, schema)


def test_cli_manifest_asset_omitted_and_exit_codes(tmp_path):
    base = [sys.executable, "-m", "sculptline_validator", "check", "--profile", DEMO]
    ok = subprocess.run(base + ["--manifest", os.path.join(PIPE, "manifest.json"), "--json-only"], cwd=ROOT, capture_output=True, text=True)
    assert ok.returncode == 0 and json.loads(ok.stdout)["asset"]["file_name"] == "SM_SyntheticProxy.fbx"
    bad = subprocess.run(base + ["--manifest", os.path.join(FIX, "synthetic_pipeline_out_tri_mismatch", "manifest.json"), "--out", str(tmp_path)],
                         cwd=ROOT, capture_output=True, text=True)
    assert bad.returncode == 1 and "[FAIL] Pipeline manifest" in bad.stdout
    html = (tmp_path / "SM_SyntheticProxy_fbx.report.html").read_text()
    assert 'data-check="manifest"' in html and "1,252" in html
    err = subprocess.run(base + ["--manifest", str(tmp_path / "missing.json"), "--json-only"], cwd=ROOT, capture_output=True, text=True)
    assert err.returncode == 2 and json.loads(err.stdout)["error"]["type"] == "manifest_error"
    none = subprocess.run(base + ["--json-only"], cwd=ROOT, capture_output=True, text=True)
    assert none.returncode == 2
    both = subprocess.run(base + [os.path.join(PIPE, "SM_SyntheticProxy_LOD1.fbx"), "--manifest", os.path.join(PIPE, "manifest.json"), "--json-only"],
                          cwd=ROOT, capture_output=True, text=True)
    assert both.returncode == 1 and mcheck(json.loads(both.stdout))["status"] == "warn"


# ---------------------------------------------------------------- export_up_axis contract
# The synthetic combined FBX declares UpAxis Y.
@pytest.mark.parametrize("where", ["top", "outputs"])
def test_export_up_axis_matching_no_warn_and_source_axis_is_info(pipe_copy, where):
    d, edit = pipe_copy

    def f(m):
        m["up_axis"] = "Z"  # source axis differs from the FBX: must NOT warn
        (m if where == "top" else m["outputs"])["export_up_axis"] = "Y"
    m = mcheck(validate(None, DEMO, manifest_path=edit(f)))
    assert m["status"] == "pass", m["message"]
    assert "up_axis" not in m["message"]
    meas = m["measured"]
    assert meas["export_up_axis"] == "Y" and meas["source_up_axis"] == "Z" and meas["fbx_up_axis"] == "Y"
    assert meas["axis_compared"] == ("export_up_axis" if where == "top" else "outputs.export_up_axis")


@pytest.mark.parametrize("where,key", [("top", "export_up_axis"), ("outputs", "outputs.export_up_axis")])
def test_export_up_axis_mismatch_warns(pipe_copy, where, key):
    d, edit = pipe_copy

    def f(m):
        m["up_axis"] = "Y"  # would match the FBX, but export_up_axis is what counts
        (m if where == "top" else m["outputs"])["export_up_axis"] = "Z"
    m = mcheck(validate(None, DEMO, manifest_path=edit(f)))
    assert m["status"] == "warn"
    assert f"manifest {key} 'Z' vs FBX declares 'Y'" in m["message"]
    assert "manifest up_axis" not in m["message"]


def test_export_up_axis_absent_keeps_old_up_axis_comparison(pipe_copy):
    d, edit = pipe_copy
    m = mcheck(validate(None, DEMO, manifest_path=edit(lambda m: m.update(up_axis="Z"))))
    assert m["status"] == "warn" and "manifest up_axis 'Z' vs FBX declares 'Y'" in m["message"]
    assert m["measured"]["axis_compared"] == "up_axis" and "export_up_axis" not in m["measured"]
    m = mcheck(validate(None, DEMO, manifest_path=edit(lambda m: m.update(up_axis="+y"))))
    assert m["status"] == "pass"


def test_html_manifest_card_lists_every_warning_in_full(pipe_copy):
    from sculptline_validator.html_report import render_html
    d, edit = pipe_copy
    ws = [f"warning {i}: " + "long text " * 40 for i in range(5)]
    rep = validate(None, DEMO, manifest_path=edit(lambda m: m["warnings"].extend(ws)))
    h = render_html(rep)
    card = h.split('data-check="manifest"')[1].split('<div class="foot">')[0]
    assert card.count("<li>warning ") == 5 and all(w in card for w in ws)
    assert "<details" not in h and "<script" not in h and "…" not in card
    assert 'class="grid grid3"' in h  # 15 checks in three columns, manifest card full width below
