import type { Case, Finding, ProductionMember } from '@rightsrader/api-client';

export const ACTIVE_MEMBER_STORAGE_KEY = 'rightsrader.activeMemberId';

export function defaultActiveMemberId(roster: readonly ProductionMember[]): string {
  const clearance = roster.find((member) => member.role === 'clearance');
  return clearance?.id ?? roster[0]?.id ?? '';
}

export function readActiveMemberId(
  storage: Pick<Storage, 'getItem'>,
  roster: readonly ProductionMember[]
): string {
  const stored = storage.getItem(ACTIVE_MEMBER_STORAGE_KEY);
  if (stored && roster.some((member) => member.id === stored)) {
    return stored;
  }
  return defaultActiveMemberId(roster);
}

export function writeActiveMemberId(
  storage: Pick<Storage, 'setItem'>,
  memberId: string
): void {
  storage.setItem(ACTIVE_MEMBER_STORAGE_KEY, memberId);
}

export function pendingFindingsForMember(caseItem: Case, memberId: string): Finding[] {
  if (!memberId) return [];
  return (caseItem.findings ?? []).filter(
    (finding) =>
      finding.reviewer_status === 'pending' &&
      (finding.stakeholder_ids ?? []).includes(memberId)
  );
}

export function inboxCasesForMember(cases: readonly Case[], memberId: string): Case[] {
  return cases.filter((caseItem) => pendingFindingsForMember(caseItem, memberId).length > 0);
}
