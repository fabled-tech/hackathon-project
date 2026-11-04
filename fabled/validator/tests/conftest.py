import copy
import json
import os
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
FIX = os.path.join(ROOT, "fixtures")
PROFILE = os.path.join(ROOT, "profiles", "example_studio.json")


@pytest.fixture(scope="session", autouse=True)
def fixtures_built():
    if not os.path.exists(os.path.join(FIX, "synthetic_storyboard_fixed.gltf")):
        subprocess.check_call([sys.executable, os.path.join(FIX, "make_fixtures.py")])


@pytest.fixture
def profile_with(tmp_path):
    """Write a copy of the example profile with nested overrides; returns its path."""
    def make(**over):
        with open(PROFILE) as fh:
            p = json.load(fh)
        for dotted, val in over.items():
            cur = p
            keys = dotted.split("__")
            for k in keys[:-1]:
                cur = cur[k]
            cur[keys[-1]] = val
        out = tmp_path / "profile.json"
        out.write_text(json.dumps(p))
        return str(out)
    return make
