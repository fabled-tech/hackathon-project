// Offline mock provider: CONCEPT MOCKUP. Lets the generate → import → pipeline → validator loop run with no API keys and
// no network. After a short fake progress ramp it returns one of three procedural models from samples/mock_generations/
// (self-made by tools/make_mock_generations.py, no license restrictions): picked by keywords in the prompt, otherwise
// deterministically from the prompt text. It does not read the prompt or image beyond that. Every task and every asset
// made from it carries concept_mockup: true, and the UI labels it. Turn it off with FABLED_PROVIDER_MOCK=off.
const DURATION_MS = Number(process.env.FABLED_PROVIDER_MOCK_MS || 2500);

export const MOCK_MODELS = [
  { file: 'knight_helmet.glb', words: /helm|knight|armou?r|medieval|warrior|paladin|soldier|crusader/i },
  { file: 'mushroom_cottage.glb', words: /mushroom|cottage|house|hut|home|building|village|fairy|toadstool|shroom/i },
  { file: 'potion_flask.glb', words: /potion|flask|bottle|vial|elixir|glass|alchemy|vase|jar/i },
];
export function pickMockModel(prompt = '') {
  const hit = MOCK_MODELS.find((m) => m.words.test(prompt));
  if (hit) return hit.file;
  let h = 0; for (const ch of String(prompt)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return MOCK_MODELS[h % MOCK_MODELS.length].file;
}

const mock = {
  id: 'mock',
  name: 'Offline mock',
  category: 'CONCEPT MOCKUP',
  kinds: ['text-to-3d', 'image-to-3d'],
  env: [],
  docs: null,
  verification: 'mock',
  verification_note: 'Not a real provider. Returns the procedural sample sculpt so the workflow can be demoed offline.',
  feeds: 'Returns a procedural knight helmet, mushroom cottage or potion flask (picked from prompt keywords) as the "generated" mesh.',
  concept_mockup: true,
  configured: (env = process.env) => !/^(0|off|false)$/i.test(env.FABLED_PROVIDER_MOCK || ''),

  async create({ kind, prompt, image }) {
    if (!mock.kinds.includes(kind)) throw new Error(`mock does not support ${kind}`);
    if (kind === 'text-to-3d' && !prompt) throw new Error('text-to-3d needs a prompt');
    if (kind === 'image-to-3d' && !image) throw new Error('image-to-3d needs an image');
    return { remote_id: `mock-${Date.now().toString(36)}`, started_ms: Date.now(), mock_model: pickMockModel(prompt) };
  },

  async poll(task) {
    const p = Math.min(100, ((Date.now() - (task.started_ms || Date.now())) / DURATION_MS) * 100);
    if (p < 100) return { status: p < 15 ? 'queued' : 'running', progress: Math.round(p), outputs: [], error: null };
    const file = task.mock_model || pickMockModel(task.prompt);
    return { status: 'succeeded', progress: 100, outputs: [{ type: 'model', format: 'glb', local: `samples/mock_generations/${file}` }], error: null };
  },
};

export default mock;
