import json
import os
import shutil
import struct
import subprocess
import sys

import numpy as np
import pytest

from conftest import FIX, PROFILE, ROOT
from fabled_validator import exit_code_for, validate
from fabled_validator.geometry import analyze
from fabled_validator.images import image_size
from fabled_validator.model import Mesh

ALL_FIXTURES = sorted(f for f in os.listdir(FIX) if f.startswith("synthetic_") and f.rsplit(".", 1)[-1] in ("obj", "gltf", "glb", "fbx"))


def run(name, profile=PROFILE):
    return validate(os.path.join(FIX, name), profile)


def status(rep):
    return {c["id"]: c["status"] for c in rep["checks"]}


def flagged(rep):
    return sorted(c["id"] for c in rep["checks"] if c["status"] in ("warn", "fail"))


def check(rep, cid):
    return next(c for c in rep["checks"] if c["id"] == cid)


# ---------------------------------------------------------------- clean assets
@pytest.mark.parametrize("name", ["synthetic_clean_character.glb", "synthetic_storyboard_fixed.gltf", "synthetic_clean_character.fbx"])
def test_clean_skinned_assets_fully_green(name):
    rep = run(name)
    assert rep["overall_status"] == "pass"
    assert rep["complete"] is True
    assert set(status(rep).values()) == {"pass"}
    assert exit_code_for(rep) == 0


def test_clean_obj_passes_but_skeleton_not_checked():
    rep = run("synthetic_clean_character.obj")
    st = status(rep)
    assert rep["overall_status"] == "pass" and rep["complete"] is False
    assert st["skeleton_binding"] == "not_checked" and st["bone_naming"] == "not_checked"
    assert "no skeleton" in check(rep, "skeleton_binding")["message"]
    assert [k for k, v in st.items() if v != "pass"] == ["skeleton_binding", "bone_naming"]


# ---------------------------------------------------------------- storyboard pair
def test_storyboard_case_has_exactly_two_flags_scale_and_normals():
    rep = run("synthetic_storyboard_two_flags.gltf")
    assert flagged(rep) == ["normals", "scale"]
    assert rep["summary"]["flagged"] == 2
    assert check(rep, "scale")["measured"]["height_cm"] == pytest.approx(18000.0)
    assert check(rep, "normals")["measured"]["faces_flagged"] == 128
    # texel density depends on scale, so it is explicitly not_checked, never faked
    assert check(rep, "texel_density")["status"] == "not_checked"
    assert exit_code_for(rep) == 1


def test_storyboard_fixed_turns_the_two_flags_green():
    bad = run("synthetic_storyboard_two_flags.gltf")
    good = run("synthetic_storyboard_fixed.gltf")
    for cid in ("scale", "normals"):
        assert check(bad, cid)["status"] == "fail" and check(good, cid)["status"] == "pass"
    assert check(good, "scale")["measured"]["height_cm"] == pytest.approx(180.0)
    assert [c["id"] for c in bad["checks"]] == [c["id"] for c in good["checks"]]


# ---------------------------------------------------------------- per-check fixtures
def test_scale_meters_obj():
    rep = run("synthetic_wrong_scale_meters.obj")
    c = check(rep, "scale")
    assert c["status"] == "fail"
    assert c["measured"]["height_cm"] == pytest.approx(1.8)
    assert c["measured"]["fix_hints"][0]["operation"] == "×100"
    assert flagged(rep) == ["scale"]


def test_scale_fbx_unit_metadata():
    rep = run("synthetic_wrong_unit_scale.fbx")
    c = check(rep, "scale")
    assert c["status"] == "fail" and c["measured"]["cm_per_file_unit"] == 100.0
    assert "UnitScaleFactor" in c["measured"]["unit_basis"]
    assert flagged(rep) == ["scale"]


def test_scale_obj_respects_assumed_units(profile_with):
    rep = run("synthetic_wrong_scale_meters.obj", profile_with(units__assumed_source_units="m"))
    assert check(rep, "scale")["status"] == "pass"


def test_flipped_faces_counts_both_signals():
    rep = run("synthetic_flipped_faces.obj")
    m = check(rep, "normals")["measured"]
    assert check(rep, "normals")["status"] == "fail"
    assert m["faces_flagged"] == 128 and m["faces_winding_inconsistent"] == 128 and m["faces_stored_normal_against_face"] == 128
    assert flagged(rep) == ["normals"]


def test_non_manifold_and_degenerate():
    rep = run("synthetic_geometry_issues.obj")
    assert flagged(rep) == ["degenerate_triangles", "non_manifold"]
    assert check(rep, "non_manifold")["measured"]["non_manifold_edges"] == 1
    d = check(rep, "degenerate_triangles")["measured"]
    assert d["repeated_vertex"] == 1 and d["zero_area"] == 2


def test_closed_mesh_rule(profile_with):
    rep = run("synthetic_geometry_issues.obj", profile_with(geometry__allow_open_boundaries=False))
    assert check(rep, "non_manifold")["measured"]["open_boundary_edges"] > 0


def test_missing_texture():
    rep = run("synthetic_missing_texture.obj")
    c = check(rep, "texture_files")
    assert c["status"] == "fail" and c["measured"]["missing"] == 1
    assert c["items"][0]["file"] == "T_Vendor_N.png"
    assert flagged(rep) == ["texture_files"]


def test_uv_and_texture_issues():
    rep = run("synthetic_uv_texture_issues.obj")
    st = status(rep)
    assert st["uv_layout"] == "fail" and check(rep, "uv_layout")["measured"]["faces_out_of_range"] == 128
    assert st["texture_slots"] == "fail" and "ORM" in check(rep, "texture_slots")["message"]
    assert st["texture_naming"] == "fail" and check(rep, "texture_naming")["items"][0]["file"] == "body_normal_final.png"
    sizes = check(rep, "texture_size")
    assert sizes["status"] == "fail" and "1000x1000 not power of two" in sizes["message"] and "8192x8 exceeds 4096" in sizes["message"]
    td = check(rep, "texel_density")
    assert td["status"] == "warn" and td["measured"]["px_per_cm"]["M_Head"] < 7.68
    assert flagged(rep) == ["texel_density", "texture_naming", "texture_size", "texture_slots", "uv_layout"]


def test_uv_udim_mode(profile_with):
    rep = run("synthetic_uv_texture_issues.obj", profile_with(uv__udim=True))
    c = check(rep, "uv_layout")
    assert c["status"] == "pass" and c["measured"]["udim_tiles"] == [1001, 1002]


def test_wrong_root_bone():
    rep = run("synthetic_wrong_root_bone.gltf")
    c = check(rep, "skeleton_binding")
    assert c["status"] == "fail" and c["measured"]["root_bones"] == ["hips"]
    assert flagged(rep) == ["skeleton_binding"]


def test_bad_bone_names():
    rep = run("synthetic_bad_bone_names.gltf")
    c = check(rep, "bone_naming")
    assert c["status"] == "fail" and sorted(i["bone"] for i in c["items"]) == ["Pelvis", "mixamorig:LeftArm", "spine.001"]
    assert flagged(rep) == ["bone_naming"]


def test_skeleton_required_but_missing_on_static_gltf(tmp_path):
    src = json.load(open(os.path.join(FIX, "synthetic_storyboard_fixed.gltf")))
    src.pop("skins")
    for n in src["nodes"]:
        n.pop("skin", None)
    for m in src["meshes"]:
        for p in m["primitives"]:
            p["attributes"].pop("JOINTS_0"); p["attributes"].pop("WEIGHTS_0")
    shutil.copy(os.path.join(FIX, "synthetic_storyboard_fixed.bin"), tmp_path)
    shutil.copytree(os.path.join(FIX, "textures"), tmp_path / "textures")
    p = tmp_path / "synthetic_storyboard_fixed.gltf"
    p.write_text(json.dumps(src))
    rep = validate(str(p), PROFILE)
    assert check(rep, "skeleton_binding")["status"] == "fail"
    assert check(rep, "bone_naming")["status"] == "not_checked"


def test_skinned_mesh_without_skin(tmp_path):
    src = json.load(open(os.path.join(FIX, "synthetic_storyboard_fixed.gltf")))
    for n in src["nodes"]:
        n.pop("skin", None)
    shutil.copy(os.path.join(FIX, "synthetic_storyboard_fixed.bin"), tmp_path)
    shutil.copytree(os.path.join(FIX, "textures"), tmp_path / "textures")
    p = tmp_path / "x.gltf"
    p.write_text(json.dumps(src))
    c = check(validate(str(p), PROFILE), "skeleton_binding")
    assert c["status"] == "fail" and c["measured"]["skinned_meshes_without_skin"] == 2


def test_triangle_budget_and_lod_count(profile_with):
    assert check(run("synthetic_clean_character.obj"), "triangle_budget")["measured"]["triangles_per_lod"] == {"LOD0": 4608, "LOD1": 288}
    over = check(run("synthetic_clean_character.obj", profile_with(lods__triangle_budgets=[1000, 100])), "triangle_budget")
    assert over["status"] == "fail" and "LOD0 4,608 > 1,000" in over["message"]
    few = check(run("synthetic_clean_character.obj", profile_with(lods__min_count=3)), "triangle_budget")
    assert few["status"] == "fail"


def test_material_count(profile_with):
    c = check(run("synthetic_clean_character.glb", profile_with(materials__max_count=1)), "material_count")
    assert c["status"] == "fail" and c["measured"]["materials_used"] == 2


def test_texel_density_values_and_tolerance(profile_with):
    c = check(run("synthetic_clean_character.glb"), "texel_density")
    assert c["status"] == "pass"
    assert c["measured"]["px_per_cm"]["M_Head"] == pytest.approx(10.24, rel=1e-3)
    c = check(run("synthetic_clean_character.glb", profile_with(texel_density__target_px_per_cm=20.48, texel_density__severity="fail")), "texel_density")
    assert c["status"] == "fail"


def test_texel_density_not_checked_without_texture_sizes(tmp_path):
    for f in ("synthetic_clean_character.obj", "synthetic_clean_character.mtl"):
        shutil.copy(os.path.join(FIX, f), tmp_path)
    c = check(validate(str(tmp_path / "synthetic_clean_character.obj"), PROFILE), "texel_density")
    assert c["status"] == "not_checked"


def test_up_axis_wrong(profile_with):
    c = check(run("synthetic_clean_character.obj", profile_with(axes__up="Z")), "up_axis")
    assert c["status"] == "warn" and c["measured"]["tallest_axis"] == "Y"
    c = check(run("synthetic_clean_character.fbx", profile_with(axes__up="Z")), "up_axis")
    assert c["status"] == "warn" and "declares Y" in c["message"]


# ---------------------------------------------------------------- geometry unit tests
def _box(inverted=False):
    v = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], float)
    t = np.array([[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]])
    if inverted:
        t = t[:, [0, 2, 1]]
    return Mesh(name="box", positions=v, tris=t, face_material=np.zeros(len(t), int))


def test_geometry_box_is_clean_and_inverted_box_is_caught():
    a = analyze(_box(), 1.7)
    assert a["nonmanifold_edges"] == 0 and a["boundary_edges"] == 0 and a["winding_flipped_mask"].sum() == 0
    b = analyze(_box(inverted=True), 1.7)
    assert b["winding_flipped_mask"].sum() == 12 and b["inverted_components"] == 1


# ---------------------------------------------------------------- formats / errors / contract
def test_image_header_reader():
    png = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 512, 256) + b"\x08\x02\x00\x00\x00"
    assert image_size(png)[:2] == (512, 256)
    jpg = b"\xff\xd8" + b"\xff\xe0" + struct.pack(">H", 4) + b"\x00\x00" + b"\xff\xc0" + struct.pack(">HBHH", 11, 8, 300, 640) + b"\x03"
    assert image_size(jpg) == (640, 300, "jpeg")
    tga = bytes([0, 0, 2]) + b"\x00" * 9 + struct.pack("<HH", 128, 64) + bytes([32, 8])
    assert image_size(tga) == (128, 64, "tga")


def test_ascii_fbx_is_a_clear_error(tmp_path):
    p = tmp_path / "ascii.fbx"
    p.write_text("; FBX 7.4.0 project file\nFBXHeaderExtension:  {\n}\n")
    rep = validate(str(p), PROFILE)
    assert rep["overall_status"] == "error" and rep["error"]["type"] == "unsupported_format"
    assert "ASCII FBX" in rep["error"]["message"]
    assert exit_code_for(rep) == 2


def test_unsupported_extension_and_bad_profile(tmp_path):
    p = tmp_path / "a.blend"
    p.write_bytes(b"BLENDER")
    assert validate(str(p), PROFILE)["error"]["type"] == "unsupported_format"
    bad = tmp_path / "bad.json"
    bad.write_text('{"profile_name": "x", "axes": {"up": "Q"}}')
    assert validate(os.path.join(FIX, "synthetic_clean_character.obj"), str(bad))["error"]["type"] == "profile_error"


def test_fbx_fixture_is_readable_by_an_independent_parser():
    assimp = pytest.importorskip("assimp_py")
    s = assimp.import_file(os.path.join(FIX, "synthetic_clean_character.fbx"), assimp.Process_Triangulate)
    tris = sum(len(m.indices) // 3 for m in s.meshes if m.name == "SK_Character_LOD0")
    assert tris == 4608
    bones = {b.name for m in s.meshes for b in m.bones}
    assert {"spine_01", "head", "thigh_l"} <= bones
    tex = {t for m in s.materials for v in m["TEXTURES"].values() for t in v}
    assert "textures/T_Body_BC.png" in tex
    ours = run("synthetic_clean_character.fbx")
    assert ours["asset_stats"]["triangles_total"] == sum(len(m.indices) // 3 for m in s.meshes)


@pytest.mark.parametrize("name", ALL_FIXTURES)
def test_every_report_matches_schema(name):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.load(open(os.path.join(ROOT, "schema", "report.schema.json")))
    rep = run(name)
    jsonschema.validate(rep, schema)
    assert [c["id"] for c in rep["checks"]] == [
        "scale", "up_axis", "normals", "non_manifold", "degenerate_triangles", "triangle_budget", "skeleton_binding",
        "bone_naming", "texture_files", "texture_slots", "texture_naming", "texture_size", "material_count", "uv_layout", "texel_density"]


def test_cli_json_only_and_exit_codes(tmp_path):
    cmd = [sys.executable, "-m", "fabled_validator", "check"]
    ok = subprocess.run(cmd + [os.path.join(FIX, "synthetic_storyboard_fixed.gltf"), "--profile", PROFILE, "--json-only"], cwd=ROOT, capture_output=True, text=True)
    assert ok.returncode == 0 and json.loads(ok.stdout)["overall_status"] == "pass"
    bad = subprocess.run(cmd + [os.path.join(FIX, "synthetic_storyboard_two_flags.gltf"), "--profile", PROFILE, "--json-only"], cwd=ROOT, capture_output=True, text=True)
    assert bad.returncode == 1 and json.loads(bad.stdout)["summary"]["flagged"] == 2
    err = subprocess.run(cmd + [str(tmp_path / "nope.obj"), "--profile", PROFILE, "--json-only"], cwd=ROOT, capture_output=True, text=True)
    assert err.returncode == 2 and json.loads(err.stdout)["overall_status"] == "error"
    out = subprocess.run(cmd + [os.path.join(FIX, "synthetic_flipped_faces.obj"), "--profile", PROFILE, "--out", str(tmp_path)], cwd=ROOT, capture_output=True, text=True)
    assert out.returncode == 1
    assert (tmp_path / "synthetic_flipped_faces_obj.report.json").exists() and (tmp_path / "synthetic_flipped_faces_obj.report.html").exists()


def test_html_shows_only_measured_values(tmp_path):
    from fabled_validator.html_report import render_html
    rep = run("synthetic_storyboard_two_flags.gltf")
    h = render_html(rep)
    assert "2 items flagged" in h and "18,000 cm" in h and "128 of 4,896" in h
    assert "SYNTHETIC TEST ASSET" in h and "CONCEPT MOCKUP" not in h
    assert h.count('class="row fail"') == 2
    assert "<script" not in h and "http" not in h.split("<body>")[1]  # self-contained, nothing fetched


def test_html_keeps_full_messages_and_balances_columns():
    from fabled_validator.html_report import _split, render_html
    rep = validate(os.path.join(FIX, "synthetic_storyboard_two_flags.gltf"), os.path.join(ROOT, "profiles", "example_studio.json"))
    k0 = _split(rep["checks"])
    long = "x " * 400
    rep["checks"][-1]["message"] = long
    html = render_html(rep)
    assert long.strip() in html  # never truncated
    k = _split(rep["checks"])
    assert 1 <= k < len(rep["checks"]) and k > k0  # a long card in the right column pulls more rows left


# ---------------------------------------------------------------- normals: two separate signals
def _obj_variant(tmp_path, reverse_winding, negate_normals, n_faces=40):
    """Copy the clean OBJ; for the first n_faces of LOD0 optionally reverse the corner order and/or
    point the corners at negated copies of their stored normals."""
    src = open(os.path.join(FIX, "synthetic_clean_character.obj")).read().splitlines()
    vns = [l for l in src if l.startswith("vn ")]
    out, extra, done = [], [], 0
    for l in src:
        if l.startswith("f ") and done < n_faces:
            corners = l.split()[1:]
            if negate_normals:
                nc = []
                for c in corners:
                    v, vt, vn = c.split("/")
                    x, y, z = map(float, vns[int(vn) - 1].split()[1:])
                    extra.append(f"vn {-x} {-y} {-z}")
                    nc.append(f"{v}/{vt}/{len(vns) + len(extra)}")
                corners = nc
            if reverse_winding:
                corners = corners[::-1]
            l = "f " + " ".join(corners)
            done += 1
        out.append(l)
    i = max(k for k, l in enumerate(out) if l.startswith("vn "))
    out[i + 1:i + 1] = extra
    d = tmp_path / ("w" if reverse_winding else "") / ("n" if negate_normals else "")
    d.mkdir(parents=True, exist_ok=True)
    f = d / "synthetic_normals_variant.obj"
    f.write_text("\n".join(out) + "\n")
    shutil.copy(os.path.join(FIX, "synthetic_clean_character.mtl"), d)
    shutil.copytree(os.path.join(FIX, "textures"), d / "textures")
    return str(f)


def test_normals_reversed_winding_only(tmp_path):
    c = check(validate(_obj_variant(tmp_path, True, True), PROFILE), "normals")
    m = c["measured"]
    assert c["status"] == "fail"
    assert m["reversed_winding"] == 40 and m["stored_normals_against_face"] == 0 and m["faces_flagged"] == 40
    assert "reversed winding: 40; stored normals against face: 0." in c["message"] and "wrong way" not in c["message"]


def test_normals_stored_normal_mismatch_only(tmp_path):
    c = check(validate(_obj_variant(tmp_path, False, True), PROFILE), "normals")
    m = c["measured"]
    assert c["status"] == "fail"
    assert m["reversed_winding"] == 0 and m["stored_normals_against_face"] == 40 and m["flagged_by_both"] == 0
    assert "40 of" in c["message"] and "reversed winding: 0; stored normals against face: 40." in c["message"]


def test_normals_split_counts_on_storyboard_pair():
    c = check(run("synthetic_storyboard_two_flags.gltf"), "normals")
    m = c["measured"]
    assert (m["reversed_winding"], m["stored_normals_against_face"], m["flagged_by_both"], m["faces_flagged"]) == (128, 128, 128, 128)
    assert "128 of 4,896 triangles flagged — reversed winding: 128; stored normals against face: 128 (128 in both)." in c["message"]
    m = check(run("synthetic_storyboard_fixed.gltf"), "normals")["measured"]
    assert (m["reversed_winding"], m["stored_normals_against_face"]) == (0, 0)
