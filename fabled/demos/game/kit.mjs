// Fabled Forge: game pitch → asset kit (task board with import profiles) → level layout → Unreal blockout plan.
//
// Rule-based and offline. A pitch is free text; it may also contain structured lines:
//   Genre: ..., Camera: ..., Style: ..., Engine: ..., Assets: a, b, c   Characters: ...   Creatures: ...   Props: ...
//   Environment: ...   Vehicles: ...
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
export const CATEGORIES = Object.keys(CATEGORY_DEFAULTS);
const isCategory = (c) => typeof c === 'string' && Object.hasOwn(CATEGORY_DEFAULTS, c);
export const defaultAssignee = (category) => (category === 'character' || category === 'creature' ? 'character artist' : 'vendor');

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
// Whole-word match with a plural ending ("witches", "carts"), so "cat" does not fire on "catapult" or "car" on "carpet".
const wordRe = (word) => new RegExp(`\\b${word}(?:e?s)?\\b`, 'i');
const LEXICON_RE = LEXICON.map(([word, category]) => ({ word, category, re: wordRe(word) }));

// Structured "Label: value" lines the pitch parser understands. Only these are removed from the prose before nouns
// are inferred, so a sentence such as "Weapons: a sword and an axe" still contributes.
const FIELD_LABELS = 'Title|Genre|Camera|Style|Art style|Engine|Platforms?|Tone|Mood|Audience|Rating|References?|Inspirations?|Characters?|Creatures?|Monsters?|Props?|Environments?|Set pieces?|Vehicles?|Assets?';
const FIELD_LINE_RE = new RegExp(`^[ \\t]*(?:${FIELD_LABELS})[ \\t]*:.*$`, 'gim');

const field = (text, name) => { const m = text.match(new RegExp(`^[ \\t]*(?:${name})[ \\t]*:[ \\t]*(.+)$`, 'im')); return m ? m[1].trim() : null; };
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
// Every line with that label contributes ("Props: a, b" twice is one list).
const listField = (text, name) => [...text.matchAll(new RegExp(`^[ \\t]*(?:${name})[ \\t]*:[ \\t]*(.+)$`, 'gim'))]
  .flatMap((m) => m[1].split(/[,;]/)).map((s) => cleanName(s).replace(/[.!?]+$/, '').trim().slice(0, 80)).filter(Boolean);
const ascii = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, ''); // "épée" → "epee"
const slug = (s) => ascii(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const pascal = (s) => ascii(s).split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
const pick = (rules, text, fallback) => (rules.find(([re]) => re.test(text)) || [null, fallback])[1];

// Unreal asset name for a display name: SM_<PascalCase>. Names with no Latin letters or digits become SM_Asset.
export function assetNameFor(name) { return `SM_${pascal(name).slice(0, 60) || 'Asset'}`; }
// Content paths are case-insensitive, so uniqueness is too. `taken` is a Set of lower-cased names; it is updated.
// `next` (optional Map) remembers the last suffix tried per base so thousands of clashing names stay linear.
function uniqueAssetName(base, taken, next = new Map()) {
  const key = base.toLowerCase();
  let name = base;
  for (let n = next.get(key) || 2; taken.has(name.toLowerCase()); n++) { name = `${base}_${n}`; next.set(key, n + 1); }
  taken.add(name.toLowerCase());
  return name;
}

export function categorize(name) {
  const n = ascii(name ?? '').toLowerCase();
  const hit = LEXICON_RE.find(({ re }) => re.test(n));
  if (hit) return hit.category;
  // Compound nouns: "watchtower", "farmhouse", "longsword". Short words are skipped ("monkey" is not a key).
  const compound = LEXICON.find(([w]) => w.length >= 4 && !w.includes(' ') && new RegExp(`[a-z]${w}(?:e?s)?\\b`).test(n));
  if (compound) return compound[1];
  if (/\b(npc|character|enemy|hero)\b/.test(n)) return 'character';
  if (/\b(building|structure|terrain|module|piece)\b/.test(n)) return 'environment';
  return 'prop';
}

// The one place a category turns into an import profile, budget and footprint. Used by buildKit() and by a
// category change on an existing asset, so the two can never disagree. Arrays are copied, never shared.
export function applyCategory(asset, category) {
  if (!asset || typeof asset !== 'object') throw new Error('applyCategory: asset must be an object');
  if (!isCategory(category)) throw new Error(`Unknown category ${JSON.stringify(category)}: must be one of ${CATEGORIES.join(', ')}`);
  const d = CATEGORY_DEFAULTS[category];
  // Keep an assignee somebody chose; replace only a missing one or the previous category's default.
  const untouched = !asset.assignee || (isCategory(asset.category) && asset.assignee === defaultAssignee(asset.category));
  asset.category = category;
  if (untouched) asset.assignee = defaultAssignee(category);
  asset.import_profile = d.profile;
  asset.budget = { lods_triangles: [...d.lods], height_cm: [...d.height_cm], texel_density_px_per_cm: d.texel_density, texture_px: d.textures, up_axis: d.up_axis, rig: d.rig };
  asset.footprint_cm = [...d.footprint_cm];
  return asset;
}

// Rename an asset: display name plus a regenerated, kit-unique asset_name. Layout items that point at it follow.
export function renameAsset(kit, assetId, newName) {
  const assets = Array.isArray(kit?.assets) ? kit.assets : [];
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`renameAsset: no asset with id ${JSON.stringify(assetId)}`);
  const name = cleanName(typeof newName === 'string' || typeof newName === 'number' ? newName : '').slice(0, 80).trim();
  if (!name) throw new Error('renameAsset: name must be a non-empty string');
  const taken = new Set(assets.filter((a) => a !== asset).map((a) => String(a.asset_name).toLowerCase()));
  asset.name = name;
  asset.asset_name = uniqueAssetName(assetNameFor(name), taken);
  for (const it of Array.isArray(kit.layout?.items) ? kit.layout.items : []) if (it && it.asset_id === asset.id) it.asset_name = asset.asset_name;
  return asset;
}

export function buildKit(pitch, { title = null } = {}) {
  const text = String(pitch || '');
  const explicit = { character: listField(text, 'Characters?'), creature: listField(text, 'Creatures?|Monsters?'), prop: listField(text, 'Props?'), environment: listField(text, 'Environments?|Set pieces?'), vehicle: listField(text, 'Vehicles?'), any: listField(text, 'Assets?') };
  const found = new Map();
  const add = (name, category, source) => { const k = slug(name) || (/\p{L}/u.test(name) ? name.toLowerCase() : ''); if (!k || found.has(k)) return; found.set(k, { name, category, source }); };
  for (const [cat, names] of Object.entries(explicit)) for (const n of names) add(n, cat === 'any' ? categorize(n) : cat, 'pitch (explicit)');
  const prose = text.replace(FIELD_LINE_RE, ' ');
  // Inferred nouns are skipped when an explicit asset already names them ("cottage" vs "mushroom cottage").
  for (const { word, category, re } of LEXICON_RE) {
    if (!re.test(prose)) continue;
    const stem = new RegExp(`\\b${word}`, 'i'); // "ruin" is covered by an explicit "ruined gate"
    if ([...found.values()].some((a) => stem.test(a.name))) continue;
    add(word, category, 'pitch (inferred)');
  }
  const genre = field(text, 'Genre') || pick(GENRE_RULES, text, 'Adventure');
  const camera = field(text, 'Camera') || pick(CAMERA_RULES, text, 'Third person');
  const style = field(text, 'Style|Art style') || pick(STYLE_RULES, text, 'Stylized / hand-painted');
  const engine = field(text, 'Engine') || 'Unreal Engine 5';
  const titleOut = title || field(text, 'Title') || (text.split('\n').find((l) => l.trim()) || 'Untitled game').trim().slice(0, 60);
  const taken = new Set();
  const nextSuffix = new Map();
  const assets = [...found.values()].map((a, i) => applyCategory({
    id: `A${String(i + 1).padStart(3, '0')}`, name: a.name, asset_name: uniqueAssetName(assetNameFor(a.name), taken, nextSuffix), category: null, source: a.source,
    status: 'requested', assignee: null, import_profile: null, budget: null, footprint_cm: null, generation: null, validator: null, comments: [],
  }, a.category));
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
  const list = Array.isArray(assets) ? assets : [];
  const by = {}; for (const a of list) by[a.category] = (by[a.category] || 0) + 1;
  const status = {}; for (const a of list) status[a.status] = (status[a.status] || 0) + 1;
  return { total: list.length, by_category: by, by_status: status, lod0_triangles_total: list.reduce((n, a) => n + (Number(a.budget?.lods_triangles?.[0]) || 0), 0) };
}

export const STATUS_FLOW = ['requested', 'generating', 'generated', 'in_pipeline', 'validated', 'imported'];
export function nextStatus(s) { const i = STATUS_FLOW.indexOf(s); return i < 0 || i === STATUS_FLOW.length - 1 ? s : STATUS_FLOW[i + 1]; }

// ---- layout ---------------------------------------------------------------------------------------------------------
export const LAYOUT_LIMIT_CM = 100000; // ±1 km: anything further out is a typo or an attack, not a blockout
const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DEFAULT_SPAWN = Object.freeze({ x: 0, y: -1200, z: 0, yaw: 90 });
const FALLBACK_FOOTPRINT_CM = [100, 100];

// Finite number from a number or a numeric string; anything else (null, '', objects, NaN, ±Infinity) is the fallback.
const num = (v, fallback = 0) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? n : fallback; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const coord = (v) => clamp(Math.round(num(v, 0)), -LAYOUT_LIMIT_CM, LAYOUT_LIMIT_CM) + 0; // "+ 0" turns -0 into 0
const yawDeg = (v) => (((Math.round(num(v, 0)) % 360) + 360) % 360) + 0;
const pair = (v) => (Array.isArray(v) && v.length >= 2 && v.slice(0, 2).every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0) ? [v[0], v[1]] : null);
const footprintOf = (asset) => pair(asset?.footprint_cm) || [...(CATEGORY_DEFAULTS[isCategory(asset?.category) ? asset.category : 'prop'].footprint_cm || FALLBACK_FOOTPRINT_CM)];
const heightOf = (asset) => { const h = pair(asset?.budget?.height_cm) || (isCategory(asset?.category) ? CATEGORY_DEFAULTS[asset.category].height_cm : null); return h ? Math.round((h[0] + h[1]) / 2) : 100; };
const safeAssetName = (asset) => (typeof asset?.asset_name === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(asset.asset_name) ? asset.asset_name : assetNameFor(asset?.name || asset?.id || ''));
const newItemId = (asset) => { const id = `${asset.id}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`; return ITEM_ID_RE.test(id) ? id : `it-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`; };

// A clean layout item. Identity (asset_id, asset_name, category, footprint_cm) always comes from the asset; only the
// transform and a short safe id are taken from `raw`, and those are coerced and clamped. Returns null without an asset.
export function sanitizeLayoutItem(raw, asset) {
  if (!asset || typeof asset !== 'object') return null;
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    id: typeof r.id === 'string' && ITEM_ID_RE.test(r.id) ? r.id : newItemId(asset),
    asset_id: asset.id, asset_name: safeAssetName(asset), category: isCategory(asset.category) ? asset.category : 'prop',
    x: coord(r.x), y: coord(r.y), z: coord(r.z), yaw: yawDeg(r.yaw),
    scale: Math.round(clamp(num(r.scale, 1), 0.1, 10) * 1000) / 1000,
    footprint_cm: footprintOf(asset),
  };
}

// Clean a whole items[] against a kit: unknown assets and non-objects are dropped, duplicate ids are re-issued.
export function sanitizeLayoutItems(kit, rawItems, { max = 2000 } = {}) {
  const byId = new Map((Array.isArray(kit?.assets) ? kit.assets : []).map((a) => [a.id, a]));
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    if (out.length >= max) break;
    const asset = raw && typeof raw === 'object' ? byId.get(raw.asset_id) : null;
    if (!asset) continue;
    let it = sanitizeLayoutItem(raw, asset);
    while (seen.has(it.id)) it = sanitizeLayoutItem({ ...it, id: null }, asset);
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

export function sanitizeSpawn(raw, fallback = DEFAULT_SPAWN) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const f = fallback && typeof fallback === 'object' ? fallback : DEFAULT_SPAWN;
  return { x: coord(r.x ?? f.x), y: coord(r.y ?? f.y), z: coord(r.z ?? f.z), yaw: yawDeg(r.yaw ?? f.yaw) };
}

// Starter layout: a 40 m × 40 m blockout with environment pieces on a ring, props and vehicles on a grid near the
// centre, and the cast in a row between the spawn and the props (no two placements share a position).
export function starterLayout(kit, { size_cm = 4000 } = {}) {
  const size = clamp(num(size_cm, 4000), 1000, LAYOUT_LIMIT_CM);
  const assets = Array.isArray(kit?.assets) ? kit.assets : [];
  const items = [];
  const env = assets.filter((a) => a.category === 'environment');
  const props = assets.filter((a) => a.category === 'prop' || a.category === 'vehicle');
  const chars = assets.filter((a) => a.category === 'character' || a.category === 'creature');
  env.forEach((a, i) => { const t = (i / Math.max(1, env.length)) * Math.PI * 2; items.push(place(a, Math.cos(t) * size * 0.35, Math.sin(t) * size * 0.35, Math.round((-t * 180) / Math.PI))); });
  props.forEach((a, i) => items.push(place(a, -600 + (i % 4) * 300, -600 + Math.floor(i / 4) * 300, 0)));
  chars.forEach((a, i) => items.push(place(a, Math.round((i - (chars.length - 1) / 2) * 200), -900, 180)));
  return { schema: LAYOUT_SCHEMA, title: kit?.title, size_cm: size, grid_cm: 100, spawn: { ...DEFAULT_SPAWN }, items, updated_at: new Date().toISOString() };
}
export function place(asset, x, y, yaw = 0, scale = 1) {
  return sanitizeLayoutItem({ x, y, z: 0, yaw, scale }, asset);
}

// Blockout plan for Unreal: one actor per layout item, with the mesh path the Fabled importer uses
// (/Game/Fabled/<AssetName>/<AssetName>) and a fallback placeholder box sized from the budget so the level
// reads before any real asset exists. Items are re-read against the kit, so a stale or hand-edited item cannot
// break the export: identity and footprint come from the asset, and items whose asset is gone are skipped.
export function blockoutPlan(kit, layout) {
  const byId = new Map((Array.isArray(kit?.assets) ? kit.assets : []).map((a) => [a.id, a]));
  const labels = new Set();
  const actors = [];
  let skipped = 0;
  for (const raw of Array.isArray(layout?.items) ? layout.items : []) {
    const a = raw && typeof raw === 'object' ? byId.get(raw.asset_id) : null;
    if (!a) { skipped += 1; continue; }
    const it = sanitizeLayoutItem(raw, a);
    const base = `${it.asset_name}_${it.id.slice(-4)}`;
    let label = base;
    for (let n = 2; labels.has(label); n++) label = `${base}_${n}`;
    labels.add(label);
    actors.push({
      label, mesh_path: `/Game/Fabled/${it.asset_name}/${it.asset_name}`, imported: a.status === 'imported',
      location: { x: it.x, y: it.y, z: it.z }, rotation: { pitch: 0, yaw: it.yaw, roll: 0 }, scale: it.scale,
      placeholder_box_cm: { x: it.footprint_cm[0], y: it.footprint_cm[1], z: heightOf(a) }, category: it.category,
    });
  }
  return {
    schema: 'fabled.blockout_plan/0.1', title: kit?.title, created_at: new Date().toISOString(),
    spawn: sanitizeSpawn(layout?.spawn), grid_cm: num(layout?.grid_cm, 100) > 0 ? num(layout?.grid_cm, 100) : 100,
    skipped_items: skipped, actors,
  };
}
