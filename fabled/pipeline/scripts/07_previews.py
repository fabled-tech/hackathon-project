"""Step 7: raw preview renders (Cycles CPU, transparent PNG) for the demo UI.
Labelled composites are made afterwards by post_previews.py (system Python + Pillow)."""
import bpy, os, sys, math, mathutils, time
sys.path.insert(0, os.path.dirname(__file__))
from common import *

a = parse_args(); cfg = a["cfg"]; T = Timer(); W = a["work"]; pc = cfg["previews"]
raw_dir = os.path.join(a["out"], "previews", "raw"); os.makedirs(raw_dir, exist_ok=True)
open_blend(os.path.join(W, "05_bake.blend"))
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = pc["samples"]
sc.cycles.use_denoising = True
sc.render.resolution_x = sc.render.resolution_y = pc["resolution"]
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
sc.render.image_settings.color_depth = "8"
sc.view_settings.view_transform = "Standard"
sc.render.threads_mode = "FIXED"; sc.render.threads = cfg["bake"]["threads"]
world = bpy.data.worlds.new("W"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.25, 0.25, 0.27, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
sc.world = world

hp = bpy.data.objects["HP_bake"]
H = hp.dimensions[2]
lod_names = [l["name"] for l in cfg["lods"]]

# ---- materials
def clay(name, col=(0.62, 0.6, 0.57)):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = 0.55
    return m, b

clay_m, _ = clay("Clay")
nm_m, nm_b = clay("Clay_NormalMap")
nt = nm_m.node_tree
src_img = bpy.data.images[f"T_{cfg['asset_name']}_N"]
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = src_img; src_img.colorspace_settings.name = "Non-Color"
nmap = nt.nodes.new("ShaderNodeNormalMap"); nmap.uv_map = "UVMap"
if cfg["bake"]["normal_convention"].lower() == "directx":   # flip green back to OpenGL for Blender preview
    sep = nt.nodes.new("ShaderNodeSeparateColor"); comb = nt.nodes.new("ShaderNodeCombineColor")
    inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs[0], comb.inputs[0]); nt.links.new(sep.outputs[2], comb.inputs[2])
    nt.links.new(sep.outputs[1], inv.inputs[1]); nt.links.new(inv.outputs[0], comb.inputs[1])
    nt.links.new(comb.outputs["Color"], nmap.inputs["Color"])
else:
    nt.links.new(tex.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], nm_b.inputs["Normal"])

# textured preview material (BC + OpenGL-corrected normal map) if a base colour was baked
bc_prev = bpy.data.images.get(f"T_{cfg['asset_name']}_BC")
tex_m = None
if bc_prev:
    tex_m = nm_m.copy(); tex_m.name = "Preview_BC_Normal"
    tb = tex_m.node_tree.nodes["Principled BSDF"]
    bcn = tex_m.node_tree.nodes.new("ShaderNodeTexImage"); bcn.image = bc_prev
    tex_m.node_tree.links.new(bcn.outputs["Color"], tb.inputs["Base Color"])
hp_orig_mats = list(hp.data.materials)
src_m = hp_orig_mats[0] if hp_orig_mats and hp_orig_mats[0] else None

wire_m = bpy.data.materials.new("Wire"); wire_m.use_nodes = True
wb = wire_m.node_tree.nodes["Principled BSDF"]; wb.inputs["Base Color"].default_value = (0.03, 0.06, 0.12, 1)
wb.inputs["Roughness"].default_value = 0.9

# HP wireframe via Cycles Wireframe node (geometry wireframe modifier on 8.5M tris is not feasible)
hpw_m, hpw_b = clay("HP_Wire")
hnt = hpw_m.node_tree
wf = hnt.nodes.new("ShaderNodeWireframe"); wf.use_pixel_size = True; wf.inputs["Size"].default_value = 0.6
mix = hnt.nodes.new("ShaderNodeMixShader"); dark = hnt.nodes.new("ShaderNodeBsdfDiffuse")
dark.inputs["Color"].default_value = (0.03, 0.06, 0.12, 1)
out_n = hnt.nodes["Material Output"]
hnt.links.new(wf.outputs[0], mix.inputs[0]); hnt.links.new(hpw_b.outputs[0], mix.inputs[1])
hnt.links.new(dark.outputs[0], mix.inputs[2]); hnt.links.new(mix.outputs[0], out_n.inputs["Surface"])

def set_mat(ob, m):
    ob.data.materials.clear(); ob.data.materials.append(m)

# wire overlay objects for LODs (LOD0 uses the pre-triangulation quad mesh so quads read as quads)
wire_objs = {}
for n in lod_names:
    src = bpy.data.objects["LOD0_quads" if n == "LOD0" else n]
    w = bpy.data.objects.new(n + "_wire", src.data.copy()); sc.collection.objects.link(w)
    mod = w.modifiers.new("wf", "WIREFRAME"); mod.thickness = H * 0.0011; mod.use_replace = True
    mod.use_even_offset = True; mod.offset = 0.0
    set_mat(w, wire_m); wire_objs[n] = w
for n in lod_names:
    bpy.data.objects[n].data = bpy.data.objects[n].data.copy()   # don't mutate the export meshes' materials

# ---- lights + camera
def add_light(name, loc, energy, size):
    l = bpy.data.lights.new(name, "AREA"); l.energy = energy; l.size = size
    o = bpy.data.objects.new(name, l); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (mathutils.Vector((0, 0, H * 0.6)) - mathutils.Vector(loc)).to_track_quat("-Z", "Y").to_euler()
LE = pc.get("light_energy_scale", 1.0) * H * H
add_light("Key", (-H * 1.6, -H * 2.2, H * 1.8), 30 * LE, H * 1.2)
add_light("Fill", (H * 2.0, -H * 1.5, H * 0.9), 8 * LE, H * 1.5)
add_light("Rim", (H * 0.5, H * 2.2, H * 1.6), 20 * LE, H * 0.8)
cam_d = bpy.data.cameras.new("Cam"); cam_d.lens = 85
cam = bpy.data.objects.new("Cam", cam_d); sc.collection.objects.link(cam); sc.camera = cam

def frame(center_z, frame_h, az=pc["camera_azimuth_deg"], el=pc["camera_elevation_deg"]):
    fov = 2 * math.atan(cam_d.sensor_width / (2 * cam_d.lens))
    dist = (frame_h / 2) / math.tan(fov / 2)
    a_, e_ = math.radians(az), math.radians(el)
    tgt = mathutils.Vector((0, 0, center_z))
    cam.location = tgt + dist * mathutils.Vector((math.sin(a_) * math.cos(e_), -math.cos(a_) * math.cos(e_), math.sin(e_)))
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()

all_objs = [o for o in sc.objects if o.type == "MESH"]
renders = {}
ONLY = a.get("only")
def render(name, show, material=None, full=True, samples=None):
    if ONLY and name not in ONLY.split(","): return
    for o in all_objs:
        o.hide_render = o not in show
    if material:
        for o, m in material.items(): set_mat(o, m)
    sc.cycles.samples = samples or pc["samples"]
    path = os.path.join(raw_dir, name + ".png"); sc.render.filepath = path
    t0 = time.time(); bpy.ops.render.render(write_still=True)
    renders[name] = {"path": path, "render_s": round(time.time() - t0, 2)}

full = (H * 0.5, H * pc.get("full_frame_height_frac", 1.12))
close = (H * pc.get("closeup_center_frac", 0.77), H * pc.get("closeup_height_frac", 0.5))   # head close-up (asset-specific framing)
L = {n: bpy.data.objects[n] for n in lod_names}
with T("renders"):
    frame(*full)
    if tex_m and src_m:
        render("hp_textured", [hp], {hp: src_m})
        render("lod0_textured", [L["LOD0"]], {L["LOD0"]: tex_m})
        render(f"{lod_names[-1].lower()}_textured", [L[lod_names[-1]]], {L[lod_names[-1]]: tex_m})
        frame(*full, az=pc["camera_azimuth_deg"] + 160)
        render("hp_textured_back", [hp], {hp: src_m})
        render("lod0_textured_back", [L["LOD0"]], {L["LOD0"]: tex_m})
        frame(*full)
    render("hp_shaded", [hp], {hp: clay_m})
    render("lod0_shaded_no_normalmap", [L["LOD0"]], {L["LOD0"]: clay_m})
    render("lod0_shaded_normalmap", [L["LOD0"]], {L["LOD0"]: nm_m})
    render(f"{lod_names[-1].lower()}_shaded_normalmap", [L[lod_names[-1]]], {L[lod_names[-1]]: nm_m})
    render("hp_wire", [hp], {hp: hpw_m})
    for n in lod_names:
        render(f"{n.lower()}_wire", [L[n], wire_objs[n]], {L[n]: clay_m})
    frame(*close)
    if tex_m and src_m:
        render("closeup_hp_textured", [hp], {hp: src_m})
        render("closeup_lod0_textured", [L["LOD0"]], {L["LOD0"]: tex_m})
        render("closeup_lod1_textured", [L[lod_names[1]]], {L[lod_names[1]]: tex_m}) if len(lod_names) > 1 else None
    render("closeup_hp_shaded", [hp], {hp: clay_m})
    render("closeup_lod0_shaded_normalmap", [L["LOD0"]], {L["LOD0"]: nm_m})
    render("closeup_lod0_shaded_no_normalmap", [L["LOD0"]], {L["LOD0"]: clay_m})
    render("closeup_hp_wire", [hp], {hp: hpw_m})
    render("closeup_lod0_wire", [L["LOD0"], wire_objs["LOD0"]], {L["LOD0"]: clay_m})
write_json(os.path.join(W, "step07.json"), {"engine": "Cycles CPU", "resolution": pc["resolution"],
           "samples": pc["samples"], "renders": renders, "core_timings_s": T.t})
print("STEP07", renders)
