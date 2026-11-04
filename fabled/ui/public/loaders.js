// In-browser sculpt loading with three.js loaders. Returns { object, meta }.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

export const SUPPORTED = ['obj', 'fbx', 'glb', 'gltf', 'ply', 'stl'];

export async function loadModel(name, arrayBuffer) {
  const ext = name.split('.').pop().toLowerCase();
  if (!SUPPORTED.includes(ext)) throw new Error(`Unsupported format .${ext} (supported: ${SUPPORTED.join(', ')})`);
  let object;
  if (ext === 'obj') {
    object = new OBJLoader().parse(new TextDecoder().decode(arrayBuffer));
  } else if (ext === 'fbx') {
    object = new FBXLoader().parse(arrayBuffer, '');
  } else if (ext === 'glb' || ext === 'gltf') {
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(arrayBuffer, '', res, rej));
    object = gltf.scene;
  } else if (ext === 'ply' || ext === 'stl') {
    const geom = (ext === 'ply' ? new PLYLoader() : new STLLoader()).parse(arrayBuffer);
    object = new THREE.Mesh(geom, new THREE.MeshStandardMaterial());
    object.name = name.replace(/\.[^.]+$/, '');
  }
  object.updateMatrixWorld(true);
  return { object, format: ext };
}

// Flatten every mesh in the loaded object into one indexed geometry (world transforms applied),
// plus facts about the file that the checks need (all read from the file, nothing assumed).
export function flatten(object) {
  const positions = []; const indices = []; const uvs = []; let allUV = true; let base = 0;
  const normals = []; let allN = true; const nm = new THREE.Matrix3(); const nv = new THREE.Vector3();
  const meshNames = []; let skinned = 0; let bones = 0; const uvMeshes = []; const textureSlots = new Set(); let materialCount = 0;
  const v = new THREE.Vector3();
  object.traverse((o) => {
    if (o.isBone) bones++;
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    if (o.isSkinnedMesh) skinned++;
    meshNames.push(o.name || '(unnamed mesh)');
    const g = o.geometry; const pos = g.attributes.position;
    if (g.attributes.uv) { uvMeshes.push(o.name || '(unnamed mesh)'); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uvs.push(uv.getX(i), uv.getY(i)); } else allUV = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { if (!m) continue; materialCount++; for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) textureSlots.add(k); }
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); positions.push(v.x, v.y, v.z); }
    // Stored vertex normals as written in the file (not recomputed). Loaders that synthesize normals
    // (OBJ without vn, PLY/STL without normals) leave the attribute absent, so nothing is invented here.
    if (g.attributes.normal && !g.userData.__computedNormals) { nm.getNormalMatrix(o.matrixWorld); const na = g.attributes.normal;
      for (let i = 0; i < na.count; i++) { nv.fromBufferAttribute(na, i).applyMatrix3(nm); normals.push(nv.x, nv.y, nv.z); } } else allN = false;
    if (g.index) { const idx = g.index.array; for (let i = 0; i < idx.length; i++) indices.push(idx[i] + base); }
    else for (let i = 0; i < pos.count; i++) indices.push(base + i);
    base += pos.count;
  });
  if (!base) throw new Error('No mesh geometry found in file');
  const neg = countMirrored(object);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), uvs: allUV ? new Float32Array(uvs) : null, normals: allN && normals.length ? new Float32Array(normals) : null, meshNames, skinnedMeshes: skinned, bones,
    uvMeshes, textureSlots: [...textureSlots], materialCount, mirroredTransforms: neg };
}

function countMirrored(object) {
  let n = 0; object.traverse((o) => { if (o.isMesh && o.matrixWorld.determinant() < 0) n++; }); return n;
}
