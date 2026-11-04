// Side-by-side three.js viewers with synced orbit cameras.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CLAY = 0xc8d0e0; const WIRE = 0xa78bfa; const FLIP = 0xf43f5e;

function createMatcapTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(92, 76, 6, 128, 128, 122);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.22, '#d6e0f0');
  grad.addColorStop(0.52, '#7a8ba3');
  grad.addColorStop(0.85, '#3c485c');
  grad.addColorStop(1, '#1b232e');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SideViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    this.camera.position.set(0, 0, 4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.scene.add(new THREE.HemisphereLight(0xe2e8f0, 0x1e1b4b, 1.15));
    const key = new THREE.DirectionalLight(0xf8fafc, 2.1); key.position.set(3, 4, 5); this.camera.add(key);
    this.rimLight = new THREE.DirectionalLight(0xa78bfa, 1.15); this.rimLight.position.set(-4, 1.5, -3); this.camera.add(this.rimLight);
    this.fillLight = new THREE.DirectionalLight(0x38bdf8, 0.45); this.fillLight.position.set(0, -3, 2); this.camera.add(this.fillLight);
    this.scene.add(this.camera);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.clayMat = new THREE.MeshStandardMaterial({ color: CLAY, roughness: 0.52, metalness: 0.08, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const matcapTex = createMatcapTexture();
    this.matcapMat = matcapTex
      ? new THREE.MeshMatcapMaterial({ matcap: matcapTex, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
      : new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.15 });
    this.wireMat = new THREE.MeshBasicMaterial({ color: WIRE, wireframe: true, transparent: true, opacity: 0.45 });
    this.flipMat = new THREE.MeshBasicMaterial({ color: FLIP, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.wireframe = false;
    this.materialMode = 'pbr';
    new ResizeObserver(() => this.resize()).observe(container); this.resize();
  }
  setMaterialMode(mode) {
    this.materialMode = mode;
    this.applyMaterialMode();
  }
  applyMaterialMode() {
    const activeMat = this.materialMode === 'clay'
      ? this.clayMat
      : this.materialMode === 'matcap'
        ? this.matcapMat
        : (this.texturedMaterial || this.clayMat);
    if (this.mesh) this.mesh.material = activeMat;
    if (this.meshes) {
      for (const [m] of this.meshes) {
        m.material = activeMat;
      }
    }
  }
  setThemeColors(primaryHex, secondaryHex) {
    if (this.rimLight) this.rimLight.color.setHex(primaryHex);
    if (this.fillLight) this.fillLight.color.setHex(secondaryHex);
    if (this.wireMat) this.wireMat.color.setHex(primaryHex);
  }
  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  // positions/indices: welded arrays. display: { center:[x,y,z], upZ:bool }
  setMesh(positions, indices, display) {
    this.clear();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, this.clayMat);
    this.wire = new THREE.Mesh(g, this.wireMat); this.wire.visible = this.wireframe;
    const holder = new THREE.Group(); holder.add(this.mesh, this.wire);
    holder.position.set(-display.center[0], -display.center[1], -display.center[2]);
    this.root.rotation.set(display.upZ ? -Math.PI / 2 : 0, 0, 0);
    this.root.add(holder); this.holder = holder;
    this.applyMaterialMode();
  }
  // Pipeline LOD with UVs: render the file's own geometry (positions, stored normals, UVs, tangents) with the baked
  // maps, glTF conventions: normal map OpenGL (+Y) in tangent space, ORM = R occlusion / G roughness / B metalness,
  // textures not flipped (flipY=false), linear colour space. geoms: BufferGeometries already in world space.
  setTexturedMesh(geoms, maps, display) {
    this.clear();
    const hasTangents = geoms.every((g) => g.attributes.tangent);
    const mat = new THREE.MeshStandardMaterial({ color: CLAY, roughness: maps.orm ? 1 : 0.65, metalness: maps.orm ? 1 : 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      normalMap: maps.normal || null, aoMap: maps.orm || null, roughnessMap: maps.orm || null, metalnessMap: maps.orm || null, side: maps.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    if (maps.normal && !hasTangents) mat.normalScale.y = -1; // same rule as GLTFLoader for derivative tangents
    const holder = new THREE.Group(); this.meshes = [];
    for (const g of geoms) { const m = new THREE.Mesh(g, mat); const w = new THREE.Mesh(g, this.wireMat); w.visible = this.wireframe; holder.add(m, w); this.meshes.push([m, w]); }
    this.mesh = this.meshes[0][0]; this.wire = { set visible(v) { holder.children.filter((c) => c.material?.wireframe).forEach((c) => { c.visible = v; }); } };
    this.texturedMaterial = mat; this.geometry = null;
    holder.position.set(-display.center[0], -display.center[1], -display.center[2]);
    this.root.rotation.set(display.upZ ? -Math.PI / 2 : 0, 0, 0);
    this.root.add(holder); this.holder = holder;
    this.applyMaterialMode();
  }
  setFlipped(positions, indices, tris, visible) {
    if (this.flipMesh) { this.holder?.remove(this.flipMesh); this.flipMesh.geometry.dispose(); this.flipMesh = null; }
    if (!tris?.length || !this.holder) return;
    const idx = new Uint32Array(tris.length * 3);
    tris.forEach((t, i) => { idx[3 * i] = indices[3 * t]; idx[3 * i + 1] = indices[3 * t + 1]; idx[3 * i + 2] = indices[3 * t + 2]; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.flipMesh = new THREE.Mesh(g, this.flipMat); this.flipMesh.visible = visible; this.holder.add(this.flipMesh);
  }
  setFlippedVisible(v) { if (this.flipMesh) this.flipMesh.visible = v; }
  setWireframe(on) { this.wireframe = on; if (this.wire) this.wire.visible = on; }
  clear() {
    if (this.holder) { this.root.remove(this.holder); this.geometry?.dispose(); this.flipMesh?.geometry.dispose(); this.texturedMaterial?.dispose(); this.texturedMaterial = null; }
    this.holder = this.mesh = this.wire = this.flipMesh = this.geometry = null;
  }
  frame(radius, animate = false) {
    const d = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    this.camera.near = radius / 100; this.camera.far = radius * 100; this.camera.updateProjectionMatrix();
    const targetPos = new THREE.Vector3(-d * 0.5, d * 0.1, d * 0.86);
    if (!animate) {
      this.camera.position.copy(targetPos);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      return;
    }
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const endTarget = new THREE.Vector3(0, 0, 0);
    const t0 = performance.now();
    const dur = 420;
    const step = (now) => {
      const u = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - u, 3);
      this.camera.position.lerpVectors(startPos, targetPos, ease);
      this.controls.target.lerpVectors(startTarget, endTarget, ease);
      this.controls.update();
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  render() { this.renderer.render(this.scene, this.camera); }
}

export function syncControls(a, b, enabled) {
  let lock = false;
  const copy = (from, to) => () => {
    if (lock || !enabled()) return; lock = true;
    to.camera.position.copy(from.camera.position); to.camera.quaternion.copy(from.camera.quaternion);
    to.controls.target.copy(from.controls.target); to.camera.near = from.camera.near; to.camera.far = from.camera.far;
    to.camera.updateProjectionMatrix(); to.controls.update(); lock = false;
  };
  a.controls.addEventListener('change', copy(a, b)); b.controls.addEventListener('change', copy(b, a));
}
