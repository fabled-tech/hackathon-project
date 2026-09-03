export type ApiHealth = { mode: 'mock' | 'hybrid' | 'cloud'; adjudicator: 'adk' | 'fixture' };

export async function fetchHealth(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<ApiHealth | null> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/health`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<ApiHealth>;
    if (body.mode !== 'mock' && body.mode !== 'hybrid' && body.mode !== 'cloud') return null;
    return { mode: body.mode, adjudicator: body.adjudicator === 'adk' ? 'adk' : 'fixture' };
  } catch {
    return null;
  }
}

export function modeBadgeLabel(health: ApiHealth | null): string {
  if (!health) return 'API UNREACHABLE';
  if (health.mode === 'cloud') return 'LIVE · Vertex + Parallel + ADK';
  if (health.mode === 'hybrid') return `HYBRID · adjudicator ${health.adjudicator}`;
  return 'OFFLINE FIXTURES';
}
