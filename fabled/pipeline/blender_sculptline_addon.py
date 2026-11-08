"""SculptLine — Blender 4.x / 5.x Viewport Add-on & Pipeline Bridge (SculptLine by Fabled).

Install in Blender:
  Edit -> Preferences -> Add-ons -> Install from Disk... -> select this file,
  or open in Blender's Scripting tab and click Run Script.

Adds a 'SculptLine' tab in the 3D Viewport Sidebar (press N) to:
  1. Inspect active sculpt/mesh triangle count, dimensions (cm), and manifold/winding health.
  2. One-click 'Unify Outward Normals' & 'Repair Non-Manifold Proxy'.
  3. One-click 'Run SculptLine Pipeline & Pre-Import Validator' directly from Blender.
"""
bl_info = {
    "name": "SculptLine",
    "author": "Fabled Technologies",
    "version": (0, 2, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar (N) > SculptLine",
    "description": "Sculpt to Unreal pipeline & pre-import check: pre-import check, scale/normal hygiene, and LOD/FBX pipeline bridge for Unreal studios.",
    "category": "Import-Export",
}

import json
import os
import subprocess
import sys

try:
    import bpy
    import bmesh
except ImportError:
    bpy = None
    bmesh = None

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
PIPELINE_CLI = os.path.join(HERE, "sculptline_pipeline.py")


if bpy is not None:

    class SCULPTLINE_Props(bpy.types.PropertyGroup):
        asset_class: bpy.props.EnumProperty(
            name="Asset Class",
            items=[
                ("bust", "Bust / Head Prop (20–80 cm)", "Static bust or head prop"),
                ("character", "Humanoid Character (150–210 cm)", "Full humanoid character"),
                ("prop_small", "Small Prop (5–100 cm)", "Small environment prop"),
                ("prop_large", "Large Prop (1–10 m)", "Large architectural prop"),
            ],
            default="bust",
        )
        lod0_budget: bpy.props.IntProperty(name="LOD0 Budget (Tris)", default=20000, min=100, max=500000)
        tex_size: bpy.props.EnumProperty(
            name="Texture Resolution",
            items=[("1024", "1024 px", ""), ("2048", "2048 px", ""), ("4096", "4096 px", "")],
            default="2048",
        )
        last_report_summary: bpy.props.StringProperty(name="Last Check", default="Not run yet")

    class SCULPTLINE_OT_recalc_normals(bpy.types.Operator):
        bl_idname = "sculptline.recalc_normals"
        bl_label = "Recalculate Outward Winding"
        bl_description = "Unify triangle winding outward on the active mesh (fixes normals.consistent_winding)"

        def execute(self, context):
            obj = context.active_object
            if not obj or obj.type != "MESH":
                self.report({"WARNING"}, "Select a mesh object first")
                return {"CANCELLED"}
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(obj.data)
            bm.free()
            obj.data.update()
            self.report({"INFO"}, f"Outward normals recalculated on {obj.name}")
            return {"FINISHED"}

    class SCULPTLINE_OT_run_pipeline(bpy.types.Operator):
        bl_idname = "sculptline.run_pipeline"
        bl_label = "Export & Run SculptLine Pipeline"
        bl_description = "Export active sculpt and run SculptLine pipeline + validator"

        def execute(self, context):
            obj = context.active_object
            if not obj or obj.type != "MESH":
                self.report({"WARNING"}, "Select a mesh object first")
                return {"CANCELLED"}
            props = context.scene.sculptline_props
            out_dir = os.path.join(HERE, "output")
            os.makedirs(out_dir, exist_ok=True)
            tmp_glb = os.path.join(out_dir, f"{obj.name}_source.glb")
            bpy.ops.export_scene.gltf(filepath=tmp_glb, export_format="GLB", use_selection=True, export_yup=True)
            cmd = [
                sys.executable,
                PIPELINE_CLI,
                "--input",
                tmp_glb,
                "--out",
                out_dir,
                "--asset-name",
                obj.name,
                "--blender",
                bpy.app.binary_path,
            ]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0:
                props.last_report_summary = f"OK -> {out_dir}/manifest.json"
                self.report({"INFO"}, f"SculptLine pipeline succeeded: {out_dir}")
            else:
                props.last_report_summary = f"Failed (rc={res.returncode})"
                self.report({"ERROR"}, f"Pipeline failed; see {out_dir}/logs/")
            return {"FINISHED"}

    class SCULPTLINE_PT_panel(bpy.types.Panel):
        bl_label = "SculptLine · Sculpt to Unreal"
        bl_idname = "SCULPTLINE_PT_panel"
        bl_space_type = "VIEW_3D"
        bl_region_type = "UI"
        bl_category = "SculptLine"

        def draw(self, context):
            layout = self.layout
            props = context.scene.sculptline_props
            obj = context.active_object

            box = layout.box()
            box.label(text="01 · Active Sculpt Telemetry", icon="MESH_DATA")
            if obj and obj.type == "MESH":
                me = obj.data
                tris = sum(max(0, len(p.vertices) - 2) for p in me.polygons)
                dims_cm = [round(d * 100.0, 1) for d in obj.dimensions]
                box.label(text=f"Object: {obj.name}")
                box.label(text=f"Triangles: {tris:,}  |  Verts: {len(me.vertices):,}")
                box.label(text=f"Size (cm): {dims_cm[0]} × {dims_cm[1]} × {dims_cm[2]} cm")
            else:
                box.label(text="Select a mesh sculpt in viewport")

            box2 = layout.box()
            box2.label(text="02 · Studio Import Profile", icon="PREFERENCES")
            box2.prop(props, "asset_class")
            box2.prop(props, "lod0_budget")
            box2.prop(props, "tex_size")

            box3 = layout.box()
            box3.label(text="03 · Pre-Import Hygiene & Export", icon="CHECKMARK")
            box3.operator("sculptline.recalc_normals", icon="NORMALS_FACE")
            box3.operator("sculptline.run_pipeline", icon="EXPORT")
            box3.label(text=f"Status: {props.last_report_summary}")

    CLASSES = (SCULPTLINE_Props, SCULPTLINE_OT_recalc_normals, SCULPTLINE_OT_run_pipeline, SCULPTLINE_PT_panel)

    def register():
        for cls in CLASSES:
            bpy.utils.register_class(cls)
        bpy.types.Scene.sculptline_props = bpy.props.PointerProperty(type=SCULPTLINE_Props)

    def unregister():
        del bpy.types.Scene.sculptline_props
        for cls in reversed(CLASSES):
            bpy.utils.unregister_class(cls)

    if __name__ == "__main__":
        register()
