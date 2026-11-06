// Runway (runwayml.com): image-to-video. In Fabled this turns a pipeline preview render (or any still) into a short clip
// for previs, pitch reels or asset turntables. The output is a video, not a mesh, so it is attached to the asset page.
//
// Verification (2026-11-06): POST /v1/image_to_video, Bearer auth and the required `X-Runway-Version: 2024-11-06` header
// were confirmed from several pages that mirror Runway's API reference. The official docs host is outside this session's
// network allow-list, so these are unverified: the base host (api.dev.runwayml.com), GET /v1/tasks/{id}, the model name,
// the ratio format, and the `status`/`output`/`failure` fields. RUNWAY_MODEL, RUNWAY_RATIO and RUNWAY_VERSION override them.
import { requestJson, clampProgress, findMediaUrl } from './http.mjs';

const BASE = () => process.env.RUNWAY_BASE_URL || 'https://api.dev.runwayml.com/v1';
const STATUS = { PENDING: 'queued', THROTTLED: 'queued', RUNNING: 'running', SUCCEEDED: 'succeeded', FAILED: 'failed', CANCELLED: 'failed' };
const headers = (env) => ({ Authorization: `Bearer ${env.RUNWAYML_API_SECRET || env.RUNWAY_API_KEY}`, 'X-Runway-Version': env.RUNWAY_VERSION || '2024-11-06' });

export default {
  id: 'runway',
  name: 'Runway',
  category: 'Video generation',
  kinds: ['image-to-video'],
  env: ['RUNWAYML_API_SECRET'],
  docs: 'https://docs.dev.runwayml.com/',
  verification: 'partial',
  verification_note: 'Create path, auth and version header confirmed from mirrors of the API reference; task polling and output fields not checked against the official docs.',
  feeds: 'Turns a preview render into a clip on the asset page (previs, turntable, pitch).',
  configured: (env = process.env) => !!(env.RUNWAYML_API_SECRET || env.RUNWAY_API_KEY),

  async create({ kind, prompt, image }, { env = process.env, fetchImpl } = {}) {
    if (kind !== 'image-to-video') throw new Error(`runway does not support ${kind}`);
    if (!image?.data_uri && !image?.url) throw new Error('image-to-video needs a still image');
    const body = {
      model: env.RUNWAY_MODEL || 'gen4_turbo',
      promptImage: image.url || image.data_uri,
      ...(prompt ? { promptText: prompt } : {}),
      ratio: env.RUNWAY_RATIO || '1280:720',
      duration: Number(env.RUNWAY_DURATION || 5),
    };
    const json = await requestJson(`${BASE()}/image_to_video`, { method: 'POST', headers: headers(env), body, fetchImpl });
    if (!json?.id) throw new Error('Runway did not return a task id');
    return { remote_id: String(json.id) };
  },

  async poll(task, { env = process.env, fetchImpl } = {}) {
    const json = await requestJson(`${BASE()}/tasks/${encodeURIComponent(task.remote_id)}`, { headers: headers(env), fetchImpl });
    const status = STATUS[json?.status] || 'running';
    const url = (Array.isArray(json?.output) && json.output[0]) || findMediaUrl(json, ['mp4', 'webm', 'mov']);
    const p = json?.progress;
    return {
      status,
      progress: clampProgress(p != null && p <= 1 ? p * 100 : p),
      outputs: url ? [{ type: 'video', format: 'mp4', url }] : [],
      error: status === 'failed' ? (json?.failure || json?.failureCode || 'failed') : null,
    };
  },
};
