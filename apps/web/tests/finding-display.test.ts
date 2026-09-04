import { describe, expect, it } from 'vitest';
import { isChromeExcerpt, linerNotesForFinding } from '../lib/finding-display';
import type { Finding } from '@rightsrader/api-client';

const source = { title: 'USPTO', url: 'https://example.com/tm' };

function finding(partial: Partial<Finding>): Finding {
  return {
    id: 'f1',
    case_id: 'c1',
    category: 'franchise',
    detected_item: 'The Matrix',
    explanation: 'Franchise lead',
    confidence: 0.9,
    supporting_evidence: [],
    source_urls: [],
    retrieved_at: '2026-09-03T00:00:00Z',
    reviewer_status: 'pending',
    ...partial
  };
}

describe('liner notes', () => {
  it('rejects extract chrome and USPTO date dumps', () => {
    expect(isChromeExcerpt('301 Moved Permanently cloudflare')).toBe(true);
    expect(isChromeExcerpt('U.S. flag _keyboard\\_arrow\\_down_ official website of the United States')).toBe(
      true
    );
    expect(
      isChromeExcerpt(
        'Jan. 1, 2020 Feb. 2, 2021 Mar. 3, 2022 Apr. 4, 2023 May 5, 2024 Jun. 6, 2025'
      )
    ).toBe(true);
    expect(isChromeExcerpt('# Search Records ## Copyright Search Records Pre-1978 Records')).toBe(true);
    expect(isChromeExcerpt('Warner Bros. registered THE MATRIX in 1999.')).toBe(false);
  });

  it('prefers the curated primary excerpt and clips long dumps', () => {
    const notes = linerNotesForFinding(
      finding({
        supporting_evidence: [
          { excerpt: '301 Moved Permanently', source },
          { excerpt: 'A'.repeat(400), source: { title: 'Alt', url: 'https://example.com/a' } }
        ],
        evidence: {
          primary: {
            excerpt: 'License the one-sheet from Warner Bros.',
            source: { title: 'Primary', url: 'https://example.com/p' }
          }
        }
      })
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].source.title).toBe('Primary');
    expect(notes[0].excerpt).toBe('License the one-sheet from Warner Bros.');
  });

  it('replaces chrome-only extracts with a short note', () => {
    const notes = linerNotesForFinding(
      finding({
        supporting_evidence: [{ excerpt: '# Search Records Pre-1978 Records cocatalog.loc.gov', source }]
      })
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].excerpt).toMatch(/page chrome/i);
  });

  it('falls back to two short supporting notes when curation is empty', () => {
    const notes = linerNotesForFinding(
      finding({
        supporting_evidence: [
          { excerpt: 'First usable note.', source },
          { excerpt: 'Second usable note.', source: { title: 'Two', url: 'https://example.com/2' } },
          { excerpt: 'Third should drop.', source: { title: 'Three', url: 'https://example.com/3' } }
        ]
      })
    );
    expect(notes.map((note) => note.excerpt)).toEqual(['First usable note.', 'Second usable note.']);
  });
});
