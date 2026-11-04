// Visual check of the demo downsizing: render LOD0 with (a) the ORIGINAL run GLB + its embedded PNG maps and
// (b) the STRIPPED GLB from dist + the WebP display copies, through the app's own viewer code path
// (SideViewer.setTexturedMesh), same camera, lights, material and resolution. Also renders (r) the original GLB with
// three's GLTFLoader material as a convention reference and (n) LOD0 without maps, to prove the maps are applied.
// Saves frames to screenshots/demo_downsize_*.png; metrics are computed by tools/compare_frames.py.
// Usage: (static server on dist at :5190) node tools/render_compare.mjs <run_dir> [url]
import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright-core'; import { fileURLToPath } from 'node:url';
const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const OUT = path.join(UI, 'screenshots');
const RUN = path.resolve(process.argv[2]); const URL_ = process.argv[3] || 'http://127.0.0.1:5190/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 }); const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location()?.url || '')) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL_ + 'demo-data/display/'); // same-origin page (directory listing); replaced below
await page.setContent(`<html><head><script type="importmap">{ "imports": { "three": "${URL_}vendor/three/build/three.module.js", "three/addons/": "${URL_}vendor/three/examples/jsm/" } }</script></head><body style="margin:0;background:#f6efe2"></body></html>`);
const res = await page.evaluate(async ({ base, origB64 }) => {
  const THREE = await import('three'); const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); const { SideViewer } = await import(base + 'viewer.js');
  const bin = Uint8Array.from(atob(origB64), (c) => c.charCodeAt(0));
  const parse = (buf) => new Promise((ok, no) => new GLTFLoader().parse(buf, '', ok, no));
  const orig = await parse(bin.buffer); const stripped = await parse(await (await fetch(base + 'demo-data/export/SM_HelenKellerBust_LOD0.glb')).arrayBuffer());
  const tl = (rel) => new THREE.TextureLoader().loadAsync(base + 'demo-data/' + rel).then((t) => { t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; });
  const webp = { normal: await tl('display/T_HelenKellerBust_N.webp'), orm: await tl('display/T_HelenKellerBust_ORM.webp') };
  const parts = (scene) => { const g = []; let mat = null; scene.updateMatrixWorld(true); scene.traverse((o) => { if (o.isMesh) { g.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); mat ||= o.material; } }); return { g, mat }; };
  const po = parts(orig.scene), ps = parts(stripped.scene);
  const box = new THREE.Box3(); po.g.forEach((g) => { g.computeBoundingBox(); box.union(g.boundingBox); });
  const c = box.getCenter(new THREE.Vector3()); const r = box.getSize(new THREE.Vector3()).length() / 2; const display = { center: [c.x, c.y, c.z], upZ: false };
  const baseColor = po.mat.color.clone();
  const frames = {};
  const shoot = async (key, setup) => {
    const div = document.createElement('div'); div.style.cssText = 'width:900px;height:900px;position:absolute;left:0;top:0'; document.body.appendChild(div);
    const v = new SideViewer(div); v.renderer.setPixelRatio(1); v.renderer.setSize(900, 900, false); v.camera.aspect = 1; v.camera.updateProjectionMatrix();
    setup(v); v.frame(r); v.camera.position.set(-r * 0.9, r * 0.35, r * 2.2); v.controls.target.set(0, r * 0.25, 0); v.controls.update();
    for (let i = 0; i < 3; i++) { v.render(); await new Promise((q) => requestAnimationFrame(q)); }
    frames[key] = v.renderer.domElement.toDataURL('image/png'); v.renderer.dispose(); div.remove();
  };
  const force = (v) => { if (v.texturedMaterial) { v.texturedMaterial.color.copy(baseColor); v.texturedMaterial.needsUpdate = true; } };
  await shoot('a_original_png_glb', (v) => { v.setTexturedMesh(po.g, { normal: po.mat.normalMap, orm: po.mat.aoMap, doubleSided: po.mat.side === THREE.DoubleSide }, display); force(v); });
  await shoot('b_webp_stripped_glb', (v) => { v.setTexturedMesh(ps.g, { ...webp, doubleSided: true }, display); force(v); });
  await shoot('r_gltfloader_reference', (v) => { const s = orig.scene.clone(); const h = new THREE.Group(); h.add(s); h.position.set(-c.x, -c.y, -c.z); v.root.add(h); v.holder = h; });
  await shoot('x_green_flipped_control', (v) => { v.setTexturedMesh(ps.g, { ...webp, doubleSided: true }, display); force(v); v.texturedMaterial.normalScale.y = -1; }); // deliberately wrong convention, as a control
  await shoot('n_no_maps', (v) => { v.setTexturedMesh(po.g, { normal: null, orm: null, doubleSided: true }, display); force(v); });
  await shoot('app_clay_webp', (v) => { v.setTexturedMesh(ps.g, { ...webp, doubleSided: true }, display); });
  return { frames, tangents: po.g.every((g) => !!g.attributes.tangent), strippedHasImages: !!ps.mat.normalMap, refNormalScale: po.mat.normalScale.toArray(), uvSame: po.g[0].attributes.uv.array.length === ps.g[0].attributes.uv.array.length && po.g[0].attributes.uv.array.every((x, i) => x === ps.g[0].attributes.uv.array[i]), posSame: po.g[0].attributes.position.array.every((x, i) => x === ps.g[0].attributes.position.array[i]) };
}, { base: URL_, origB64: fs.readFileSync(path.join(RUN, 'export', 'SM_HelenKellerBust_LOD0.glb')).toString('base64') });
for (const [k, d] of Object.entries(res.frames)) { const p = path.join(OUT, `demo_downsize_LOD0_${k}.png`); fs.writeFileSync(p, Buffer.from(d.split(',')[1], 'base64')); console.log('frame', p); }
delete res.frames; console.log(JSON.stringify(res)); console.log('errors', JSON.stringify(errors)); await b.close(); if (errors.length) process.exit(1);
