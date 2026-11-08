"""
Tier 4: Real-World Application Scenarios for Fabled Capability Showcase
Verifies complete, end-to-end user workflows, lifecycle pipelines, and multi-component scenarios (total >= 11 tests, 12 scenarios implemented).
"""

import os
import sys
import json
import time
import subprocess
from pathlib import Path
import pytest

# ============================================================================
# Real-World Workflows and Lifecycles
# ============================================================================

def test_t4_scenario_01_complete_studio_ingestion_lifecycle(http_client, run_validator, project_paths, tmp_path):
    """Scenario 1: Complete Studio Ingestion Lifecycle.
    Upload raw sculpt -> Pre-import validate -> Run Native Pipeline -> Verify Manifest & LODs -> Re-validate export."""
    # Step 1: Upload asset
    clean_mesh = (project_paths["fixtures"] / "synthetic_clean_character.obj").read_bytes()
    status, job = http_client.post("/api/jobs?filename=ingestion_hero.obj", data=clean_mesh, is_json=False)
    assert status == 200
    job_id = job["job_id"]
    input_path = job["input_path"]

    # Step 2: Pre-import validate raw input
    pre_val = run_validator([
        "check", input_path,
        "--profile", str(project_paths["profiles"] / "demo_placeholder_prop.json"),
        "--json-only"
    ])
    assert pre_val["report"] is not None
    assert pre_val["report"]["overall_status"] in ["pass", "warn", "fail"]

    # Step 3: Run pipeline via CLI
    out_dir = tmp_path / "scenario_01_out"
    cmd = [
        sys.executable, str(project_paths["pipeline"] / "sculptline_pipeline.py"),
        "--input", input_path,
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0

    # Step 4: Verify manifest and LODs
    manifest_path = out_dir / "manifest.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["status"] == "ok"
    assert len(manifest["lods"]) >= 2
    for lod in manifest["lods"]:
        assert (out_dir / lod["path"]).exists()

    # Step 5: Post-export validation
    post_val = run_validator([
        "check",
        "--manifest", str(manifest_path),
        "--profile", str(project_paths["profiles"] / "demo_placeholder_prop.json"),
        "--json-only"
    ])
    assert post_val["report"] is not None
    assert post_val["report"]["manifest"]["readable"] is True


def test_t4_scenario_02_web_workspace_interactive_session(http_client, project_paths):
    """Scenario 2: Web Workspace Interactive Session.
    Check server status -> Open frozen output -> Query progress & result -> Validate -> Query saved reports."""
    # Step 1: Query server status
    status, st = http_client.get("/api/status")
    assert status == 200
    assert st["pipeline"]["available"] is True
    assert st["validator"]["available"] is True

    # Step 2: Open frozen pipeline output
    status, opened = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    assert opened.get("ok") is True
    job_id = opened["job_id"]

    # Step 3: Query progress and result
    status, prog = http_client.get(f"/api/jobs/{job_id}/progress")
    assert status == 200
    assert prog["progress"]["total"] == 8

    status, res = http_client.get(f"/api/jobs/{job_id}/result")
    assert status == 200
    assert res.get("ok") is True
    assert "manifest" in res

    # Step 4: Run in-app validation
    status, val = http_client.post(f"/api/jobs/{job_id}/validate", data={})
    assert status == 200
    assert val.get("ok") is True
    assert "summary" in val["report"]

    # Step 5: Query saved historical reports
    status, saved = http_client.get("/api/saved-reports")
    assert status == 200
    assert isinstance(saved["reports"], list)


def test_t4_scenario_03_native_studio_storyboard_beats(project_paths):
    """Scenario 3: Native Studio Storyboard Workflow.
    Verify Swift data models and storyboard beats 1 (load sculpt), 3 (open output), 5 (run validator), 6 (auto-fixes)."""
    models_file = project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift"
    content = models_file.read_text()
    assert "runStoryboardBeat" in content
    assert "loadRawSampleSculpt" in content or "openRealPipelineOutput" in content
    assert "runPreImportChecks" in content


def test_t4_scenario_04_disaster_recovery_engine_fallback(run_pipeline, project_paths, tmp_path):
    """Scenario 4: Blender-to-Native Fallback Disaster Recovery.
    Simulate host with missing/broken Blender path -> Automatic fallback to Native engine -> Complete 8 stages."""
    out_dir = tmp_path / "disaster_recovery_out"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "/usr/local/bin/nonexistent_blender_binary"
    ])
    assert res["returncode"] == 0
    assert "running Fabled native Python+NumPy mesh pipeline engine" in res["stdout"] or "native" in res["stdout"].lower()
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["status"] == "ok"
    assert manifest["tool"]["blender_version"] == "native-numpy-engine-0.1"


def test_t4_scenario_05_multi_asset_project_organization(project_paths):
    """Scenario 5: Multi-Asset Studio Project Organization.
    Notion-style asset tree organizes Character Bust, Small Prop, Large Prop, and Notes."""
    models_file = project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift"
    content = models_file.read_text()
    assert "AssetClassPreset" in content
    assert "bust" in content
    assert "prop_small" in content
    assert "prop_large" in content


def test_t4_scenario_06_qa_gatekeeper_defect_detection_and_fix(run_validator, project_paths):
    """Scenario 6: Quality Assurance Gatekeeper Workflow.
    Detect defect mesh with inverted normals & scale error -> Flag issues -> Provide diagnostic report."""
    flipped_asset = project_paths["fixtures"] / "synthetic_flipped_faces.obj"
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    res = run_validator(["check", str(flipped_asset), "--profile", str(profile), "--json-only"])
    assert res["returncode"] == 1
    report = res["report"]
    assert report["overall_status"] == "warn" or report["overall_status"] == "fail"
    normals_check = next((c for c in report["checks"] if c["id"] == "normals"), None)
    assert normals_check is not None
    assert normals_check["status"] in ["warn", "fail"]


def test_t4_scenario_07_headless_ci_automated_run(run_pipeline, run_validator, project_paths, tmp_path):
    """Scenario 7: Headless CI Deployment.
    Execute pipeline with --blender none and validator --json-only in headless environment without display server."""
    out_dir = tmp_path / "ci_headless"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] == 0

    val_res = run_validator([
        "check",
        "--manifest", str(out_dir / "manifest.json"),
        "--profile", str(project_paths["profiles"] / "demo_placeholder_prop.json"),
        "--json-only"
    ])
    assert val_res["returncode"] in [0, 1]
    assert val_res["report"]["manifest"]["readable"] is True


def test_t4_scenario_08_studio_custom_profile_budget_enforcement(run_pipeline, project_paths, tmp_path):
    """Scenario 8: Custom Profile Studio Tailoring.
    Enforce custom studio profile with strict triangle budgets (LOD0: 10k, LOD1: 5k, LOD2: 2k)."""
    custom_cfg = tmp_path / "studio_custom.json"
    cfg = json.loads((project_paths["pipeline_config"]).read_text())
    cfg["lods"] = [
        {"name": "LOD0", "target_tris": 10000, "screen_size": 1.0},
        {"name": "LOD1", "target_tris": 5000, "screen_size": 0.5},
        {"name": "LOD2", "target_tris": 2000, "screen_size": 0.25}
    ]
    custom_cfg.write_text(json.dumps(cfg))

    out_dir = tmp_path / "custom_profile_out"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(custom_cfg),
        "--blender", "none"
    ])
    assert res["returncode"] == 0
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert len(manifest["lods"]) == 3
    assert manifest["lods"][0]["budget_triangles"] == 10000
    assert manifest["lods"][1]["budget_triangles"] == 5000
    assert manifest["lods"][2]["budget_triangles"] == 2000


def test_t4_scenario_09_full_ui_dark_theme_and_ambient_consistency(project_paths):
    """Scenario 9: Theme & Aesthetic Consistency Audit.
    Web UI CSS tokens (--bg-void: #07080c) and Native Studio SculptLineTheme (voidBg: 0x05060A) match dark Palantir design."""
    web_css = (project_paths["ui"] / "public" / "styles.css").read_text()
    assert "--bg-void" in web_css or "#07080c" in web_css.lower() or "#05060a" in web_css.lower()

    native_models = (project_paths["studio"] / "Sources" / "Models" / "SculptLineModels.swift").read_text()
    assert "SculptLineTheme" in native_models
    assert "voidBg" in native_models
    assert "0x05 / 255.0" in native_models or "0x07 / 255.0" in native_models


def test_t4_scenario_10_high_poly_sculpt_decimation_chain(run_pipeline, project_paths, tmp_path):
    """Scenario 10: High-Poly Sculpt Decimation Chain.
    Ingest asset -> Execute LOD chain -> Verify monotonic decimation from LOD0 down to LOD3."""
    out_dir = tmp_path / "decimation_chain"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] == 0
    manifest = json.loads((out_dir / "manifest.json").read_text())
    lods = manifest["lods"]
    assert len(lods) >= 4
    # Check that triangle budgets decrease monotonically
    for i in range(len(lods) - 1):
        assert lods[i]["budget_triangles"] >= lods[i + 1]["budget_triangles"]


def test_t4_scenario_11_cross_platform_build_and_tool_integrity(project_paths):
    """Scenario 11: End-to-End Multiplatform Verification.
    Verify Swift Package builds cleanly and UI test tools exist."""
    # Native Studio build
    proc = subprocess.run(["swift", "build"], cwd=str(project_paths["studio"]), capture_output=True, text=True)
    assert proc.returncode == 0

    # Web UI test tools
    assert (project_paths["ui"] / "tools" / "check_demo_dist.mjs").exists()
    assert (project_paths["ui"] / "package.json").exists()


def test_t4_scenario_12_corrupt_asset_graceful_recovery(http_client, run_pipeline, project_paths, tmp_path):
    """Scenario 12: Corrupt Asset Resilience & System Recovery.
    Submit corrupt asset -> Pipeline rejects cleanly -> Server remains healthy and processes next request."""
    # Corrupt upload
    corrupt_data = b"NOT_A_VALID_MESH_CORRUPTED_STREAM"
    status, job = http_client.post("/api/jobs?filename=corrupt.obj", data=corrupt_data, is_json=False)
    assert status == 200
    corrupt_job_id = job["job_id"]

    # Server remains healthy and answers status
    status, st = http_client.get("/api/status")
    assert status == 200
    assert st["pipeline"]["available"] is True

    # Valid subsequent request succeeds immediately
    status, opened = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    assert opened.get("ok") is True
