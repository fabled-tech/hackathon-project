// Geometry operations on plain typed arrays: weld, triangle count, topology/orientation analysis,
// vertex-clustering decimation (the browser preview), texel density. All numbers shown in the UI
// come from these functions run on the loaded data.

export const triCount = (indices) => Math.floor(indices.length / 3);

// Weld vertices by quantized position. Triangle order is preserved (triangle i stays triangle i).
export function weld(positions, indices) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const q = 1 / (diag * 1e-6);
  const map = new Map(); const remap = new Uint32Array(positions.length / 3); const out = [];
  for (let i = 0, n = positions.length / 3; i < n; i++) {
    const key = `${Math.round(positions[3 * i] * q)},${Math.round(positions[3 * i + 1] * q)},${Math.round(positions[3 * i + 2] * q)}`;
    let id = map.get(key);
    if (id === undefined) { id = out.length / 3; map.set(key, id); out.push(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]); }
    remap[i] = id;
  }
  const idx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) idx[i] = remap[indices[i]];
  return { positions: new Float32Array(out), indices: idx,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], size: [maxX - minX, maxY - minY, maxZ - minZ] } };
}

// Edge topology + orientation analysis on a welded mesh, using the SAME definition as
// fabled_validator (validator/fabled_validator/geometry.py analyze() + checks.py check_normals):
//  - weld: positions quantized to bbox-diagonal x 1e-6 (same tolerance as the validator)
//  - duplicate-index triangles are skipped; zero-area = area <= (diag x 1e-7)^2, never flagged
//  - edges are matched on welded vertex ids; only edges shared by exactly 2 triangles propagate
//  - "winding flipped": BFS orientation per connected part; closed parts are oriented outward by
//    signed volume, open parts by a vote of the stored vertex normals (majority if none)
//  - "stored normal against face": sum of the 3 stored corner normals . geometric normal < 0
//  - "flagged" = winding flipped OR stored normal against face  (what the validator counts)
// raw = { positions, indices, normals } of the unwelded file data (same triangle order); optional.
export function analyzeTopology(positions, indices, raw = null) {
  const nT = triCount(indices); const nV = positions.length / 3;
  const P = raw?.positions || positions, RI = raw?.indices || indices, I = indices; const N = raw?.normals || null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z; if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z; }
  const diag = Math.max(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ), 1e-9);
  const areaEps = (diag * 1e-7) ** 2;
  const dupMask = new Uint8Array(nT), zeroMask = new Uint8Array(nT), against = new Uint8Array(nT); const sv = new Float64Array(nT);
  let dup = 0, zero = 0, nAgainst = 0;
  for (let t = 0; t < nT; t++) {
    const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
    if (a === b || b === c || a === c) { dup++; dupMask[t] = 1; continue; }
    const ra = RI[3 * t], rb = RI[3 * t + 1], rc = RI[3 * t + 2];
    const ux = P[3 * rb] - P[3 * ra], uy = P[3 * rb + 1] - P[3 * ra + 1], uz = P[3 * rb + 2] - P[3 * ra + 2];
    const vx = P[3 * rc] - P[3 * ra], vy = P[3 * rc + 1] - P[3 * ra + 1], vz = P[3 * rc + 2] - P[3 * ra + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (area <= areaEps) { zero++; zeroMask[t] = 1; }
    sv[t] = (P[3 * ra] * (P[3 * rb + 1] * P[3 * rc + 2] - P[3 * rb + 2] * P[3 * rc + 1])
           - P[3 * ra + 1] * (P[3 * rb] * P[3 * rc + 2] - P[3 * rb + 2] * P[3 * rc])
           + P[3 * ra + 2] * (P[3 * rb] * P[3 * rc + 1] - P[3 * rb + 1] * P[3 * rc])) / 6;
    if (N && !zeroMask[t]) {
      const nx = N[3 * ra] + N[3 * rb] + N[3 * rc], ny = N[3 * ra + 1] + N[3 * rb + 1] + N[3 * rc + 1], nz = N[3 * ra + 2] + N[3 * rb + 2] + N[3 * rc + 2];
      if (Math.hypot(nx, ny, nz) > 1e-12 && nx * cx + ny * cy + nz * cz < 0) { against[t] = 1; nAgainst++; }
    }
  }
  // edges on welded ids
  const edgeId = new Map(); const eTriA = [], eDirA = [], eTriB = [], eDirB = [], eCount = [], eTris = [];
  for (let t = 0; t < nT; t++) {
    if (dupMask[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = I[3 * t + k], b = I[3 * t + ((k + 1) % 3)];
      const lo = a < b ? a : b, hi = a < b ? b : a; const dir = a < b ? 1 : -1; const key = lo * nV + hi;
      let e = edgeId.get(key);
      if (e === undefined) { e = eCount.length; edgeId.set(key, e); eCount.push(1); eTriA.push(t); eDirA.push(dir); eTriB.push(-1); eDirB.push(0); eTris.push(null); }
      else { eCount[e]++; if (eCount[e] === 2) { eTriB[e] = t; eDirB[e] = dir; } else (eTris[e] ||= [eTriA[e], eTriB[e]]).push(t); }
    }
  }
  let boundary = 0, nonManifold = 0, inconsistent = 0; const openFace = new Uint8Array(nT);
  const adjStart = new Int32Array(nT + 1); const nE = eCount.length;
  for (let e = 0; e < nE; e++) {
    if (eCount[e] === 1) { boundary++; openFace[eTriA[e]] = 1; }
    else if (eCount[e] > 2) { nonManifold++; for (const t of eTris[e]) openFace[t] = 1; }
    else { adjStart[eTriA[e] + 1]++; adjStart[eTriB[e] + 1]++; if (eDirA[e] === eDirB[e]) inconsistent++; }
  }
  for (let t = 0; t < nT; t++) adjStart[t + 1] += adjStart[t];
  const adjTri = new Int32Array(adjStart[nT]); const adjFlip = new Int8Array(adjStart[nT]); const fillPos = adjStart.slice(0, nT);
  for (let e = 0; e < nE; e++) if (eCount[e] === 2) {
    const flip = eDirA[e] === eDirB[e] ? 1 : 0;
    adjTri[fillPos[eTriA[e]]] = eTriB[e]; adjFlip[fillPos[eTriA[e]]++] = flip;
    adjTri[fillPos[eTriB[e]]] = eTriA[e]; adjFlip[fillPos[eTriB[e]]++] = flip;
  }
  // BFS: orient 0 = seed orientation, 1 = opposite (validator's convention)
  const orient = new Int8Array(nT).fill(-1); const queue = new Int32Array(nT);
  const flippedMask = new Uint8Array(nT); let components = 0, inverted = 0, conflicts = 0;
  for (let s = 0; s < nT; s++) {
    if (orient[s] !== -1 || dupMask[s]) continue;
    let head = 0, tail = 0; queue[tail++] = s; orient[s] = 0; const members = []; let open = false;
    while (head < tail) {
      const t = queue[head++]; members.push(t); if (openFace[t]) open = true;
      for (let j = adjStart[t]; j < adjStart[t + 1]; j++) {
        const u = adjTri[j]; const want = orient[t] ^ adjFlip[j];
        if (orient[u] === -1) { orient[u] = want; queue[tail++] = u; } else if (orient[u] !== want) conflicts++;
      }
    }
    let bad; // which orientation group is wrong
    if (!open) {
      let vol = 0; for (const t of members) vol += orient[t] === 0 ? sv[t] : -sv[t];
      bad = vol >= 0 ? 1 : 0;
      if (vol < 0 && !members.some((t) => orient[t] === 1)) inverted++;
    } else if (N) {
      let s0 = 0, s1 = 0;
      for (const t of members) { const sc = against[t] ? 1 : zeroMask[t] ? 0 : -1; if (orient[t] === 0) s0 += sc; else s1 += sc; }
      bad = s0 > s1 ? 0 : 1;
    } else {
      let g0 = 0, g1 = 0; for (const t of members) { if (orient[t] === 0) g0++; else g1++; }
      bad = g0 >= g1 ? 1 : 0;
    }
    for (const t of members) if (orient[t] === bad && !zeroMask[t]) flippedMask[t] = 1;
    components++;
  }
  const flipped = [], againstList = [], flagged = [];
  for (let t = 0; t < nT; t++) {
    if (flippedMask[t]) flipped.push(t);
    if (against[t]) againstList.push(t);
    if (flippedMask[t] || against[t]) flagged.push(t);
  }
  return { triangles: nT, vertices: nV, degenerate: dup + zero, duplicateIndex: dup, zeroArea: zero, boundaryEdges: boundary, nonManifoldEdges: nonManifold,
    inconsistentEdges: inconsistent, orientationConflicts: conflicts / 2, invertedComponents: inverted, components,
    hasStoredNormals: !!N, flippedTriangles: flipped, againstTriangles: againstList, flaggedTriangles: flagged };
}

export function flipTriangles(indices, tris) {
  for (const t of tris) { const b = indices[3 * t + 1]; indices[3 * t + 1] = indices[3 * t + 2]; indices[3 * t + 2] = b; }
}

// Vertex-clustering decimation (browser preview only; NOT Fabled's retopology).
function cluster(positions, indices, bbox, R) {
  const [mx, my, mz] = bbox.min; const longest = Math.max(...bbox.size) || 1; const cell = longest / R; const inv = 1 / cell;
  const nV = positions.length / 3; const cid = new Int32Array(nV); const map = new Map(); let n = 0;
  const Rx = Math.floor(bbox.size[0] * inv) + 2, Ry = Math.floor(bbox.size[1] * inv) + 2;
  for (let i = 0; i < nV; i++) {
    const ix = Math.floor((positions[3 * i] - mx) * inv), iy = Math.floor((positions[3 * i + 1] - my) * inv), iz = Math.floor((positions[3 * i + 2] - mz) * inv);
    const key = ix + Rx * (iy + Ry * iz);
    let c = map.get(key); if (c === undefined) { c = n++; map.set(key, c); } cid[i] = c;
  }
  return { cid, n };
}
function countTris(indices, cid) {
  let k = 0;
  for (let i = 0; i < indices.length; i += 3) { const a = cid[indices[i]], b = cid[indices[i + 1]], c = cid[indices[i + 2]]; if (a !== b && b !== c && a !== c) k++; }
  return k;
}
export function decimateToTarget(positions, indices, bbox, target) {
  const nT = triCount(indices);
  if (target >= nT) return { positions: positions.slice(), indices: indices.slice(), resolution: null, copied: true };
  let lo = 2, hi = 4096, best = null;
  while (lo <= hi) {
    const R = (lo + hi) >> 1; const c = cluster(positions, indices, bbox, R); const k = countTris(indices, c.cid);
    if (k <= target) { best = { R, c }; lo = R + 1; } else hi = R - 1;
  }
  if (!best) best = { R: 2, c: cluster(positions, indices, bbox, 2) };
  const { cid, n } = best.c; const sum = new Float64Array(n * 3); const cnt = new Uint32Array(n);
  for (let i = 0; i < positions.length / 3; i++) { const c = cid[i]; sum[3 * c] += positions[3 * i]; sum[3 * c + 1] += positions[3 * i + 1]; sum[3 * c + 2] += positions[3 * i + 2]; cnt[c]++; }
  const outP = new Float32Array(n * 3); for (let c = 0; c < n; c++) for (let k = 0; k < 3; k++) outP[3 * c + k] = sum[3 * c + k] / cnt[c];
  const seen = new Set(); const outI = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = cid[indices[i]], b = cid[indices[i + 1]], c = cid[indices[i + 2]];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((x, y) => x - y); const key = `${s[0]},${s[1]},${s[2]}`;
    if (seen.has(key)) continue; seen.add(key); outI.push(a, b, c);
  }
  return { positions: outP, indices: new Uint32Array(outI), resolution: best.R, copied: false };
}

export function surfaceArea(positions, indices) {
  let A = 0; const P = positions;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
    const vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
    A += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return A;
}
export function uvArea(uvs, indices) {
  let A = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    A += 0.5 * Math.abs((uvs[2 * b] - uvs[2 * a]) * (uvs[2 * c + 1] - uvs[2 * a + 1]) - (uvs[2 * c] - uvs[2 * a]) * (uvs[2 * b + 1] - uvs[2 * a + 1]));
  }
  return A;
}
