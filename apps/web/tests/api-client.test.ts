import { describe, expect, it, vi } from 'vitest';
import {
  createCase,
  listAssets,
  listCases,
  updateFindingStatus,
  uploadAsset
} from '@rightsrader/api-client';

describe('createCase', () => {
  it('returns curated primary evidence and its rationale', async () => {
    const response = await createCase(
      { script_text: 'A focused excerpt.' },
      'http://api.test',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'case-1',
            script_text: 'A focused excerpt.',
            created_at: '2026-08-02T00:00:00Z',
            asset_count: 0,
            findings: [
              {
                id: 'finding-1',
                case_id: 'case-1',
                category: 'brand_reference',
                detected_item: 'Example Brand',
                explanation: 'A named brand.',
                confidence: 0.8,
                reviewer_status: 'pending',
                retrieved_at: '2026-08-02T00:00:00Z',
                evidence: {
                  primary: {
                    excerpt: 'Official excerpt.',
                    source: { title: 'Official source', url: 'https://source.test/best' }
                  },
                  rationale: 'Confirms the brand named in the scene.',
                  alternatives: []
                },
                supporting_evidence: [],
                source_urls: []
              }
            ]
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    expect(response.findings[0].evidence?.primary?.source.url).toBe('https://source.test/best');
    expect(response.findings[0].evidence?.rationale).toContain('Confirms');
  });
});

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

describe('asset and case-history API helpers', () => {
  it('lists recent cases with the requested limit', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await listCases(3, 'http://api.test/', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'http://api.test/api/cases?limit=3',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('lists assets using an encoded case identifier', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await listAssets('case/one', 'http://api.test', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'http://api.test/api/cases/case%2Fone/assets',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('uploads an asset without setting a JSON content type', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'asset-1', filename: 'production-note.txt' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await uploadAsset(
      'case/one',
      new File(['note'], 'production-note.txt', { type: 'text/plain' }),
      'http://api.test',
      fetcher
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://api.test/api/cases/case%2Fone/assets',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    );
    const request = fetcher.mock.calls[0][1];
    expect(request.headers).toBeUndefined();
    expect((request.body as FormData).get('file')).toBeInstanceOf(File);
  });
});
