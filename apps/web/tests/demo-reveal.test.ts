import { describe, expect, it } from 'vitest';
import type { Case, CaseThreadMessage, Finding, ToolCallEvent } from '@rightsrader/api-client';
import {
  caseForDemoReveal,
  DEMO_REVEAL_BY_STEP,
  workflowStatusForDemoReveal
} from '../lib/demo-reveal';

function message(
  partial: Pick<CaseThreadMessage, 'id' | 'agent_name' | 'author_kind' | 'body'>
): CaseThreadMessage {
  return {
    case_id: 'c1',
    created_at: '2026-08-30T00:00:00Z',
    ...partial
  };
}

function finding(id: string, item: string): Finding {
  return {
    id,
    case_id: 'c1',
    category: 'franchise_reference',
    detected_item: item,
    explanation: 'x',
    confidence: 0.9,
    supporting_evidence: [],
    source_urls: ['https://example.com'],
    retrieved_at: '2026-08-30T00:00:00Z',
    reviewer_status: 'pending',
    stakeholder_ids: ['m1']
  };
}

function tool(
  partial: Pick<ToolCallEvent, 'id' | 'agent_name' | 'method'>
): ToolCallEvent {
  return {
    case_id: 'c1',
    provider: 'vertex',
    ok: true,
    summary: 'ok',
    started_at: '2026-08-30T00:00:00Z',
    ...partial
  };
}

const full: Case = {
  id: 'c1',
  script_text: 'INT. GREENSCREEN',
  created_at: '2026-08-30T00:00:00Z',
  title: 'The Matrix rooftop homage',
  findings: [finding('f1', 'The Matrix'), finding('f2', 'There is no spoon')],
  thread: [
    message({ id: 't1', author_kind: 'agent', agent_name: 'Intake', body: 'Detected 2 leads' }),
    message({ id: 't2', author_kind: 'agent', agent_name: 'Research', body: 'Searching' }),
    message({ id: 't3', author_kind: 'agent', agent_name: 'Curation', body: 'Cited' })
  ],
  tool_calls: [
    tool({ id: 'c1', agent_name: 'Research', method: 'plan_queries' }),
    tool({ id: 'c2', agent_name: 'Curation', method: 'curate_evidence' })
  ]
};

describe('demo reveal staging', () => {
  it('maps five coach steps onto ready → human', () => {
    expect(DEMO_REVEAL_BY_STEP).toEqual([
      'ready',
      'intake',
      'research',
      'curation',
      'human'
    ]);
  });

  it('hides the case until intake', () => {
    expect(caseForDemoReveal(full, 'ready')).toBeNull();
    expect(workflowStatusForDemoReveal('ready')).toBe('idle');
  });

  it('reveals Intake thread only before research', () => {
    const sliced = caseForDemoReveal(full, 'intake');
    expect(sliced).not.toBeNull();
    expect(sliced!.thread?.map((m) => m.agent_name)).toEqual(['Intake']);
    expect(sliced!.findings).toEqual([]);
    expect(sliced!.tool_calls).toEqual([]);
    expect(workflowStatusForDemoReveal('intake')).toBe('running');
  });

  it('reveals Research tools before curation findings', () => {
    const sliced = caseForDemoReveal(full, 'research');
    expect(sliced).not.toBeNull();
    expect(sliced!.thread?.map((m) => m.agent_name)).toEqual(['Intake', 'Research']);
    expect(sliced!.tool_calls?.map((c) => c.method)).toEqual(['plan_queries']);
    expect(sliced!.findings).toEqual([]);
  });

  it('reveals findings at curation and marks pipeline complete at human', () => {
    const curated = caseForDemoReveal(full, 'curation');
    expect(curated).not.toBeNull();
    expect(curated!.findings.map((f) => f.detected_item)).toEqual([
      'The Matrix',
      'There is no spoon'
    ]);
    expect(curated!.thread).toHaveLength(3);
    expect(workflowStatusForDemoReveal('human')).toBe('complete');
    expect(caseForDemoReveal(full, 'human')?.findings).toHaveLength(2);
  });
});
