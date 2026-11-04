// Measures the UI's own normals/winding analysis (public/loaders.js + public/meshops.js, run in headless Chrome
// exactly as the app runs it) on a file, per mesh, and prints counts + flagged triangle indices as JSON.
// Compare with:  (cd ../validator && .venv/bin/python ../ui/tools/validator_analyze_readonly.py <file>)
// Usage: node tools/compare_normals.mjs <file> [server-url]   (needs the UI server running; only loads the page)
import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
const file = path.resolve(process.argv[2]); const URL_ = process.argv[3] || 'http://127.0.0.1:5178/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.goto(URL_, { waitUntil: 'networkidle' });
const res = await p.evaluate(async ({ name, b64 }) => {
  const THREE = await import('three'); const L = await import('/loaders.js'); const M = await import('/meshops.js');
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const { object } = await L.loadModel(name, bin.buffer);
  // group meshes by the nearest ancestor (or self) whose name ends in LODn (glTF splits primitives into child meshes)
  const groups = new Map();
  object.traverse((o) => {
    if (!o.isMesh) return; let a = o; while (a && !/LOD\d+$/i.test(a.name || '')) a = a.parent; const key = a ? a.name : (o.name || 'mesh');
    if (!groups.has(key)) groups.set(key, new THREE.Group()); const c = o.clone(); c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); groups.get(key).add(c);
  });
  const out = [];
  for (const [mesh, g] of groups) {
    g.updateMatrixWorld(true); const flat = L.flatten(g); const w = M.weld(flat.positions, flat.indices); const t = M.analyzeTopology(w.positions, w.indices, flat);
    out.push({ mesh, triangles: t.triangles, flagged: t.flaggedTriangles.length, winding: t.flippedTriangles.length, against: t.againstTriangles.length, stored_normals: t.hasStoredNormals,
      inconsistent_edges: t.inconsistentEdges, boundary_edges: t.boundaryEdges, components: t.components,
      flagged_idx: t.flaggedTriangles.slice(0, 50), against_idx: t.againstTriangles.slice(0, 50), winding_idx: t.flippedTriangles.slice(0, 50) });
  }
  return out.sort((x, y) => x.mesh.localeCompare(y.mesh));
}, { name: path.basename(file), b64: fs.readFileSync(file).toString('base64') });
console.log(JSON.stringify(res)); await b.close();
