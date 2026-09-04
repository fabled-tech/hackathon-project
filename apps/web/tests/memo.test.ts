import { describe, expect, it } from 'vitest';
import { assigneeDisplayName, memoOwnerName, verdictLabel, verdictTone } from '../lib/memo';

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
  it('never prints a raw roster UUID as the assignee', () => {
    const roster = [{ id: '90254cbb-4b36-4594-adda-f5752e21e796', name: 'Jordan', role: 'clearance' as const }];
    expect(assigneeDisplayName(roster[0].id, roster)).toBe('Jordan');
    expect(assigneeDisplayName('Jordan', roster)).toBe('Jordan');
    expect(assigneeDisplayName('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', roster)).toBeNull();
    expect(assigneeDisplayName(null, roster)).toBeNull();
  });
});
