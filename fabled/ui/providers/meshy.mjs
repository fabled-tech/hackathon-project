// Meshy (meshy.ai): text-to-3D and image-to-3D. The output is a mesh that can go straight into the Fabled pipeline as a sculpt.
//
// Verification (2026-11-06): the base URL https://api.meshy.ai/openapi, the POST /v1/image-to-3d and GET /v1/image-to-3d/{id}
// paths, Bearer auth, the task id in `result`, and the SUCCEEDED/FAILED statuses were confirmed via search results that quote
// docs.meshy.ai (quick start + openapi.yaml). The text-to-3d path (/v2/text-to-3d, mode "preview") and the `model_urls`,
// `progress`, `thumbnail_url` and `task_error` fields come from the vendor docs as remembered, NOT re-read here, because
// docs.meshy.ai is outside this session's network allow-list. Check them before relying on this adapter.
import { requestJson, clampProgress, findMediaUrl } from './http.mjs';

const BASE = () => process.env.MESHY_BASE_URL || 'https://api.meshy.ai/openapi';
const PATHS = { 'image-to-3d': '/v1/image-to-3d', 'text-to-3d': '/v2/text-to-3d' };
const STATUS = { PENDING: 'queued', IN_PROGRESS: 'running', SUCCEEDED: 'succeeded', FAILED: 'failed', CANCELED: 'failed', EXPIRED: 'failed' };

export default {
  id: 'meshy',
  name: 'Meshy',
  category: '3D generation',
  kinds: ['text-to-3d', 'image-to-3d'],
  env: ['MESHY_API_KEY'],
  docs: 'https://docs.meshy.ai/api/quick-start',
  verification: 'partial',
  verification_note: 'Image-to-3D path, auth, task id and statuses confirmed from docs search results; text-to-3D path and output field names not re-read (docs host blocked in this session).',
  feeds: 'Generated mesh is imported as a new sculpt, then runs through retopo, LODs, bake and the pre-import validator.',
  configured: (env = process.env) => !!env.MESHY_API_KEY,

  async create({ kind, prompt, image }, { env = process.env, fetchImpl } = {}) {
    const headers = { Authorization: `Bearer ${env.MESHY_API_KEY}` };
    let body;
    if (kind === 'image-to-3d') {
      if (!image?.data_uri && !image?.url) throw new Error('image-to-3d needs an image');
      // Meshy accepts a public URL or a base64 data URI in image_url.
      body = { image_url: image.url || image.data_uri, ...(prompt ? { texture_prompt: prompt } : {}) };
    } else if (kind === 'text-to-3d') {
      if (!prompt) throw new Error('text-to-3d needs a prompt');
      body = { mode: 'preview', prompt };
    } else throw new Error(`meshy does not support ${kind}`);
    const json = await requestJson(BASE() + PATHS[kind], { method: 'POST', headers, body, fetchImpl });
    const taskId = json?.result || json?.id;
    if (!taskId) throw new Error('Meshy did not return a task id');
    return { remote_id: String(taskId) };
  },

  async poll(task, { env = process.env, fetchImpl } = {}) {
    const json = await requestJson(`${BASE()}${PATHS[task.kind]}/${encodeURIComponent(task.remote_id)}`, { headers: { Authorization: `Bearer ${env.MESHY_API_KEY}` }, fetchImpl });
    const status = STATUS[json?.status] || 'running';
    const glb = json?.model_urls?.glb || findMediaUrl(json?.model_urls, ['glb']);
    const outputs = [];
    if (glb) outputs.push({ type: 'model', format: 'glb', url: glb });
    else if (json?.model_urls?.obj) outputs.push({ type: 'model', format: 'obj', url: json.model_urls.obj });
    if (json?.thumbnail_url) outputs.push({ type: 'image', format: 'png', url: json.thumbnail_url });
    return { status, progress: clampProgress(json?.progress), outputs, error: json?.task_error?.message || null };
  },
};
