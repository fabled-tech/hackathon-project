// Synthetic workspace index (same shape as GET /api/workspace, schema fabled.workspace/0.1) for the filter / render tests.
// TEST FIXTURE: invented names and numbers, never shown in the app.
export const WORKSPACE_FIXTURE = {
  schema: 'fabled.workspace/0.1',
  total: 6,
  groups: [
    { id: 'runs', label: 'Pipeline runs', assets: [
      { id: 'run:pipeline/output', kind: 'pipeline_output', name: 'Historical bust scan (CC0)', status: { label: 'Validator WARN', tone: 'warn' },
        triangles: { input: 327680, lod_count: 4, lod0_triangles: 18636 }, created_at: '2026-11-03T20:44:03-08:00', folder: 'pipeline/output' },
      { id: 'run:pipeline/runs/20261103-195336', kind: 'frozen_run', name: 'Historical bust scan (CC0)', status: { label: 'Validator PASS', tone: 'ok' },
        triangles: { input: 327680, lod_count: 4, lod0_triangles: 18636 }, created_at: '2026-11-03T19:53:39-08:00', folder: 'pipeline/runs/20261103-195336' },
    ] },
    { id: 'uploads', label: 'Uploads', hidden_count: 0, assets: [
      { id: 'job:aaaaaaaa-1111', kind: 'upload', name: 'shield_prop.obj', status: { label: 'Uploaded', tone: 'neutral' }, triangles: { input: null, lod_count: null, lod0_triangles: null }, created_at: '2026-11-06T04:00:00Z' },
    ] },
    { id: 'generated', label: 'AI generations', assets: [
      { id: 'gen:gen-abc', kind: 'generation', name: 'stylized dwarf bust', status: { label: 'Generating 40%', tone: 'running' }, created_at: '2026-11-06T04:10:00Z',
        provenance: { provider: 'meshy', provider_name: 'Meshy', kind: 'text-to-3d', prompt: 'stylized dwarf bust' } },
      { id: 'job:bbbbbbbb-2222', kind: 'generated', name: 'mock_text_to_3d_abc.glb', status: { label: 'Validator FAIL', tone: 'fail' }, concept_mockup: true, created_at: '2026-11-06T04:12:00Z',
        provenance: { provider: 'mock', provider_name: 'Offline mock', kind: 'text-to-3d', prompt: 'paladin shield' } },
    ] },
    { id: 'samples', label: 'Samples & fixtures', assets: [
      { id: 'sample:fabled_sample_head.glb', kind: 'sample', name: 'fabled_sample_head.glb', status: { label: '2,003 seeded flips', tone: 'neutral' }, triangles: { input: 327680 } },
    ] },
  ],
};
