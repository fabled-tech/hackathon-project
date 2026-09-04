import type { MemoVerdict, ProductionMember } from '@rightsrader/api-client';

export function verdictLabel(verdict: MemoVerdict): string {
  switch (verdict) {
    case 'cleared': return 'Cleared';
    case 'license_required': return 'License required';
    case 'rewrite_recommended': return 'Rewrite recommended';
    case 'needs_human': return 'Needs a human';
  }
}

export function verdictTone(verdict: MemoVerdict): 'cleared' | 'warn' | 'danger' | 'neutral' {
  switch (verdict) {
    case 'cleared': return 'cleared';
    case 'license_required': return 'danger';
    case 'rewrite_recommended': return 'warn';
    case 'needs_human': return 'neutral';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a finding.assignee that may be a roster id or a display name. Never show a raw UUID. */
export function assigneeDisplayName(
  assignee: string | null | undefined,
  roster: readonly Pick<ProductionMember, 'id' | 'name'>[]
): string | null {
  if (!assignee) return null;
  const byId = roster.find((member) => member.id === assignee);
  if (byId) return byId.name;
  const byName = roster.find((member) => member.name === assignee);
  if (byName) return byName.name;
  if (UUID_RE.test(assignee)) return null;
  return assignee;
}

export function memoOwnerName(
  memo: { assigned_member_id?: string | null },
  roster: readonly Pick<ProductionMember, 'id' | 'name'>[]
): string | null {
  if (!memo.assigned_member_id) return null;
  return roster.find((member) => member.id === memo.assigned_member_id)?.name ?? null;
}
