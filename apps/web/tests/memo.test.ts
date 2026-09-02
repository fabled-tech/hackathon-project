import { describe, expect, it } from 'vitest';
import { memoOwnerName, verdictLabel, verdictTone } from '../lib/memo';

describe('memo helpers', () => {
  it('labels verdicts in product language', () => {
    expect(verdictLabel('cleared')).toBe('Cleared');
    expect(verdictLabel('license_required')).toBe('License required');
    expect(verdictLabel('rewrite_recommended')).toBe('Rewrite recommended');
    expect(verdictLabel('needs_human')).toBe('Needs a human');
  });
  it('maps tones', () => {
    expect(verdictTone('cleared')).toBe('cleared');
    expect(verdictTone('license_required')).toBe('danger');
    expect(verdictTone('rewrite_recommended')).toBe('warn');
    expect(verdictTone('needs_human')).toBe('neutral');
  });
  it('resolves the owner name from the roster', () => {
    const roster = [{ id: 'm', name: 'Maya', role: 'legal' as const }];
    expect(memoOwnerName({ assigned_member_id: 'm' }, roster)).toBe('Maya');
    expect(memoOwnerName({ assigned_member_id: 'zzz' }, roster)).toBeNull();
    expect(memoOwnerName({ assigned_member_id: null }, roster)).toBeNull();
  });
});
