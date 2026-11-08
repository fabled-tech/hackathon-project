// Higgsfield (higgsfield.ai): cinematic image-to-video (camera-motion presets, hosted third-party video models).
//
// Verification (2026-11-08): MEDIUM. Research notes (docs/research, "Higgsfield and video APIs") read the official
// @higgsfield/client and higgsfield-client READMEs on GitHub plus search extracts of docs.higgsfield.ai:
//   base URL        https://api.higgsfield.ai         (keys from console.higgsfield.ai)
//   auth            Authorization: Key <KEY_ID>:<KEY_SECRET>   (HF_API_KEY + HF_API_SECRET in the SDKs)
//   image→video     POST /<model path>/image-to-video, e.g. wan/v2.7/image-to-video, body { prompt, image_url }
//   submit response { status: "queued", request_id, status_url: https://api.higgsfield.ai/requests/{id}/status, cancel_url }
//   poll            GET status_url → status queued|in_progress|completed|failed|nsfw|canceled; output under video.url
// Not exercised from this repo yet, and the docs host itself was unreachable from the build box, so everything stays
// overridable and the adapter is off until the key is set:
//   HIGGSFIELD_API_KEY      key id (required)         HIGGSFIELD_API_SECRET  key secret (sent as "<key>:<secret>")
//   HIGGSFIELD_BASE_URL     default https://api.higgsfield.ai
//   HIGGSFIELD_I2V_PATH     default wan/v2.7/image-to-video   (other model paths: kling 3.0, seedance 2.5, dop …)
//   HIGGSFIELD_AUTH_HEADER  default Authorization
//   HIGGSFIELD_AUTH_SCHEME  default "Key"
//   HIGGSFIELD_STATUS_PATH  default requests/{id}/status  (used only when the response has no status_url)
// Note: providers reject SVG; send PNG/JPEG stills. image_url may be a public https URL or a data URI (unverified).
import { requestJson, clampProgress, findMediaUrl } from './http.mjs';

const BASE = () => (process.env.HIGGSFIELD_BASE_URL || 'https://api.higgsfield.ai').replace(/\/$/, '');
const STATUS = { queued: 'queued', in_queue: 'queued', pending: 'queued', in_progress: 'running', processing: 'running', running: 'running',
  completed: 'succeeded', succeeded: 'succeeded', success: 'succeeded', failed: 'failed', error: 'failed', nsfw: 'failed', canceled: 'failed', cancelled: 'failed' };

function authHeaders(env) {
  const header = env.HIGGSFIELD_AUTH_HEADER || 'Authorization';
  const scheme = env.HIGGSFIELD_AUTH_SCHEME ?? 'Key';
  const cred = env.HIGGSFIELD_API_SECRET ? `${env.HIGGSFIELD_API_KEY}:${env.HIGGSFIELD_API_SECRET}` : env.HIGGSFIELD_API_KEY;
  return { [header]: scheme ? `${scheme} ${cred}` : cred };
}

export default {
  id: 'higgsfield',
  name: 'Higgsfield',
  category: 'Video generation',
  kinds: ['image-to-video'],
  env: ['HIGGSFIELD_API_KEY'],
  docs: 'https://docs.higgsfield.ai',
  verification: 'partly',
  verification_note: 'Base URL, Key auth, per-model image-to-video path and the request_id/status_url polling shape come from the official SDK READMEs (Nov 2026); not yet exercised with a real key from this repo.',
  feeds: 'Turns a preview render into a cinematic clip on the asset page.',
  configured: (env = process.env) => !!env.HIGGSFIELD_API_KEY,

  async create({ kind, prompt, image }, { env = process.env, fetchImpl } = {}) {
    if (kind !== 'image-to-video') throw new Error(`higgsfield does not support ${kind}`);
    if (!image?.url && !image?.data_uri) throw new Error('image-to-video needs a still image');
    if (!prompt) throw new Error('Higgsfield image-to-video needs a prompt (camera move / action)');
    const path = (env.HIGGSFIELD_I2V_PATH || 'wan/v2.7/image-to-video').replace(/^\//, '');
    const json = await requestJson(`${BASE()}/${path}`, { method: 'POST', headers: authHeaders(env), body: { prompt, image_url: image.url || image.data_uri }, fetchImpl });
    const id = json?.request_id || json?.id || json?.job_id || json?.data?.id;
    if (!id) throw new Error('Higgsfield did not return a request id');
    return { remote_id: String(id), status_url: typeof json?.status_url === 'string' ? json.status_url : null };
  },

  async poll(task, { env = process.env, fetchImpl } = {}) {
    const statusPath = (env.HIGGSFIELD_STATUS_PATH || 'requests/{id}/status').replace('{id}', encodeURIComponent(task.remote_id));
    let url = `${BASE()}/${statusPath.replace(/^\//, '')}`;
    // Only follow a provider-returned status URL on the same host, so a response cannot send the key elsewhere.
    if (task.status_url) { try { if (new URL(task.status_url).host === new URL(BASE()).host) url = task.status_url; } catch { /* keep default */ } }
    const json = await requestJson(url, { headers: authHeaders(env), fetchImpl });
    const raw = String(json?.status || json?.state || json?.data?.status || '').toLowerCase();
    const status = STATUS[raw] || 'running';
    const video = json?.video?.url || findMediaUrl(json, ['mp4', 'webm', 'mov']);
    return { status, progress: clampProgress(json?.progress), outputs: video ? [{ type: 'video', format: 'mp4', url: video }] : [], error: status === 'failed' ? (json?.error || raw) : null };
  },
};
