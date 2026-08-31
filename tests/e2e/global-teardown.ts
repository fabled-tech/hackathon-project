import { deleteEphemeralProductions } from './ephemeral-productions';

export default async function globalTeardown(): Promise<void> {
  try {
    await deleteEphemeralProductions({
      get: async (url) => {
        const response = await fetch(url);
        return { json: () => response.json() };
      },
      delete: async (url) => {
        await fetch(url, { method: 'DELETE' });
      }
    });
  } catch {
    // API may already be down when Playwright tears down a dedicated server.
  }
}
