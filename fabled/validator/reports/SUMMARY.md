# Fixture run summary (real output of run_fixtures.py)

| Fixture | Overall | Exit | Flagged checks | Not checked |
|---|---|---|---|---|
| `synthetic_bad_bone_names.gltf` | fail | 1 | bone_naming (fail) | - |
| `synthetic_clean_character.fbx` | pass | 0 | - | - |
| `synthetic_clean_character.glb` | pass | 0 | - | - |
| `synthetic_clean_character.obj` | pass | 0 | - | skeleton_binding, bone_naming |
| `synthetic_flipped_faces.obj` | fail | 1 | normals (fail) | skeleton_binding, bone_naming |
| `synthetic_geometry_issues.obj` | fail | 1 | non_manifold (fail), degenerate_triangles (fail) | skeleton_binding, bone_naming |
| `synthetic_missing_texture.obj` | fail | 1 | texture_files (fail) | skeleton_binding, bone_naming |
| `synthetic_storyboard_fixed.gltf` | pass | 0 | - | - |
| `synthetic_storyboard_two_flags.gltf` | fail | 1 | scale (fail), normals (fail) | texel_density |
| `synthetic_uv_texture_issues.obj` | fail | 1 | texture_slots (fail), texture_naming (fail), texture_size (fail), uv_layout (fail), texel_density (warn) | skeleton_binding, bone_naming |
| `synthetic_wrong_root_bone.gltf` | fail | 1 | skeleton_binding (fail) | - |
| `synthetic_wrong_scale_meters.obj` | fail | 1 | scale (fail) | skeleton_binding, bone_naming, texel_density |
| `synthetic_wrong_unit_scale.fbx` | fail | 1 | scale (fail) | texel_density |
| `synthetic_pipeline_out/manifest.json (demo profile)` | pass | 0 | - | skeleton_binding, bone_naming |
| `synthetic_pipeline_out_missing_lod/manifest.json (demo profile)` | fail | 1 | manifest (fail) | skeleton_binding, bone_naming |
| `synthetic_pipeline_out_tri_mismatch/manifest.json (demo profile)` | fail | 1 | manifest (fail) | skeleton_binding, bone_naming |
