// Pure helpers for the connected workspace (no DOM): filtering, labels, relative time. Imported by workspace.js in the
// browser and by the Node test suites.

export const KIND_ICON = { pipeline_output: '▣', frozen_run: '◇', upload: '⇡', generated: '✦', generation: '✦', sample: '○', fixture: '⚑' };
export const KIND_LABEL = { pipeline_output: 'Pipeline output', frozen_run: 'Frozen pipeline run', upload: 'Uploaded sculpt', generated: 'AI-generated sculpt',
  generation: 'AI generation', sample: 'Sample sculpt', fixture: 'Test fixture' };
export const TONES = ['ok', 'warn', 'fail', 'running', 'neutral', 'mock'];

const fmt = (n) => Number(n).toLocaleString('en-US');
export const compact = (n) => (n == null ? null : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

// "LOD0 18.6k tris · 4 LODs" for runs, "328k tris" for sculpts, null when nothing is known. Never invented.
export function trisLabel(a) {
  const t = a?.triangles;
  if (!t) return null;
  if (t.lod0_triangles != null) return `LOD0 ${compact(t.lod0_triangles)} tris${t.lod_count ? ` · ${t.lod_count} LODs` : ''}`;
  if (t.lod_count) return `${t.lod_count} LODs${t.input != null ? ` · in ${compact(t.input)}` : ''}`;
  if (t.input != null) return `${compact(t.input)} tris`;
  return null;
}
export const trisTitle = (a) => {
  const t = a?.triangles; if (!t) return '';
  return [t.input != null ? `input ${fmt(t.input)} tris` : null, t.lod0_triangles != null ? `LOD0 ${fmt(t.lod0_triangles)} tris` : null, t.lod_count ? `${t.lod_count} LODs` : null]
    .filter(Boolean).join(' · ') + ' (from manifest / SAMPLE_INFO.json)';
};

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return null;
  const s = Math.round((now - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

const haystack = (a, g) => [a.name, a.kind, KIND_LABEL[a.kind], a.status?.label, a.folder, a.provenance?.provider_name, a.provenance?.prompt, g?.label]
  .filter(Boolean).join(' ').toLowerCase();

// Filters workspace groups by a free-text query. Every whitespace-separated term must match (AND). Literal matching only,
// so regex metacharacters in the query are harmless.
export function filterWorkspace(ws, query) {
  const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const groups = (ws?.groups || []).map((g) => ({ ...g, assets: (g.assets || []).filter((a) => !terms.length || terms.every((t) => haystack(a, g).includes(t))) }));
  return { groups, total: groups.reduce((n, g) => n + g.assets.length, 0) };
}

export const findAsset = (ws, id) => {
  for (const g of ws?.groups || []) for (const a of g.assets || []) if (a.id === id) return a;
  return null;
};

export const toneOf = (a) => (TONES.includes(a?.status?.tone) ? a.status.tone : 'neutral');
