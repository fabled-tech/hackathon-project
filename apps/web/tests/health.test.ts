import { describe, expect, it } from 'vitest';
import { fetchHealth, modeBadgeLabel } from '../lib/health';

describe('health', () => {
  it('parses the health payload', async () => {
    const fake = (async () => new Response(JSON.stringify({ status: 'ok', mode: 'cloud', adjudicator: 'adk' }))) as unknown as typeof fetch;
    expect(await fetchHealth('http://api.test', fake)).toEqual({ mode: 'cloud', adjudicator: 'adk' });
  });
  it('returns null on failure', async () => {
    const fake = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await fetchHealth('http://api.test', fake)).toBeNull();
  });
  it('labels modes', () => {
    expect(modeBadgeLabel({ mode: 'cloud', adjudicator: 'adk' })).toBe('LIVE · Vertex + Parallel + ADK');
    expect(modeBadgeLabel({ mode: 'mock', adjudicator: 'fixture' })).toBe('OFFLINE FIXTURES');
    expect(modeBadgeLabel(null)).toBe('API UNREACHABLE');
  });
});
