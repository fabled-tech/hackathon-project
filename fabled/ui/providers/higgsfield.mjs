// Higgsfield (higgsfield.ai): cinematic image-to-video (camera-motion presets, hosted third-party video models).
//
// Verification (2026-11-06): LOW. The only endpoint found was a connector page that documents
// https://platform.higgsfield.ai/minimax/hailuo-2.3/standard/image-to-video with required `prompt` and `image_url`, and
// says the call returns a request-status object you poll. The official docs (docs.higgsfield.ai) are outside this session's
// network allow-list, so these are guesses: the auth header and scheme, the request-id field and the status URL.
// Everything is overridable, and the adapter stays off until HIGGSFIELD_API_KEY is set:
//   HIGGSFIELD_BASE_URL     default https://platform.higgsfield.ai
//   HIGGSFIELD_I2V_PATH     default minimax/hailuo-2.3/standard/image-to-video
//   HIGGSFIELD_AUTH_HEADER  default Authorization
//   HIGGSFIELD_AUTH_SCHEME  default "Key"  (value sent: "<scheme> <key>", or just "<key>" if the scheme is empty;
//                           set HIGGSFIELD_API_SECRET to send "<key>:<secret>")
//   HIGGSFIELD_STATUS_PATH  default requests/{id}/status  (used only when the response has no status URL)
import { requestJson, clampProgress, findMediaUrl } from './http.mjs';

const BASE = () => (process.env.HIGGSFIELD_BASE_URL || 'https://platform.higgsfield.ai').replace(/\/$/, '');
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
  verification: 'unverified',
  verification_note: 'One endpoint path seen on a third-party connector page; auth, polling and output fields are configurable guesses until checked against docs.higgsfield.ai.',
  feeds: 'Turns a preview render into a cinematic clip on the asset page.',
  configured: (env = process.env) => !!env.HIGGSFIELD_API_KEY,

  async create({ kind, prompt, image }, { env = process.env, fetchImpl } = {}) {
    if (kind !== 'image-to-video') throw new Error(`higgsfield does not support ${kind}`);
    if (!image?.url && !image?.data_uri) throw new Error('image-to-video needs a still image');
    if (!prompt) throw new Error('Higgsfield image-to-video needs a prompt (camera move / action)');
    const path = (env.HIGGSFIELD_I2V_PATH || 'minimax/hailuo-2.3/standard/image-to-video').replace(/^\//, '');
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
