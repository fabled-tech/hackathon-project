import { describe, expect, it, vi } from 'vitest';
import {
  createCase,
  createCaseFromFile,
  deleteProductionIcon,
  getCase,
  listAssets,
  listCases,
  updateProduction,
  updateFindingStatus,
  uploadAsset,
  uploadProductionIcon
} from '@rightsrader/api-client';

describe('createCase evidence contract', () => {
  it('exposes the validated primary source and alternatives', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'case-1',
          script_text: 'An Example Brand can appears.',
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
              supporting_evidence: [],
              source_urls: [],
              retrieved_at: '2026-08-02T00:00:00Z',
              reviewer_status: 'pending',
              evidence: {
                primary: {
                  excerpt: 'Verified evidence.',
                  source: { title: 'Official source', url: 'https://source.test/a' }
                },
                rationale: 'The source is directly relevant to the detected item.',
                alternatives: []
              }
            }
          ]
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await createCase(
      { script_text: 'An Example Brand can appears.' },
      'http://api.test',
      fetcher
    );

    const finding = result.findings[0];
    expect(finding).toBeDefined();
    if (!finding) throw new Error('Expected one finding');
    expect(finding.evidence?.primary?.source.url).toBe('https://source.test/a');
    expect(finding.evidence?.rationale).toContain('directly relevant');
    expect(finding.evidence?.alternatives).toEqual([]);
  });

  describe('createCaseFromFile', () => {
    it('uploads a production source without forcing a JSON content type', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'case-file',
            script_text: 'Uploaded image',
            created_at: '2026-08-30T00:00:00Z',
            findings: [],
            asset_count: 1,
            production_id: 'production-1',
            title: 'board.png'
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      );
      const file = new File(['image'], 'board.png', { type: 'image/png' });

      await createCaseFromFile('production-1', file, 'http://api.test', fetcher);

      expect(fetcher).toHaveBeenCalledWith(
        'http://api.test/api/cases/from-file/production-1',
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
      );
      expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
    });
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

describe('getCase', () => {
  it('fetches a case by encoded id and returns the parsed result', async () => {
    const casePayload = {
      id: 'case/one',
      script_text: 'Nimbus Soda appears.',
      created_at: '2026-08-02T00:00:00Z',
      asset_count: 1,
      findings: []
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(casePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getCase('case/one', 'http://api.test', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'http://api.test/api/cases/case%2Fone',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.id).toBe('case/one');
    expect(result.script_text).toBe('Nimbus Soda appears.');
    expect(result.findings).toEqual([]);
  });
});

describe('updateProduction', () => {
  it('sends production-scoped ignore phrases', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'production-1',
          title: 'Studio Feature',
          ignore_keywords: ['Universal Studios']
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const production = await updateProduction(
      'production-1',
      { ignore_keywords: ['Universal Studios'] },
      'http://api.test',
      fetcher
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://api.test/api/productions/production-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ ignore_keywords: ['Universal Studios'] })
      })
    );
    expect(production.ignore_keywords).toEqual(['Universal Studios']);
  });

  describe('production icons', () => {
    it('uploads and removes a custom image', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'production-1',
              title: 'Studio Feature',
              icon_version: 'version-1'
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'production-1',
              title: 'Studio Feature',
              icon_version: null
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      const file = new File(['png'], 'icon.png', { type: 'image/png' });

      await uploadProductionIcon('production-1', file, 'http://api.test', fetcher);
      await deleteProductionIcon('production-1', 'http://api.test', fetcher);

      expect(fetcher.mock.calls[0][0]).toBe(
        'http://api.test/api/productions/production-1/icon'
      );
      expect(fetcher.mock.calls[0][1]).toEqual(
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
      );
      expect(fetcher.mock.calls[1]).toEqual([
        'http://api.test/api/productions/production-1/icon',
        { method: 'DELETE' }
      ]);
    });
  });
});

describe('error handling', () => {
  it('createCase throws when the API returns a non-2xx status', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      createCase({ script_text: 'Some script.' }, 'http://api.test', fetcher)
    ).rejects.toThrow('500');
  });

  it('getCase throws when the API returns a non-2xx status', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(getCase('missing-id', 'http://api.test', fetcher)).rejects.toThrow('404');
  });

  it('uploadAsset throws when the API returns a non-2xx status', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Payload Too Large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      uploadAsset(
        'case-1',
        new File(['data'], 'note.txt', { type: 'text/plain' }),
        'http://api.test',
        fetcher
      )
    ).rejects.toThrow('413');
  });
});
