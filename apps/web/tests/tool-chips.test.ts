import { describe, expect, it } from 'vitest';
import { chipMethodLabel } from '../lib/tool-chips';

describe('chipMethodLabel', () => {
  it('maps judge_grounded to memo_grounded so desk chips never say judge', () => {
    expect(chipMethodLabel('judge_grounded')).toBe('memo_grounded');
  });

  it('leaves search_authoritative unchanged for e2e selectors', () => {
    expect(chipMethodLabel('search_authoritative')).toBe('search_authoritative');
  });
});
