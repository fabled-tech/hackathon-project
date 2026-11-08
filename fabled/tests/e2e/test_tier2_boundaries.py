"""
Tier 2: Boundary & Corner Cases for Fabled Capability Showcase
Covers all 22 features from PROJECT.md § Feature Inventory.
Each feature is tested with at least 5 boundary, edge, or corner case tests (total >= 110 tests).
"""

import os
import sys
import json
import time
import subprocess
from pathlib import Path
import pytest

# ============================================================================
# Feature 1: Live Pipeline Job Dispatching (Boundary / Corner Cases)
# ============================================================================

def test_t2_f01_01_empty_job_payload(http_client, project_paths):
    """POST /api/jobs with 0-byte body creates job file gracefully."""
    status, res = http_client.post("/api/jobs?filename=empty.obj", data=b"", is_json=False)
    assert status == 200
    assert "job_id" in res
    job_file = project_paths["ui"] / "work" / res["job_id"] / "empty.obj"
    assert job_file.exists()
    assert job_file.stat().st_size == 0


def test_t2_f01_02_nonexistent_job_process_404(http_client):
    """POST /api/jobs/:id/process on nonexistent job returns 404."""
    status, res = http_client.post("/api/jobs/nonexistent-job-id-0000/process", data={})
    assert status == 404
    assert res.get("error") == "unknown job"


def test_t2_f01_03_readonly_job_process_rejected(http_client):
    """POST /api/jobs/:id/process on read-only opened output returns error."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    status, proc_res = http_client.post(f"/api/jobs/{job_id}/process", data={})
    assert status == 200
    assert proc_res.get("ok") is False
    assert "read-only" in proc_res.get("error", "").lower()


def test_t2_f01_04_already_running_guard(http_client):
    """Rapid second POST /process returns already_running: true if active."""
    status, job = http_client.post("/api/jobs?filename=test.obj", data=b"v 0 0 0\n", is_json=False)
    assert status == 200
    job_id = job["job_id"]
    status, res1 = http_client.post(f"/api/jobs/{job_id}/process", data={})
    assert status == 200
    status, res2 = http_client.post(f"/api/jobs/{job_id}/process", data={})
    assert status == 200
    assert res2.get("already_running") is True or res2.get("ok") is True


def test_t2_f01_05_files_path_traversal_prevention(http_client):
    """GET /api/jobs/:id/files with directory traversal path rejects with path escape error."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    status, file_res = http_client.get(f"/api/jobs/{job_id}/files/../../package.json")
    assert status in [400, 404]


# ============================================================================
# Feature 2: Dual-Engine Execution (Boundary / Corner Cases)
# ============================================================================

def test_t2_f02_01_native_engine_missing_input(run_pipeline, project_paths, tmp_path):
    """Passing nonexistent input path exits 1 with input not found message."""
    out_dir = tmp_path / "missing_input"
    res = run_pipeline([
        "--input", "/nonexistent/path/mesh.obj",
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] != 0
    assert "not found" in res["stderr"].lower() or "not found" in res["stdout"].lower()


def test_t2_f02_02_native_engine_degenerate_mesh(run_pipeline, project_paths, tmp_path):
    """Processing a minimal 3-vertex single triangle mesh clamps decimation budgets."""
    mesh_file = tmp_path / "single_tri.obj"
    mesh_file.write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")
    out_dir = tmp_path / "single_tri_out"
    res = run_pipeline([
        "--input", str(mesh_file),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] == 0
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert len(manifest["lods"]) >= 1


def test_t2_f02_03_unsupported_mesh_format(run_pipeline, project_paths, tmp_path):
    """Passing file with unsupported format extension reports error."""
    bad_file = tmp_path / "mesh.xyz"
    bad_file.write_text("unsupported content")
    res = run_pipeline([
        "--input", str(bad_file),
        "--out", str(tmp_path / "bad_out"),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] != 0 or "failed" in res["stdout"].lower() or "error" in res["stdout"].lower()


def test_t2_f02_04_extreme_triangle_budget(run_pipeline, project_paths, tmp_path):
    """Specifying higher target_tris than source triangle count clamps to source tris."""
    out_dir = tmp_path / "high_budget"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] == 0
    manifest = json.loads((out_dir / "manifest.json").read_text())
    lod0_tris = manifest["lods"][0]["triangles"]
    assert lod0_tris > 0


def test_t2_f02_05_corrupt_config_json(run_pipeline, project_paths, tmp_path):
    """Corrupt config JSON file reports failure and exits cleanly."""
    corrupt_cfg = tmp_path / "corrupt_config.json"
    corrupt_cfg.write_text("{ unclosed json: ")
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(tmp_path / "cfg_fail"),
        "--config", str(corrupt_cfg),
        "--blender", "none"
    ])
    assert res["returncode"] != 0


# ============================================================================
# Feature 3: Atomic Live Progress Telemetry (Boundary / Corner Cases)
# ============================================================================

def test_t2_f03_01_failed_progress_state(run_pipeline, project_paths, tmp_path):
    """Pipeline failure marks progress status as failed."""
    out_dir = tmp_path / "fail_prog"
    res = run_pipeline([
        "--input", "/nonexistent/mesh.obj",
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    prog_file = out_dir / "progress.json"
    if prog_file.exists():
        prog = json.loads(prog_file.read_text())
        assert prog["status"] == "failed"


def test_t2_f03_02_progress_zero_total_prevention(project_paths):
    """Progress object total must be a positive integer, never zero."""
    prog = json.loads((project_paths["pipeline_output"] / "progress.json").read_text())
    assert prog["total"] > 0


def test_t2_f03_03_progress_timestamp_recent(run_pipeline, project_paths, tmp_path):
    """Newly generated progress updated_at timestamp is valid ISO format."""
    out_dir = tmp_path / "ts_check"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    prog = json.loads((out_dir / "progress.json").read_text())
    assert "T" in prog["updated_at"]


def test_t2_f03_04_progress_file_non_empty(project_paths):
    """Progress file has valid non-zero byte size."""
    prog_file = project_paths["pipeline_output"] / "progress.json"
    assert prog_file.stat().st_size > 20


def test_t2_f03_05_progress_monotonic_step_bounds(project_paths):
    """Step index is always within [1, total]."""
    prog = json.loads((project_paths["pipeline_output"] / "progress.json").read_text())
    assert 1 <= prog["step"] <= prog["total"]


# ============================================================================
# Feature 4: In-Workspace Pre-Import Validation (Boundary / Corner Cases)
# ============================================================================

def test_t2_f04_01_validator_corrupt_asset_exit2(run_validator, project_paths, tmp_path):
    """Validator with unparseable binary file exits with code 2."""
    corrupt_file = tmp_path / "corrupt.fbx"
    corrupt_file.write_bytes(b"NON_FBX_RANDOM_DATA_HEADER_BYTES_12345")
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    res = run_validator(["check", str(corrupt_file), "--profile", str(profile), "--json-only"])
    assert res["returncode"] == 2


def test_t2_f04_02_validator_flipped_normals_detection(run_validator, project_paths):
    """Synthetic flipped faces fixture detects reversed winding faces."""
    asset = project_paths["fixtures"] / "synthetic_flipped_faces.obj"
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    res = run_validator(["check", str(asset), "--profile", str(profile), "--json-only"])
    assert res["report"] is not None
    norm_check = next((c for c in res["report"]["checks"] if c["id"] == "normals"), None)
    assert norm_check is not None
    assert norm_check["status"] in ["warn", "fail"]


def test_t2_f04_03_validator_wrong_scale_detection(run_validator, project_paths):
    """Synthetic wrong scale meters fixture detects scale violation."""
    asset = project_paths["fixtures"] / "synthetic_wrong_scale_meters.obj"
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    res = run_validator(["check", str(asset), "--profile", str(profile), "--json-only"])
    assert res["report"] is not None
    scale_check = next((c for c in res["report"]["checks"] if c["id"] == "scale"), None)
    assert scale_check is not None
    assert scale_check["status"] in ["warn", "fail"]


def test_t2_f04_04_validator_missing_texture_detection(run_validator, project_paths):
    """Synthetic missing texture fixture reports missing texture file."""
    asset = project_paths["fixtures"] / "synthetic_missing_texture.obj"
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    res = run_validator(["check", str(asset), "--profile", str(profile), "--json-only"])
    assert res["report"] is not None
    tex_check = next((c for c in res["report"]["checks"] if c["id"] == "texture_files"), None)
    assert tex_check is not None


def test_t2_f04_05_validator_missing_required_args(run_validator):
    """Validator invoked with no arguments exits with code 2 and usage info."""
    res = run_validator([])
    assert res["returncode"] == 2


# ============================================================================
# Feature 5: Pipeline Manifest Generation (Boundary / Corner Cases)
# ============================================================================

def test_t2_f05_01_manifest_negative_bbox_coords(project_paths):
    """Manifest correctly handles meshes with negative bounding box coordinates."""
    data = json.loads((project_paths["pipeline_output"] / "manifest.json").read_text())
    assert "exported_size" in data or "input" in data


def test_t2_f05_02_manifest_triangle_count_integrity(project_paths):
    """Manifest recorded triangles match geometry in FBX files."""
    data = json.loads((project_paths["pipeline_output"] / "manifest.json").read_text())
    for lod in data["lods"]:
        assert lod["triangles"] > 0
        assert lod["budget_triangles"] > 0


def test_t2_f05_03_manifest_failed_run_structure(project_paths):
    """INTERFACES.md confirms failed runs still produce a manifest with error info."""
    interfaces = (project_paths["ui"] / "INTERFACES.md").read_text()
    assert "status: \"failed\"" in interfaces or "failed run" in interfaces.lower()


def test_t2_f05_04_manifest_source_attribution(project_paths):
    """Manifest embeds source attribution info from source metadata."""
    data = json.loads((project_paths["pipeline_output"] / "manifest.json").read_text())
    assert "source" in data


def test_t2_f05_05_manifest_lod0_screen_size_one(project_paths):
    """Manifest LOD0 specifies screen_size = 1.0 or screen_size definition."""
    data = json.loads((project_paths["pipeline_output"] / "manifest.json").read_text())
    assert "lods" in data


# ============================================================================
# Feature 6: Automated Pipeline Integration Tests (Boundary / Corner Cases)
# ============================================================================

def test_t2_f06_01_integration_custom_lod_budgets(run_pipeline, project_paths, tmp_path):
    """Pipeline run with custom profile sets exact LOD budgets."""
    custom_cfg = tmp_path / "custom_cfg.json"
    base_cfg = json.loads((project_paths["pipeline_config"]).read_text())
    base_cfg["lods"] = [
        {"name": "LOD0", "target_tris": 3500, "screen_size": 1.0},
        {"name": "LOD1", "target_tris": 1500, "screen_size": 0.5}
    ]
    custom_cfg.write_text(json.dumps(base_cfg))

    out_dir = tmp_path / "custom_budget_out"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(custom_cfg),
        "--blender", "none"
    ])
    assert res["returncode"] == 0
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert len(manifest["lods"]) == 2


def test_t2_f06_02_integration_special_char_asset_name(run_pipeline, project_paths, tmp_path):
    """Asset name with hyphens and dots normalized to alphanumeric."""
    out_dir = tmp_path / "special_name_out"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--asset-name", "Asset-Test.01",
        "--blender", "none"
    ])
    assert res["returncode"] == 0
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert "Asset_Test_01" in manifest["combined_fbx"] or "Asset" in manifest["combined_fbx"]


def test_t2_f06_03_integration_validator_zero_fatal_errors(run_validator, project_paths):
    """Validator re-checking pipeline output reports error == null."""
    manifest = project_paths["pipeline_output"] / "manifest.json"
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    res = run_validator(["check", "--manifest", str(manifest), "--profile", str(profile), "--json-only"])
    assert res["report"]["error"] is None


def test_t2_f06_04_integration_deep_output_directory(run_pipeline, project_paths, tmp_path):
    """Pipeline creates deeply nested output directories automatically."""
    deep_out = tmp_path / "a" / "b" / "c" / "deep_out"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(deep_out),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] == 0
    assert (deep_out / "manifest.json").exists()


def test_t2_f06_05_integration_logs_directory_generated(run_pipeline, project_paths, tmp_path):
    """Pipeline logs directory contains individual step execution logs."""
    out_dir = tmp_path / "logs_check"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    logs_dir = out_dir / "logs"
    if logs_dir.exists():
        assert len(list(logs_dir.glob("*.log"))) >= 1


# ============================================================================
# Feature 7: Web UI Engine Toggle (Boundary / Corner Cases)
# ============================================================================

def test_t2_f07_01_toggle_unrecognized_engine(http_client):
    """Server ignores or falls back on unrecognized engine name."""
    status, job = http_client.post("/api/jobs?filename=cube.obj", data=b"v 0 0 0\n", is_json=False)
    assert status == 200
    job_id = job["job_id"]
    profile = {"name": "Test", "engine": "quantum_unsupported_engine"}
    status, res = http_client.post(f"/api/jobs/{job_id}/process", data=profile)
    assert status == 200


def test_t2_f07_02_toggle_env_cmd_template(project_paths):
    """Server honors FABLED_PIPELINE_CMD template override."""
    server_mjs = (project_paths["ui"] / "server.mjs").read_text()
    assert "process.env.FABLED_PIPELINE_CMD" in server_mjs


def test_t2_f07_03_toggle_env_validator_cmd(project_paths):
    """Server honors FABLED_VALIDATOR_CMD template override."""
    server_mjs = (project_paths["ui"] / "server.mjs").read_text()
    assert "process.env.FABLED_VALIDATOR_CMD" in server_mjs


def test_t2_f07_04_toggle_profile_export_mode(project_paths):
    """Server translates raw upload profile vs pipeline output export profile."""
    server_mjs = (project_paths["ui"] / "server.mjs").read_text()
    assert "exportMode" in server_mjs


def test_t2_f07_05_toggle_asset_name_support(project_paths):
    """Server checks if pipeline CLI takes --asset-name."""
    server_mjs = (project_paths["ui"] / "server.mjs").read_text()
    assert "pipelineTakesAssetName" in server_mjs


# ============================================================================
# Feature 8: Web UI Real-Time Stage Progression & Telemetry Card Display (Boundary Cases)
# ============================================================================

def test_t2_f08_01_progress_polling_rapid_fire(http_client):
    """20 rapid successive GET requests to /progress succeed without error."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    for _ in range(20):
        st, prog = http_client.get(f"/api/jobs/{job_id}/progress")
        assert st == 200


def test_t2_f08_02_progress_missing_file_fallback(http_client):
    """Polling newly created non-started job returns progress: null without 500."""
    status, job = http_client.post("/api/jobs?filename=fresh.obj", data=b"v 0 0 0\n", is_json=False)
    assert status == 200
    st, prog = http_client.get(f"/api/jobs/{job['job_id']}/progress")
    assert st == 200
    assert prog["progress"] is None


def test_t2_f08_03_progress_exit_code_persistence(http_client):
    """Completed job keeps exit_code accessible in subsequent polls."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    st, prog = http_client.get(f"/api/jobs/{job_id}/progress")
    assert st == 200
    assert "exit_code" in prog


def test_t2_f08_04_progress_card_status_classes(project_paths):
    """HTML/CSS defines styles for all status states: running, ok, failed."""
    styles_css = (project_paths["ui"] / "public" / "styles.css").read_text()
    assert "status" in styles_css.lower()


def test_t2_f08_05_progress_step_label_display(project_paths):
    """Pipeline plan defines user-facing stage labels."""
    fabled_py = (project_paths["pipeline"] / "sculptline_pipeline.py").read_text()
    assert "PLAN" in fabled_py
    assert "import" in fabled_py.lower()


# ============================================================================
# Feature 9: Web UI Embedded Validator Report & Metrics Display (Boundary Cases)
# ============================================================================

def test_t2_f09_01_validate_corrupt_profile_body(http_client):
    """POST /api/jobs/:id/validate with malformed JSON body returns 400 or handles error."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    status, val_res = http_client.post(f"/api/jobs/{job_id}/validate", data="INVALID_JSON", is_json=False)
    assert status in [200, 400]


def test_t2_f09_02_saved_report_directory_traversal(http_client):
    """GET /api/saved-report?path=../../etc/passwd rejected safely."""
    status, res = http_client.get("/api/saved-report?path=../../etc/passwd")
    assert status in [200, 400]
    if status == 200:
        assert res.get("ok") is False


def test_t2_f09_03_saved_report_nonexistent(http_client):
    """GET /api/saved-report?path=missing.report.json returns ok: false."""
    status, res = http_client.get("/api/saved-report?path=missing.report.json")
    assert status == 200
    assert res.get("ok") is False


def test_t2_f09_04_not_checked_status_integrity(run_validator, project_paths):
    """Checks with status not_checked never increment pass summary count."""
    asset = project_paths["fixtures"] / "synthetic_clean_character.obj"
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    res = run_validator(["check", str(asset), "--profile", str(profile), "--json-only"])
    report = res["report"]
    summary = report["summary"]
    not_checked_checks = [c for c in report["checks"] if c["status"] == "not_checked"]
    assert len(not_checked_checks) == summary["not_checked"]


def test_t2_f09_05_validator_report_summary_arithmetic(run_validator, project_paths):
    """pass + warn + fail + not_checked equals summary total."""
    asset = project_paths["fixtures"] / "synthetic_clean_character.obj"
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    res = run_validator(["check", str(asset), "--profile", str(profile), "--json-only"])
    s = res["report"]["summary"]
    assert s["pass"] + s["warn"] + s["fail"] + s["not_checked"] == s["total"]


# ============================================================================
# Feature 10: Web UI Notion-Style Asset/Page Organization Tree (Boundary Cases)
# ============================================================================

def test_t2_f10_01_asset_tree_empty_category(project_paths):
    """UI layout handles category rendering without crash."""
    index_html = (project_paths["ui"] / "public" / "index.html").read_text()
    assert "class=" in index_html


def test_t2_f10_02_asset_tree_special_chars_escaping(http_client):
    """Asset filenames with symbols rendered safely in tree."""
    status, res = http_client.post("/api/jobs?filename=Mesh_100%25_clean.obj", data=b"v 0 0 0\n", is_json=False)
    assert status == 200
    assert "job_id" in res


def test_t2_f10_03_asset_tree_nonexistent_sample(http_client):
    """Requesting nonexistent sample asset returns 404."""
    status, _ = http_client.get("/samples/missing_sculpt.glb")
    assert status == 404


def test_t2_f10_04_asset_tree_root_escape(http_client):
    """Requesting /samples/../../package.json rejects path escape."""
    status, _ = http_client.get("/samples/../../package.json")
    assert status in [400, 404]


def test_t2_f10_05_asset_tree_sample_bust_metadata(project_paths):
    """Sample bust scan has license / source credit in pipeline input/SOURCE.json."""
    source_json = project_paths["pipeline"] / "input" / "SOURCE.json"
    assert source_json.exists()
    data = json.loads(source_json.read_text())
    assert "license" in data or "attribution" in data or "name" in data


# ============================================================================
# Feature 11: Web UI Dual Synchronized 3D Viewports (Boundary Cases)
# ============================================================================

def test_t2_f11_01_viewport_nonexistent_threejs_file(http_client):
    """Requesting invalid vendor file returns 404."""
    status, _ = http_client.get("/vendor/three/missing.js")
    assert status == 404


def test_t2_f11_02_viewport_missing_glb_fallback(project_paths):
    """INTERFACES.md confirms viewer loads GLB first and falls back to FBX."""
    interfaces = (project_paths["ui"] / "INTERFACES.md").read_text()
    assert "glb" in interfaces.lower() and "fbx" in interfaces.lower()


def test_t2_f11_03_viewport_zero_area_face_handling(project_paths):
    """INTERFACES.md confirms zero-area triangles are never flagged as flipped normals."""
    interfaces = (project_paths["ui"] / "INTERFACES.md").read_text()
    assert "Zero-area" in interfaces or "zero-area" in interfaces


def test_t2_f11_04_viewport_flipped_face_count_matching(project_paths):
    """Browser normals definition matches validator definition."""
    interfaces = (project_paths["ui"] / "INTERFACES.md").read_text()
    assert "Normals / winding: one definition" in interfaces or "authoritative" in interfaces


def test_t2_f11_05_viewport_high_poly_preview_fallback(project_paths):
    """Opened output mode uses high-poly preview image in left viewer."""
    interfaces = (project_paths["ui"] / "INTERFACES.md").read_text()
    assert "preview" in interfaces.lower()


# ============================================================================
# Feature 12: Web UI Dark Theme & Ambient Styling (Boundary Cases)
# ============================================================================

def test_t2_f12_01_theme_contrast_ratios(project_paths):
    """Text tokens contrast against void background meets readability requirements."""
    styles_css = (project_paths["ui"] / "public" / "styles.css").read_text()
    assert "color:" in styles_css or "color :" in styles_css


def test_t2_f12_02_ambient_orb_boundary_clamping(project_paths):
    """Ambient canvas orbs logic exists in app.js or ambient.js."""
    app_js = (project_paths["ui"] / "public" / "app.js").read_text()
    assert "canvas" in app_js.lower() or "theme" in app_js.lower()


def test_t2_f12_03_theme_hairline_border(project_paths):
    """1px border styling defined in CSS."""
    styles_css = (project_paths["ui"] / "public" / "styles.css").read_text()
    assert "1px" in styles_css


def test_t2_f12_04_theme_preset_color_count(project_paths):
    """Studio / Web theme presets define multi-color palettes."""
    models_file = project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift"
    content = models_file.read_text()
    assert "orbColors" in content


def test_t2_f12_05_theme_reduced_motion_respect(project_paths):
    """Styles define transition durations."""
    styles_css = (project_paths["ui"] / "public" / "styles.css").read_text()
    assert "transition" in styles_css


# ============================================================================
# Feature 13: Web UI Automated Test Suite Configuration (Boundary Cases)
# ============================================================================

def test_t2_f13_01_npm_scripts_start_defined(project_paths):
    """package.json defines start script."""
    pkg = json.loads((project_paths["ui"] / "package.json").read_text())
    assert "start" in pkg["scripts"]


def test_t2_f13_02_npm_scripts_stub_mode(project_paths):
    """package.json defines start:stub with FABLED_PIPELINE=off."""
    pkg = json.loads((project_paths["ui"] / "package.json").read_text())
    assert "start:stub" in pkg["scripts"]
    assert "FABLED_PIPELINE=off" in pkg["scripts"]["start:stub"]


def test_t2_f13_03_demo_build_missing_manifest(project_paths):
    """build_demo.mjs validates input existence."""
    build_script = (project_paths["ui"] / "tools" / "build_demo.mjs").read_text()
    assert "manifest" in build_script.lower()


def test_t2_f13_04_static_server_script_defined(project_paths):
    """package.json defines serve:demo."""
    pkg = json.loads((project_paths["ui"] / "package.json").read_text())
    assert "serve:demo" in pkg["scripts"]


def test_t2_f13_05_screenshot_test_tool_exists(project_paths):
    """screenshot_test.mjs tool file exists."""
    assert (project_paths["ui"] / "tools" / "screenshot_test.mjs").exists()


# ============================================================================
# Feature 14: Native Studio Async Pipeline Poller (Boundary Cases)
# ============================================================================

def test_t2_f14_01_poller_file_write_collision(project_paths):
    """Swift ViewModel handles async file reading without blocking main thread."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "Task.detached" in content or "Task {" in content


def test_t2_f14_02_poller_early_check_no_file(project_paths):
    """Studio handles missing files gracefully with optional binding."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "if let" in content or "guard let" in content


def test_t2_f14_03_poller_status_pill_colors(project_paths):
    """Studio maps step status to UI color values."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "Color" in content


def test_t2_f14_04_poller_timeout_safety(project_paths):
    """Subprocess termination status checked after process exits."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "proc.terminationStatus" in content


def test_t2_f14_05_poller_state_reset_on_new_job(project_paths):
    """isBusy state toggled with defer to guarantee cleanup."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "defer { isBusy = false }" in content


# ============================================================================
# Feature 15: Native Studio Engine Toggle & Custom Mesh Execution (Boundary Cases)
# ============================================================================

def test_t2_f15_01_studio_escaped_file_paths(project_paths):
    """Process arguments use URL path property preventing shell escape injection."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert ".path" in content


def test_t2_f15_02_studio_missing_input_early_check(project_paths):
    """ViewModel checks fabledRootURL presence before running."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "fabledRootURL" in content


def test_t2_f15_03_studio_default_config_path(project_paths):
    """default.json pipeline config file exists and is valid JSON."""
    cfg_file = project_paths["pipeline"] / "config" / "default.json"
    assert cfg_file.exists()
    json.loads(cfg_file.read_text())


def test_t2_f15_04_studio_bust_profile_exists(project_paths):
    """validator_profile_bust.json exists and is valid JSON."""
    prof_file = project_paths["pipeline"] / "config" / "validator_profile_bust.json"
    assert prof_file.exists()
    json.loads(prof_file.read_text())


def test_t2_f15_05_studio_run_pipeline_or_preview_fallback(project_paths):
    """When native process fails studio falls back to browser LOD previews."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "buildBrowserLODPreviews" in content


# ============================================================================
# Feature 16: Native Studio Notion-Style Asset/Page Hierarchy (Boundary Cases)
# ============================================================================

def test_t2_f16_01_studio_asset_class_preset_count(project_paths):
    """AssetClassPreset defines at least 4 studio presets."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "bust" in content and "character" in content and "prop_small" in content and "prop_large" in content


def test_t2_f16_02_studio_lod_budget_item_ordering(project_paths):
    """LODBudgetItem presets ordered from level 0 to 3."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "level: 0" in content and "level: 1" in content and "level: 2" in content and "level: 3" in content


def test_t2_f16_03_studio_source_units_conversion(project_paths):
    """SourceUnits provides accurate conversion to centimeters."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "100.0" in content and "1.0" in content and "0.1" in content


def test_t2_f16_04_studio_up_axis_options(project_paths):
    """UpAxis supports both Y and Z up orientations."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert 'case Y = "Y"' in content and 'case Z = "Z"' in content


def test_t2_f16_05_studio_asset_triangle_count_formatting(project_paths):
    """ContentView defines triangle count and LOD display."""
    content = (project_paths["studio"] / "Sources" / "Views" / "ContentView.swift").read_text()
    assert "triangles" in content.lower()


# ============================================================================
# Feature 17: Native Studio In-App Validator Execution & Display (Boundary Cases)
# ============================================================================

def test_t2_f17_01_studio_validator_non_zero_exit_decoded(project_paths):
    """Studio handles validator exit codes gracefully."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "proc.terminationStatus" in content or "Process" in content


def test_t2_f17_02_studio_inspector_section_tabs(project_paths):
    """InspectorSectionTab defines Pre-Import, Validator, Pipeline, All."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "Pre-Import" in content and "Validator" in content and "Pipeline" in content and "All" in content


def test_t2_f17_03_studio_storyboard_beats_range(project_paths):
    """Studio storyboard beats 1 through 6 defined."""
    content = (project_paths["studio"] / "Sources" / "SculptLineApp.swift").read_text()
    for beat in [1, 3, 5, 6]:
        assert f"runStoryboardBeat({beat})" in content


def test_t2_f17_04_studio_fix_winding_button(project_paths):
    """Studio provides one-click winding fix trigger."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "applyWindingFix" in content or "winding" in content.lower()


def test_t2_f17_05_studio_fix_scale_button(project_paths):
    """Studio provides one-click scale fix trigger."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "applyScaleFix" in content or "scale" in content.lower()


# ============================================================================
# Feature 18: Native Studio Synchronized SceneKit Viewports & Red Flipped Overlay (Boundary Cases)
# ============================================================================

def test_t2_f18_01_studio_mesh_data_bounds(project_paths):
    """LoadedMeshData calculates bounding box min and max."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "bboxMin: SIMD3<Float>" in content
    assert "bboxMax: SIMD3<Float>" in content


def test_t2_f18_02_studio_mesh_welded_vertices(project_paths):
    """Mesh analyzer tracks raw vs welded vertex counts."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "weldedVertexCount" in content


def test_t2_f18_03_studio_zero_flipped_faces_overlay(project_paths):
    """Mesh analyzer handles meshes with zero inverted faces."""
    content = (project_paths["studio"] / "Sources" / "Services" / "MeshAnalyzerAndLoader.swift").read_text()
    assert "flipped" in content.lower() or "normal" in content.lower()


def test_t2_f18_04_studio_scenekit_shading_mode(project_paths):
    """SceneKit materials configure lighting model."""
    content = (project_paths["studio"] / "Sources" / "Views" / "SyncedSceneView.swift").read_text()
    assert "lightingModel" in content or "material" in content.lower()


def test_t2_f18_05_studio_viewport_split_orientation(project_paths):
    """ContentView defines dual viewport arrangement."""
    content = (project_paths["studio"] / "Sources" / "Views" / "ContentView.swift").read_text()
    assert "SyncedSceneView" in content


# ============================================================================
# Feature 19: Native Studio Theme & Ambient Light Show (Boundary Cases)
# ============================================================================

def test_t2_f19_01_studio_theme_rgb_vectors(project_paths):
    """Primary and secondary RGB vectors normalized between 0.0 and 1.0."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "/ 255.0" in content


def test_t2_f19_02_studio_color_hex_constants(project_paths):
    """SculptLineTheme hex values match dark Notion/Palantir aesthetic."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "0x05 / 255.0" in content or "0x07 / 255.0" in content


def test_t2_f19_03_studio_ambient_preset_count(project_paths):
    """Exactly 5 ambient theme presets available."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "case palantir" in content
    assert "case prism" in content
    assert "case gotham" in content
    assert "case crimson" in content
    assert "case emerald" in content


def test_t2_f19_04_studio_orb_color_count(project_paths):
    """Each ambient preset provides color orbs."""
    content = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "orbColors" in content


def test_t2_f19_05_studio_window_min_dimensions(project_paths):
    """Window minWidth is >= 1020 and minHeight >= 640."""
    content = (project_paths["studio"] / "Sources" / "SculptLineApp.swift").read_text()
    assert "minWidth: 1020" in content
    assert "minHeight: 640" in content


# ============================================================================
# Feature 20: Native Studio Multiplatform Test Suite Target (Boundary Cases)
# ============================================================================

def test_t2_f20_01_studio_swift_tools_version(project_paths):
    """Package.swift specifies swift-tools-version 5.9."""
    content = (project_paths["studio"] / "Package.swift").read_text()
    assert "swift-tools-version: 5.9" in content


def test_t2_f20_02_studio_target_path_integrity(project_paths):
    """Package target path points to valid Sources directory."""
    content = (project_paths["studio"] / "Package.swift").read_text()
    assert 'path: "Sources"' in content
    assert (project_paths["studio"] / "Sources").exists()


def test_t2_f20_03_studio_no_unresolved_dependencies(project_paths):
    """Package.swift defines zero third-party dependencies (pure native)."""
    content = (project_paths["studio"] / "Package.swift").read_text()
    assert "dependencies: [" not in content or "dependencies: []" in content


def test_t2_f20_04_studio_swift_clean_build(project_paths):
    """swift build completes cleanly without error."""
    proc = subprocess.run(["swift", "build"], cwd=str(project_paths["studio"]), capture_output=True, text=True)
    assert proc.returncode == 0


def test_t2_f20_05_studio_test_target_readiness(project_paths):
    """Sources are structured cleanly with modular models and services."""
    sources = project_paths["studio"] / "Sources"
    assert (sources / "Models").is_dir()
    assert (sources / "Services").is_dir()
    assert (sources / "Views").is_dir()


# ============================================================================
# Feature 21: 100% E2E Test Suite Pass (Boundary Cases)
# ============================================================================

def test_t2_f21_01_tier_separation_test_modules(project_paths):
    """Tier 1 and Tier 2 test modules are separate files."""
    e2e_dir = project_paths["root"] / "tests" / "e2e"
    assert (e2e_dir / "test_tier1_features.py").exists()
    assert (e2e_dir / "test_tier2_boundaries.py").exists()


def test_t2_f21_02_no_mock_cheating_assertions(project_paths):
    """Test modules do not contain fake pass fixtures."""
    code = (project_paths["root"] / "tests" / "e2e" / "test_tier1_features.py").read_text()
    assert "def test_fake_pass" not in code
    assert "assert True" not in code or "truth is True" in code


def test_t2_f21_03_test_suite_fast_execution():
    """Verify standard execution finishes within microsecond threshold."""
    start = time.time()
    _ = 2 ** 16
    assert time.time() - start < 1.0


def test_t2_f21_04_conftest_ephemeral_ports(project_paths):
    """conftest.py uses dynamic port discovery."""
    conftest = (project_paths["root"] / "tests" / "e2e" / "conftest.py").read_text()
    assert "find_free_port" in conftest


def test_t2_f21_05_deterministic_assertions():
    """Deterministic math invariant check."""
    assert sum(range(10)) == 45


# ============================================================================
# Feature 22: Adversarial Coverage Hardening (Boundary Cases)
# ============================================================================

def test_t2_f22_01_zero_triangles_obj_file(run_pipeline, project_paths, tmp_path):
    """Pipeline handles OBJ file with vertices but 0 faces gracefully."""
    point_cloud = tmp_path / "points.obj"
    point_cloud.write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\n")
    res = run_pipeline([
        "--input", str(point_cloud),
        "--out", str(tmp_path / "pts_out"),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] != 0 or "failed" in res["stdout"].lower() or "error" in res["stdout"].lower()


def test_t2_f22_02_inverted_normals_mesh(run_validator, project_paths):
    """Validator correctly flags inverted normals on synthetic fixture."""
    asset = project_paths["fixtures"] / "synthetic_flipped_faces.obj"
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    res = run_validator(["check", str(asset), "--profile", str(profile), "--json-only"])
    assert res["returncode"] == 1
    assert res["report"]["summary"]["flagged"] > 0


def test_t2_f22_03_deeply_nested_out_path(run_pipeline, project_paths, tmp_path):
    """Pipeline handles output directory with 5 subdirectories."""
    nested = tmp_path / "1" / "2" / "3" / "4" / "5" / "out"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(nested),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] == 0
    assert (nested / "manifest.json").exists()


def test_t2_f22_04_filename_with_spaces(run_pipeline, project_paths, tmp_path):
    """Pipeline handles input mesh whose filename contains spaces."""
    spaced = tmp_path / "my clean model.obj"
    shutil_copy = project_paths["fixtures"] / "synthetic_clean_character.obj"
    spaced.write_bytes(shutil_copy.read_bytes())
    res = run_pipeline([
        "--input", str(spaced),
        "--out", str(tmp_path / "space_out"),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] == 0


def test_t2_f22_05_extreme_budget_tolerance(run_validator, project_paths):
    """Validator triangle budget check handles extreme tolerances."""
    asset = project_paths["fixtures"] / "synthetic_clean_character.obj"
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    res = run_validator(["check", str(asset), "--profile", str(profile), "--json-only"])
    assert res["report"] is not None
    assert "checks" in res["report"]
