import { describe, expect, it, vi } from 'vitest';
import { updateFindingStatus } from '@rightsrader/api-client';

describe('updateFindingStatus', () => {
  it('sends the selected reviewer status to the API', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'finding-1', reviewer_status: 'dismissed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const finding = await updateFindingStatus(
      'case-1',
      'finding-1',
      'dismissed',
      'http://api.test',
      fetcher
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://api.test/api/cases/case-1/findings/finding-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ reviewer_status: 'dismissed' })
      })
    );
    expect(finding.reviewer_status).toBe('dismissed');
  });
});
