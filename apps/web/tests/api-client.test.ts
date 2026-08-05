import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createProduction,
  createProductionAsset,
  createProductionScript,
  getProduction,
  getProductionRun,
  createCase,
  listProductionReviewEvents,
  listProductionRuns,
  listProductions,
  listAssets,
  listCases,
  monitorProductionChanges,
  recheckProductionSources,
  replaceProductionAsset,
  replaceProductionScript,
  retireProductionSource,
  updateProductionFindingStatus,
  updateFindingStatus,
  uploadAsset,
  type ProductionDetail,
  type ReviewerStatus
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
                  alternatives: [
                    {
                      excerpt: 'Alternative source excerpt.',
                      source: { title: 'Alternative source', url: 'https://source.test/alternative' }
                    }
                  ]
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
    expect(response.findings[0].evidence?.alternatives?.[0].source.url).toBe(
      'https://source.test/alternative'
    );
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

describe('production monitoring API helpers', () => {
  it('preserves safe HTTP status and detail on API errors', async () => {
    const detail =
      'The production changed while monitoring. Review the latest sources and try again.';
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      monitorProductionChanges('production-1', 'http://api.test', fetcher)
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      detail
    });
  });

  it('types reviewer status counts as numeric values keyed by reviewer status', () => {
    expectTypeOf<NonNullable<ProductionDetail['reviewer_status_counts']>>().toEqualTypeOf<
      Partial<Record<ReviewerStatus, number>>
    >();
  });

  it('posts an explicit recheck and uploads a replacement asset with encoded identifiers', async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'run-1', findings: [], source_snapshots: [] }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }))
    );

    await recheckProductionSources('production/one', 'http://api.test', fetcher);
    await replaceProductionAsset(
      'production/one',
      'source two',
      new File(['note'], 'notes.txt', { type: 'text/plain' }),
      'http://api.test',
      fetcher
    );

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://api.test/api/productions/production%2Fone/rechecks',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://api.test/api/productions/production%2Fone/assets/source%20two/versions',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    );
    expect(fetcher.mock.calls[1][1]?.headers).toBeUndefined();
    expect((fetcher.mock.calls[1][1]?.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('uses OpenAPI methods, JSON payloads, encoded paths, and default list limits', async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    const baseUrl = 'http://api.test';

    await createProduction({ name: 'Summer feature' }, baseUrl, fetcher);
    await listProductions(undefined, baseUrl, fetcher);
    await getProduction('production/one', baseUrl, fetcher);
    await createProductionScript(
      'production/one',
      { name: 'Opening scene', script_text: 'INT. STUDIO - DAY' },
      baseUrl,
      fetcher
    );
    await replaceProductionScript(
      'production/one',
      'source two',
      { script_text: 'EXT. LOT - NIGHT' },
      baseUrl,
      fetcher
    );
    await retireProductionSource('production/one', 'source two', baseUrl, fetcher);
    await createProductionAsset(
      'production/one',
      new File(['note'], 'notes.txt', { type: 'text/plain' }),
      baseUrl,
      fetcher
    );
    await monitorProductionChanges('production/one', baseUrl, fetcher);
    await listProductionRuns('production/one', undefined, baseUrl, fetcher);
    await getProductionRun('production/one', 'run/two', baseUrl, fetcher);
    await updateProductionFindingStatus(
      'production/one',
      'run/two',
      'finding three',
      { reviewer_status: 'accepted' },
      baseUrl,
      fetcher
    );
    await listProductionReviewEvents('production/one', undefined, baseUrl, fetcher);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://api.test/api/productions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Summer feature' })
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://api.test/api/productions?limit=20',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'http://api.test/api/productions/production%2Fone',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      'http://api.test/api/productions/production%2Fone/scripts',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Opening scene', script_text: 'INT. STUDIO - DAY' })
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      5,
      'http://api.test/api/productions/production%2Fone/scripts/source%20two',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script_text: 'EXT. LOT - NIGHT' })
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      6,
      'http://api.test/api/productions/production%2Fone/sources/source%20two',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      7,
      'http://api.test/api/productions/production%2Fone/assets',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    );
    expect(fetcher.mock.calls[6][1]?.headers).toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(
      8,
      'http://api.test/api/productions/production%2Fone/runs',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      9,
      'http://api.test/api/productions/production%2Fone/runs?limit=25',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      10,
      'http://api.test/api/productions/production%2Fone/runs/run%2Ftwo',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      11,
      'http://api.test/api/productions/production%2Fone/runs/run%2Ftwo/findings/finding%20three',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer_status: 'accepted' })
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      12,
      'http://api.test/api/productions/production%2Fone/review-events?limit=50',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
