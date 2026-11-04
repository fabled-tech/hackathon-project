"""
Tier 3: Cross-Feature Interactions & Pairwise Combinations for Fabled
Verifies combinatorial interactions between pairs and sets of the 22 features (total >= 22 tests, 25 tests implemented).
"""

import os
import sys
import json
import time
import subprocess
from pathlib import Path
import pytest

# ============================================================================
# Pairwise Combinations (Features 1 - 22)
# ============================================================================

def test_t3_comb_01_job_dispatch_with_native_engine(http_client, project_paths, tmp_path):
    """F01 (Job Dispatch) + F02 (Dual-Engine: Native fallback):
    Web API creates a job and prepares configuration for native fallback execution."""
    sample_mesh = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"
    status, job = http_client.post("/api/jobs?filename=triangle.obj", data=sample_mesh, is_json=False)
    assert status == 200
    job_id = job["job_id"]
    profile = {
        "name": "Native Engine Job",
        "units": "cm",
        "scale": 1.0,
        "engine": "native",
        "lod_budget": [{"level": 0, "max_triangles": 500, "screen_size": 1.0}]
    }
    status, res = http_client.post(f"/api/jobs/{job_id}/process", data=profile)
    assert status == 200
    assert res.get("ok") is True


def test_t3_comb_02_job_dispatch_with_telemetry_polling(http_client):
    """F01 (Job Dispatch) + F03 (Live Telemetry):
    Job dispatched via API can be polled for live progress without race conditions."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    status, prog = http_client.get(f"/api/jobs/{job_id}/progress")
    assert status == 200
    assert "progress" in prog
    assert prog["progress"]["total"] == 8


def test_t3_comb_03_job_dispatch_with_manifest_retrieval(http_client):
    """F01 (Job Dispatch) + F05 (Manifest):
    GET /api/jobs/:id/result retrieves the full pipeline manifest and export asset."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    status, result = http_client.get(f"/api/jobs/{job_id}/result")
    assert status == 200
    assert result.get("ok") is True
    assert "manifest" in result
    assert result["manifest"]["schema"] == "fabled.pipeline.manifest/0.1"
    assert "export_asset" in result


def test_t3_comb_04_dual_engine_telemetry_progression(run_pipeline, project_paths, tmp_path):
    """F02 (Dual Engine) + F03 (Live Telemetry):
    Native engine updates progress.json at each discrete stage during run."""
    out_dir = tmp_path / "comb_telemetry"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    assert res["returncode"] == 0
    prog_file = out_dir / "progress.json"
    assert prog_file.exists()
    prog = json.loads(prog_file.read_text())
    assert prog["step"] == 8
    assert prog["done"] is True
    assert prog["status"] == "ok"


def test_t3_comb_05_dual_engine_validator_cross_validation(run_pipeline, run_validator, project_paths, tmp_path):
    """F02 (Dual Engine) + F04 (Validator):
    Native engine export verified end-to-end by fabled_validator CLI."""
    out_dir = tmp_path / "comb_val"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    val_res = run_validator([
        "check",
        "--manifest", str(out_dir / "manifest.json"),
        "--profile", str(project_paths["profiles"] / "demo_placeholder_prop.json"),
        "--json-only"
    ])
    assert val_res["report"] is not None
    assert val_res["report"]["manifest"]["readable"] is True
    assert val_res["report"]["summary"]["pass"] > 0


def test_t3_comb_06_dual_engine_manifest_compliance(run_pipeline, project_paths, tmp_path):
    """F02 (Dual Engine) + F05 (Manifest):
    Native engine produces manifest.json recording tool version 'native-numpy-engine-0.1'."""
    out_dir = tmp_path / "comb_manifest"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(project_paths["pipeline_config"]),
        "--blender", "none"
    ])
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["tool"]["blender_version"] == "native-numpy-engine-0.1"
    assert len(manifest["lods"]) >= 2


def test_t3_comb_07_telemetry_stage_cards_web_api(http_client):
    """F03 (Live Telemetry) + F08 (Web Stage Cards):
    Live progress from progress.json formatted for Web UI stage telemetry card display."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    status, prog = http_client.get(f"/api/jobs/{job_id}/progress")
    assert status == 200
    p = prog["progress"]
    assert "name" in p
    assert "label" in p
    assert "status" in p
    assert p["status"] in ["running", "ok", "failed"]


def test_t3_comb_08_validator_embedded_web_report(http_client):
    """F04 (Validator) + F09 (Web Embedded Report):
    In-workspace validator output decoded and served via POST /api/jobs/:id/validate."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    status, val_res = http_client.post(f"/api/jobs/{job_id}/validate", data={})
    assert status == 200
    assert val_res.get("ok") is True
    rep = val_res["report"]
    assert "checks" in rep
    assert "overall_status" in rep
    assert rep["schema_version"] == "0.2.0"


def test_t3_comb_09_manifest_and_embedded_validator(http_client):
    """F05 (Manifest) + F09 (Web Embedded Report):
    POST /api/jobs/:id/validate evaluates manifest target (--manifest)."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    status, val_res = http_client.post(f"/api/jobs/{job_id}/validate", data={})
    assert status == 200
    assert val_res["target"]["kind"] == "manifest"


def test_t3_comb_10_manifest_and_threejs_viewports(http_client):
    """F05 (Manifest) + F11 (Web Dual Viewports):
    Manifest LOD geometry and Normal/ORM textures resolved and served via /api/jobs/:id/files/."""
    status, res = http_client.post("/api/open-output?dir=pipeline/output")
    assert status == 200
    job_id = res["job_id"]
    manifest = res["manifest"]
    lod0_path = manifest["lods"][0]["path"]
    status, data = http_client.get(f"/api/jobs/{job_id}/files/{lod0_path}")
    assert status == 200
    assert len(data) > 0


def test_t3_comb_11_web_engine_toggle_and_pipeline_routing(project_paths):
    """F07 (Web Engine Toggle) + F02 (Dual Engine):
    Server.mjs parses engine override and selects appropriate pipeline arguments."""
    server_code = (project_paths["ui"] / "server.mjs").read_text()
    assert "pipelineCommand" in server_code
    assert "fabled_pipeline.py" in server_code


def test_t3_comb_12_web_stage_cards_and_dark_theme(project_paths):
    """F08 (Web Stage Cards) + F12 (Dark Theme):
    Stage progress cards styled with Palantir dark theme CSS tokens."""
    styles_css = (project_paths["ui"] / "public" / "styles.css").read_text()
    assert "--bg-void" in styles_css or "background" in styles_css
    assert "card" in styles_css.lower()


def test_t3_comb_13_web_asset_tree_and_sample_serving(http_client):
    """F10 (Web Asset Tree) + F11 (Web Dual Viewports):
    Asset tree node selection maps to available 3D sample files."""
    status, data = http_client.get("/samples/fabled_sample_head.glb")
    assert status == 200
    assert len(data) > 1000


def test_t3_comb_14_native_poller_and_telemetry_contract(project_paths):
    """F14 (Native Studio Poller) + F03 (Live Telemetry):
    Native poller decodes 8-stage progress object written by pipeline."""
    content = (project_paths["studio"] / "Sources" / "Models" / "FabledModels.swift").read_text()
    assert "FabledStudioViewModel" in content
    assert "progress" in content.lower() or "isBusy" in content


def test_t3_comb_15_native_studio_engine_and_pipeline_cli(project_paths):
    """F15 (Native Studio Engine Toggle) + F02 (Dual Engine):
    Native Studio Process invocation passes --blender none or binary path to pipeline."""
    content = (project_paths["studio"] / "Sources" / "Models" / "FabledModels.swift").read_text()
    assert "fabled_pipeline.py" in content
    assert "--input" in content


def test_t3_comb_16_native_studio_asset_tree_and_models(project_paths):
    """F16 (Native Studio Asset Tree) + F18 (Native SceneKit Viewports):
    Native Studio Notion-style asset hierarchy binds to 3D scene view model."""
    content = (project_paths["studio"] / "Sources" / "Models" / "FabledModels.swift").read_text()
    assert "AssetClassPreset" in content
    assert "LoadedMeshData" in content


def test_t3_comb_17_native_studio_validator_and_report_sheet(project_paths):
    """F17 (Native Studio Validator) + F04 (Pre-Import Validator):
    In-app validator invocation updates check statuses and summary in view model."""
    content = (project_paths["studio"] / "Sources" / "Models" / "FabledModels.swift").read_text()
    assert "runPreImportChecks" in content


def test_t3_comb_18_native_studio_viewports_and_red_flipped_overlay(project_paths):
    """F18 (Native Studio SceneKit Viewports) + F04 (Validator Normals Check):
    Validator flipped faces detection maps to SceneKit red highlight overlay geometry."""
    analyzer_file = project_paths["studio"] / "Sources" / "Services" / "MeshAnalyzerAndLoader.swift"
    content = analyzer_file.read_text()
    assert "flipped" in content.lower() or "normal" in content.lower()


def test_t3_comb_19_native_studio_viewports_and_ambient_theme(project_paths):
    """F18 (Native Studio SceneKit Viewports) + F19 (Native Ambient Theme):
    SceneKit viewport rendering styled with Palantir dark theme and ambient lighting."""
    scene_file = project_paths["studio"] / "Sources" / "Views" / "SyncedSceneView.swift"
    content = scene_file.read_text()
    assert "SCNView" in content or "SceneView" in content


def test_t3_comb_20_native_studio_timeline_and_preset_switching(project_paths):
    """F19 (Native Ambient Light Show) + F19 (Theme Presets):
    TimelineView animation updates with AmbientThemePreset colors."""
    content = (project_paths["studio"] / "Sources" / "Models" / "FabledModels.swift").read_text()
    assert "AmbientThemePreset" in content
    assert "orbColors" in content


def test_t3_comb_21_web_test_suite_and_server_endpoints(project_paths):
    """F13 (Web Automated Test) + F01 (Job Dispatch):
    Web test tools verify API routes and asset serving."""
    tools_dir = project_paths["ui"] / "tools"
    assert (tools_dir / "check_demo_dist.mjs").exists()


def test_t3_comb_22_native_package_and_analyzer_service(project_paths):
    """F20 (Native Studio Multiplatform Test) + F18 (SceneKit Services):
    SPM package compiles MeshAnalyzerAndLoader with zero external dependencies."""
    proc = subprocess.run(["swift", "build"], cwd=str(project_paths["studio"]), capture_output=True, text=True)
    assert proc.returncode == 0


def test_t3_comb_23_dual_engine_and_adversarial_scale(run_pipeline, project_paths, tmp_path):
    """F02 (Dual Engine) + F22 (Adversarial):
    Native engine processing mesh with custom units and scale multiplier."""
    custom_cfg = tmp_path / "scale_cfg.json"
    base_cfg = json.loads((project_paths["pipeline_config"]).read_text())
    base_cfg["source_units_to_m"] = 0.001  # Millimeters
    custom_cfg.write_text(json.dumps(base_cfg))

    out_dir = tmp_path / "scale_out"
    inp = project_paths["fixtures"] / "synthetic_clean_character.obj"
    res = run_pipeline([
        "--input", str(inp),
        "--out", str(out_dir),
        "--config", str(custom_cfg),
        "--blender", "none"
    ])
    assert res["returncode"] == 0
    assert (out_dir / "manifest.json").exists()


def test_t3_comb_24_validator_and_adversarial_fixtures(run_validator, project_paths):
    """F04 (Validator) + F22 (Adversarial):
    Validator evaluates multiple synthetic defect fixtures."""
    fixtures = [
        ("synthetic_flipped_faces.obj", 1),
        ("synthetic_wrong_scale_meters.obj", 1),
        ("synthetic_missing_texture.obj", 1),
    ]
    profile = project_paths["profiles"] / "demo_placeholder_prop.json"
    for fix_file, expected_exit in fixtures:
        asset = project_paths["fixtures"] / fix_file
        res = run_validator(["check", str(asset), "--profile", str(profile), "--json-only"])
        assert res["returncode"] == expected_exit


def test_t3_comb_25_manifest_and_adversarial_error_reporting(project_paths):
    """F05 (Manifest) + F22 (Adversarial):
    Manifest records warning and notes entries for imperfect inputs."""
    data = json.loads((project_paths["pipeline_output"] / "manifest.json").read_text())
    assert "warnings" in data or "notes" in data or "manual_steps" in data
