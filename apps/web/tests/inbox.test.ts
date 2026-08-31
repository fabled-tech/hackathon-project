import { describe, expect, it } from 'vitest';
import type { Case, Finding, ProductionMember } from '@rightsrader/api-client';
import {
  ACTIVE_MEMBER_STORAGE_KEY,
  defaultActiveMemberId,
  inboxCasesForMember,
  pendingFindingsForMember,
  readActiveMemberId,
  writeActiveMemberId
} from '../lib/inbox';

const jordan: ProductionMember = { id: 'm-clearance', name: 'Jordan', role: 'clearance' };
const alex: ProductionMember = { id: 'm-production', name: 'Alex', role: 'production' };
const maya: ProductionMember = { id: 'm-legal', name: 'Maya', role: 'legal' };

function finding(partial: Partial<Finding> & Pick<Finding, 'id' | 'detected_item'>): Finding {
  return {
    case_id: 'c1',
    category: 'brand_reference',
    explanation: 'x',
    confidence: 0.8,
    supporting_evidence: [],
    source_urls: [],
    retrieved_at: '2026-08-30T00:00:00Z',
    reviewer_status: 'pending',
    stakeholder_ids: [jordan.id],
    ...partial
  };
}

function caseWith(findings: Finding[], id = 'c1'): Case {
  return {
    id,
    production_id: 'p1',
    title: 'The Matrix rooftop homage',
    script_text: 'INT. GREENSCREEN...',
    created_at: '2026-08-30T00:00:00Z',
    findings,
    thread: [],
    tool_calls: []
  };
}

describe('defaultActiveMemberId', () => {
  it('prefers clearance over other roles', () => {
    expect(defaultActiveMemberId([alex, maya, jordan])).toBe(jordan.id);
  });

  it('falls back to first roster member when no clearance', () => {
    expect(defaultActiveMemberId([alex, maya])).toBe(alex.id);
  });

  it('returns empty string for empty roster', () => {
    expect(defaultActiveMemberId([])).toBe('');
  });
});

describe('active member storage', () => {
  it('reads a stored id when it is still on the roster', () => {
    const storage = {
      getItem: (key: string) => (key === ACTIVE_MEMBER_STORAGE_KEY ? maya.id : null),
      setItem: () => undefined
    };
    expect(readActiveMemberId(storage, [jordan, maya])).toBe(maya.id);
  });

  it('falls back to default when stored id is missing or unknown', () => {
    const storage = {
      getItem: () => 'ghost',
      setItem: () => undefined
    };
    expect(readActiveMemberId(storage, [jordan, alex])).toBe(jordan.id);
  });

  it('writes the active member id under the stable key', () => {
    const writes: Record<string, string> = {};
    writeActiveMemberId(
      {
        setItem: (key, value) => {
          writes[key] = value;
        }
      },
      jordan.id
    );
    expect(writes[ACTIVE_MEMBER_STORAGE_KEY]).toBe(jordan.id);
  });
});

describe('pendingFindingsForMember / inboxCasesForMember', () => {
  const matrix = caseWith([
    finding({
      id: 'f-matrix',
      detected_item: 'The Matrix',
      category: 'franchise_reference',
      stakeholder_ids: [jordan.id, alex.id]
    }),
    finding({
      id: 'f-spoon',
      detected_item: 'There is no spoon',
      category: 'quotation',
      stakeholder_ids: [jordan.id, maya.id]
    })
  ]);

  it('lists pending findings assigned to clearance (Jordan)', () => {
    expect(pendingFindingsForMember(matrix, jordan.id).map((f) => f.detected_item)).toEqual([
      'The Matrix',
      'There is no spoon'
    ]);
  });

  it('excludes findings that are not pending', () => {
    const escalated = caseWith([
      finding({
        id: 'f1',
        detected_item: 'The Matrix',
        reviewer_status: 'escalated',
        stakeholder_ids: [jordan.id]
      })
    ]);
    expect(pendingFindingsForMember(escalated, jordan.id)).toEqual([]);
    expect(inboxCasesForMember([escalated], jordan.id)).toEqual([]);
  });

  it('excludes findings that do not list the member', () => {
    expect(pendingFindingsForMember(matrix, 'nobody')).toEqual([]);
  });

  it('includes a case in Inbox when at least one pending assignment matches', () => {
    const onlyProductionPending = caseWith(
      [
        finding({
          id: 'f1',
          detected_item: 'The Matrix',
          stakeholder_ids: [jordan.id, alex.id],
          reviewer_status: 'dismissed'
        }),
        finding({
          id: 'f2',
          detected_item: 'Nimbus Soda',
          stakeholder_ids: [alex.id],
          reviewer_status: 'pending'
        })
      ],
      'c2'
    );
    expect(inboxCasesForMember([matrix, onlyProductionPending], jordan.id).map((c) => c.id)).toEqual([
      'c1'
    ]);
    expect(inboxCasesForMember([matrix, onlyProductionPending], alex.id).map((c) => c.id)).toEqual([
      'c1',
      'c2'
    ]);
  });
});
