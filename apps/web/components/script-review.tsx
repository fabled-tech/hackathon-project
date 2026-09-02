'use client';

import {
  createCase,
  createCaseFromFile,
  getCase,
  listAssets,
  listCases,
  postThreadMessage,
  type Asset,
  type Case,
  type CaseSummary,
  type CaseThreadMessage,
  type Finding,
  type ProductionMember,
  type ReviewerStatus,
  type ToolCallEvent,
  uploadAsset,
  updateFindingStatus
} from '@rightsrader/api-client';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CircleAlert,
  FileSearch,
  FileText,
  FileUp,
  Globe2,
  Loader2,
  Radar,
  Scale,
  Sparkles,
  UserRound
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { FEATURED_DEMO_SCRIPTS } from '@/lib/demo-mode';
import {
  caseForDemoReveal,
  workflowStatusForDemoReveal,
  type DemoRevealStage
} from '@/lib/demo-reveal';
import { fetchHealth, modeBadgeLabel, type ApiHealth } from '@/lib/health';
import { writeActiveMemberId } from '@/lib/inbox';
import { memoOwnerName, verdictLabel, verdictTone } from '@/lib/memo';

const SAMPLE_SCRIPT = FEATURED_DEMO_SCRIPTS[0].script;
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

function statusLabel(status: ReviewerStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function isQuotaError(error: unknown): boolean {
  return error instanceof Error && /\(429\)/.test(error.message);
}

function fileSizeLabel(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} bytes`;
  return `${(byteSize / 1024).toFixed(1)} KiB`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

const STATUS_STYLES: Record<ReviewerStatus, string> = {
  pending: 'border-ink text-ink bg-white',
  dismissed: 'border-muted bg-lavender-pale text-muted',
  escalated: 'border-accent bg-accent text-white shadow-[3px_3px_0_#150a30]',
  accepted: 'border-ink bg-brand text-ink'
};

const STATUS_LABELS: Record<ReviewerStatus, string> = {
  pending: 'Pending',
  dismissed: 'Dismissed',
  escalated: '⚡ Escalated',
  accepted: '✓ Cleared'
};

function StatusStamp({
  status,
  animate = false
}: {
  status: ReviewerStatus;
  animate?: boolean;
}) {
  return (
    <span
      className={`inline-block shrink-0 ${animate ? 'animate-stamp-slam' : 'rotate-2'}`}
      data-testid="status-stamp"
      data-status={status}
      data-animate={animate ? 'true' : 'false'}
    >
      <span
        className={`inline-flex items-center border-2 px-2.5 py-1 font-display text-[10px] uppercase ${
          STATUS_STYLES[status] ?? STATUS_STYLES.pending
        }`}
      >
        {STATUS_LABELS[status] ?? statusLabel(status)}
      </span>
    </span>
  );
}

function Spinner({ className = 'size-4' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden />;
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section
      className="relative overflow-clip border-2 border-line p-6"
      style={{
        backgroundImage:
          'radial-gradient(53.6px 53.5px at 60px 46px, rgb(255 46 154 / 0.28), transparent 45%), radial-gradient(53.2px 53.1px at calc(100% - 40px) calc(100% - 69px), rgb(0 229 255 / 0.24), transparent 50%), linear-gradient(90deg, #2a0f4a, #2a0f4a)'
      }}
    >
      {children}
    </section>
  );
}

function PixelLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-pixel text-[11px] leading-relaxed tracking-[0.14em] text-cyan-pop [text-shadow:0_0_12px_rgb(0_229_255/0.45)]">
      {children}
    </p>
  );
}

function PrimaryButton({
  children,
  disabled,
  type = 'submit',
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex shrink-0 items-center gap-2 border-2 border-ink bg-gradient-to-b from-brand-soft via-brand to-brand-strong px-3 py-2 font-display text-[10px] text-ink shadow-press transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  disabled,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex shrink-0 items-center gap-1.5 border-2 border-ink bg-white px-3 py-2 font-display text-[10px] text-ink shadow-press transition hover:bg-exhibit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function EscalateButton({
  children,
  disabled,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex shrink-0 items-center gap-1.5 border-2 border-ink bg-gradient-to-b from-accent-soft via-accent to-accent-strong px-3 py-2 font-display text-[10px] text-white shadow-press [text-shadow:0_1px_1px_rgb(0_0_0/0.3)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

type AgentWorkflowStatus = 'idle' | 'running' | 'complete' | 'failed';

function threadHasAgent(thread: CaseThreadMessage[] | undefined, name: string): boolean {
  return (thread ?? []).some((message) => message.agent_name === name);
}

function AgentPipeline({
  status,
  result,
  revealStage,
  health
}: {
  status: AgentWorkflowStatus;
  result: Case | null;
  /** When set (demo walkthrough), light stages one-by-one instead of all-complete. */
  revealStage?: DemoRevealStage | null;
  health: ApiHealth | null;
}) {
  const findings = result?.findings ?? [];
  const thread = result?.thread ?? [];
  const citedSources = new Set(
    findings.flatMap((finding) => finding.source_urls)
  ).size;
  const curatedSources = findings.filter(
    (finding) => finding.evidence?.primary
  ).length;
  const memos = findings.filter((finding) => finding.memo != null).length;
  const hasAdjudicator =
    memos > 0 ||
    threadHasAgent(thread, 'Adjudicator') ||
    (result?.tool_calls ?? []).some((call) => call.agent_name === 'Adjudicator') ||
    revealStage === 'adjudication';
  const revealIndex =
    revealStage === 'intake' ? 0
    : revealStage === 'research' ? 1
    : revealStage === 'curation' ? 2
    : revealStage === 'adjudication' ? 3
    : revealStage === 'human' ? (hasAdjudicator ? 3 : 2)
    : -1;
  const stages = [
    { name: 'Gemini Intake', description: 'Vertex Gemini detects clearance leads.', icon: <Sparkles className="size-3.5" aria-hidden />, output: `${findings.length} ${findings.length === 1 ? 'lead' : 'leads'} detected`, done: revealStage != null ? revealIndex >= 0 : threadHasAgent(thread, 'Intake') || status === 'complete' },
    { name: 'Parallel Research', description: 'Vertex plan/brief plus Parallel Search xN and Extract.', icon: <Globe2 className="size-3.5" aria-hidden />, output: `${citedSources} ${citedSources === 1 ? 'source' : 'sources'} verified`, done: revealStage != null ? revealIndex >= 1 : threadHasAgent(thread, 'Research') || status === 'complete' },
    { name: 'Gemini Curation', description: 'Vertex Gemini cites only extracted URLs.', icon: <FileSearch className="size-3.5" aria-hidden />, output: `${curatedSources} primary ${curatedSources === 1 ? 'source' : 'sources'} selected`, done: revealStage != null ? revealIndex >= 2 : threadHasAgent(thread, 'Curation') || status === 'complete' },
    ...(hasAdjudicator
      ? [{
          name: 'Clearance Adjudicator',
          description: 'ADK agents argue competing readings on Parallel; Gemini writes a grounded Clearance Memo.',
          icon: <Scale className="size-3.5" aria-hidden />,
          output: `${memos} ${memos === 1 ? 'memo' : 'memos'} issued`,
          done: revealStage != null ? revealIndex >= 3 : threadHasAgent(thread, 'Adjudicator') || status === 'complete'
        }]
      : [])
  ];

  return (
    <section
      className="mt-4 border-2 border-line bg-panel p-4"
      aria-label="Case agent pipeline"
      data-testid="agent-pipeline"
      data-reveal-stage={revealStage ?? undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-pixel text-[8px] tracking-[0.16px] text-cyan-pop">
            CASE AGENT PIPELINE
          </p>
          <p className="mt-1 text-[10.5px] leading-4 text-lavender-soft">
            Intake → Research (Parallel Search ×N + Extract) → Curation → Adjudicator (ADK
            multi-agent) → your call. Every model and search call is logged under the message
            that made it.
          </p>
        </div>
        <span
          className={`border px-2 py-1 font-pixel text-[7px] ${
            status === 'complete'
              ? 'border-brand text-brand'
              : status === 'failed'
                ? 'border-accent text-accent'
                : status === 'running'
                  ? 'border-cyan-pop text-cyan-pop'
                  : 'border-line-strong text-lavender'
          }`}
          aria-live="polite"
        >
          {status === 'running'
            ? 'WORKING'
            : status === 'complete'
              ? 'COMPLETE'
              : status === 'failed'
                ? 'RETRY NEEDED'
                : 'READY'}
        </span>
        <span className={`border px-2 py-1 font-pixel text-[7px] ${health?.mode === 'cloud' ? 'border-brand text-brand' : 'border-line-strong text-lavender'}`} data-testid="mode-badge">
          {modeBadgeLabel(health)}
        </span>
      </div>

      <ol className={`mt-4 grid gap-2 lg:items-stretch ${stages.length === 4 ? 'lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]' : 'lg:grid-cols-[1fr_auto_1fr_auto_1fr]'}`}>
        {stages.map((stage, index) => {
            const isCurrent =
              revealStage != null && revealIndex === index && status === 'running';
            return (
            <li key={stage.name} className="contents">
              <div
                className={`border-2 p-3 transition ${
                  stage.done
                    ? 'border-brand/70 bg-brand/5'
                    : isCurrent
                      ? 'animate-pulse border-cyan-pop/70 bg-cyan-pop/5'
                      : status === 'failed'
                        ? 'border-accent/70 bg-danger-bg'
                        : 'border-line bg-canvas/20'
                }`}
                data-pipeline-stage={stage.name}
                data-pipeline-done={stage.done ? 'true' : 'false'}
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center border border-line bg-canvas text-cyan-pop">
                    {stage.done ? (
                      <Check className="size-3.5 text-brand" aria-hidden />
                    ) : isCurrent ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      stage.icon
                    )}
                  </span>
                  <span className="font-display text-[9px] text-paper">{stage.name}</span>
                </div>
                <p className="mt-2 text-[9.5px] leading-4 text-lavender-soft">
                  {stage.description}
                </p>
                {stage.done ? (
                  <p className="mt-2 font-pixel text-[7px] leading-3 text-brand">
                    {stage.output}
                  </p>
                ) : null}
              </div>
              {index < stages.length - 1 ? (
                <ArrowRight
                  className="mx-auto hidden size-4 self-center text-cyan-pop lg:block"
                  aria-hidden
                />
              ) : null}
            </li>
            );
          })}
        </ol>
      </section>
  );
}

function memberById(
  roster: ProductionMember[],
  memberId: string | null | undefined
): ProductionMember | undefined {
  return roster.find((member) => member.id === memberId);
}

function humanInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

function humanAvatarTone(name: string): string {
  const tones = [
    'bg-brand text-ink border-ink',
    'bg-[#7ee787] text-ink border-ink',
    'bg-[#ffb454] text-ink border-ink',
    'bg-accent-soft text-ink border-accent',
    'bg-[#79c0ff] text-ink border-ink'
  ] as const;
  let hash = 0;
  for (const char of name) {
    hash = (hash + char.charCodeAt(0) * 17) % tones.length;
  }
  return tones[hash]!;
}

function HumanAvatar({
  name,
  size = 'md'
}: {
  name: string;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'size-6 text-[8px]' : 'size-9 text-[10px]';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center border-2 font-display ${dim} ${humanAvatarTone(name)}`}
      data-testid="human-avatar"
      title={`${name} · human`}
      aria-hidden
    >
      {humanInitials(name)}
    </span>
  );
}

function AgentAvatar({
  agentName,
  size = 'md'
}: {
  agentName: string;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'size-6' : 'size-9';
  const iconClass = size === 'sm' ? 'size-3.5' : 'size-4';
  const normalized = agentName.trim().toLowerCase();
  let Icon = Bot;
  if (normalized === 'intake') Icon = Sparkles;
  if (normalized === 'research') Icon = Radar;
  if (normalized === 'curation') Icon = FileSearch;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center border-2 border-cyan-pop bg-[#0b1220] text-cyan-pop ${dim}`}
      data-testid="agent-avatar"
      data-agent={agentName}
      title={`${agentName} · agent`}
      aria-hidden
    >
      <Icon className={iconClass} strokeWidth={2.25} />
    </span>
  );
}

function FindingStakeholders({
  finding,
  roster,
  emphasize = false,
  animate = false
}: {
  finding: Finding;
  roster: ProductionMember[];
  emphasize?: boolean;
  animate?: boolean;
}) {
  const members = (finding.stakeholder_ids ?? [])
    .map((id) => roster.find((member) => member.id === id))
    .filter((member): member is ProductionMember => Boolean(member));
  if (members.length === 0) return null;

  if (emphasize) {
    return (
      <div
        className={`mt-3 border-2 border-accent bg-accent-soft p-3 shadow-[4px_4px_0_#ff2e9a] ${
          animate ? 'animate-stakeholder-pop' : ''
        }`}
        data-testid="research-stakeholders"
        data-emphasized="true"
      >
        <p className="font-pixel text-[8px] tracking-[0.16px] text-accent-strong">
          ESCALATED TO THESE HUMANS
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {members.map((member) => (
            <li
              key={member.id}
              className="inline-flex items-center gap-1.5 border-2 border-ink bg-white px-2 py-1 text-ink"
            >
              <HumanAvatar name={member.name} size="sm" />
              <span className="font-display text-[10px] uppercase">{member.name}</span>
              <span className="font-pixel text-[6px] text-accent-strong">{member.role}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <p className="mt-1 text-[10px] text-lavender-soft" data-testid="research-stakeholders">
      Research stakeholders:{' '}
      {members.map((member) => member.name).join(', ')}
    </p>
  );
}

function assignToolCallChips(
  thread: CaseThreadMessage[],
  toolCalls: ToolCallEvent[]
): Map<string, ToolCallEvent[]> {
  const assigned = new Set<string>();
  const byMessage = new Map<string, ToolCallEvent[]>();

  for (const message of thread) {
    const matched = toolCalls.filter((call) => {
      if (assigned.has(call.id)) return false;
      if (message.author_kind !== 'agent') return false;
      if (call.agent_name !== message.agent_name) return false;
      if (call.lead) return message.body.includes(call.lead);
      return message.agent_name === 'Intake';
    });
    for (const call of matched) assigned.add(call.id);
    byMessage.set(message.id, matched);
  }

  for (const call of toolCalls) {
    if (assigned.has(call.id)) continue;
    const host =
      [...thread]
        .reverse()
        .find((message) => message.author_kind === 'agent' && message.agent_name === call.agent_name) ??
      thread.find((message) => message.author_kind === 'agent');
    if (!host) continue;
    byMessage.set(host.id, [...(byMessage.get(host.id) ?? []), call]);
  }
  return byMessage;
}

function ToolCallChips({ calls }: { calls: ToolCallEvent[] }) {
  if (calls.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1" data-testid="tool-call-chips">
      {calls.map((call) => (
        <li
          key={call.id}
          className="border border-[#3d4f66] bg-[#0b1220] px-1.5 py-0.5 font-mono text-[9px] text-[#9ecbff]"
          data-testid="tool-call-chip"
          data-provider={call.provider}
          data-method={call.method}
        >
          <span className="text-[#ffb454]">{call.provider.toUpperCase()}</span>{' '}
          {call.method}
          {call.fixture ? ' · fixture' : ' · live'}
          <span className={call.ok ? ' text-[#7ee787]' : ' text-[#ff7b72]'}>
            {call.ok ? ' OK' : ' FAIL'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function JudgeLogRail({ calls }: { calls: ToolCallEvent[] }) {
  const vertexCount = calls.filter((call) => call.provider === 'vertex').length;
  const parallelCount = calls.filter((call) => call.provider === 'parallel').length;
  return (
    <aside
      className="flex h-full min-h-[24rem] flex-col border-2 border-[#3d4f66] bg-[#0b1220] text-[#c9d1d9] shadow-[4px_4px_0_#ffb454]"
      data-testid="judge-log"
      aria-label="Agent tool-call log"
    >
      <div className="border-b border-[#3d4f66] px-3 py-2.5">
        <p className="font-mono text-[10px] font-semibold tracking-wide text-[#ffb454]">AGENT TOOL LOG</p>
        <p className="mt-1 font-mono text-[10px] leading-4 text-[#8b949e]">
          Every Vertex Gemini, ADK, and Parallel call this case made, in order. No secrets or
          response bodies. Offline runs are marked <span className="text-[#d2a8ff]">fixture</span>;
          live runs are marked <span className="text-[#7ee787]">live</span>.
        </p>
        <p className="mt-2 font-mono text-[10px] text-[#7ee787]">
          {calls.length} calls · vertex={vertexCount} · parallel={parallelCount}
        </p>
      </div>
      {calls.length === 0 ? (
        <p className="px-3 py-4 font-mono text-[11px] text-[#8b949e]">
          Waiting for tool calls after analyze…
        </p>
      ) : (
        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2 font-mono text-[11px] leading-4">
          {calls.map((call, index) => (
            <li
              key={call.id}
              className="border border-[#30363d] bg-[#161b22] px-2 py-1.5"
              data-provider={call.provider}
              data-method={call.method}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="tabular-nums text-[#8b949e]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="font-semibold text-[#ffb454]">
                  {call.provider.toUpperCase()}
                </span>
                <span className="text-[#79c0ff]">{call.method}</span>
                <span className={call.ok ? 'text-[#7ee787]' : 'text-[#ff7b72]'}>
                  {call.ok ? 'OK' : 'FAIL'}
                </span>
                <span className="tabular-nums text-[#8b949e]">{call.duration_ms}ms</span>
                <span className={call.fixture ? 'text-[#d2a8ff]' : 'text-[#7ee787]'}>{call.fixture ? 'fixture' : 'live'}</span>
              </div>
              <p className="mt-1 text-[#c9d1d9]">
                <span className="text-[#8b949e]">{call.agent_name}</span>
                {call.lead ? <span className="text-[#8b949e]"> · {call.lead}</span> : null}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-[#9ecbff]">{call.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function CaseDesk({
  result,
  roster,
  actingMemberId,
  onActingMemberId,
  reply,
  onReplyChange,
  onReply,
  isReplying,
  onChangeStatus,
  updatingFindingId
}: {
  result: Case;
  roster: ProductionMember[];
  actingMemberId: string;
  onActingMemberId: (id: string) => void;
  reply: string;
  onReplyChange: (value: string) => void;
  onReply: () => void;
  isReplying: boolean;
  onChangeStatus: (finding: Finding, status: ReviewerStatus) => void;
  updatingFindingId: string | null;
}) {
  const thread = result.thread ?? [];
  const chipsByMessage = assignToolCallChips(thread, result.tool_calls ?? []);
  const actingMember = memberById(roster, actingMemberId);
  const threadEndRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [thread.length]);
  return (
    <section
      className="flex h-full min-h-0 flex-col border-2 border-line bg-panel p-4"
      data-testid="case-desk"
    >
      <p className="font-pixel text-[8px] tracking-[0.16px] text-cyan-pop">
        CASE DESK · GROUP THREAD
      </p>
      <p className="mt-1 text-[10.5px] leading-4 text-lavender-soft">
        This is the group chat. Agents and roster humans post here. Dismiss / Escalate posts as
        whoever you are acting as — same thread, not a separate queue.
      </p>
      {roster.length > 0 ? (
        <ul
          className="mt-3 flex flex-wrap gap-1.5"
          data-testid="demo-coach-roster"
        >
          {roster.map((member) => (
            <li
              key={member.id}
              className="inline-flex items-center gap-1.5 border border-line bg-canvas/40 py-1 pl-1 pr-2 font-pixel text-[7px] text-lavender"
            >
              <HumanAvatar name={member.name} size="sm" />
              {member.name} · {member.role}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 min-h-0 flex-1" data-testid="demo-coach-stakeholders">
      <ol
        className="max-h-[min(34rem,calc(100vh-16rem))] space-y-2 overflow-y-auto pr-1"
        data-testid="case-thread"
      >
        {thread.map((message, index) => {
          const human = memberById(roster, message.member_id);
          const isAgent = message.author_kind === 'agent';
          const agentName = message.agent_name ?? 'Agent';
          const humanName = human?.name ?? 'Teammate';
          const author = isAgent
            ? agentName
            : human
              ? `${human.name} (${human.role})`
              : 'Teammate';
          const finding = result.findings.find((item) => item.id === message.finding_id);
          const isLatest = index === thread.length - 1;
          return (
            <li
              key={message.id}
              ref={isLatest ? threadEndRef : undefined}
              className={`border p-2.5 ${
                message.author_kind === 'human'
                  ? 'border-brand bg-brand/10'
                  : 'border-line bg-canvas/30'
              }`}
              data-author-kind={message.author_kind}
            >
              <div className="flex items-start gap-2.5">
                {isAgent ? (
                  <AgentAvatar agentName={agentName} />
                ) : human ? (
                  <HumanAvatar name={humanName} />
                ) : (
                  <span
                    className="inline-flex size-9 shrink-0 items-center justify-center border-2 border-brand bg-brand text-ink"
                    data-testid="human-avatar"
                    aria-hidden
                  >
                    <UserRound className="size-4" strokeWidth={2.25} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p
                      className={`font-pixel text-[7px] uppercase tracking-[0.16px] ${
                        isAgent ? 'text-cyan-pop' : 'text-brand'
                      }`}
                    >
                      {author}
                    </p>
                    <span
                      className={`border px-1 py-0.5 font-pixel text-[6px] tracking-[0.12em] ${
                        isAgent
                          ? 'border-cyan-pop/60 text-cyan-pop'
                          : 'border-brand/70 text-brand'
                      }`}
                    >
                      {isAgent ? 'AGENT' : 'HUMAN'}
                    </span>
                  </div>
                  <p className="mt-1 text-[10.5px] leading-4 text-paper">{message.body}</p>
                  <ToolCallChips calls={chipsByMessage.get(message.id) ?? []} />
                  {finding ? (
                    <p className="mt-1 text-[9px] text-lavender-soft">
                      On {finding.detected_item}
                      {finding.stakeholder_ids?.length
                        ? ` · ${finding.stakeholder_ids
                            .map((id) => memberById(roster, id)?.name)
                            .filter(Boolean)
                            .join(', ')}`
                        : ''}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      </div>
      {roster.length > 0 ? (
        <>
        <form
          className="mt-3 space-y-2 border-t border-line pt-3"
          data-testid="demo-coach-composer"
          onSubmit={(event) => {
            event.preventDefault();
            onReply();
          }}
        >
          <label className="block font-pixel text-[7px] text-line-strong" htmlFor="act-as-member">
            Acting as
          </label>
          <div className="flex items-center gap-2">
            {actingMember ? <HumanAvatar name={actingMember.name} size="sm" /> : null}
            <select
              id="act-as-member"
              value={actingMemberId}
              onChange={(event) => onActingMemberId(event.target.value)}
              className="block w-full border-2 border-ink bg-white px-2 py-1.5 text-[11px] text-ink"
            >
              {roster.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} ({member.role})
                </option>
              ))}
            </select>
          </div>
          <textarea
            aria-label="Desk reply"
            value={reply}
            onChange={(event) => onReplyChange(event.target.value)}
            rows={2}
            className="block w-full border-2 border-ink bg-white px-2 py-1.5 text-[11px] text-ink"
            placeholder="Reply in the desk thread…"
          />
          <PrimaryButton disabled={isReplying || reply.trim().length === 0}>
            {isReplying ? 'Posting…' : 'Post to desk'}
          </PrimaryButton>
        </form>
        <div className="mt-2 space-y-1.5" data-testid="demo-coach-actions">
          <p className="font-pixel text-[7px] text-line-strong">
            ACTIONS POST INTO THIS THREAD
          </p>
          <div className="flex flex-wrap gap-2">
            {result.findings.map((finding) => (
              <span key={finding.id} className="flex gap-1">
                <SecondaryButton
                  disabled={updatingFindingId === finding.id}
                  onClick={() => onChangeStatus(finding, 'dismissed')}
                >
                  Dismiss {finding.detected_item}
                </SecondaryButton>
                <EscalateButton
                  disabled={updatingFindingId === finding.id}
                  onClick={() => onChangeStatus(finding, 'escalated')}
                >
                  Escalate {finding.detected_item}
                </EscalateButton>
              </span>
            ))}
          </div>
        </div>
        </>
      ) : (
        <p className="mt-3 text-[10px] text-lavender-soft">
          Add roster members on the production to speak in this thread.
        </p>
      )}
    </section>
  );
}

export function ScriptReview({
  productionId,
  roster = [],
  activeMemberId,
  onActiveMemberChange,
  onCaseCreated,
  onCaseUpdated,
  initialCase = null,
  focusTour = false,
  demoWalkthrough = null
}: {
  productionId?: string;
  roster?: ProductionMember[];
  activeMemberId?: string;
  onActiveMemberChange?: (memberId: string) => void;
  onCaseCreated?: () => void;
  onCaseUpdated?: (caseResult: Case) => void;
  initialCase?: Case | null;
  focusTour?: boolean;
  /** Staged Matrix (or other) walkthrough — parent advances revealStage on each coach Next. */
  demoWalkthrough?: {
    fullCase: Case;
    stage: DemoRevealStage;
  } | null;
} = {}) {
  const [scriptText, setScriptText] = useState(
    demoWalkthrough?.fullCase.script_text ?? initialCase?.script_text ?? SAMPLE_SCRIPT
  );
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [showToolLog, setShowToolLog] = useState(false);
  const [caseResult, setCaseResult] = useState<Case | null>(initialCase);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [recentCases, setRecentCases] = useState<CaseSummary[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [agentWorkflowStatus, setAgentWorkflowStatus] =
    useState<AgentWorkflowStatus>(initialCase ? 'complete' : 'idle');
  const displayCase = demoWalkthrough
    ? caseForDemoReveal(demoWalkthrough.fullCase, demoWalkthrough.stage)
    : caseResult;
  const workingCase = demoWalkthrough?.fullCase ?? caseResult;
  const displayWorkflowStatus: AgentWorkflowStatus = demoWalkthrough
    ? workflowStatusForDemoReveal(demoWalkthrough.stage)
    : agentWorkflowStatus;
  const pipelineCase = demoWalkthrough
    ? demoWalkthrough.stage === 'ready'
      ? null
      : demoWalkthrough.fullCase
    : caseResult;
  const filedTitle =
    demoWalkthrough?.fullCase.title ?? displayCase?.title ?? caseResult?.title;
  const showWalkthroughChrome = Boolean(demoWalkthrough);
  const showDeskColumns = Boolean(displayCase || showWalkthroughChrome);
  const [isLoadingRecentCases, setIsLoadingRecentCases] = useState(false);
  const [isLoadingCaseId, setIsLoadingCaseId] = useState<string | null>(null);
  const [updatingFindingId, setUpdatingFindingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rosterDefaultId =
    roster.find((member) => member.role === 'clearance')?.id || roster[0]?.id || '';
  const actingMemberId =
    (activeMemberId && roster.some((member) => member.id === activeMemberId)
      ? activeMemberId
      : null) ?? rosterDefaultId;
  const setActingMemberId = (memberId: string) => {
    writeActiveMemberId(window.localStorage, memberId);
    onActiveMemberChange?.(memberId);
  };
  const [deskReply, setDeskReply] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [stampBurstId, setStampBurstId] = useState<string | null>(null);
  const stampBurstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisFileInputRef = useRef<HTMLInputElement>(null);
  const caseOperationGeneration = useRef(0);
  const activeCaseIdRef = useRef<string | null>(initialCase?.id ?? null);
  const submissionGeneration = useRef(0);
  const uploadGeneration = useRef(0);
  const fileAnalysisGeneration = useRef(0);
  const caseLoadingGeneration = useRef(0);

  useEffect(() => {
    let alive = true;
    fetchHealth(API_BASE_URL).then((h) => {
      if (alive) setHealth(h);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function submitScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operationGeneration = ++caseOperationGeneration.current;
    const requestGeneration = ++submissionGeneration.current;
    setIsSubmitting(true);
    setAgentWorkflowStatus('running');
    setError(null);
    try {
      const nextCase = await createCase(
        { script_text: scriptText, production_id: productionId ?? null },
        API_BASE_URL
      );
      if (caseOperationGeneration.current !== operationGeneration) {
        return;
      }
      activeCaseIdRef.current = nextCase.id;
      setCaseResult(nextCase);
      setAgentWorkflowStatus('complete');
      setAssets([]);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onCaseCreated?.();
    } catch (caught) {
      if (caseOperationGeneration.current === operationGeneration) {
        setAgentWorkflowStatus('failed');
        setError(
          isQuotaError(caught)
            ? 'Daily live-analysis budget reached. Open a pre-analyzed demo case or try again tomorrow.'
            : 'RightsRadar could not analyze this script right now. Please try again.'
        );
      }
    } finally {
      if (submissionGeneration.current === requestGeneration) {
        setIsSubmitting(false);
      }
    }
  }

  async function submitAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caseResult || !selectedFile) return;
    const caseId = caseResult.id;
    const operationGeneration = caseOperationGeneration.current;
    const requestGeneration = ++uploadGeneration.current;
    setIsUploading(true);
    setError(null);
    try {
      await uploadAsset(caseId, selectedFile, API_BASE_URL);
      const nextAssets = await listAssets(caseId, API_BASE_URL);
      if (
        caseOperationGeneration.current !== operationGeneration ||
        activeCaseIdRef.current !== caseId
      ) {
        return;
      }

      setAssets(nextAssets);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      if (
        caseOperationGeneration.current === operationGeneration &&
        activeCaseIdRef.current === caseId
      ) {
        setError('The asset could not be uploaded. Use a plain-text file no larger than 256 KiB.');
      }
    } finally {
      if (uploadGeneration.current === requestGeneration) {
        setIsUploading(false);
      }
    }
  }

  async function submitAnalysisFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productionId || !analysisFile) return;
    const operationGeneration = ++caseOperationGeneration.current;
    const requestGeneration = ++fileAnalysisGeneration.current;
    setIsAnalyzingFile(true);
    setAgentWorkflowStatus('running');
    setError(null);
    try {
      const nextCase = await createCaseFromFile(
        productionId,
        analysisFile,
        API_BASE_URL
      );
      const nextAssets = await listAssets(nextCase.id, API_BASE_URL);
      if (caseOperationGeneration.current !== operationGeneration) return;
      activeCaseIdRef.current = nextCase.id;
      setScriptText(nextCase.script_text);
      setCaseResult(nextCase);
      setAgentWorkflowStatus('complete');
      setAssets(nextAssets);
      setAnalysisFile(null);
      setSelectedFile(null);
      if (analysisFileInputRef.current) analysisFileInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
      onCaseCreated?.();
    } catch (caught) {
      if (caseOperationGeneration.current === operationGeneration) {
        setAgentWorkflowStatus('failed');
        setError(
          isQuotaError(caught)
            ? 'Daily live-analysis budget reached. Open a pre-analyzed demo case or try again tomorrow.'
            : 'RightsRadar could not analyze this file. Use a PDF, DOCX, PNG, JPEG, or WebP file up to 10 MiB.'
        );
      }
    } finally {
      if (fileAnalysisGeneration.current === requestGeneration) {
        setIsAnalyzingFile(false);
      }
    }
  }

  async function refreshRecentCases() {
    setIsLoadingRecentCases(true);
    setError(null);
    try {
      setRecentCases(await listCases(10, API_BASE_URL));
    } catch {
      setError('Recent cases could not be loaded. Please try again.');
    } finally {
      setIsLoadingRecentCases(false);
    }
  }

  async function reopenCase(caseId: string) {
    const operationGeneration = ++caseOperationGeneration.current;
    const requestGeneration = ++caseLoadingGeneration.current;
    setIsLoadingCaseId(caseId);
    setError(null);
    try {
      const nextCase = await getCase(caseId, API_BASE_URL);
      const nextAssets = await listAssets(caseId, API_BASE_URL);
      if (caseOperationGeneration.current !== operationGeneration) {
        return;
      }
      activeCaseIdRef.current = caseId;
      setScriptText(nextCase.script_text);
      setCaseResult(nextCase);
      setAgentWorkflowStatus('complete');
      setAssets(nextAssets);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      if (caseOperationGeneration.current === operationGeneration) {
        setError('This case could not be reopened. Please try again.');
      }
    } finally {
      if (caseLoadingGeneration.current === requestGeneration) {
        setIsLoadingCaseId(null);
      }
    }
  }

  async function changeStatus(finding: Finding, reviewerStatus: ReviewerStatus) {
    if (!workingCase) return;
    if (roster.length > 0 && !actingMemberId) {
      setError('Pick who you are acting as before dismissing or escalating in the desk thread.');
      return;
    }
    setUpdatingFindingId(finding.id);
    setError(null);
    try {
      await updateFindingStatus(
        workingCase.id,
        finding.id,
        reviewerStatus,
        API_BASE_URL,
        fetch,
        actingMemberId || null
      );
      const nextCase = await getCase(workingCase.id, API_BASE_URL);
      setCaseResult(nextCase);
      onCaseUpdated?.(nextCase);
      if (stampBurstTimer.current) {
        clearTimeout(stampBurstTimer.current);
      }
      setStampBurstId(finding.id);
      stampBurstTimer.current = setTimeout(() => {
        setStampBurstId((current) => (current === finding.id ? null : current));
      }, 900);
      const card = document.querySelector(
        `[data-testid="finding-card"][data-finding-id="${finding.id}"]`
      );
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (reviewerStatus === 'escalated') {
        window.setTimeout(() => {
          document
            .querySelector('[data-testid="case-desk"]')
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 650);
      }
    } catch {
      setError('The reviewer status could not be saved. Please try again.');
    } finally {
      setUpdatingFindingId(null);
    }
  }

  async function postDeskReply() {
    if (!workingCase || !actingMemberId || !deskReply.trim()) return;
    setIsReplying(true);
    setError(null);
    try {
      const nextCase = await postThreadMessage(
        workingCase.id,
        { member_id: actingMemberId, body: deskReply.trim() },
        API_BASE_URL
      );
      setCaseResult(nextCase);
      onCaseUpdated?.(nextCase);
      setDeskReply('');
    } catch {
      setError('The desk reply could not be posted. Please try again.');
    } finally {
      setIsReplying(false);
    }
  }

  return (
    <div className="w-full">
      <main className="w-full pb-10 pt-1">
        <div className="flex flex-wrap items-end justify-between gap-3 pb-4">
          <div>
            <PixelLabel>Rights clearance desk</PixelLabel>
            <h1 className="mt-1 font-display text-xl text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4] sm:text-2xl">
              Case workspace
            </h1>
            {focusTour || showWalkthroughChrome ? (
              <p className="mt-1 max-w-2xl text-[11px] leading-4 text-paper">
                Walkthrough: press <strong>Run next stage</strong> to advance Intake → Research →
                Curation → Adjudicator. The highlighted panel is the current beat.
              </p>
            ) : (
              <p className="mt-1 max-w-2xl text-[11px] leading-4 text-lavender-soft">
                Left: file the scene and work the desk thread. Center: findings and clearance
                memos. Right: recent cases, plus the agent tool log when you need it.
              </p>
            )}
          </div>
        </div>

        <div
          className={`grid items-start gap-4 ${
            displayCase && !focusTour && !showWalkthroughChrome
              ? 'xl:grid-cols-[minmax(0,1fr)_21rem]'
              : !displayCase && !showWalkthroughChrome
                ? 'lg:grid-cols-[minmax(0,1fr)_20rem]'
                : ''
          }`}
        >
          <div className="min-w-0 space-y-4">
            <div className="animate-fade-up min-w-0" data-testid="user-input-section">
              <PixelLabel>
                {displayCase || showWalkthroughChrome ? '00 · Your input' : '01 · Intake & desk'}
              </PixelLabel>
              <div className="mt-2 space-y-3">
                <Panel>
                  {displayCase || showWalkthroughChrome ? (
                    <div className="mb-3 border-2 border-brand/50 bg-brand/10 px-3 py-2">
                      <p className="font-pixel text-[8px] tracking-[0.16px] text-brand">
                        FILED SCENE · WHAT THE AGENTS READ
                      </p>
                      {filedTitle ? (
                        <p className="mt-1 font-display text-sm text-paper">{filedTitle}</p>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <p className="font-display text-lg text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4]">
                        RightsRadar
                      </p>
                      <p className="mt-1 max-w-md text-[11px] leading-4 text-lavender-soft">
                        Paste a scene or upload a production file. Agents post into the desk; humans
                        decide on the same thread.
                      </p>
                    </>
                  )}

                  <aside
                    className={`${displayCase || showWalkthroughChrome ? 'mt-0' : 'mt-4'} border border-warn-line bg-warn-bg p-3.5 text-[11px] leading-[17px] text-lavender-soft`}
                    aria-label="Legal disclaimer"
                  >
                    <p>
                      <strong className="font-bold text-paper">Research assistance only.</strong>{' '}
                      RightsRadar does not provide legal advice or make final infringement
                      determinations. Verify findings with qualified counsel and your clearance
                      process.
                    </p>
                  </aside>

                  <form
                    onSubmit={submitScript}
                    className="mt-3 border-2 border-ink bg-exhibit px-[18px] pb-[18px] pt-6 shadow-card"
                  >
                    <label
                      htmlFor="script-text"
                      className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
                    >
                      {displayCase || showWalkthroughChrome
                        ? 'Script the agents analyzed'
                        : 'Script text'}
                    </label>
                    <div className="mb-2 flex flex-wrap gap-2" data-testid="sample-chips">
                      {FEATURED_DEMO_SCRIPTS.map((sample) => (
                        <button
                          key={sample.id}
                          type="button"
                          onClick={() => setScriptText(sample.script)}
                          className="border border-ink bg-white px-2 py-1 font-display text-[8px] text-ink shadow-press hover:bg-exhibit"
                        >
                          {sample.title}
                        </button>
                      ))}
                    </div>
                    <textarea
                      id="script-text"
                      name="script-text"
                      value={scriptText}
                      onChange={(event) => setScriptText(event.target.value)}
                      rows={displayCase || showWalkthroughChrome ? 6 : 8}
                      maxLength={20_000}
                      required
                      readOnly={showWalkthroughChrome}
                      placeholder="Paste a script excerpt to scan for rights-clearance research leads…"
                      className="mt-2.5 block w-full resize-y border-2 border-ink bg-white px-2.5 py-2.5 text-[11px] leading-[17px] text-ink-soft transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cyan-pop"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <span className="font-pixel text-[8px] tabular-nums text-muted">
                        {scriptText.length.toLocaleString()} / 20,000
                      </span>
                      {showWalkthroughChrome ? (
                        <span className="font-pixel text-[8px] text-cyan-pop">
                          USE RUN NEXT STAGE
                        </span>
                      ) : (
                        <PrimaryButton disabled={isSubmitting || scriptText.trim().length === 0}>
                          {isSubmitting ? (
                            <>
                              <Spinner /> Analyzing…
                            </>
                          ) : displayCase ? (
                            '▶ Re-analyze script'
                          ) : (
                            '▶ Analyze script'
                          )}
                        </PrimaryButton>
                      )}
                    </div>
                  </form>

                  {productionId ? (
                    <form
                      onSubmit={submitAnalysisFile}
                      className="mt-3 border-2 border-ink bg-exhibit p-[18px] shadow-card"
                    >
                      <label
                        htmlFor="analysis-file"
                        className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
                      >
                        ▸ OR ANALYZE A PRODUCTION FILE
                      </label>
                      <p className="mt-2 text-[10.5px] leading-4 text-muted">
                        Gemini reviews PDF and image layout visually. DOCX text is extracted
                        securely, then detected leads are researched on the web through Parallel.
                      </p>
                      <input
                        ref={analysisFileInputRef}
                        id="analysis-file"
                        type="file"
                        accept=".pdf,.docx,image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={(event) =>
                          setAnalysisFile(event.target.files?.[0] ?? null)
                        }
                        className="mt-3 block w-full cursor-pointer border-2 border-dashed border-line-strong bg-white px-3 py-2.5 text-[11px] text-muted transition file:mr-3 file:cursor-pointer file:border-2 file:border-ink file:bg-cyan-pop file:px-2.5 file:py-1 file:font-display file:text-[9px] file:text-ink hover:border-cyan-pop focus:outline-none focus:ring-2 focus:ring-cyan-pop"
                      />
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <span className="text-[10px] text-muted">
                          {analysisFile
                            ? `${analysisFile.name} · ${fileSizeLabel(analysisFile.size)}`
                            : 'PDF · DOCX · PNG · JPEG · WEBP · 10 MiB max'}
                        </span>
                        <PrimaryButton disabled={!analysisFile || isAnalyzingFile}>
                          {isAnalyzingFile ? (
                            <>
                              <Spinner /> Analyzing file…
                            </>
                          ) : (
                            <>
                              <FileUp className="size-3.5" aria-hidden /> Analyze file
                            </>
                          )}
                        </PrimaryButton>
                      </div>
                    </form>
                  ) : null}
                </Panel>

                <AgentPipeline
                  status={displayWorkflowStatus}
                  result={pipelineCase}
                  revealStage={demoWalkthrough?.stage ?? null}
                  health={health}
                />
              </div>
            </div>

            {error ? (
              <p
                className="flex items-start gap-2.5 border-2 border-accent bg-danger-bg px-4 py-3 text-sm font-semibold text-accent"
                role="alert"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}

            {showDeskColumns ? (
              <div
                className={`grid items-start gap-4 ${
                  showDeskColumns ? 'lg:grid-cols-[minmax(20rem,1fr)_minmax(18rem,1fr)]' : ''
                }`}
              >
                <div className="animate-fade-up min-w-0">
                  <PixelLabel>01 · Case desk</PixelLabel>
                  <div className="mt-2">
                    {displayCase ? (
                      <CaseDesk
                        result={displayCase}
                        roster={roster}
                        actingMemberId={actingMemberId}
                        onActingMemberId={setActingMemberId}
                        reply={deskReply}
                        onReplyChange={setDeskReply}
                        onReply={() => void postDeskReply()}
                        isReplying={isReplying}
                        onChangeStatus={changeStatus}
                        updatingFindingId={updatingFindingId}
                      />
                    ) : (
                      <Panel>
                        <p className="font-pixel text-[8px] text-cyan-pop">WAITING FOR INTAKE</p>
                        <p className="mt-2 text-[11px] leading-4 text-lavender-soft">
                          Press <strong>Run next stage</strong> to let Gemini Intake post the first
                          desk message.
                        </p>
                      </Panel>
                    )}
                  </div>
                </div>

            {showDeskColumns ? (
              <div className="animate-fade-up min-w-0 space-y-4">
                <div data-testid="demo-coach-findings">
                  <PixelLabel>02 · Findings</PixelLabel>
                  <div className="mt-2">
                    <Panel>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-pixel text-[8px] tracking-[0.16px] text-line-strong">
                            STEP 2 / FINDINGS
                          </p>
                          <h2 className="mt-2 font-display text-base text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4,1px_1px_0_#aab5c4]">
                            Potential research leads
                          </h2>
                        </div>
                        <span className="border border-ink bg-white px-2 py-1 font-pixel text-[8.5px] text-ink">
                          {displayCase?.findings.length ?? 0}{' '}
                          {(displayCase?.findings.length ?? 0) === 1 ? 'FINDING' : 'FINDINGS'}
                        </span>
                      </div>

                      <div className="mt-4 space-y-4">
                        {!displayCase || displayCase.findings.length === 0 ? (
                          <p className="text-[11.5px] leading-[17.83px] text-lavender-soft">
                            {showWalkthroughChrome &&
                            demoWalkthrough &&
                            demoWalkthrough.stage !== 'curation' &&
                            demoWalkthrough.stage !== 'adjudication' &&
                            demoWalkthrough.stage !== 'human'
                              ? 'Findings unlock after Gemini Curation. Keep pressing Run next stage.'
                              : 'No deterministic research leads were found in this excerpt. That is not a clearance conclusion.'}
                          </p>
                        ) : (
                          displayCase.findings.map((finding, findingIndex) => {
                            const isEscalated = finding.reviewer_status === 'escalated';
                            const isDismissed = finding.reviewer_status === 'dismissed';
                            const justStamped = stampBurstId === finding.id;
                            return (
                            <article
                              className={`border-2 bg-exhibit p-[18px] transition ${
                                isEscalated
                                  ? 'border-accent shadow-[5px_5px_0_#ff2e9a]'
                                  : isDismissed
                                    ? 'border-muted opacity-80 shadow-none'
                                    : 'border-ink shadow-pop'
                              }`}
                              data-testid="finding-card"
                              data-finding-id={finding.id}
                              data-reviewer-status={finding.reviewer_status}
                              key={finding.id}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <span className="font-pixel text-[8px] uppercase leading-[14px] tracking-[0.16px] text-line-strong">
                                  Exhibit {String.fromCharCode(65 + findingIndex)}
                                  <br />
                                  {finding.category.replace(/_/g, ' ')}
                                </span>
                                <StatusStamp
                                  key={`${finding.id}-${finding.reviewer_status}-${justStamped ? 'burst' : 'idle'}`}
                                  status={finding.reviewer_status}
                                  animate={justStamped && finding.reviewer_status !== 'pending'}
                                />
                              </div>
                              <h3 className="mt-2 font-display text-base leading-[21.6px] text-ink">
                                {finding.detected_item}
                              </h3>
                              <p className="mt-1.5 text-[11.5px] leading-[17.83px] text-ink-soft">
                                {finding.explanation}
                              </p>
                              <FindingStakeholders
                                finding={finding}
                                roster={roster}
                                emphasize={isEscalated}
                                animate={justStamped && isEscalated}
                              />
                              <div className="mt-2.5 flex flex-wrap gap-1.5">
                                <span className="border border-ink bg-white px-2 py-0.5 text-[10.5px] font-bold text-ink">
                                  {Math.round(finding.confidence * 100)}% match
                                </span>
                                <span className="border border-ink bg-white px-2 py-0.5 text-[10.5px] font-bold text-ink">
                                  {formatDateTime(finding.retrieved_at)}
                                </span>
                              </div>
                              <div className="mt-3 border-t-2 border-dashed border-faint pt-2.5">
                                <h4 className="font-pixel text-[8px] uppercase tracking-[0.16px] text-line-strong">
                                  Evidence / liner notes
                                </h4>
                                {finding.supporting_evidence.map((evidence) => (
                                  <blockquote key={evidence.source.url} className="mt-2.5">
                                    <a
                                      href={evidence.source.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-[11.5px] font-bold text-ink underline-offset-2 transition hover:text-accent hover:underline"
                                    >
                                      {evidence.source.title}
                                      <ArrowUpRight className="size-3" aria-hidden />
                                    </a>
                                    <p className="mt-1 text-[11px] leading-[16.5px] text-muted">
                                      {evidence.excerpt}
                                    </p>
                                  </blockquote>
                                ))}
                              </div>
                              {finding.memo ? (
                                <div
                                  className="mt-3 border-2 border-ink bg-white p-3"
                                  data-testid="clearance-memo"
                                  data-verdict={finding.memo.verdict}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h4 className="font-pixel text-[8px] uppercase tracking-[0.16px] text-line-strong">
                                      Clearance memo · Adjudicator
                                    </h4>
                                    <span
                                      className={`rotate-1 border-2 px-2 py-0.5 font-display text-[9px] ${
                                        verdictTone(finding.memo.verdict) === 'cleared'
                                          ? 'border-brand-strong text-brand-strong'
                                          : verdictTone(finding.memo.verdict) === 'danger'
                                            ? 'border-accent text-accent'
                                            : verdictTone(finding.memo.verdict) === 'warn'
                                              ? 'border-[#c77d00] text-[#c77d00]'
                                              : 'border-ink text-ink'
                                      }`}
                                      data-testid="memo-verdict"
                                    >
                                      {verdictLabel(finding.memo.verdict)} · {Math.round(finding.memo.confidence * 100)}%
                                    </span>
                                  </div>
                                  <p className="mt-2 text-[11px] leading-[16.5px] text-ink-soft">
                                    {finding.memo.rationale}
                                  </p>
                                  {finding.memo.dispositive_url ? (
                                    <a
                                      href={finding.memo.dispositive_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-ink underline-offset-2 hover:text-accent hover:underline"
                                    >
                                      Dispositive source <ArrowUpRight className="size-3" aria-hidden />
                                    </a>
                                  ) : null}
                                  <p className="mt-2 font-pixel text-[7px] text-line-strong">
                                    {memoOwnerName(finding.memo, roster)
                                      ? `Assigned to ${memoOwnerName(finding.memo, roster)} (${finding.memo.recommended_owner_role})`
                                      : `Recommended owner: ${finding.memo.recommended_owner_role}`}
                                    {' · '}
                                    {finding.memo.hypotheses?.length ?? 0} hypotheses argued
                                  </p>
                                </div>
                              ) : null}
                              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
                                <span className="text-[10px] text-muted">✂ - - - - -</span>
                                <div className="flex gap-2.5">
                                  <SecondaryButton
                                    disabled={updatingFindingId === finding.id}
                                    onClick={() => changeStatus(finding, 'dismissed')}
                                  >
                                    {updatingFindingId === finding.id ? (
                                      <Spinner className="size-3.5" />
                                    ) : null}
                                    Dismiss
                                  </SecondaryButton>
                                  <EscalateButton
                                    disabled={updatingFindingId === finding.id}
                                    onClick={() => changeStatus(finding, 'escalated')}
                                  >
                                    {updatingFindingId === finding.id ? (
                                      <Spinner className="size-3.5" />
                                    ) : null}
                                    Escalate in desk ⚡
                                  </EscalateButton>
                                </div>
                              </div>
                            </article>
                            );
                          })
                        )}
                      </div>
                    </Panel>
                  </div>
                </div>

                {focusTour ? null : (
                <div>
                  <PixelLabel>03 · Attachments</PixelLabel>
                  <div className="mt-2">
                    <Panel>
                      <p className="font-pixel text-[8px] tracking-[0.16px] text-line-strong">
                        STEP 3 / PRODUCTION NOTES
                      </p>
                      <h2 className="mt-2 font-display text-base text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4,1px_1px_0_#aab5c4]">
                        Attach a production note
                      </h2>

                      <form
                        onSubmit={submitAsset}
                        className="mt-4 space-y-3 border-2 border-ink bg-exhibit p-[18px] shadow-card"
                      >
                        <label
                          htmlFor="asset-file"
                          className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
                        >
                          ▸ Attach plain-text asset
                        </label>
                        <div
                          id="asset-file-guidance"
                          className="border-2 border-line bg-white px-3 py-2.5 text-[10.5px] leading-4 text-muted"
                        >
                          <p>
                            <strong className="font-bold text-ink">Expected:</strong> a{' '}
                            <code className="text-accent">.txt</code> export of script sides,
                            continuity or clearance notes, prop and product-placement logs,
                            character or likeness notes, or quote and music-cue lists.
                          </p>
                          <p className="mt-1.5">
                            This attachment is stored with the case for human review; it is not
                            analyzed. To analyze a PDF, DOCX, PNG, JPEG, or WebP file, use the
                            production-file uploader above.
                          </p>
                        </div>
                        <input
                          ref={fileInputRef}
                          id="asset-file"
                          name="asset-file"
                          type="file"
                          accept="text/plain,.txt"
                          aria-describedby="asset-file-guidance asset-file-limits"
                          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                          className="block w-full cursor-pointer border-2 border-dashed border-line-strong bg-white px-3 py-2.5 text-[11px] text-muted transition file:mr-3 file:cursor-pointer file:border-2 file:border-ink file:bg-brand file:px-2.5 file:py-1 file:font-display file:text-[9px] file:text-ink hover:border-cyan-pop focus:outline-none focus:ring-2 focus:ring-cyan-pop"
                        />
                        {selectedFile ? (
                          <p
                            className="flex items-center gap-2 text-[10.5px] font-bold text-ink"
                            aria-live="polite"
                          >
                            <FileText className="size-3.5 shrink-0 text-accent" aria-hidden />
                            Selected: {selectedFile.name} ({fileSizeLabel(selectedFile.size)})
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span id="asset-file-limits" className="font-pixel text-[8px] text-muted">
                            UTF-8 .TXT · 256 KIB MAX
                          </span>
                          <PrimaryButton disabled={!selectedFile || isUploading}>
                            {isUploading ? (
                              <>
                                <Spinner /> Uploading…
                              </>
                            ) : (
                              '▶ Upload asset'
                            )}
                          </PrimaryButton>
                        </div>
                      </form>

                      <div className="mt-5" data-testid="asset-list" aria-live="polite">
                        <h3 className="font-pixel text-[8px] uppercase tracking-[0.16px] text-line-strong">
                          Attached assets
                        </h3>
                        {assets.length === 0 ? (
                          <p className="mt-2 text-[11.5px] leading-[17.83px] text-lavender-soft">
                            No plain-text production notes are attached yet.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-2">
                            {assets.map((asset) => (
                              <li
                                key={asset.id}
                                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border border-ink bg-white px-3 py-2.5"
                              >
                                <span className="flex min-w-0 items-center gap-2 text-[11px] font-bold text-ink">
                                  <FileText className="size-3.5 shrink-0 text-accent" aria-hidden />
                                  <span className="truncate">{asset.filename}</span>
                                </span>
                                <span className="text-[9.5px] text-muted">
                                  {asset.content_type} · {fileSizeLabel(asset.byte_size)} ·{' '}
                                  {formatDateTime(asset.created_at)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </Panel>
                  </div>
                </div>
                )}
              </div>
            ) : null}
            </div>
            ) : null}

            {displayCase && !focusTour && !showWalkthroughChrome ? (
              <div className="animate-fade-up">
                <PixelLabel>Recent cases</PixelLabel>
                <div className="mt-2" data-testid="recent-cases" aria-live="polite">
                  <div className="flex flex-wrap items-center gap-2">
                    <SecondaryButton disabled={isLoadingRecentCases} onClick={refreshRecentCases}>
                      {isLoadingRecentCases ? (
                        <>
                          <Spinner className="size-3.5" /> Loading…
                        </>
                      ) : (
                        '↻ Refresh'
                      )}
                    </SecondaryButton>
                    {recentCases.length === 0 ? (
                      <span className="text-[11px] text-lavender-soft">No recent cases yet.</span>
                    ) : (
                      recentCases.slice(0, 6).map((recentCase) => (
                        <button
                          key={recentCase.id}
                          type="button"
                          disabled={isLoadingCaseId === recentCase.id}
                          onClick={() => reopenCase(recentCase.id)}
                          className="max-w-[14rem] truncate border border-ink bg-white px-2 py-1.5 text-left font-display text-[9px] text-ink shadow-press hover:bg-exhibit disabled:opacity-60"
                        >
                          {recentCase.script_excerpt}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {displayCase && !focusTour && !showWalkthroughChrome ? (
            <div className="animate-fade-up xl:sticky xl:top-2 xl:max-h-[calc(100vh-1.25rem)] xl:self-start">
              <button
                type="button"
                data-testid="toggle-tool-log"
                onClick={() => setShowToolLog((value) => !value)}
                className="border-2 border-ink bg-white px-3 py-2 font-display text-[9px] text-ink shadow-press"
                aria-expanded={showToolLog}
              >
                {showToolLog ? 'Hide agent tool log' : 'Show agent tool log'} · {(displayCase.tool_calls ?? []).length}
              </button>
              {showToolLog ? (
                <div className="mt-2 h-[calc(100vh-8rem)] min-h-[24rem]">
                  <JudgeLogRail calls={displayCase.tool_calls ?? []} />
                </div>
              ) : null}
            </div>
          ) : !displayCase && !showWalkthroughChrome ? (
          <aside className="animate-fade-up lg:sticky lg:top-4">
            <PixelLabel>04 · Cases</PixelLabel>
            <div className="mt-2">
              <Panel>
                <h2 className="font-display text-base text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4]">
                  Your cases
                </h2>
                <p className="mt-1.5 text-[11px] leading-4 text-lavender-soft">
                  Newest cut first.
                </p>
                <div className="mt-3">
                  <SecondaryButton disabled={isLoadingRecentCases} onClick={refreshRecentCases}>
                    {isLoadingRecentCases ? (
                      <>
                        <Spinner className="size-3.5" /> Loading…
                      </>
                    ) : (
                      '↻ Refresh recent cases'
                    )}
                  </SecondaryButton>
                </div>

                <div className="mt-4" data-testid="recent-cases" aria-live="polite">
                  {recentCases.length === 0 ? (
                    <p className="text-[11.5px] italic leading-[17.83px] text-lavender-soft">
                      Refresh to load recently reviewed cases.
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {recentCases.map((recentCase) => (
                        <li key={recentCase.id}>
                          <button
                            type="button"
                            disabled={isLoadingCaseId === recentCase.id}
                            onClick={() => reopenCase(recentCase.id)}
                            className="flex w-full items-center justify-between gap-3 border border-ink bg-white px-3 py-2.5 text-left transition hover:bg-exhibit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-pop disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className="min-w-0">
                              <span className="line-clamp-1 block font-display text-[11px] text-ink">
                                {recentCase.script_excerpt}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-muted">
                                {isLoadingCaseId === recentCase.id ? (
                                  <Spinner className="size-3" />
                                ) : null}
                                {recentCase.id.slice(0, 8).toUpperCase()} ·{' '}
                                {new Date(recentCase.created_at).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric'
                                })}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              <span className="inline-block rotate-2 border border-ink px-1.5 py-0.5 font-display text-[8.5px] text-ink">
                                {recentCase.finding_count > 0
                                  ? `${recentCase.finding_count} HOT ⚡`
                                  : '✓ CLEARED'}
                              </span>
                              <span className="font-pixel text-[8.5px] text-muted">
                                {recentCase.finding_count}{' '}
                                {recentCase.finding_count === 1 ? 'TRACK' : 'TRACKS'}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Panel>
            </div>
          </aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}
