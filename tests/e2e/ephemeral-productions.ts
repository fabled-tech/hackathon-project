export const DEMO_PRODUCTION_TITLE = 'RightsRadar Demo Desk';

export function isEphemeralProductionTitle(title: string): boolean {
  return (
    title.startsWith('E2E Production ') ||
    title.startsWith('Desk Production ') ||
    title.startsWith('Two Lane ') ||
    title.startsWith('Custom Icon ') ||
    title === '000 Alpha Sort' ||
    title === 'ZZZ Omega Sort' ||
    title === 'Ignore List Feature' ||
    title === 'Browser Verify Desk' ||
    title === 'ft'
  );
}

export async function deleteEphemeralProductions(
  request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }>; delete: (url: string) => Promise<unknown> }
): Promise<number> {
  const payload = await (await request.get('http://127.0.0.1:8000/api/productions')).json();
  if (!Array.isArray(payload)) return 0;
  let removed = 0;
  for (const item of payload) {
    if (
      item &&
      typeof item === 'object' &&
      'id' in item &&
      'title' in item &&
      typeof item.id === 'string' &&
      typeof item.title === 'string' &&
      isEphemeralProductionTitle(item.title)
    ) {
      await request.delete(`http://127.0.0.1:8000/api/productions/${item.id}`);
      removed += 1;
    }
  }
  return removed;
}
