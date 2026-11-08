// Browser-side pre-import checks. Every value in a message is computed from the loaded mesh
// and the current profile. Severity: error | warning | info. passed: true | false | null (informational).
import { triCount, surfaceArea, uvArea } from './meshops.js';

export const UNIT_TO_CM = { m: 100, cm: 1, mm: 0.1 };
const fmt = (n, d = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const fmtLen = (cm) => (cm >= 100 ? `${fmt(cm / 100)} m` : `${fmt(cm)} cm`);

export function runBrowserChecks({ src, topo, profile, lods, manifest, validator = null }) {
  const out = []; const obj = src.flat.meshNames.length === 1 ? src.flat.meshNames[0] : `${src.flat.meshNames.length} meshes`;
  const upIdx = profile.up_axis === 'Z' ? 2 : 1;
  const heightUnits = src.welded.bbox.size[upIdx];
  const cmPerUnit = UNIT_TO_CM[profile.units] * profile.scale;
  const heightCm = heightUnits * cmPerUnit;
  const [minCm, maxCm] = profile.asset_class.height_cm;

  // 1. Scale
  const scaleOk = heightCm >= minCm && heightCm <= maxCm;
  let suggestion = null;
  if (!scaleOk && heightUnits > 0) {
    for (const s of [0.01, 0.1, 10, 100, 0.001, 1000, 1]) { const h = heightUnits * UNIT_TO_CM[profile.units] * s; if (h >= minCm && h <= maxCm) { suggestion = s; break; } }
  }
  out.push({ id: 'scale.height_range', severity: 'error', passed: scaleOk, object: obj,
    message: `${profile._heightNote ? `Height measured ${fmt(heightCm, 1)} cm from the file (${profile._heightNote})` : `Height ${fmtLen(heightCm)}`} (${fmt(heightUnits, 3)} units × ${UNIT_TO_CM[profile.units]} cm/unit × scale ${profile.scale}, ${profile.up_axis}-up${profile._used ? ` ${profile._measureNote}` : ''}). ${profile._used ? 'Profile used' : 'Profile'} expects ${minCm}–${maxCm} cm for "${profile.asset_class.label}".`,
    fix_hint: scaleOk ? null : (suggestion ? `Scale ${suggestion} would put it at ${fmtLen(heightUnits * UNIT_TO_CM[profile.units] * suggestion)}.` : 'Check source units and scale.'),
    fix: !scaleOk && suggestion ? { kind: 'scale', value: suggestion } : null });

  // 2. Normals: same definition as sculptline_validator's "normals" check (see meshops.analyzeTopology):
  //    flagged = winding disagrees with its connected surface OR stored vertex normals point against the face.
  //    The validator's number is authoritative; the browser figure is labeled with what it was measured on.
  out.push(normalsCheck({ src, topo, lods, validator }));
  // 3. Open / non-manifold edges
  out.push({ id: 'mesh.manifold', severity: 'warning', passed: topo.boundaryEdges === 0 && topo.nonManifoldEdges === 0, object: obj,
    message: `${fmt(topo.boundaryEdges, 0)} open (boundary) edges, ${fmt(topo.nonManifoldEdges, 0)} non-manifold edges.` });

  // 4. Degenerate triangles
  out.push({ id: 'mesh.degenerate_triangles', severity: 'warning', passed: topo.degenerate === 0, object: obj,
    message: `${fmt(topo.degenerate, 0)} zero-area triangles.` });

  // 5. Mirrored transforms
  if (src.flat.mirroredTransforms > 0) out.push({ id: 'transform.mirrored', severity: 'warning', passed: false, object: obj,
    message: `${src.flat.mirroredTransforms} mesh node(s) have a negative-scale (mirrored) transform.` });

  // 6. Skeleton
  const wantsSkel = profile.skeleton.type !== 'none';
  const skinned = src.flat.skinnedMeshes > 0;
  out.push({ id: 'skeleton.binding', severity: 'warning', passed: !wantsSkel ? true : skinned ? null : false, object: obj,
    message: !wantsSkel ? 'Profile imports as a static mesh; no skeleton required.'
      : !skinned ? `Profile asks for skeleton ${profile.skeleton.asset_path}, but the file has no skinned meshes or bones. The pipeline is static-mesh only for now, so the skeleton setting is not used yet.`
      : skinned ? `File has ${src.flat.skinnedMeshes} skinned mesh(es) and ${src.flat.bones} bones. Match to ${profile.skeleton.asset_path} is not verified in the browser.`
      : `Profile expects skeleton ${profile.skeleton.asset_path}, but the file has no skinned meshes or bones.`,
    fix_hint: wantsSkel && !skinned ? 'Binding to the studio skeleton is a pipeline step (not wired in this prototype).' : null });

  // 7. Triangle count vs LOD0 budget (informational for the sculpt)
  const sculptTris = triCount(src.welded.indices); const lod0 = profile.lod_budget[0]?.max_triangles;
  if (!src.fromPipeline) out.push({ id: 'mesh.sculpt_triangles', severity: 'info', passed: null, object: obj,
    message: `Sculpt has ${fmt(sculptTris, 0)} triangles; LOD0 budget is ${lod0 != null ? fmt(lod0, 0) : 'unset'}${lod0 && sculptTris > lod0 ? ', so it needs retopology before import.' : '.'}` });
  else if (manifest?.input?.triangles != null) out.push({ id: 'mesh.input_triangles', severity: 'info', passed: null, object: 'high-poly input',
    message: `High-poly input has ${fmt(manifest.input.triangles, 0)} triangles according to the pipeline manifest (input not loaded in the browser).` });

  // 8. LOD budgets (only for meshes actually built/loaded)
  for (const l of lods) {
    const fromManifest = l.source === 'pipeline' && l.budget != null;
    const budget = fromManifest ? l.budget : profile.lod_budget[l.level]?.max_triangles;
    const label = `LOD${l.level} (${l.source === 'pipeline' ? 'pipeline output' : 'browser preview'})`;
    out.push({ id: `lod.budget.lod${l.level}`, severity: 'error', passed: budget == null ? null : l.tris <= budget, object: label,
      message: `${fmt(l.tris, 0)} triangles vs ${fromManifest ? 'manifest' : 'profile'} budget ${budget != null ? fmt(budget, 0) : 'unset'}.` });
  }

  // 9. Texel density (needs UVs; computed on LOD0 if loaded with UVs, else on the sculpt)
  const target = profile.texel_density.px_per_m; const tex = profile.texel_density.texture_size;
  const uvSrc = lods.find((l) => l.level === 0 && l.uvData)?.uvData || (src.flat.uvs ? { positions: src.flat.positions, indices: src.flat.indices, uvs: src.flat.uvs, label: obj } : null);
  if (uvSrc) {
    const mPerUnit = cmPerUnit / 100;
    const worldM2 = surfaceArea(uvSrc.positions, uvSrc.indices) * mPerUnit * mPerUnit; const uvA = uvArea(uvSrc.uvs, uvSrc.indices);
    const td = worldM2 > 0 ? tex * Math.sqrt(uvA / worldM2) : 0; const tol = 0.15;
    if (target == null) out.push({ id: 'uv.texel_density', severity: 'info', passed: null, object: uvSrc.label || 'LOD0',
      message: `No texel density target in the profile used, so not checked. Measured (information only): ${fmt(td / 100, 2)} px/cm at ${tex}px (UV area ${fmt(uvA, 3)}, surface ${fmt(worldM2, 4)} m²).` });
    else out.push({ id: 'uv.texel_density', severity: 'warning', passed: Math.abs(td - target) <= target * tol, object: uvSrc.label || 'LOD0',
      message: `Average texel density ${fmt(td, 0)} px/m at ${tex}px (UV area ${fmt(uvA, 3)}, surface ${fmt(worldM2, 4)} m²). Target ${target} px/m ±15%.` });
  } else {
    out.push({ id: 'uv.texel_density', severity: 'info', passed: null, object: obj,
      message: 'No UVs on the loaded meshes, so texel density cannot be computed here. It applies to the retopo output once the pipeline unwraps it.' });
  }

  // 10. Textures
  out.push({ id: 'materials.textures', severity: 'info', passed: null, object: obj,
    message: src.flat.textureSlots.length ? `Texture slots found in file: ${src.flat.textureSlots.join(', ')}.` : `No textures in the file (${src.flat.materialCount} material slot(s)). Texture hookup is checked on the pipeline output.` });
  return out;
}

// ---- normals / winding ----
const lodOf = (name) => { const m = /LOD(\d+)\s*$/i.exec(String(name || '')); return m ? Number(m[1]) : null; };
function browserLabel(src, lods) {
  if (src.fromPipeline) { const f = (lods.find((l) => l.level === 0)?.format || src.format || '').toUpperCase(); return `browser check: ${f === 'GLB' || f === 'GLTF' ? 'GLB preview' : `${f} file`}`; }
  return `browser check: uploaded ${String(src.format || '').toUpperCase()}`;
}
function browserNormals(src, topo, lods) {
  // Pipeline output: every loaded LOD (the validator checks all LOD meshes in the combined FBX). Upload: the file.
  const per = src.fromPipeline && lods.some((l) => l.topo)
    ? lods.filter((l) => l.topo).map((l) => ({ level: l.level, t: l.topo }))
    : [{ level: null, t: topo }];
  const sum = (k) => per.reduce((n, p) => n + (Array.isArray(p.t[k]) ? p.t[k].length : p.t[k]), 0);
  return { per, triangles: sum('triangles'), flagged: sum('flaggedTriangles'), winding: sum('flippedTriangles'), against: sum('againstTriangles'),
    stored: per.every((p) => p.t.hasStoredNormals) };
}
export function validatorNormals(rep) {
  const c = Array.isArray(rep?.checks) ? rep.checks.find((x) => x.id === 'normals') : null;
  if (!c || rep.concept_mockup) return null;
  const m = c.measured || {};
  const items = Array.isArray(c.items) ? c.items : [];
  // validator >= bbf237d: reversed_winding / stored_normals_against_face (null = no stored normals in file) / flagged_by_both
  const has = (k) => Object.prototype.hasOwnProperty.call(m, k);
  return { status: c.status, triangles: m.triangles_checked, flagged: m.faces_flagged,
    winding: has('reversed_winding') ? m.reversed_winding : m.faces_winding_inconsistent,
    against: has('stored_normals_against_face') ? m.stored_normals_against_face : m.faces_stored_normal_against_face,
    both: has('flagged_by_both') ? m.flagged_by_both : undefined,
    perMesh: items.map((it) => ({ mesh: it.mesh, level: lodOf(it.mesh), flagged: it.faces_flagged, winding: it.reversed_winding ?? it.winding_flipped,
      against: Object.prototype.hasOwnProperty.call(it, 'stored_normals_against_face') ? it.stored_normals_against_face : null })),
    message: c.message };
}
function normalsCheck({ src, topo, lods, validator }) {
  const label = browserLabel(src, lods);
  const b = browserNormals(src, topo, lods);
  const v = validatorNormals(validator);
  const perB = b.per.length > 1 ? ' (' + b.per.map((p) => `LOD${p.level} ${fmt(p.t.flaggedTriangles.length, 0)}/${fmt(p.t.triangles, 0)}`).join(', ') + ')' : '';
  const bText = `${fmt(b.flagged, 0)} of ${fmt(b.triangles, 0)} triangles flagged${perB}: reversed winding ${fmt(b.winding, 0)}, stored normals against face ${b.stored ? fmt(b.against, 0) : 'n/a (no stored normals in file)'}`;
  const fixable = topo.flippedTriangles.length;
  const fix = fixable && !src.fromPipeline ? { kind: 'flip', count: fixable } : null;
  const preview = src.browserFixedFlips ? ` Winding was flipped in the BROWSER PREVIEW ONLY; the file on disk (what the pipeline and validator read) still has ${fmt(src.browserFixedFlips, 0)} reversed triangles.` : '';
  if (!v) {
    return { id: 'normals.flipped', severity: 'error', passed: src.browserFixedFlips ? false : b.flagged === 0, object: label,
      message: `${label}: ${bText}. Validator result not available yet, so this browser figure is provisional.${preview}`,
      fix_hint: b.flagged ? 'Definition (same as the SculptLine validator): a triangle is flagged if its winding disagrees with its connected surface or its stored vertex normals point against it.' : null, fix };
  }
  // Compare on the same scope: per LOD when we have LODs, else totals.
  let agree = v.flagged === b.flagged && v.triangles === b.triangles;
  const diffs = [];
  if (b.per.length > 1) {
    for (const p of b.per) {
      const vm = v.perMesh.find((x) => x.level === p.level); const vf = vm ? vm.flagged : 0;
      if (vf !== p.t.flaggedTriangles.length) { agree = false; diffs.push(`LOD${p.level}: validator ${fmt(vf, 0)} vs browser ${fmt(p.t.flaggedTriangles.length, 0)}`); }
    }
  }
  const perV = v.perMesh.length ? ' (' + v.perMesh.map((x) => `${x.level != null ? `LOD${x.level}` : x.mesh} ${fmt(x.flagged, 0)}`).join(', ') + ')' : '';
  const vText = `Validator (authoritative): ${fmt(v.flagged ?? 0, 0)} of ${fmt(v.triangles ?? 0, 0)} triangles flagged${perV}. Reversed winding: ${fmt(v.winding ?? 0, 0)}. Stored normals against face: ${v.against === null ? 'no stored normals in file' : fmt(v.against ?? 0, 0)}.${v.both !== undefined ? ` Flagged by both: ${fmt(v.both ?? 0, 0)}.` : ''}`;
  return { id: 'normals.flipped', severity: agree ? 'error' : 'warning', passed: src.browserFixedFlips ? false : v.status === 'pass' ? true : false, object: 'validator (authoritative)',
    message: `${vText} ${label}, same definition: ${agree ? `agrees (${fmt(b.flagged, 0)} of ${fmt(b.triangles, 0)}).` : `DOES NOT MATCH (${bText}${diffs.length ? '; ' + diffs.join('; ') : ''}). The browser figure is not used; the validator figure stands.`}${preview}`,
    fix_hint: v.against && !v.winding ? 'Winding is consistent; the flags are triangles whose stored (smoothed) vertex normals point against the face. Fix by recomputing/splitting normals on those faces in the DCC or pipeline export.' : null, fix };
}

export const VALIDATOR_CHECKS_INFO = [
  { id: 'scale', group: 'Scale & orientation', title: 'Scale (bounding-box height)', explanation: 'Validates that the bounding-box height matches studio height range for the specified asset class.', fixHint: 'Adjust import scale or source units in the Studio Spec profile.' },
  { id: 'up_axis', group: 'Scale & orientation', title: 'Up axis', explanation: 'Ensures model orientation adheres to Unreal Engine Z-up coordinate conventions.', fixHint: 'Change Up axis to Z in profile, or re-export asset with Z-up coordinates.' },
  { id: 'normals', group: 'Normals', title: 'Flipped / inconsistent normals', explanation: 'Checks for inverted face normals and inconsistent polygon winding order.', fixHint: 'Recalculate or split vertex normals in DCC, or preview unified winding in browser.' },
  { id: 'non_manifold', group: 'Geometry', title: 'Non-manifold geometry', explanation: 'Verifies mesh is watertight with zero open boundary or non-manifold edges.', fixHint: 'Run retopology or manifold cleanup pass in pipeline to seal mesh edges.' },
  { id: 'degenerate_triangles', group: 'Geometry', title: 'Degenerate triangles', explanation: 'Flags zero-area or collinear collapsed faces causing rendering artifacts.', fixHint: 'Clean degenerate faces via decimation or weld vertices in DCC.' },
  { id: 'triangle_budget', group: 'Geometry', title: 'Triangle budget per LOD', explanation: 'Verifies polygon count stays within studio triangle budget for each LOD level.', fixHint: 'Increase target decimation or adjust LOD budget thresholds in profile.' },
  { id: 'skeleton_binding', group: 'Skeleton', title: 'Skeleton root & skin binding', explanation: 'Verifies rigged skeletal mesh contains valid root joint and skinning weights.', fixHint: 'Bind mesh to designated studio skeleton or set profile asset type to static mesh.' },
  { id: 'bone_naming', group: 'Skeleton', title: 'Bone naming', explanation: 'Ensures bone hierarchy conforms to standard Unreal mannequin joint names.', fixHint: 'Rename non-standard bone joints to match target skeleton profile.' },
  { id: 'texture_files', group: 'Textures & materials', title: 'Missing textures', explanation: 'Verifies all textures referenced by materials exist on disk.', fixHint: 'Place missing image files in export texture directory.' },
  { id: 'texture_slots', group: 'Textures & materials', title: 'Required texture slots', explanation: 'Ensures required material channels (BaseColor, Normal, ORM) are connected.', fixHint: 'Bake missing Normal or ORM maps using pipeline stage 05.' },
  { id: 'texture_naming', group: 'Textures & materials', title: 'Texture naming', explanation: 'Checks texture filenames conform to studio T_<Asset>_<Slot> convention.', fixHint: 'Rename texture maps to adhere to standard T_* naming.' },
  { id: 'texture_size', group: 'Textures & materials', title: 'Texture size (power of two, max res)', explanation: 'Confirms texture dimensions are power-of-two (POT) and within max resolution limits.', fixHint: 'Resize textures to power-of-two resolutions (1024, 2048, or 4096).' },
  { id: 'material_count', group: 'Textures & materials', title: 'Material count', explanation: 'Verifies material slot count does not exceed budget to minimize draw calls.', fixHint: 'Consolidate multiple materials into a single atlas/PBR material.' },
  { id: 'uv_layout', group: 'UVs', title: 'UV0 present & in range', explanation: 'Validates primary UV coordinates exist in channel 0 within [0, 1] range.', fixHint: 'Unwrap mesh UVs or run pipeline stage 03 UV unwrap.' },
  { id: 'texel_density', group: 'UVs', title: 'Texel density', explanation: 'Measures UV texel density across mesh against studio target density.', fixHint: 'Scale UV islands or adjust texture resolution to meet target px/cm.' },
  { id: 'manifest', group: 'Pipeline manifest', title: 'Pipeline manifest cross-check', explanation: 'Cross-checks pipeline output files against manifest.json schema and LOD specifications.', fixHint: 'Re-run pipeline to produce complete export manifest.' },
];

