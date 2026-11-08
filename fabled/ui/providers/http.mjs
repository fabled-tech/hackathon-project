// Shared HTTP helpers for provider adapters. Node >= 18 (global fetch). No dependencies.

import { env } from '../env.mjs';

export class ProviderError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const TIMEOUT_MS = Number(env('PROVIDER_TIMEOUT_MS') || 30000);

// JSON request with a timeout. Never logs headers (they carry API keys).
export async function requestJson(url, { method = 'GET', headers = {}, body = undefined, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ProviderError(`request to ${new URL(url).host} failed: ${e.name === 'AbortError' ? `timed out after ${TIMEOUT_MS} ms` : e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = json?.message || json?.error?.message || json?.error || json?.detail || text.slice(0, 300);
    throw new ProviderError(`${new URL(url).host} answered HTTP ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`, { status: res.status, body: json ?? text.slice(0, 2000) });
  }
  return json;
}

// Depth-first search for the first https URL whose path ends in one of `exts`. Used for responses whose exact
// output field is not verified: it finds e.g. a .mp4 or .glb wherever the provider put it.
export function findMediaUrl(obj, exts) {
  const re = new RegExp(`^https://[^\\s"']+\\.(${exts.join('|')})(\\?[^\\s"']*)?$`, 'i');
  const seen = new Set();
  const walk = (v) => {
    if (v == null || seen.has(v)) return null;
    if (typeof v === 'string') return re.test(v) ? v : null;
    if (typeof v !== 'object') return null;
    seen.add(v);
    for (const x of Array.isArray(v) ? v : Object.values(v)) { const hit = walk(x); if (hit) return hit; }
    return null;
  };
  return walk(obj);
}

export const clampProgress = (p) => (p == null || Number.isNaN(Number(p)) ? null : Math.max(0, Math.min(100, Number(p))));
