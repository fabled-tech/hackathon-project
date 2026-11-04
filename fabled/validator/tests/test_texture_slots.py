"""Texture slot classification evidence (name suffix vs property links) and texture_size wording."""
import json
import os
import shutil

import pytest

from conftest import FIX, ROOT
from fabled_validator import validate
from fabled_validator.checks import classify_textures
from fabled_validator.loaders.common import merge_orm
from fabled_validator.model import Asset, Material, TextureRef
from fabled_validator.profile import load_profile

DEMO = os.path.join(ROOT, "profiles", "demo_placeholder.json")
EXAMPLE = os.path.join(ROOT, "profiles", "example_studio.json")
FROZEN = os.path.join(ROOT, "..", "pipeline", "runs", "20261025-224413")


def by_id(rep):
    return {c["id"]: c for c in rep["checks"]}


def _asset(refs):
    a = Asset(path="x.fbx", format="fbx")
    a.materials = [Material(name="M", textures=merge_orm(refs))]
    return a


def test_two_texture_nodes_same_orm_file_via_roughness_and_metallic():
    # what the real pipeline writes: two FBX Texture objects pointing at one T_*_ORM.png
    refs = [TextureRef("Roughness", "ShininessExponent", "T_A_ORM.png", path="/t/T_A_ORM.png", exists=True),
            TextureRef("Metallic", "ReflectionFactor", "T_A_ORM.png", path="/t/T_A_ORM.png", exists=True)]
    a = _asset(refs)
    classify_textures(a, load_profile(DEMO))
    (t,) = a.materials[0].textures
    assert t.slot == "ORM" and t.property_slot == "ORM"
    assert t.linked_via == ["ShininessExponent", "ReflectionFactor"]
    assert t.slot_rule.startswith("name suffix _ORM") and t.slot_conflict is None


def test_orm_linked_through_unmapped_property_is_still_orm_by_name():
    a = _asset([TextureRef("Other", "SpecularFactor", "T_A_ORM.png", path="/t/T_A_ORM.png", exists=True)])
    classify_textures(a, load_profile(DEMO))
    t = a.materials[0].textures[0]
    assert t.slot == "ORM" and t.linked_via == ["SpecularFactor"] and t.slot_conflict is None


def test_unsuffixed_packed_texture_falls_back_to_property_links():
    a = _asset([TextureRef("Roughness", "ShininessExponent", "packed.png", path="/t/p.png", exists=True),
                TextureRef("Metallic", "ReflectionFactor", "packed.png", path="/t/p.png", exists=True)])
    classify_textures(a, load_profile(DEMO))
    t = a.materials[0].textures[0]
    assert t.slot == "ORM" and t.slot_rule.startswith("property link")


def test_normal_named_texture_linked_as_base_color_is_a_conflict(tmp_path):
    shutil.copy(os.path.join(FIX, "synthetic_clean_character.obj"), tmp_path)
    shutil.copytree(os.path.join(FIX, "textures"), tmp_path / "textures")
    (tmp_path / "synthetic_clean_character.mtl").write_text(
        "newmtl M_Body\nmap_Kd textures/T_Body_N.png\nnewmtl M_Head\nmap_Bump textures/T_Head_N.png\n")
    rep = validate(str(tmp_path / "synthetic_clean_character.obj"), DEMO)
    c = by_id(rep)["texture_slots"]
    assert c["status"] == "warn" and "T_Body_N.png: name says Normal, but it is linked as BaseColor via map_Kd" in c["message"]
    # the naming check also flags the link/suffix disagreement
    assert by_id(rep)["texture_naming"]["status"] == "fail"


def test_fbx_report_records_link_evidence_and_unreal_note():
    rep = validate(os.path.join(FIX, "synthetic_pipeline_out", "SM_SyntheticProxy.fbx"), DEMO)
    c = by_id(rep)["texture_slots"]
    links = {l["file"]: l for l in c["measured"]["texture_links"]}
    assert links["T_SyntheticProxy_ORM.png"]["slot"] == "ORM"
    assert links["T_SyntheticProxy_ORM.png"]["linked_via"] == ["ShininessExponent", "ReflectionFactor"]
    assert links["T_SyntheticProxy_N.png"]["linked_via"] == ["NormalMap"]
    assert "UNVERIFIED" in c["measured"]["unreal_orm_note"]
    # glTF reports don't get the FBX-specific note
    assert "unreal_orm_note" not in by_id(validate(os.path.join(FIX, "synthetic_clean_character.glb"), DEMO))["texture_slots"]["measured"]


@pytest.mark.skipif(not os.path.isfile(os.path.join(FROZEN, "export", "SM_HelenKellerBust.fbx")), reason="frozen pipeline run not present")
def test_frozen_pipeline_fbx_orm_evidence():
    rep = validate(os.path.join(FROZEN, "export", "SM_HelenKellerBust.fbx"), DEMO)
    links = {l["file"]: l for l in by_id(rep)["texture_slots"]["measured"]["texture_links"]}
    assert links["T_HelenKellerBust_ORM.png"]["linked_via"] == ["ShininessExponent", "ReflectionFactor"]
    assert links["T_HelenKellerBust_ORM.png"]["slot"] == "ORM"
    assert links["T_HelenKellerBust_N.png"]["slot"] == "Normal"


def test_texture_size_message_without_max_resolution(tmp_path):
    p = json.load(open(EXAMPLE))
    p["textures"]["max_resolution"] = None
    f = tmp_path / "p.json"
    f.write_text(json.dumps(p))
    c = by_id(validate(os.path.join(FIX, "synthetic_clean_character.glb"), str(f)))["texture_size"]
    assert c["status"] == "pass"
    assert "None" not in c["message"]
    assert "power of two; no max resolution set" in c["message"]
    c = by_id(validate(os.path.join(FIX, "synthetic_clean_character.glb"), EXAMPLE))["texture_size"]
    assert "power of two; ≤ 4096 px" in c["message"]
