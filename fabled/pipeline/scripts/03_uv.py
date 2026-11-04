"""Step 3: UV-unwrap LOD0 (Smart UV Project + pack), mark seams, measure islands/overlap/texel density."""
import bpy, bmesh, os, sys, math
sys.path.insert(0, os.path.dirname(__file__))
from common import *

a = parse_args(); cfg = a["cfg"]; T = Timer(); W = a["work"]; ucfg = cfg["uv"]
open_blend(os.path.join(W, "02_retopo.blend"))
lod0 = bpy.data.objects["LOD0"]
out = {}

with T("unwrap"):
    select_only(lod0)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(ucfg["angle_limit_deg"]), island_margin=0.0,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
with T("pack"):
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION",
                            margin=ucfg["pack_margin_fraction"], shape_method="CONCAVE")
    bpy.ops.uv.seams_from_islands(mark_seams=True, mark_sharp=False)
    bpy.ops.object.mode_set(mode="OBJECT")
lod0.data.uv_layers[0].name = "UVMap"

# keep an untriangulated quad copy for wireframe previews
quad = bpy.data.objects.new("LOD0_quads", lod0.data.copy())
bpy.context.scene.collection.objects.link(quad)
quad.hide_render = True

with T("triangulate"):
    m = lod0.modifiers.new("Tri", "TRIANGULATE"); m.quad_method = "BEAUTY"; m.ngon_method = "BEAUTY"
    m.keep_custom_normals = False
    apply_modifier(lod0, m)
    out["clean_mesh_after_triangulate"] = clean_mesh(lod0)
    out["faces_set_flat_opposing_normals"] = flatten_faces_with_opposing_normals(lod0)

with T("measure"):
    m_uv = uv_metrics(lod0, ucfg["overlap_check_resolution"], cfg["bake"]["resolution"], os.path.join(W, "uv_lod0.npz"))

out.update({
    "method": "Smart UV Project (angle limit %.0f deg) + Pack Islands (concave, rotate, margin %.3f)" % (ucfg["angle_limit_deg"], ucfg["pack_margin_fraction"]),
    **m_uv,
    "lod0_after_triangulate": mesh_stats(lod0),
    "core_timings_s": T.t,
})
with T("save"):
    save_blend(os.path.join(W, "03_uv.blend"))
out["core_timings_s"] = T.t
write_json(os.path.join(W, "step03.json"), out)
print("STEP03", out)
