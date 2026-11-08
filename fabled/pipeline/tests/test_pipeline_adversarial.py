#!/usr/bin/env python3
"""Adversarial stress harness for Blender binary fallback in SculptLine mesh pipeline.

Tests every corrupt, unexecutable, malformed, permission-denied, and boundary-condition
scenario for the --blender argument to verify that the pipeline falls back gracefully
to the native Python/NumPy mesh engine with clean exit code 0, complete progress.json,
valid manifest.json, and valid output FBX assets.
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import pytest

PIPELINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPELINE_CLI = os.path.join(PIPELINE_ROOT, "sculptline_pipeline.py")
REPO_ROOT = os.path.dirname(os.path.dirname(PIPELINE_ROOT))
# validator/ is a sibling of pipeline/ (works whether this tree is fabled/ in a larger repo or the repo root)
FIXTURE_MESH = os.path.join(os.path.dirname(PIPELINE_ROOT), "validator", "fixtures", "synthetic_clean_character.obj")

# Detect host Blender
HOST_BLENDER = None
for cand in (
    os.environ.get("SCULPTLINE_BLENDER"),
    os.environ.get("FABLED_BLENDER"),
    "/opt/homebrew/bin/blender",
    shutil.which("blender"),
    shutil.which("Blender"),
    "/Applications/Blender.app/Contents/MacOS/Blender",
):
    if cand and os.path.isfile(cand) and os.access(cand, os.X_OK):
        HOST_BLENDER = cand
        break


def _run_pipeline(mesh_path, out_dir, blender_arg, extra_args=None):
    cmd = [
        sys.executable,
        PIPELINE_CLI,
        "--input", str(mesh_path),
        "--out", str(out_dir),
        "--blender", str(blender_arg),
    ]
    if extra_args:
        cmd.extend(extra_args)
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    return proc


def _verify_pipeline_success(out_dir, expected_native=True):
    # 1. progress.json check
    prog_path = os.path.join(out_dir, "progress.json")
    assert os.path.exists(prog_path), f"progress.json not found in {out_dir}"
    prog = json.loads(open(prog_path).read())
    assert prog.get("status") == "ok", f"Expected progress status 'ok', got {prog.get('status')}"
    assert prog.get("done") is True, f"Expected progress done True, got {prog.get('done')}"
    assert prog.get("step") == 8, f"Expected step 8, got {prog.get('step')}"

    # 2. manifest.json check
    man_path = os.path.join(out_dir, "manifest.json")
    assert os.path.exists(man_path), f"manifest.json not found in {out_dir}"
    man = json.loads(open(man_path).read())
    assert man.get("status") == "ok", f"Expected manifest status 'ok', got {man.get('status')}"
    
    if expected_native:
        assert man.get("tool", {}).get("blender_version") == "native-numpy-engine-0.1"

    # 3. combined_fbx check
    combined_rel = man.get("combined_fbx")
    assert combined_rel, "manifest missing 'combined_fbx' field"
    combined_fbx = os.path.join(out_dir, combined_rel)
    assert os.path.exists(combined_fbx), f"Combined FBX {combined_fbx} does not exist"
    assert os.path.getsize(combined_fbx) > 0, f"Combined FBX {combined_fbx} is 0 bytes"


class TestAdversarialBlenderFallback:
    """Rigorous adversarial tests verifying robust fallback across edge cases."""

    def test_case_01_zero_byte_executable(self, tmp_path):
        """0-byte executable file with 0o755 permissions."""
        bin_path = tmp_path / "zero_byte_blender"
        bin_path.write_bytes(b"")
        bin_path.chmod(0o755)
        out_dir = tmp_path / "out_zero_byte"

        res = _run_pipeline(FIXTURE_MESH, out_dir, str(bin_path))
        assert res.returncode == 0, f"Failed with rc={res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert "invalid, 0-byte, or not executable" in res.stdout
        _verify_pipeline_success(str(out_dir), expected_native=True)

    def test_case_02_corrupt_ascii_executable(self, tmp_path):
        """Non-empty garbage ASCII text with 0o755 permissions (triggers kernel Exec format error)."""
        bin_path = tmp_path / "corrupt_ascii_blender"
        bin_path.write_text("NOT_A_VALID_BINARY_EXECUTABLE\n")
        bin_path.chmod(0o755)
        out_dir = tmp_path / "out_corrupt_ascii"

        res = _run_pipeline(FIXTURE_MESH, out_dir, str(bin_path))
        assert res.returncode == 0, f"Failed with rc={res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert "Failed to execute Blender binary" in res.stdout or "invalid, 0-byte, or not executable" in res.stdout
        _verify_pipeline_success(str(out_dir), expected_native=True)

    def test_case_03_corrupt_binary_header_bytes(self, tmp_path):
        """Non-empty invalid binary Mach-O / ELF magic header with random corrupted bytes."""
        bin_path = tmp_path / "corrupt_header_blender"
        bin_path.write_bytes(b"\xca\xfe\xba\xbe\x00\x00\x00\x01\xff\xff\x00\x00corrupt_payload")
        bin_path.chmod(0o755)
        out_dir = tmp_path / "out_corrupt_header"

        res = _run_pipeline(FIXTURE_MESH, out_dir, str(bin_path))
        assert res.returncode == 0, f"Failed with rc={res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert "Failed to execute Blender binary" in res.stdout or "invalid, 0-byte, or not executable" in res.stdout
        _verify_pipeline_success(str(out_dir), expected_native=True)

    def test_case_04_nonexistent_path(self, tmp_path):
        """Path pointing to a file that does not exist."""
        bin_path = tmp_path / "nonexistent" / "blender"
        out_dir = tmp_path / "out_nonexistent"

        res = _run_pipeline(FIXTURE_MESH, out_dir, str(bin_path))
        assert res.returncode == 0, f"Failed with rc={res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert "Blender binary not found" in res.stdout or "running SculptLine native" in res.stdout
        _verify_pipeline_success(str(out_dir), expected_native=True)

    def test_case_05_directory_path(self, tmp_path):
        """A directory path passed as the --blender binary."""
        dir_path = tmp_path / "blender_dir"
        dir_path.mkdir()
        out_dir = tmp_path / "out_directory"

        res = _run_pipeline(FIXTURE_MESH, out_dir, str(dir_path))
        assert res.returncode == 0, f"Failed with rc={res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert "invalid, 0-byte, or not executable" in res.stdout
        _verify_pipeline_success(str(out_dir), expected_native=True)

    def test_case_06_permission_denied_chmod_000(self, tmp_path):
        """File with 0o000 permissions (no read, write, or execute for any user)."""
        bin_path = tmp_path / "no_perms_blender"
        bin_path.write_bytes(b"something")
        bin_path.chmod(0o000)
        out_dir = tmp_path / "out_no_perms"

        try:
            res = _run_pipeline(FIXTURE_MESH, out_dir, str(bin_path))
            assert res.returncode == 0, f"Failed with rc={res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
            assert "invalid, 0-byte, or not executable" in res.stdout
            _verify_pipeline_success(str(out_dir), expected_native=True)
        finally:
            bin_path.chmod(0o644)  # cleanup capability

    def test_case_07_non_executable_regular_file(self, tmp_path):
        """Regular file with 0o644 permissions (read/write only, not executable)."""
        bin_path = tmp_path / "readable_only_blender"
        bin_path.write_bytes(b"hello regular file")
        bin_path.chmod(0o644)
        out_dir = tmp_path / "out_non_executable"

        res = _run_pipeline(FIXTURE_MESH, out_dir, str(bin_path))
        assert res.returncode == 0, f"Failed with rc={res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert "invalid, 0-byte, or not executable" in res.stdout
        _verify_pipeline_success(str(out_dir), expected_native=True)

    def test_case_08_explicit_native_keywords(self, tmp_path):
        """Explicit flags: --blender none, native, false, off, 0, stub."""
        for kw in ("none", "native", "false", "off", "0", "stub"):
            out_dir = tmp_path / f"out_kw_{kw}"
            res = _run_pipeline(FIXTURE_MESH, out_dir, kw)
            assert res.returncode == 0, f"Failed for keyword {kw} with rc={res.returncode}"
            assert "Native engine requested" in res.stdout
            _verify_pipeline_success(str(out_dir), expected_native=True)

    def test_case_09_path_with_spaces_in_directory(self, tmp_path):
        """Path containing spaces in directory and filename."""
        spaced_dir = tmp_path / "dir with spaces"
        spaced_dir.mkdir()
        bin_path = spaced_dir / "blender binary with spaces"
        bin_path.write_bytes(b"corrupt payload in spaced dir")
        bin_path.chmod(0o755)
        out_dir = tmp_path / "out_spaces"

        res = _run_pipeline(FIXTURE_MESH, out_dir, str(bin_path))
        assert res.returncode == 0, f"Failed with rc={res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert "Failed to execute Blender binary" in res.stdout or "invalid, 0-byte, or not executable" in res.stdout
        _verify_pipeline_success(str(out_dir), expected_native=True)

    def test_case_10_character_device_dev_null(self, tmp_path):
        """Passing /dev/null as blender binary."""
        if not os.path.exists("/dev/null"):
            pytest.skip("/dev/null does not exist on this OS")
        out_dir = tmp_path / "out_dev_null"

        res = _run_pipeline(FIXTURE_MESH, out_dir, "/dev/null")
        assert res.returncode == 0, f"Failed with rc={res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        assert "invalid, 0-byte, or not executable" in res.stdout
        _verify_pipeline_success(str(out_dir), expected_native=True)

    @pytest.mark.skipif(HOST_BLENDER is None, reason="No host Blender found")
    def test_case_11_real_host_blender_execution(self, tmp_path):
        """Verify normal headless Blender execution when valid binary is supplied."""
        # Check if other blenders running
        pgrep = subprocess.run(["pgrep", "-fl", "[Bb]lender"], capture_output=True, text=True)
        other_blender = [
            l for l in pgrep.stdout.splitlines()
            if not any(ign in l for ign in ("blender-mcp", "sculptline_pipeline", "fabled_pipeline", "pytest", "test_pipeline"))
            and any(b in l for b in ("/blender", "Blender.app", " blender"))
        ]
        if other_blender:
            pytest.skip(f"Another Blender process is active: {other_blender[0]}")

        out_dir = tmp_path / "out_real_blender"
        # Run steps 01..06 with real Blender
        res = _run_pipeline(FIXTURE_MESH, out_dir, HOST_BLENDER, extra_args=["--steps", "01,02,03,04,05,06"])
        assert res.returncode == 0, f"Real Blender run failed with rc={res.returncode}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        
        # Verify progress and manifest
        prog_path = os.path.join(str(out_dir), "progress.json")
        assert os.path.exists(prog_path)
        prog = json.loads(open(prog_path).read())
        assert prog.get("status") == "ok"
        assert prog.get("done") is True

        man_path = os.path.join(str(out_dir), "manifest.json")
        assert os.path.exists(man_path)
        man = json.loads(open(man_path).read())
        assert man.get("status") == "ok"
        assert man.get("tool", {}).get("blender_version", "").startswith("Blender")

        combined_rel = man.get("combined_fbx")
        combined_fbx = os.path.join(str(out_dir), combined_rel)
        assert os.path.exists(combined_fbx)
        assert os.path.getsize(combined_fbx) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
