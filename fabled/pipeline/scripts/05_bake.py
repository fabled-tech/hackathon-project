"""Step 5: bake a tangent-space normal map from the high-poly sculpt onto LOD0 (Cycles, CPU),
then build an Unreal-style material (M_<asset>) referencing it and assign it to every LOD."""
import bpy, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import *
import numpy as np

a = parse_args(); cfg = a["cfg"]; T = Timer(); W = a["work"]; b = cfg["bake"]
asset = cfg["asset_name"]
export_dir = os.path.join(a["out"], "export"); os.makedirs(export_dir, exist_ok=True)
open_blend(os.path.join(W, "04_lods.blend"))
hp = bpy.data.objects["HP_bake"]; lod0 = bpy.data.objects["LOD0"]
height = hp.dimensions[2]
res = b["resolution"]
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = b["samples"]
sc.render.threads_mode = "FIXED"; sc.render.threads = b["threads"]

img_name = f"T_{asset}_N"
img = bpy.data.images.new(img_name, res, res, alpha=False, float_buffer=(b["color_depth"] == "16"))
img.colorspace_settings.name = "Non-Color"
img.generated_color = (0.5, 0.5, 1.0, 1.0)

mat = bpy.data.materials.new(f"M_{asset}"); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.6, 0.6, 0.6, 1); bsdf.inputs["Roughness"].default_value = 0.6
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; tex.location = (-600, -200)
nm = nt.nodes.new("ShaderNodeNormalMap"); nm.space = "TANGENT"; nm.uv_map = "UVMap"; nm.location = (-300, -200)
nt.links.new(tex.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
nt.nodes.active = tex
for name in [l["name"] for l in cfg["lods"]]:
    o = bpy.data.objects[name]; o.data.materials.clear(); o.data.materials.append(mat)

g = "NEG_Y" if b["normal_convention"].lower() == "directx" else "POS_Y"
cage = height * b["cage_extrusion_fraction_of_height"]; maxd = height * b["max_ray_distance_fraction_of_height"]
# Bake with the link to Normal temporarily removed so LOD0's own (flat) normal map doesn't feed back
for l in list(nt.links):
    if l.to_node == bsdf and l.to_socket.name == "Normal": nt.links.remove(l)
for o in bpy.context.view_layer.objects: o.select_set(False)
hp.select_set(True); lod0.select_set(True); bpy.context.view_layer.objects.active = lod0
with T("bake"):
    r = bpy.ops.object.bake(type="NORMAL", use_selected_to_active=True, cage_extrusion=cage,
                            max_ray_distance=maxd, margin=b["margin_px"], margin_type="EXTEND",
                            normal_space="TANGENT", normal_r="POS_X", normal_g=g, normal_b="POS_Z",
                            target="IMAGE_TEXTURES", use_clear=True)
nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
png = os.path.join(export_dir, f"{img_name}.png")
with T("save_png"):
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = b["color_depth"]
    sc.render.image_settings.color_mode = "RGB"
    img.save_render(png, scene=sc)
    img.filepath = png; img.source = "FILE"; img.reload()

# ---- optional base colour transfer (source texture -> LOD0 UVs), Cycles DIFFUSE colour-only, selected-to-active
bc_cfg = b.get("base_color", {}); bc_info = None
src_imgs = sorted({n.image.name for m_ in hp.data.materials if m_ and m_.use_nodes
                   for n in m_.node_tree.nodes if n.type == "TEX_IMAGE" and n.image})
if bc_cfg.get("enabled", True) and src_imgs:
    bc_img = bpy.data.images.new(f"T_{asset}_BC", res, res, alpha=False)
    bc_img.colorspace_settings.name = "sRGB"
    bc_tex = nt.nodes.new("ShaderNodeTexImage"); bc_tex.image = bc_img; bc_tex.location = (-600, 450)
    nt.nodes.active = bc_tex
    sc.cycles.samples = bc_cfg.get("samples", 4)
    for o in bpy.context.view_layer.objects: o.select_set(False)
    hp.select_set(True); lod0.select_set(True); bpy.context.view_layer.objects.active = lod0
    with T("bake_base_color"):
        r_bc = bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_selected_to_active=True,
                                   cage_extrusion=cage, max_ray_distance=maxd, margin=b["margin_px"],
                                   margin_type="EXTEND", target="IMAGE_TEXTURES", use_clear=True)
    bc_png = os.path.join(export_dir, f"T_{asset}_BC.png")
    sc.render.image_settings.color_depth = "8"; sc.render.image_settings.color_mode = "RGB"
    bc_img.save_render(bc_png, scene=sc)
    bc_img.filepath = bc_png; bc_img.source = "FILE"; bc_img.reload()
    nt.links.new(bc_tex.outputs["Color"], bsdf.inputs["Base Color"])
    bpx = np.empty(res * res * 4, dtype=np.float32); bc_img.pixels.foreach_get(bpx); bpx = bpx.reshape(res, res, 4)[..., :3]
    uvm_ = np.load(os.path.join(W, "uv_lod0.npz"))
    bc_info = {"path": bc_png, "bytes": os.path.getsize(bc_png), "resolution": res, "operator_result": sorted(r_bc),
               "source_textures": src_imgs, "method": "Cycles DIFFUSE bake, pass_filter=COLOR, selected-to-active from source",
               "samples": bc_cfg.get("samples", 4),
               "mean_rgb": [round(float(v), 4) for v in bpx.reshape(-1, 3).mean(0)],
               "pct_texels_black": round(100.0 * float((bpx.max(-1) < 0.01).mean()), 2)}
    del bpx

# ---- optional AO bake -> ORM (R = baked AO, G = roughness const, B = metallic const)
ao_cfg = b.get("ao", {}); orm_info = None
if ao_cfg.get("enabled"):
    ao_img = bpy.data.images.new(f"T_{asset}_AO_tmp", res, res, alpha=False, float_buffer=True)
    ao_img.colorspace_settings.name = "Non-Color"
    ao_tex = nt.nodes.new("ShaderNodeTexImage"); ao_tex.image = ao_img; ao_tex.location = (-600, 200)
    nt.nodes.active = ao_tex
    if sc.world is None:
        sc.world = bpy.data.worlds.new("BakeWorld")
    sc.world.light_settings.distance = height * ao_cfg["distance_fraction_of_height"]
    sc.cycles.samples = ao_cfg["samples"]
    # AO rays must only see the high-poly: hide the other LODs and make LOD0 invisible to secondary rays,
    # otherwise the low-poly shell (within a few mm of the sculpt) occludes everything (first attempt baked ~black).
    for spec in cfg["lods"][1:]:
        bpy.data.objects[spec["name"]].hide_render = True
    for attr in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
        setattr(lod0, attr, False)
    for o in bpy.context.view_layer.objects: o.select_set(False)
    hp.select_set(True); lod0.select_set(True); bpy.context.view_layer.objects.active = lod0
    with T("bake_ao"):
        r_ao = bpy.ops.object.bake(type="AO", use_selected_to_active=True, cage_extrusion=cage,
                                   max_ray_distance=maxd, margin=b["margin_px"], margin_type="EXTEND",
                                   target="IMAGE_TEXTURES", use_clear=True)
    with T("pack_orm"):
        apx = np.empty(res * res * 4, dtype=np.float32); ao_img.pixels.foreach_get(apx); apx = apx.reshape(res, res, 4)
        orm = np.ones((res, res, 4), dtype=np.float32)
        orm[..., 0] = apx[..., 0]
        orm[..., 1] = ao_cfg["orm_roughness_constant"]; orm[..., 2] = ao_cfg["orm_metallic_constant"]
        orm_img = bpy.data.images.new(f"T_{asset}_ORM", res, res, alpha=False)
        orm_img.colorspace_settings.name = "Non-Color"
        orm_img.pixels.foreach_set(orm.ravel())
        orm_png = os.path.join(export_dir, f"T_{asset}_ORM.png")
        sc.render.image_settings.color_depth = "8"
        orm_img.save_render(orm_png, scene=sc)
        orm_img.filepath = orm_png; orm_img.source = "FILE"; orm_img.reload()
        nt.nodes.remove(ao_tex); bpy.data.images.remove(ao_img)
        for spec in cfg["lods"][1:]:
            bpy.data.objects[spec["name"]].hide_render = False
        for attr in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
            setattr(lod0, attr, True)
        # Hook ORM into M_<asset>. Blender's FBX exporter (PrincipledBSDFWrapper) only writes a texture when an
        # Image node is linked DIRECTLY to a Principled socket; through Separate Color it is silently dropped
        # (verified: the FBX then referenced only T_*_N). So the ORM image is linked straight into Roughness and
        # Metallic: the FBX records it in the roughness (ShininessExponent) and metallic (ReflectionFactor) slots.
        # Channel selection (R=AO, G=rough, B=metal) has to happen in the Unreal material.
        ot = nt.nodes.new("ShaderNodeTexImage"); ot.image = orm_img; ot.location = (-600, 200); ot.label = "ORM (R=AO G=Rough B=Metal)"
        nt.links.new(ot.outputs["Color"], bsdf.inputs["Roughness"]); nt.links.new(ot.outputs["Color"], bsdf.inputs["Metallic"])
    aor = apx[..., 0]
    orm_info = {"path": orm_png, "bytes": os.path.getsize(orm_png), "resolution": res, "samples": ao_cfg["samples"],
                "ao_distance_m": round(sc.world.light_settings.distance, 5), "operator_result": sorted(r_ao),
                "channels": {"r": "baked_ao", "g": {"constant": ao_cfg["orm_roughness_constant"]},
                             "b": {"constant": ao_cfg["orm_metallic_constant"]}},
                "ao_stats": {"min": round(float(aor.min()), 4), "mean": round(float(aor.mean()), 4), "max": round(float(aor.max()), 4)}}

# simple bake sanity stats on the saved texture
px = np.empty(res * res * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(res, res, 4)[..., :3]
flat = np.all(np.abs(px - np.array([0.5, 0.5, 1.0])) < 0.01, axis=-1)
uvd = np.load(os.path.join(W, "uv_lod0.npz"))
with T("save"):
    save_blend(os.path.join(W, "05_bake.blend"))
out = {"resolution": res, "samples": b["samples"], "engine": "Cycles CPU", "threads": b["threads"],
       "type": "tangent-space normal", "normal_convention": b["normal_convention"],
       "swizzle": ["POS_X", g, "POS_Z"], "cage_extrusion_m": round(cage, 6), "max_ray_distance_m": round(maxd, 6),
       "margin_px": b["margin_px"], "color_depth_bits": int(b["color_depth"]),
       "bake_source_tris": tri_count(hp), "bake_target": "LOD0", "bake_target_tris": tri_count(lod0),
       "operator_result": sorted(r), "texture_path": png, "texture_bytes": os.path.getsize(png),
       "pct_texels_exactly_flat_blue": round(100.0 * float(flat.mean()), 2),
       "material": mat.name, "orm": orm_info, "base_color": bc_info,
       "base_color_note": (None if bc_info else ("source mesh has no image texture, so no base colour was baked" if not src_imgs else "base colour bake disabled in config")),
       "core_timings_s": T.t}
write_json(os.path.join(W, "step05.json"), out)
print("STEP05", out)
