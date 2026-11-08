// Fabled Forge: game pitch → asset kit (task board with import profiles) → level layout → Unreal blockout plan.
//
// Rule-based and offline. A pitch is free text; it may also contain structured lines:
//   Genre: ..., Camera: ..., Style: ..., Engine: ..., Assets: a, b, c   Characters: ...   Props: ...   Environment: ...
// Anything not stated is inferred from keywords. Budgets come from the category defaults below, which mirror the
// placeholder validator profiles in ../validator/profiles (DEMO PLACEHOLDER VALUES, not studio data).

export const KIT_SCHEMA = 'fabled.kit/0.1';
export const LAYOUT_SCHEMA = 'fabled.layout/0.1';

export const CATEGORY_DEFAULTS = {
  character: { profile: 'demo_placeholder', up_axis: 'Z', height_cm: [150, 220], lods: [60000, 30000, 15000, 5000], texel_density: 10.24, textures: 4096, rig: 'required', footprint_cm: [60, 60] },
  creature: { profile: 'demo_placeholder_mochi_character', up_axis: 'Z', height_cm: [20, 45], lods: [30000, 15000, 7000, 2500], texel_density: 10.24, textures: 2048, rig: 'required', footprint_cm: [40, 60] },
  prop: { profile: 'demo_placeholder_prop', up_axis: 'Z', height_cm: [20, 80], lods: [20000, 10000, 5000, 2000], texel_density: 5.12, textures: 2048, rig: 'none', footprint_cm: [60, 60] },
  environment: { profile: 'demo_placeholder_prop', up_axis: 'Z', height_cm: [200, 800], lods: [40000, 20000, 10000, 4000], texel_density: 2.56, textures: 2048, rig: 'none', footprint_cm: [400, 400] },
  vehicle: { profile: 'demo_placeholder_prop', up_axis: 'Z', height_cm: [120, 300], lods: [80000, 40000, 20000, 8000], texel_density: 5.12, textures: 4096, rig: 'optional', footprint_cm: [200, 450] },
};

const GENRE_RULES = [
  [/\b(souls|dark fantasy|dungeon|rpg|role.?playing)\b/i, 'Action RPG'],
  [/\b(platformer|jump|run and gun)\b/i, 'Platformer'],
  [/\b(shooter|fps|gunfight)\b/i, 'Shooter'],
  [/\b(cozy|farm|garden|life sim|shopkeep)\b/i, 'Cozy sim'],
  [/\b(horror|haunt|survival)\b/i, 'Survival horror'],
  [/\b(puzzle)\b/i, 'Puzzle'],
  [/\b(racing|kart|drive)\b/i, 'Racing'],
  [/\b(strategy|tactics|city.?builder)\b/i, 'Strategy'],
];
const CAMERA_RULES = [[/\b(third.?person|over the shoulder)\b/i, 'Third person'], [/\b(first.?person|fps)\b/i, 'First person'], [/\b(top.?down|isometric)\b/i, 'Top-down / isometric'], [/\b(side.?scroll|2\.5d)\b/i, 'Side-scrolling 2.5D']];
const STYLE_RULES = [[/\b(stylized|hand.?painted|cel|toon|cartoon)\b/i, 'Stylized / hand-painted'], [/\b(realistic|photoreal|pbr)\b/i, 'Realistic PBR'], [/\b(low.?poly|flat.?shaded)\b/i, 'Low-poly flat-shaded'], [/\b(pixel|retro|ps1)\b/i, 'Retro / PS1-style']];

// Noun lexicon: category + default size. Add words here, not special cases elsewhere.
const LEXICON = [
  ['knight', 'character'], ['hero', 'character'], ['player character', 'character'], ['villager', 'character'], ['merchant', 'character'], ['guard', 'character'], ['wizard', 'character'], ['witch', 'character'], ['robot', 'character'], ['soldier', 'character'], ['boss', 'character'], ['farmer', 'character'],
  ['cat', 'creature'], ['dog', 'creature'], ['fox', 'creature'], ['dragon', 'creature'], ['slime', 'creature'], ['wolf', 'creature'], ['spider', 'creature'], ['bird', 'creature'], ['rabbit', 'creature'], ['mushroom creature', 'creature'],
  ['sword', 'prop'], ['shield', 'prop'], ['helmet', 'prop'], ['potion', 'prop'], ['flask', 'prop'], ['chest', 'prop'], ['lantern', 'prop'], ['torch', 'prop'], ['barrel', 'prop'], ['crate', 'prop'], ['key', 'prop'], ['book', 'prop'], ['scroll', 'prop'], ['coin', 'prop'], ['bow', 'prop'], ['axe', 'prop'], ['staff', 'prop'], ['crystal', 'prop'], ['campfire', 'prop'], ['bench', 'prop'], ['table', 'prop'], ['chair', 'prop'], ['sign', 'prop'], ['well', 'prop'], ['cart', 'prop'], ['anvil', 'prop'], ['cauldron', 'prop'],
  ['cottage', 'environment'], ['house', 'environment'], ['tower', 'environment'], ['castle', 'environment'], ['bridge', 'environment'], ['gate', 'environment'], ['wall', 'environment'], ['tree', 'environment'], ['rock', 'environment'], ['ruin', 'environment'], ['shrine', 'environment'], ['tavern', 'environment'], ['windmill', 'environment'], ['dock', 'environment'], ['fence', 'environment'], ['cliff', 'environment'], ['cave entrance', 'environment'], ['hut', 'environment'], ['market stall', 'environment'],
  ['car', 'vehicle'], ['truck', 'vehicle'], ['boat', 'vehicle'], ['airship', 'vehicle'], ['bike', 'vehicle'], ['wagon', 'vehicle'], ['kart', 'vehicle'],
];

const field = (text, name) => { const m = text.match(new RegExp(`^\\s*(?:${name})\\s*:\\s*(.+)$`, 'im')); return m ? m[1].trim() : null; };
const listField = (text, name) => { const v = field(text, name); return v ? v.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : []; };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const pascal = (s) => s.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
const pick = (rules, text, fallback) => (rules.find(([re]) => re.test(text)) || [null, fallback])[1];

export function categorize(name) {
  const n = name.toLowerCase();
  const hit = LEXICON.find(([w]) => n.includes(w));
  if (hit) return hit[1];
  if (/\b(npc|character|enemy|hero)\b/.test(n)) return 'character';
  if (/\b(building|structure|terrain|module|piece)\b/.test(n)) return 'environment';
  return 'prop';
}

export function buildKit(pitch, { title = null } = {}) {
  const text = String(pitch || '');
  const explicit = { character: listField(text, 'Characters?'), prop: listField(text, 'Props?'), environment: listField(text, 'Environment|Environments|Set pieces?'), vehicle: listField(text, 'Vehicles?'), any: listField(text, 'Assets?') };
  const found = new Map();
  const add = (name, category, source) => { const k = slug(name); if (!k || found.has(k)) return; found.set(k, { name, category, source }); };
  for (const [cat, names] of Object.entries(explicit)) for (const n of names) add(n, cat === 'any' ? categorize(n) : cat, 'pitch (explicit)');
  const prose = text.replace(/^\s*[A-Za-z ]+:\s*.+$/gm, ' ');
  // Inferred nouns are skipped when an explicit asset already names them ("cottage" vs "mushroom cottage").
  for (const [word, cat] of LEXICON) {
    if (!new RegExp(`\\b${word}s?\\b`, 'i').test(prose)) continue;
    if ([...found.values()].some((a) => a.name.toLowerCase().includes(word))) continue;
    add(word, cat, 'pitch (inferred)');
  }
  const genre = field(text, 'Genre') || pick(GENRE_RULES, text, 'Adventure');
  const camera = field(text, 'Camera') || pick(CAMERA_RULES, text, 'Third person');
  const style = field(text, 'Style|Art style') || pick(STYLE_RULES, text, 'Stylized / hand-painted');
  const engine = field(text, 'Engine') || 'Unreal Engine 5';
  const titleOut = title || field(text, 'Title') || (text.split('\n').find((l) => l.trim()) || 'Untitled game').trim().slice(0, 60);
  const assets = [...found.values()].map((a, i) => {
    const d = CATEGORY_DEFAULTS[a.category];
    return {
      id: `A${String(i + 1).padStart(3, '0')}`, name: a.name, asset_name: `SM_${pascal(a.name)}`, category: a.category, source: a.source,
      status: 'requested', assignee: a.category === 'character' || a.category === 'creature' ? 'character artist' : 'vendor',
      import_profile: d.profile, budget: { lods_triangles: d.lods, height_cm: d.height_cm, texel_density_px_per_cm: d.texel_density, texture_px: d.textures, up_axis: d.up_axis, rig: d.rig },
      footprint_cm: d.footprint_cm, generation: null, validator: null, comments: [],
    };
  });
  const order = { character: 0, creature: 1, vehicle: 2, environment: 3, prop: 4 };
  assets.sort((a, b) => order[a.category] - order[b.category] || a.name.localeCompare(b.name));
  assets.forEach((a, i) => { a.id = `A${String(i + 1).padStart(3, '0')}`; });
  return {
    schema: KIT_SCHEMA, title: titleOut, created_at: new Date().toISOString(), method: 'rule-based (no LLM)', genre, camera, style, engine,
    budget_note: 'DEMO PLACEHOLDER VALUES: budgets come from the placeholder validator profiles, not from a studio.',
    assets, summary: summarize(assets),
  };
}

export function summarize(assets) {
  const by = {}; for (const a of assets) by[a.category] = (by[a.category] || 0) + 1;
  const status = {}; for (const a of assets) status[a.status] = (status[a.status] || 0) + 1;
  return { total: assets.length, by_category: by, by_status: status, lod0_triangles_total: assets.reduce((n, a) => n + a.budget.lods_triangles[0], 0) };
}

export const STATUS_FLOW = ['requested', 'generating', 'generated', 'in_pipeline', 'validated', 'imported'];
export function nextStatus(s) { const i = STATUS_FLOW.indexOf(s); return i < 0 || i === STATUS_FLOW.length - 1 ? s : STATUS_FLOW[i + 1]; }

// Starter layout: a 40 m × 40 m blockout with environment pieces on a ring and props clustered near the spawn.
export function starterLayout(kit, { size_cm = 4000 } = {}) {
  const items = [];
  const env = kit.assets.filter((a) => a.category === 'environment');
  const props = kit.assets.filter((a) => a.category === 'prop' || a.category === 'vehicle');
  const chars = kit.assets.filter((a) => a.category === 'character' || a.category === 'creature');
  env.forEach((a, i) => { const t = (i / Math.max(1, env.length)) * Math.PI * 2; items.push(place(a, Math.cos(t) * size_cm * 0.35, Math.sin(t) * size_cm * 0.35, Math.round((-t * 180) / Math.PI))); });
  props.forEach((a, i) => items.push(place(a, -600 + (i % 4) * 300, -600 + Math.floor(i / 4) * 300, 0)));
  chars.forEach((a, i) => items.push(place(a, 200 * i, 0, 180)));
  return { schema: LAYOUT_SCHEMA, title: kit.title, size_cm, grid_cm: 100, spawn: { x: 0, y: -1200, z: 0, yaw: 90 }, items, updated_at: new Date().toISOString() };
}
export function place(asset, x, y, yaw = 0, scale = 1) {
  return { id: `${asset.id}-${Math.random().toString(36).slice(2, 6)}`, asset_id: asset.id, asset_name: asset.asset_name, category: asset.category, x: Math.round(x), y: Math.round(y), z: 0, yaw, scale, footprint_cm: asset.footprint_cm };
}

// Blockout plan for Unreal: one actor per layout item, with the mesh path the Fabled importer uses
// (/Game/Fabled/<AssetName>/<AssetName>) and a fallback placeholder box sized from the budget so the level
// reads before any real asset exists.
export function blockoutPlan(kit, layout) {
  const byId = new Map(kit.assets.map((a) => [a.id, a]));
  return {
    schema: 'fabled.blockout_plan/0.1', title: kit.title, created_at: new Date().toISOString(), spawn: layout.spawn, grid_cm: layout.grid_cm,
    actors: layout.items.map((it) => {
      const a = byId.get(it.asset_id);
      const h = a ? (a.budget.height_cm[0] + a.budget.height_cm[1]) / 2 : 100;
      return { label: `${it.asset_name}_${it.id.slice(-4)}`, mesh_path: `/Game/Fabled/${it.asset_name}/${it.asset_name}`, imported: a?.status === 'imported', location: { x: it.x, y: it.y, z: it.z }, rotation: { pitch: 0, yaw: it.yaw, roll: 0 }, scale: it.scale, placeholder_box_cm: { x: it.footprint_cm[0], y: it.footprint_cm[1], z: Math.round(h) }, category: it.category };
    }),
  };
}
