// Remove embedded images (and the textures/samplers that use them) from a GLB, keeping geometry, UVs, normals,
// tangents and material factors byte-identical. Material texture references are removed; the original texture
// names are kept in material.extras.fabled_stripped_textures so the viewer knows which external maps belong where.
// Usage: node tools/strip_glb.mjs in.glb out.glb
import fs from 'node:fs'; import crypto from 'node:crypto';
export function stripGlbImages(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12); const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8; const binLen = buf.readUInt32LE(20 + jsonLen); const bin = buf.subarray(binStart, binStart + binLen);
  const images = json.images || []; const textures = json.textures || [];
  const drop = new Set(images.map((im) => im.bufferView).filter((v) => v != null));
  // material refs -> names
  const texName = (ti) => { const t = textures[ti]; const im = t ? images[t.source] : null; return im?.name || im?.uri || `texture_${ti}`; };
  for (const m of json.materials || []) {
    const stripped = {};
    const take = (obj, key, label) => { if (obj?.[key]) { stripped[label] = { name: texName(obj[key].index), texCoord: obj[key].texCoord ?? 0, ...(obj[key].scale != null ? { scale: obj[key].scale } : {}), ...(obj[key].strength != null ? { strength: obj[key].strength } : {}) }; delete obj[key]; } };
    take(m, 'normalTexture', 'normal'); take(m, 'occlusionTexture', 'occlusion'); take(m, 'emissiveTexture', 'emissive');
    take(m.pbrMetallicRoughness, 'baseColorTexture', 'baseColor'); take(m.pbrMetallicRoughness, 'metallicRoughnessTexture', 'metallicRoughness');
    if (Object.keys(stripped).length) m.extras = { ...(m.extras || {}), fabled_stripped_textures: stripped };
  }
  delete json.images; delete json.textures; delete json.samplers;
  // rebuild bufferViews without the image views, compacting the BIN chunk (4-byte aligned)
  const remap = new Map(); const views = []; const parts = []; let off = 0;
  json.bufferViews.forEach((v, i) => {
    if (drop.has(i)) return;
    const data = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
    remap.set(i, views.length); views.push({ ...v, byteOffset: off }); parts.push(data); off += data.length;
  });
  json.bufferViews = views;
  for (const a of json.accessors || []) if (a.bufferView != null) a.bufferView = remap.get(a.bufferView);
  const padEnd = (4 - (off % 4)) % 4; if (padEnd) parts.push(Buffer.alloc(padEnd));
  const newBin = Buffer.concat(parts); json.buffers = [{ byteLength: newBin.length }];
  json.asset = { ...json.asset, extras: { ...(json.asset?.extras || {}), fabled_note: 'Embedded images removed for the static demo; geometry unchanged. Textures are shipped as separate display copies.' } };
  let js = Buffer.from(JSON.stringify(json), 'utf8'); const jp = (4 - (js.length % 4)) % 4; if (jp) js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
  const out = Buffer.alloc(12 + 8 + js.length + 8 + newBin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4e4f534a, 16); js.copy(out, 20);
  const b0 = 20 + js.length; out.writeUInt32LE(newBin.length, b0); out.writeUInt32LE(0x004e4942, b0 + 4); newBin.copy(out, b0 + 8);
  const imageSha = images.map((im) => { const v = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')).bufferViews[im.bufferView]; return crypto.createHash('sha256').update(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)).digest('hex'); });
  return { glb: out, removedImages: images.map((im) => im.name || im.uri), imageSha, removedBytes: buf.length - out.length };
}
if (process.argv[1] && process.argv[1].endsWith('strip_glb.mjs') && process.argv[3]) {
  const r = stripGlbImages(fs.readFileSync(process.argv[2])); fs.writeFileSync(process.argv[3], r.glb);
  console.log(`${process.argv[3]}: ${r.glb.length} bytes (removed ${r.removedImages.join(', ')}, -${r.removedBytes} bytes)`);
}
