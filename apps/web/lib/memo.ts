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

export function memoOwnerName(
  memo: { assigned_member_id?: string | null },
  roster: readonly Pick<ProductionMember, 'id' | 'name'>[]
): string | null {
  if (!memo.assigned_member_id) return null;
  return roster.find((member) => member.id === memo.assigned_member_id)?.name ?? null;
}
