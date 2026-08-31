import type { Case, CaseThreadMessage, ToolCallEvent } from '@rightsrader/api-client';

/** Progressive walkthrough reveal of a finished Matrix (or other) case. */
export type DemoRevealStage = 'ready' | 'intake' | 'research' | 'curation' | 'human';

/** Coach step index → pipeline reveal stage (one press advances one stage). */
export const DEMO_REVEAL_BY_STEP: readonly DemoRevealStage[] = [
  'ready',
  'intake',
  'research',
  'curation',
  'human'
] as const;

const AGENTS_BY_STAGE: Record<DemoRevealStage, ReadonlySet<string>> = {
  ready: new Set(),
  intake: new Set(['Intake']),
  research: new Set(['Intake', 'Research']),
  curation: new Set(['Intake', 'Research', 'Curation']),
  human: new Set(['Intake', 'Research', 'Curation'])
};

export function demoRevealStageIndex(stage: DemoRevealStage): number {
  return DEMO_REVEAL_BY_STEP.indexOf(stage);
}

export function workflowStatusForDemoReveal(
  stage: DemoRevealStage
): 'idle' | 'running' | 'complete' {
  if (stage === 'ready') return 'idle';
  if (stage === 'human') return 'complete';
  return 'running';
}

function keepAgentMessage(message: CaseThreadMessage, agents: ReadonlySet<string>): boolean {
  if (message.author_kind !== 'agent') return true;
  return Boolean(message.agent_name && agents.has(message.agent_name));
}

function keepToolCall(call: ToolCallEvent, stage: DemoRevealStage): boolean {
  if (stage === 'ready' || stage === 'intake') return false;
  if (stage === 'research') {
    return call.agent_name === 'Intake' || call.agent_name === 'Research';
  }
  return true;
}

/**
 * Slice a fully analyzed case so the desk/pipeline can play forward on each Next.
 * Findings (with evidence) appear only at curation+.
 */
export function caseForDemoReveal(full: Case, stage: DemoRevealStage): Case | null {
  if (stage === 'ready') return null;

  const agents = AGENTS_BY_STAGE[stage];
  const thread = (full.thread ?? []).filter((message) => keepAgentMessage(message, agents));
  const tool_calls = (full.tool_calls ?? []).filter((call) => keepToolCall(call, stage));
  const showFindings = stage === 'curation' || stage === 'human';

  return {
    ...full,
    thread,
    tool_calls,
    findings: showFindings ? full.findings : []
  };
}
