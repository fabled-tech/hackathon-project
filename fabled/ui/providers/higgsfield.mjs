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
//   HIGGSFIELD_MAX_DATA_URI_BYTES  default 8388608 (8 MB); 0 refuses every data URI (public https URLs only)
//
// OPEN QUESTION: the image input. What the notes establish is that the docs describe the image-to-video input as a
// *public URL* in `image_url` (Wan 2.7 page; the Seedance example is https://example.com/input.jpg). What this
// adapter sends depends on what it is given:
//   image.url       a public https URL                      -> sent as image_url. The documented form.
//   image.data_uri  a base64 data: URI (what the Fabled server builds from a preview render or an uploaded still,
//                   because those files are not on any public URL) -> also sent as image_url. UNVERIFIED: nothing in
//                   the notes says the API accepts a data URI there, and no request has been made with a real key.
//                   It may be rejected with an HTTP 4xx, or accepted and fail later.
// The official SDKs have an upload step for local files (Python: upload / upload_file / upload_image; Node agent
// API: client.agents.media.upload), but the notes record only those function names, not the REST endpoint, its
// request shape or what it returns. So no upload call is implemented here and there is deliberately no upload-path
// env var: it would be a guess. To settle this: read the upload section of docs.higgsfield.ai (or the SDK source),
// or send one small data URI with a real key and record the answer in PROVIDERS.md.
// Until then a data URI above HIGGSFIELD_MAX_DATA_URI_BYTES is refused before any network call, so a multi-megabyte
// body is never posted to an endpoint that may not take it. Providers reject SVG; send PNG/JPEG stills.
import { requestJson, clampProgress, findMediaUrl } from './http.mjs';

const BASE = () => (process.env.HIGGSFIELD_BASE_URL || 'https://api.higgsfield.ai').replace(/\/$/, '');
const STATUS = { queued: 'queued', in_queue: 'queued', pending: 'queued', in_progress: 'running', processing: 'running', running: 'running',
  completed: 'succeeded', succeeded: 'succeeded', success: 'succeeded', failed: 'failed', error: 'failed', nsfw: 'failed', canceled: 'failed', cancelled: 'failed' };

export const DEFAULT_MAX_DATA_URI_BYTES = 8 * 1024 * 1024;
function maxDataUriBytes(env) {
  const raw = env.HIGGSFIELD_MAX_DATA_URI_BYTES;
  const n = Number(raw);
  return raw != null && String(raw).trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MAX_DATA_URI_BYTES;
}
const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

// The value for image_url: a public https URL as documented, or (unverified) a size-capped data URI.
function imageUrlFor(image, env) {
  if (image.url) {
    if (!/^https:\/\//i.test(image.url)) throw new Error('Higgsfield image_url must be a public https URL');
    return image.url;
  }
  const bytes = Buffer.byteLength(String(image.data_uri));
  const limit = maxDataUriBytes(env);
  if (bytes > limit) {
    throw new Error(`Higgsfield: this image would be sent inline as a ${mb(bytes)} MB data URI, over the ${mb(limit)} MB limit `
      + '(HIGGSFIELD_MAX_DATA_URI_BYTES). Higgsfield documents image_url as a public https URL, and whether it accepts a data URI at all is unverified. '
      + 'Give a public https image URL, or use a smaller image; an upload step would be needed for large local files and is not implemented '
      + '(the REST upload endpoint is not documented in docs/research).');
  }
  return image.data_uri;
}

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
  verification_note: 'Base URL, Key auth, per-model image-to-video path and the request_id/status_url polling shape come from the official SDK READMEs (Nov 2026); not yet exercised with a real key from this repo. Open question: the docs describe image_url as a public URL; local stills are sent as a data URI (8 MB cap), which is unverified.',
  feeds: 'Turns a preview render into a cinematic clip on the asset page.',
  configured: (env = process.env) => !!env.HIGGSFIELD_API_KEY,

  async create({ kind, prompt, image }, { env = process.env, fetchImpl } = {}) {
    if (kind !== 'image-to-video') throw new Error(`higgsfield does not support ${kind}`);
    if (!image?.url && !image?.data_uri) throw new Error('image-to-video needs a still image');
    if (!prompt) throw new Error('Higgsfield image-to-video needs a prompt (camera move / action)');
    const path = (env.HIGGSFIELD_I2V_PATH || 'wan/v2.7/image-to-video').replace(/^\//, '');
    const imageUrl = imageUrlFor(image, env); // throws before any network call when the image cannot be sent
    const json = await requestJson(`${BASE()}/${path}`, { method: 'POST', headers: authHeaders(env), body: { prompt, image_url: imageUrl }, fetchImpl });
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
