// Tripo (tripo3d.ai): text-to-model and image-to-model.
//
// Verification (2026-11-06): POST /v2/openapi/task to create and GET /v2/openapi/task/{task_id} to poll were confirmed from
// two independent third-party integrations (ComfyUI's Tripo nodes, a proxy's docs) that point at platform.tripo3d.ai/docs.
// The official docs host is outside this session's network allow-list, so these are unverified: the base host
// (api.tripo3d.ai), the `type` values, the `file: {type, url}` image form (the official SDK uploads a file first), the
// response envelope `{code, data:{task_id}}`, and the output fields. Override the host with TRIPO_BASE_URL if needed.
import { requestJson, clampProgress, findMediaUrl } from './http.mjs';

const BASE = () => process.env.TRIPO_BASE_URL || 'https://api.tripo3d.ai/v2/openapi';
const STATUS = { queued: 'queued', running: 'running', success: 'succeeded', failed: 'failed', cancelled: 'failed', banned: 'failed', expired: 'failed', unknown: 'running' };

export default {
  id: 'tripo',
  name: 'Tripo',
  category: '3D generation',
  kinds: ['text-to-3d', 'image-to-3d'],
  env: ['TRIPO_API_KEY'],
  docs: 'https://platform.tripo3d.ai/docs/generation',
  verification: 'unverified',
  verification_note: 'Task create/poll paths seen in third-party integrations; request and response fields not checked against the official docs.',
  feeds: 'Generated mesh is imported as a new sculpt for the Fabled pipeline.',
  configured: (env = process.env) => !!env.TRIPO_API_KEY,

  async create({ kind, prompt, image }, { env = process.env, fetchImpl } = {}) {
    let body;
    if (kind === 'text-to-3d') {
      if (!prompt) throw new Error('text-to-3d needs a prompt');
      body = { type: 'text_to_model', prompt };
    } else if (kind === 'image-to-3d') {
      if (!image?.url) throw new Error('Tripo image-to-3d needs a public image URL (local images need an upload step this adapter does not implement yet)');
      const ext = (image.url.split('?')[0].split('.').pop() || 'png').toLowerCase();
      body = { type: 'image_to_model', file: { type: ext === 'jpeg' ? 'jpg' : ext, url: image.url } };
    } else throw new Error(`tripo does not support ${kind}`);
    const json = await requestJson(`${BASE()}/task`, { method: 'POST', headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}` }, body, fetchImpl });
    const taskId = json?.data?.task_id || json?.task_id;
    if (!taskId) throw new Error(`Tripo did not return a task id${json?.message ? `: ${json.message}` : ''}`);
    return { remote_id: String(taskId) };
  },

  async poll(task, { env = process.env, fetchImpl } = {}) {
    const json = await requestJson(`${BASE()}/task/${encodeURIComponent(task.remote_id)}`, { headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}` }, fetchImpl });
    const d = json?.data || json || {};
    const status = STATUS[d.status] || 'running';
    const out = d.output || {};
    const model = out.pbr_model || out.model || out.base_model || findMediaUrl(d, ['glb', 'fbx', 'obj']);
    const outputs = [];
    if (model) outputs.push({ type: 'model', format: (String(model).split('?')[0].split('.').pop() || 'glb').toLowerCase(), url: model });
    if (out.rendered_image) outputs.push({ type: 'image', format: 'webp', url: out.rendered_image });
    return { status, progress: clampProgress(d.progress), outputs, error: status === 'failed' ? (d.error || json?.message || `status ${d.status}`) : null };
  },
};
