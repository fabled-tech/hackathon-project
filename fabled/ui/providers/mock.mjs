// Offline mock provider: CONCEPT MOCKUP. Lets the generate → import → pipeline → validator loop run with no API keys and
// no network. It "generates" the repo's own procedural sample sculpt (self-made, no license restrictions), after a short
// fake progress ramp. Every task and every asset made from it carries concept_mockup: true, and the UI labels it.
// Turn it off with FABLED_PROVIDER_MOCK=off.
const DURATION_MS = Number(process.env.FABLED_PROVIDER_MOCK_MS || 2500);

const mock = {
  id: 'mock',
  name: 'Offline mock',
  category: 'CONCEPT MOCKUP',
  kinds: ['text-to-3d', 'image-to-3d'],
  env: [],
  docs: null,
  verification: 'mock',
  verification_note: 'Not a real provider. Returns the procedural sample sculpt so the workflow can be demoed offline.',
  feeds: 'Returns samples/fabled_sample_head.glb as the "generated" mesh.',
  concept_mockup: true,
  configured: (env = process.env) => !/^(0|off|false)$/i.test(env.FABLED_PROVIDER_MOCK || ''),

  async create({ kind, prompt, image }) {
    if (!mock.kinds.includes(kind)) throw new Error(`mock does not support ${kind}`);
    if (kind === 'text-to-3d' && !prompt) throw new Error('text-to-3d needs a prompt');
    if (kind === 'image-to-3d' && !image) throw new Error('image-to-3d needs an image');
    return { remote_id: `mock-${Date.now().toString(36)}`, started_ms: Date.now() };
  },

  async poll(task) {
    const p = Math.min(100, ((Date.now() - (task.started_ms || Date.now())) / DURATION_MS) * 100);
    if (p < 100) return { status: p < 15 ? 'queued' : 'running', progress: Math.round(p), outputs: [], error: null };
    return { status: 'succeeded', progress: 100, outputs: [{ type: 'model', format: 'glb', local: 'samples/fabled_sample_head.glb' }], error: null };
  },
};

export default mock;
