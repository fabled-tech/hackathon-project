"""Tier 5 White-Box Adversarial Stress Test Suite for SculptLine Backend Pipelines and Validator.

Covers:
1. Malformed meshes (non-manifold edges, isolated vertices, extreme aspect ratios, inverted winding, NaN coordinates, zero-area faces).
2. Pipeline stage disruption (missing intermediate stage outputs, missing textures, killed workers, corrupt state).
3. Engine fallback resilience (corrupt/crashing Blender binaries, hanging processes, permission denied, font resolution).
4. Pre-import QA validator Schema 0.2.0 edge cases and manifest cross-checks.
"""
from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(HERE)
ROOT_DIR = os.path.dirname(PIPELINE_DIR)
VALIDATOR_DIR = os.path.join(ROOT_DIR, "validator")
FIXTURES_DIR = os.path.join(VALIDATOR_DIR, "fixtures")
PROFILES_DIR = os.path.join(VALIDATOR_DIR, "profiles")
PIPELINE_CLI = os.path.join(PIPELINE_DIR, "sculptline_pipeline.py")
CLEAN_MESH = os.path.join(FIXTURES_DIR, "synthetic_clean_character.obj")
DEMO_PROFILE = os.path.join(PROFILES_DIR, "demo_placeholder.json")

# Ensure validator is importable
if VALIDATOR_DIR not in sys.path:
    sys.path.insert(0, VALIDATOR_DIR)
if PIPELINE_DIR not in sys.path:
    sys.path.insert(0, PIPELINE_DIR)

from sculptline_validator.report import validate, exit_code_for
from sculptline_validator.geometry import analyze as validator_analyze
from sculptline_validator.model import ParseError, UnsupportedFormatError


# =============================================================================
# Helper utilities
# =============================================================================
def _run_cli(args, timeout=120):
    cmd = [sys.executable, PIPELINE_CLI] + args
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def _write_obj(path, vertices, faces):
    with open(path, "w") as fh:
        for v in vertices:
            fh.write(f"v {v[0]} {v[1]} {v[2]}\n")
        for f in faces:
            fh.write("f " + " ".join(str(idx + 1) for idx in f) + "\n")


# =============================================================================
# 1. Malformed Meshes & Extreme Geometry Tests
# =============================================================================
class TestMalformedMeshes:
    def test_malformed_01_nonmanifold_fan(self, tmp_path):
        """10-triangle fan sharing the exact same edge (1, 2)."""
        mesh_path = tmp_path / "fan.obj"
        verts = [(0.0, 0.0, 0.0), (0.0, 0.0, 1.0)]
        faces = []
        for i in range(10):
            angle = i * 2.0 * np.pi / 10.0
            verts.append((float(np.cos(angle)), float(np.sin(angle)), 0.5))
            faces.append((0, 1, 2 + i))
        _write_obj(mesh_path, verts, faces)

        # 1. Validator QA: Must detect non-manifold geometry
        rep = validate(str(mesh_path), DEMO_PROFILE)
        assert rep["overall_status"] in ("fail", "warn")
        nm_check = next((c for c in rep["checks"] if c["id"] == "non_manifold"), None)
        assert nm_check is not None
        assert nm_check["status"] == "fail"
        assert nm_check["measured"]["non_manifold_edges"] >= 1

        # 2. Native pipeline: Cleans and executes successfully
        out_dir = tmp_path / "out_fan"
        res = _run_cli(["--input", str(mesh_path), "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 0
        assert (out_dir / "manifest.json").exists()
        prog = json.loads((out_dir / "progress.json").read_text())
        assert prog["status"] == "ok"
        assert prog["done"] is True

    def test_malformed_02_isolated_vertices(self, tmp_path):
        """1,000 isolated unreferenced vertices and only 1 active triangle."""
        mesh_path = tmp_path / "isolated.obj"
        verts = [(float(i * 0.01), 0.0, 0.0) for i in range(1000)]
        verts.extend([(0.0, 0.0, 0.0), (10.0, 0.0, 0.0), (0.0, 10.0, 0.0)])
        faces = [(1000, 1001, 1002)]
        _write_obj(mesh_path, verts, faces)

        out_dir = tmp_path / "out_isolated"
        res = _run_cli(["--input", str(mesh_path), "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 0
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "ok"
        fbx = out_dir / manifest["combined_fbx"]
        assert fbx.exists()
        assert fbx.stat().st_size > 0

    def test_malformed_03_extreme_aspect_ratio_needle(self, tmp_path):
        """1,000,000 : 1 aspect ratio (needle-like mesh)."""
        mesh_path = tmp_path / "needle.obj"
        verts = [(0.0, 0.0, 0.0), (100000.0, 0.0, 0.0), (50000.0, 0.05, 0.05)]
        faces = [(0, 1, 2)]
        _write_obj(mesh_path, verts, faces)

        out_dir = tmp_path / "out_needle"
        res = _run_cli(["--input", str(mesh_path), "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 0
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "ok"

    def test_malformed_04_flat_sheet_zero_height(self, tmp_path):
        """Planar 2D quad with Z=0 everywhere (0 height, flat sheet)."""
        mesh_path = tmp_path / "sheet.obj"
        verts = [(0.0, 0.0, 0.0), (50.0, 0.0, 0.0), (50.0, 50.0, 0.0), (0.0, 50.0, 0.0)]
        faces = [(0, 1, 2), (0, 2, 3)]
        _write_obj(mesh_path, verts, faces)

        out_dir = tmp_path / "out_sheet"
        res = _run_cli(["--input", str(mesh_path), "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 0
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "ok"

    def test_malformed_05_reversed_winding_cube(self, tmp_path):
        """Inverted clockwise-wound cube faces."""
        mesh_path = tmp_path / "inverted_cube.obj"
        # 8 vertices of a unit cube
        verts = [
            (-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
            (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)
        ]
        # Clockwise faces (inverted inward)
        faces = [
            (0, 1, 2), (0, 2, 3),  # bottom CW
            (5, 4, 7), (5, 7, 6),  # top CW
            (4, 0, 3), (4, 3, 7),  # left CW
            (1, 5, 6), (1, 6, 2),  # right CW
            (4, 5, 1), (4, 1, 0),  # front CW
            (3, 2, 6), (3, 6, 7),  # back CW
        ]
        _write_obj(mesh_path, verts, faces)

        # Validator flags winding
        rep = validate(str(mesh_path), DEMO_PROFILE)
        assert rep["overall_status"] in ("fail", "warn")
        norm_check = next((c for c in rep["checks"] if c["id"] == "normals"), None)
        assert norm_check is not None
        assert norm_check["status"] == "fail"

        # Native pipeline fixes winding and exports cleanly
        out_dir = tmp_path / "out_inverted"
        res = _run_cli(["--input", str(mesh_path), "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 0
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "ok"

    def test_malformed_06_nan_and_inf_coordinates(self, tmp_path):
        """Mesh containing NaN and Inf coordinates."""
        mesh_path = tmp_path / "nan.obj"
        with open(mesh_path, "w") as fh:
            fh.write("v nan nan nan\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nf 1 2 3\n")

        # Validator flags failure
        rep = validate(str(mesh_path), DEMO_PROFILE)
        assert rep["overall_status"] == "fail"

        # Pipeline halts gracefully with status failed
        out_dir = tmp_path / "out_nan"
        res = _run_cli(["--input", str(mesh_path), "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 1
        prog = json.loads((out_dir / "progress.json").read_text())
        assert prog["status"] == "failed"
        assert prog["done"] is True
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "failed"
        assert "error" in manifest

    def test_malformed_07_empty_obj_zero_vertices(self, tmp_path):
        """Empty OBJ with 0 vertices and 0 faces."""
        mesh_path = tmp_path / "empty.obj"
        mesh_path.write_text("# empty OBJ\n")

        rep = validate(str(mesh_path), DEMO_PROFILE)
        assert rep["overall_status"] == "error"

        out_dir = tmp_path / "out_empty"
        res = _run_cli(["--input", str(mesh_path), "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 1
        prog = json.loads((out_dir / "progress.json").read_text())
        assert prog["status"] == "failed"
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "failed"

    def test_malformed_08_disjoint_multi_component_mesh(self, tmp_path):
        """10 disconnected tetrahedral components floating apart."""
        mesh_path = tmp_path / "disjoint.obj"
        verts, faces = [], []
        v_offset = 0
        for comp in range(10):
            cx, cy, cz = comp * 5.0, 0.0, 0.0
            verts.extend([
                (cx, cy, cz), (cx + 1, cy, cz), (cx, cy + 1, cz), (cx, cy, cz + 1)
            ])
            faces.extend([
                (v_offset, v_offset + 1, v_offset + 2),
                (v_offset, v_offset + 2, v_offset + 3),
                (v_offset, v_offset + 3, v_offset + 1),
                (v_offset + 1, v_offset + 3, v_offset + 2),
            ])
            v_offset += 4
        _write_obj(mesh_path, verts, faces)

        out_dir = tmp_path / "out_disjoint"
        res = _run_cli(["--input", str(mesh_path), "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 0
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "ok"
        assert len(manifest["outputs"]["lods"]) == 4

    def test_malformed_09_extreme_float_scale(self, tmp_path):
        """Coordinates at 1e25 scale (astronomical units)."""
        mesh_path = tmp_path / "astronomical.obj"
        verts = [(1e25, 0.0, 0.0), (0.0, 1e25, 0.0), (0.0, 0.0, 1e25)]
        faces = [(0, 1, 2)]
        _write_obj(mesh_path, verts, faces)

        out_dir = tmp_path / "out_astro"
        res = _run_cli(["--input", str(mesh_path), "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 0
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "ok"

    def test_malformed_10_all_degenerate_triangles_collinear(self, tmp_path):
        """Mesh where all triangles are zero-area collinear degenerate triangles."""
        mesh_path = tmp_path / "degenerate_collinear.obj"
        verts = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (2.0, 0.0, 0.0)]
        faces = [(0, 1, 2)]
        _write_obj(mesh_path, verts, faces)

        out_dir = tmp_path / "out_collinear"
        res = _run_cli(["--input", str(mesh_path), "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 1
        prog = json.loads((out_dir / "progress.json").read_text())
        assert prog["status"] == "failed"
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "failed"
        assert "no valid triangles" in manifest["error"]


# =============================================================================
# 2. Pipeline Stage Disruption & Error Recovery Tests
# =============================================================================
class TestPipelineStageDisruption:
    def test_disruption_01_missing_step01_json(self, tmp_path):
        """build_manifest resilience when step01.json is missing or deleted."""
        from build_manifest import build

        out_dir = tmp_path / "out_missing_step01"
        work_dir = out_dir / "work"
        work_dir.mkdir(parents=True)

        cfg = {"asset_name": "TestAsset", "lods": [{"name": "LOD0", "target_tris": 100}]}
        state = {"step_runs": {}}
        # Note: step01.json is NOT created
        build(out=str(out_dir), cfg=cfg, inp=CLEAN_MESH, state=state, failed="test deliberate failure")

        man_path = out_dir / "manifest.json"
        assert man_path.exists()
        manifest = json.loads(man_path.read_text())
        assert manifest["status"] == "failed"
        assert "deliberate failure" in manifest["error"]

    def test_disruption_02_corrupt_intermediate_step_json(self, tmp_path):
        """build_manifest resilience when intermediate step JSON contains corrupt garbage."""
        from build_manifest import build

        out_dir = tmp_path / "out_corrupt_step"
        work_dir = out_dir / "work"
        work_dir.mkdir(parents=True)
        (work_dir / "step01.json").write_text("{CORRUPT_JSON_CONTENT;;;}")
        (work_dir / "step04.json").write_text("NOT_JSON")

        cfg = {"asset_name": "TestAsset", "lods": [{"name": "LOD0", "target_tris": 100}]}
        state = {"step_runs": {}}
        build(out=str(out_dir), cfg=cfg, inp=CLEAN_MESH, state=state, failed=None)

        man_path = out_dir / "manifest.json"
        assert man_path.exists()
        manifest = json.loads(man_path.read_text())
        assert manifest["schema"] == "fabled.pipeline.manifest/0.1"

    def test_disruption_03_corrupt_driver_state_recovery(self, tmp_path):
        """Empirical vulnerability test: driver_state.json corrupt from previous crashed run.
        Verifies that pipeline safely recovers from JSONDecodeError on line 302 and completes.
        """
        out_dir = tmp_path / "out_corrupt_driver"
        work_dir = out_dir / "work"
        work_dir.mkdir(parents=True)
        (work_dir / "driver_state.json").write_text("CORRUPTED_RAW_TEXT")

        res = _run_cli(["--input", CLEAN_MESH, "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 0
        assert (out_dir / "manifest.json").exists()
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "ok"

    def test_disruption_04_partial_step_subset_execution(self, tmp_path):
        """Running a restricted subset of steps: --steps 01,02 with native engine."""
        out_dir = tmp_path / "out_partial_steps"
        # In native fallback mode, all 8 steps execute as atomic engine unit
        res = _run_cli(["--input", CLEAN_MESH, "--out", str(out_dir), "--blender", "none", "--steps", "01,02"])
        assert res.returncode == 0
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["status"] == "ok"

    def test_disruption_05_write_glb_empty_array_resilience(self, tmp_path):
        """Direct unit test: _write_glb_lod handles empty array reductions without zero-size exception."""
        from native_pipeline import _write_glb_lod, _generate_baked_textures
        exp_dir = tmp_path / "exp"
        tex = _generate_baked_textures(str(exp_dir), "EmptyTest", res=64)
        out_glb = str(tmp_path / "empty.glb")
        mesh_dict = {
            "name": "LOD0",
            "pos_cm": np.zeros((0, 3), dtype=np.float32),
            "tris": np.zeros((0, 3), dtype=np.int64),
            "corner_normals": np.zeros((0, 3, 3), dtype=np.float32),
            "corner_uvs": np.zeros((0, 3, 2), dtype=np.float32),
        }
        # Calling _write_glb_lod with empty arrays must not raise "ValueError: zero-size array to reduction"
        _write_glb_lod(out_glb, "EmptyTest", mesh_dict, tex["normal_gl"], tex["orm"])
        assert os.path.exists(out_glb)


# =============================================================================
# 3. Engine Fallback Resilience Tests
# =============================================================================
class TestEngineFallbackResilience:
    def test_fallback_01_dev_null_binary(self, tmp_path):
        """--blender /dev/null triggers graceful fallback to native engine."""
        out_dir = tmp_path / "out_devnull"
        res = _run_cli(["--input", CLEAN_MESH, "--out", str(out_dir), "--blender", "/dev/null"])
        assert res.returncode == 0
        assert "invalid, 0-byte, or not executable" in res.stdout
        manifest = json.loads((out_dir / "manifest.json").read_text())
        assert manifest["tool"]["blender_version"] == "native-numpy-engine-0.1"

    def test_fallback_02_segfaulting_blender_process(self, tmp_path):
        """Simulated Blender script that segfaults (exits with code 139 / kill -11)."""
        segfault_bin = tmp_path / "segfault_blender"
        segfault_bin.write_text("#!/bin/sh\nexit 139\n")
        segfault_bin.chmod(0o755)

        out_dir = tmp_path / "out_segfault"
        res = _run_cli(["--input", CLEAN_MESH, "--out", str(out_dir), "--blender", str(segfault_bin)])
        # Must not hang or crash unhandled; completes with exit code 0 or 1
        assert res.returncode in (0, 1)
        assert (out_dir / "manifest.json").exists()

    def test_fallback_03_permission_denied_input(self, tmp_path):
        """Input mesh file with chmod 000 (unreadable)."""
        bad_mesh = tmp_path / "unreadable.obj"
        bad_mesh.write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")
        bad_mesh.chmod(0o000)

        out_dir = tmp_path / "out_unreadable"
        try:
            res = _run_cli(["--input", str(bad_mesh), "--out", str(out_dir), "--blender", "none"])
            assert res.returncode == 1
            prog = json.loads((out_dir / "progress.json").read_text())
            assert prog["status"] == "failed"
            manifest = json.loads((out_dir / "manifest.json").read_text())
            assert manifest["status"] == "failed"
        finally:
            bad_mesh.chmod(0o644)

    def test_fallback_04_font_resolution_fallback(self):
        """Multi-platform font resolution in post_previews fallback when fonts missing."""
        sys.path.insert(0, os.path.join(PIPELINE_DIR, "scripts"))
        from post_previews import _find_font, _get_font
        font_regular = _find_font(bold=False)
        font_bold = _find_font(bold=True)
        # Even if system fonts are missing, _get_font returns default bitmap font
        f_title = _get_font(bold=True, size=28)
        assert f_title is not None
        f_body = _get_font(bold=False, size=16)
        assert f_body is not None


# =============================================================================
# 4. Pre-Import QA Validator Boundary & Stress Tests
# =============================================================================
class TestValidatorBoundaryAndStress:
    def test_validator_01_manifest_cross_check(self, tmp_path):
        """Cross-checking an asset with --manifest."""
        out_dir = tmp_path / "pipeline_run"
        res = _run_cli(["--input", CLEAN_MESH, "--out", str(out_dir), "--blender", "none"])
        assert res.returncode == 0
        manifest_path = out_dir / "manifest.json"

        # Validate with manifest check
        rep = validate(manifest_path=str(manifest_path), profile_path=DEMO_PROFILE)
        assert rep["schema_version"] == "0.2.0"
        m_check = next((c for c in rep["checks"] if c["id"] == "manifest"), None)
        assert m_check is not None
        assert m_check["status"] in ("pass", "warn")

    def test_validator_02_manifest_missing_combined_fbx(self, tmp_path):
        """Manifest referencing a deleted or nonexistent FBX asset."""
        man_path = tmp_path / "ghost_manifest.json"
        man_path.write_text(json.dumps({
            "schema": "fabled.pipeline.manifest/0.1",
            "combined_fbx": "nonexistent_model.fbx",
            "outputs": {"combined_fbx": "nonexistent_model.fbx"}
        }))

        rep = validate(manifest_path=str(man_path), profile_path=DEMO_PROFILE)
        assert rep["overall_status"] == "error"
        assert exit_code_for(rep) == 2
        assert "not found" in rep["error"]["message"]

    def test_validator_03_unsupported_format(self, tmp_path):
        """Unsupported file extensions (.blend, .max, .c4d)."""
        blend_file = tmp_path / "test.blend"
        blend_file.write_bytes(b"BLENDER_V500")

        rep = validate(str(blend_file), DEMO_PROFILE)
        assert rep["overall_status"] == "error"
        assert exit_code_for(rep) == 2
        assert "Unsupported file type" in rep["error"]["message"]

    def test_validator_04_malformed_profile_json(self, tmp_path):
        """Corrupt or non-JSON profile path."""
        bad_prof = tmp_path / "bad_profile.json"
        bad_prof.write_text("{BAD_JSON")

        rep = validate(CLEAN_MESH, str(bad_prof))
        assert rep["overall_status"] == "error"
        assert exit_code_for(rep) == 2

    def test_validator_05_large_mesh_geometry_stress(self, tmp_path):
        """Synthetic high-density sphere (20,000+ triangles) through validator analysis."""
        mesh_path = tmp_path / "dense_sphere.obj"
        n_lat, n_lon = 100, 100
        verts = []
        for i in range(n_lat + 1):
            theta = i * np.pi / n_lat
            for j in range(n_lon):
                phi = j * 2.0 * np.pi / n_lon
                verts.append((
                    float(np.sin(theta) * np.cos(phi) * 50.0),
                    float(np.sin(theta) * np.sin(phi) * 50.0),
                    float(np.cos(theta) * 50.0)
                ))
        faces = []
        for i in range(n_lat):
            for j in range(n_lon):
                p0 = i * n_lon + j
                p1 = i * n_lon + (j + 1) % n_lon
                p2 = (i + 1) * n_lon + (j + 1) % n_lon
                p3 = (i + 1) * n_lon + j
                faces.append((p0, p1, p2))
                faces.append((p0, p2, p3))
        _write_obj(mesh_path, verts, faces)

        t0 = time.monotonic()
        rep = validate(str(mesh_path), DEMO_PROFILE)
        dur = time.monotonic() - t0
        assert dur < 5.0, f"Validator took too long on 20k tri mesh: {dur:.2f}s"
        assert rep["summary"]["total"] >= 15
