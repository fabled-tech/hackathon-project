'use client';

import {
  createWorkspaceMember,
  createProduction,
  deleteWorkspaceMember,
  listAgentRuns,
  listOrganizationIssues,
  listProductions,
  listWorkspaceMembers,
  runDigest,
  runWatch,
  updateProduction,
  type AgentRun,
  type OrganizationIssue,
  type ProductionStatus,
  type ProductionSummary,
  type WorkspaceMember
} from '@rightsrader/api-client';
import {
  Bot,
  Briefcase,
  ChevronRight,
  Clapperboard,
  FileSearch,
  Film,
  FolderPlus,
  LayoutDashboard,
  Loader2,
  Music,
  Settings,
  Star,
  Tv,
  Users,
  Video,
  Wand2
} from 'lucide-react';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { ScriptReview } from './script-review';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

const STATUS_LABELS: Record<ProductionStatus, string> = {
  development: 'Development',
  pre_production: 'Pre-pro',
  shooting: 'Shooting',
  post: 'Post',
  released: 'Released'
};

const STATUS_COLORS: Record<ProductionStatus, string> = {
  development: 'border-lavender text-lavender',
  pre_production: 'border-cyan-pop text-cyan-pop',
  shooting: 'border-accent text-accent',
  post: 'border-brand text-brand',
  released: 'border-paper text-paper'
};

function Spinner({ className = 'size-4' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden />;
}

function PixelLabel({ children }: { children: ReactNode }) {
  return <p className="font-pixel text-[9.5px] leading-relaxed text-lavender">{children}</p>;
}

function Panel({ children, glow = true }: { children: ReactNode; glow?: boolean }) {
  return (
    <section
      className="relative overflow-clip border-2 border-line p-5"
      style={{
        backgroundImage: glow
          ? 'radial-gradient(53.6px 53.5px at 60px 46px, rgb(255 46 154 / 0.28), transparent 45%), radial-gradient(53.2px 53.1px at calc(100% - 40px) calc(100% - 69px), rgb(0 229 255 / 0.24), transparent 50%), linear-gradient(90deg, #2a0f4a, #2a0f4a)'
          : 'linear-gradient(90deg, #2a0f4a, #2a0f4a)'
      }}
    >
      {children}
    </section>
  );
}

function FigmaCard({
  children,
  className = '',
  shadow = 'shadow-card'
}: {
  children: ReactNode;
  className?: string;
  shadow?: 'shadow-card' | 'shadow-pop' | 'shadow-none';
}) {
  return (
    <section className={`border-2 border-ink bg-exhibit p-4 text-ink ${shadow} ${className}`}>
      {children}
    </section>
  );
}

function BungeeHeading({
  children,
  className = '',
  id
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <h2
      id={id}
      className={`font-display text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4,1px_1px_0_#aab5c4] ${className}`}
    >
      {children}
    </h2>
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

function GhostButton({
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

const PRODUCTION_ICONS = {
  clapperboard: Clapperboard,
  film: Film,
  video: Video,
  tv: Tv,
  music: Music,
  star: Star,
  wand: Wand2,
  briefcase: Briefcase
} as const;

type ProductionIcon = keyof typeof PRODUCTION_ICONS;

function productionIcon(icon: string | undefined) {
  return PRODUCTION_ICONS[(icon as ProductionIcon) ?? 'clapperboard'] ?? Clapperboard;
}

type View =
  | { kind: 'home' }
  | { kind: 'case' }
  | { kind: 'overview' }
  | { kind: 'runs' }
  | { kind: 'settings' }
  | { kind: 'issues' }
  | { kind: 'team' };

export function Dashboard() {
  const [productions, setProductions] = useState<ProductionSummary[]>([]);
  const [activeProductionId, setActiveProductionId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [organizationIssues, setOrganizationIssues] = useState<OrganizationIssue[]>([]);
  const [isLoadingProductions, setIsLoadingProductions] = useState(false);
  const [isLoadingOrganization, setIsLoadingOrganization] = useState(false);
  const [isRunningAgent, setIsRunningAgent] = useState<'digest' | 'watch' | null>(null);
  const [showNewProduction, setShowNewProduction] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStudio, setNewStudio] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeProduction = productions.find((p) => p.id === activeProductionId) ?? null;
  const canRunAgents = (activeProduction?.case_count ?? 0) > 0;

  const refreshProductions = useCallback(async () => {
    setError(null);
    try {
      const list = await listProductions(API_BASE_URL);
      setProductions(list);
    } catch {
      setError('Could not load productions.');
    }
  }, []);

  const refreshAgentRuns = useCallback(async (productionId: string) => {
    try {
      const runs = await listAgentRuns(productionId, 20, API_BASE_URL);
      setAgentRuns(runs);
    } catch {
      /* non-fatal */
    }
  }, []);

  const refreshOrganization = useCallback(async () => {
    setIsLoadingOrganization(true);
    try {
      const [members, issues] = await Promise.all([
        listWorkspaceMembers(API_BASE_URL),
        listOrganizationIssues(API_BASE_URL)
      ]);
      setWorkspaceMembers(members);
      setOrganizationIssues(issues);
    } catch {
      setError('Could not load the organization workspace.');
    } finally {
      setIsLoadingOrganization(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoadingProductions(true);
      try {
        const list = await listProductions(API_BASE_URL);
        if (cancelled) return;
        setProductions(list);
      } catch {
        if (!cancelled) setError('Could not load productions.');
      } finally {
        if (!cancelled) setIsLoadingProductions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoadingOrganization(true);
      try {
        const [members, issues] = await Promise.all([
          listWorkspaceMembers(API_BASE_URL),
          listOrganizationIssues(API_BASE_URL)
        ]);
        if (cancelled) return;
        setWorkspaceMembers(members);
        setOrganizationIssues(issues);
      } catch {
        if (!cancelled) setError('Could not load the organization workspace.');
      } finally {
        if (!cancelled) setIsLoadingOrganization(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeProductionId) return;
    let cancelled = false;
    (async () => {
      try {
        const runs = await listAgentRuns(activeProductionId, 20, API_BASE_URL);
        if (!cancelled) setAgentRuns(runs);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProductionId]);

  async function submitProduction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTitle.trim()) return;
    setError(null);
    try {
      const created = await createProduction(
        { title: newTitle.trim(), studio: newStudio.trim() },
        API_BASE_URL
      );
      setNewTitle('');
      setNewStudio('');
      setShowNewProduction(false);
      await refreshProductions();
      setActiveProductionId(created.id);
      setView({ kind: 'overview' });
    } catch {
      setError('Could not create the production.');
    }
  }

  function openNewProductionDialog() {
    setNewTitle('');
    setNewStudio('');
    setShowNewProduction(true);
  }

  function closeNewProductionDialog() {
    setShowNewProduction(false);
    setNewTitle('');
    setNewStudio('');
  }

  async function triggerAgent(kind: 'digest' | 'watch') {
    if (!activeProductionId || !canRunAgents) return;
    setIsRunningAgent(kind);
    setError(null);
    try {
      if (kind === 'digest') {
        await runDigest(activeProductionId, API_BASE_URL);
      } else {
        await runWatch(activeProductionId, API_BASE_URL);
      }
      await refreshAgentRuns(activeProductionId);
      await refreshProductions();
      setView({ kind: 'runs' });
    } catch {
      setError(`The ${kind} agent could not run right now.`);
    } finally {
      setIsRunningAgent(null);
    }
  }

  const latestBrief = agentRuns.find((r) => r.kind === 'digest' && r.status === 'completed');

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[796px] overflow-hidden border-x-2 border-line bg-ink lg:my-6 lg:min-h-[calc(100vh-3rem)] lg:border-2">
      <aside
        className="flex w-[214px] shrink-0 flex-col border-r-2 border-line bg-panel"
        style={{
          backgroundImage:
            'radial-gradient(110px 110px at 42px 0, rgb(0 229 255 / 0.18), transparent 55%), linear-gradient(90deg, #2a0f4a, #2a0f4a)'
        }}
      >
        <div className="p-[15px] pt-5">
          <div className="flex items-center gap-2">
            <span className="flex size-[26px] items-center justify-center border-2 border-ink bg-brand font-display text-[11px] text-ink shadow-press">
              R
            </span>
            <span className="font-display text-[13px] text-paper [text-shadow:2px_2px_0_#aab5c4]">
              RightsRadar
            </span>
          </div>
          <p className="mt-2 font-pixel text-[7px] text-lavender">RIGHTS CLEARANCE OS</p>
        </div>

        <div className="flex-1 overflow-y-auto px-[15px] pb-[15px]">
        <button
          type="button"
          onClick={() => setView({ kind: 'home' })}
          className={`mb-4 flex w-full items-center gap-2 border-2 px-2.5 py-2 text-left font-display text-[8px] transition focus-visible:outline-2 focus-visible:outline-cyan-pop ${
            view.kind === 'home'
              ? 'border-ink bg-brand text-ink shadow-press'
              : 'border-transparent text-lavender-soft hover:border-line'
          }`}
        >
          <LayoutDashboard className="size-3" aria-hidden />
          Project directory
        </button>

        <div className="mb-4">
          <PixelLabel>ORGANIZATION</PixelLabel>
          <ul className="mt-2 space-y-1">
            {(
              [
                { kind: 'issues', label: 'Issue queue', icon: FileSearch },
                { kind: 'team', label: 'Team directory', icon: Users }
              ] as const
            ).map((item) => (
              <li key={item.kind}>
                <button
                  type="button"
                  onClick={() => setView({ kind: item.kind })}
                  className={`flex w-full items-center gap-2 border-2 px-2.5 py-1.5 text-left font-display text-[9px] transition focus-visible:outline-2 focus-visible:outline-cyan-pop ${
                    view.kind === item.kind
                      ? 'border-ink bg-brand text-ink shadow-press'
                      : 'border-transparent text-lavender-soft hover:border-line'
                  }`}
                >
                  <item.icon className="size-3.5" aria-hidden />
                  {item.label}
                  {item.kind === 'issues' && organizationIssues.length > 0 ? (
                    <span className="ml-auto border border-current px-1 font-pixel text-[7px]">
                      {organizationIssues.length}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <PixelLabel>YOUR PROJECTS</PixelLabel>
          <button
            type="button"
            onClick={openNewProductionDialog}
              className="text-lavender transition hover:text-brand focus-visible:outline-2 focus-visible:outline-brand"
              aria-label="New production"
            >
              <FolderPlus className="size-4" aria-hidden />
            </button>
          </div>

          {isLoadingProductions ? (
            <p className="flex items-center gap-2 text-[11px] text-lavender-soft">
              <Spinner className="size-3.5" /> Loading…
            </p>
          ) : productions.length === 0 ? (
            <p className="text-[11px] italic leading-[17.83px] text-lavender-soft">
              No productions yet. Create one to begin tracking clearance.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {productions.map((production) => (
                <li key={production.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveProductionId(production.id);
                      setView({ kind: 'overview' });
                    }}
                    className={`w-full border-2 px-2.5 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-cyan-pop ${
                      production.id === activeProductionId
                        ? 'border-ink bg-white text-ink shadow-card'
                        : 'border-line bg-exhibit text-ink hover:border-cyan-pop'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {(() => {
                          const Icon = productionIcon(production.icon);
                          return <Icon className="size-3.5 shrink-0" aria-hidden />;
                        })()}
                        <span className="line-clamp-1 font-display text-[9px]">
                          {production.title}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 border px-1 py-0.5 font-pixel text-[7px] ${STATUS_COLORS[production.status ?? 'development']}`}
                      >
                        {STATUS_LABELS[production.status ?? 'development']}
                      </span>
                    </span>
                    <span className="mt-1 block text-[8px] text-muted">
                      {production.case_count ?? 0} cases · {production.open_finding_count ?? 0} open
                      · {production.escalated_finding_count ?? 0} escalated
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {activeProduction ? (
          <nav className="mt-6 border-t-2 border-line pt-4">
            <PixelLabel>WORKSPACE</PixelLabel>
            <ul className="mt-2 space-y-1">
              {(
                [
                  { kind: 'overview', label: 'Overview', icon: LayoutDashboard },
                  { kind: 'case', label: 'New case', icon: FileSearch },
                  { kind: 'runs', label: 'Agent runs', icon: Bot },
                  { kind: 'settings', label: 'Settings', icon: Settings }
                ] as const
              ).map((item) => (
                <li key={item.kind}>
                  <button
                    type="button"
                    onClick={() => setView({ kind: item.kind })}
                    className={`flex w-full items-center gap-2 border-2 px-2.5 py-1.5 text-left font-display text-[9px] transition focus-visible:outline-2 focus-visible:outline-cyan-pop ${
                      view.kind === item.kind
                        ? 'border-ink bg-brand text-ink shadow-press'
                        : 'border-transparent text-lavender-soft hover:border-line'
                    }`}
                  >
                    <item.icon className="size-3.5" aria-hidden />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </aside>

      <main
        className="min-w-0 flex-1 overflow-y-auto p-[22px_26px]"
        style={{
          backgroundImage:
            'radial-gradient(135px 135px at calc(100% - 28px) 54px, rgb(255 46 154 / 0.16), transparent 50%), linear-gradient(90deg, #150a30, #150a30)'
        }}
      >
        {error ? (
          <p
            className="mb-4 flex items-start gap-2.5 border-2 border-accent bg-danger-bg px-4 py-3 text-sm font-semibold text-accent"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {view.kind === 'home' ? (
          <ProjectHome
            productions={productions}
            isLoading={isLoadingProductions}
            onCreateProject={openNewProductionDialog}
            onOpenProject={(productionId) => {
              setActiveProductionId(productionId);
              setView({ kind: 'overview' });
            }}
          />
        ) : view.kind === 'issues' ? (
          <OrganizationIssueQueue
            issues={organizationIssues}
            isLoading={isLoadingOrganization}
            onRefresh={refreshOrganization}
            onOpenProject={(productionId) => {
              setActiveProductionId(productionId);
              setView({ kind: 'overview' });
            }}
          />
        ) : view.kind === 'team' ? (
          <TeamDirectory
            members={workspaceMembers}
            isLoading={isLoadingOrganization}
            onChanged={refreshOrganization}
          />
        ) : !activeProduction ? (
          <ProjectHome
            productions={productions}
            isLoading={isLoadingProductions}
            onCreateProject={openNewProductionDialog}
            onOpenProject={(productionId) => {
              setActiveProductionId(productionId);
              setView({ kind: 'overview' });
            }}
          />
        ) : view.kind === 'case' ? (
          <ScriptReview
            productionId={activeProduction.id}
            productionTitle={activeProduction.title}
            members={workspaceMembers}
            onCaseCreated={async () => {
              await Promise.all([refreshProductions(), refreshOrganization()]);
            }}
            onHandoffCompleted={async () => {
              await Promise.all([refreshProductions(), refreshOrganization()]);
            }}
            onOpenTeam={() => setView({ kind: 'team' })}
          />
        ) : view.kind === 'runs' ? (
          <AgentRunsView runs={agentRuns} />
        ) : view.kind === 'settings' ? (
          <ProductionSettings
            key={activeProduction.id}
            production={activeProduction}
            onSaved={refreshProductions}
            onError={setError}
          />
        ) : (
          <div className="max-w-[492px] space-y-[14px]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {(() => {
                  const Icon = productionIcon(activeProduction.icon);
                  return (
                    <span className="flex size-9 shrink-0 items-center justify-center border-2 border-ink bg-white">
                      <Icon className="size-4 text-ink" aria-hidden />
                    </span>
                  );
                })()}
                <div>
                  <PixelLabel>PRODUCTION</PixelLabel>
                  <BungeeHeading className="mt-1 text-xl">{activeProduction.title}</BungeeHeading>
                  <p className="mt-1 text-[9.5px] text-lavender-soft">
                    {activeProduction.studio || 'No studio'} ·{' '}
                    {STATUS_LABELS[activeProduction.status ?? 'development']}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <GhostButton
                  disabled={!canRunAgents || isRunningAgent !== null}
                  onClick={() => triggerAgent('digest')}
                >
                  {isRunningAgent === 'digest' ? <Spinner className="size-3.5" /> : null}
                  ✧ Clearance brief
                </GhostButton>
                <PrimaryButton
                  type="button"
                  disabled={!canRunAgents || isRunningAgent !== null}
                  onClick={() => triggerAgent('watch')}
                >
                  {isRunningAgent === 'watch' ? <Spinner className="size-3.5" /> : null}
                  ▶ Run watch agent
                </PrimaryButton>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'CASES', value: activeProduction.case_count ?? 0 },
                {
                  label: 'OPEN FINDINGS',
                  value: activeProduction.open_finding_count ?? 0
                },
                {
                  label: 'ESCALATED',
                  value: activeProduction.escalated_finding_count ?? 0
                }
              ].map((stat) => (
                <FigmaCard key={stat.label} className="min-w-0 p-4">
                  <p className="font-pixel text-[7px] text-line-strong">{stat.label}</p>
                  <p className="mt-2 font-display text-2xl text-ink">{stat.value}</p>
                </FigmaCard>
              ))}
            </div>

            <FigmaCard shadow="shadow-none">
              <p className="font-pixel text-[7px] text-line-strong">LATEST CLEARANCE BRIEF</p>
              {latestBrief ? (
                <>
                  <p className="mt-2 text-[11px] leading-[17px] text-ink-soft">{latestBrief.summary}</p>
                  <p className="mt-2 font-pixel text-[7px] text-muted">
                    {new Date(latestBrief.created_at).toLocaleString()}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[11px] leading-[17px] text-ink-soft">
                  {canRunAgents
                    ? 'No brief yet. Run the clearance brief agent to summarize open findings across this production.'
                    : 'Research a script first. Clearance briefs become available once this project has findings to summarize.'}
                </p>
              )}
            </FigmaCard>

            <FigmaCard>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-pixel text-[7px] text-line-strong">CASES</p>
                  <p className="mt-2 max-w-[330px] text-[11px] leading-[17px] text-ink-soft">
                    {canRunAgents
                      ? `${activeProduction.case_count ?? 0} case(s) in this production. Open the new case workspace to run another script excerpt.`
                      : 'Paste a script excerpt to create the first research case. RightsRadar will identify potential clearance leads and preserve them in this project.'}
                  </p>
                </div>
                <GhostButton onClick={() => setView({ kind: 'case' })}>New case →</GhostButton>
              </div>
            </FigmaCard>
          </div>
        )}
      </main>

      {showNewProduction ? (
        <NewProductionDialog
          title={newTitle}
          studio={newStudio}
          onTitleChange={setNewTitle}
          onStudioChange={setNewStudio}
          onSubmit={submitProduction}
          onClose={closeNewProductionDialog}
        />
      ) : null}
    </div>
  );
}

function ProjectHome({
  productions,
  isLoading,
  onCreateProject,
  onOpenProject
}: {
  productions: ProductionSummary[];
  isLoading: boolean;
  onCreateProject: () => void;
  onOpenProject: (productionId: string) => void;
}) {
  const projectCount = productions.length;
  const caseCount = productions.reduce((total, project) => total + (project.case_count ?? 0), 0);
  const openFindingCount = productions.reduce(
    (total, project) => total + (project.open_finding_count ?? 0),
    0
  );
  const escalatedFindingCount = productions.reduce(
    (total, project) => total + (project.escalated_finding_count ?? 0),
    0
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="relative overflow-hidden border-2 border-line bg-panel p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-cyan-pop/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-24 left-1/3 size-64 rounded-full bg-accent/15 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <PixelLabel>RIGHTSRADAR OS · PROJECT DIRECTORY</PixelLabel>
            <BungeeHeading className="mt-3 text-3xl leading-tight sm:text-4xl">
              Clearance starts with the production.
            </BungeeHeading>
            <p className="mt-4 max-w-xl text-sm leading-6 text-lavender-pale">
              Open a project to research scripts, triage findings, and keep every rights decision in
              one reviewable workspace.
            </p>
          </div>
          <PrimaryButton type="button" onClick={onCreateProject}>
            <FolderPlus className="size-4" aria-hidden />
            ▶ New project
          </PrimaryButton>
        </div>
      </section>

      <section aria-label="Portfolio summary" className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'PROJECTS', value: projectCount, detail: 'in your clearance portfolio', icon: Briefcase },
          { label: 'CASES', value: caseCount, detail: 'scripts researched', icon: FileSearch },
          {
            label: 'OPEN QUEUE',
            value: openFindingCount,
            detail: `${escalatedFindingCount} escalated for follow-up`,
            icon: Bot
          }
        ].map((stat) => (
          <Panel key={stat.label} glow={false}>
            <div className="flex items-center justify-between">
              <PixelLabel>{stat.label}</PixelLabel>
              <stat.icon className="size-4 text-cyan-pop" aria-hidden />
            </div>
            <p className="mt-3 font-display text-3xl text-paper [text-shadow:2px_2px_0_#aab5c4]">
              {stat.value}
            </p>
            <p className="mt-1 text-[11px] text-lavender-soft">{stat.detail}</p>
          </Panel>
        ))}
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <PixelLabel>WORKSPACES</PixelLabel>
            <BungeeHeading className="mt-1 text-xl">Your projects</BungeeHeading>
          </div>
          <p className="max-w-md text-right text-[11.5px] leading-[17px] text-lavender-soft">
            Choose a project before starting a new script review.
          </p>
        </div>

        {isLoading ? (
          <Panel>
            <p className="flex items-center gap-2 text-sm text-lavender-soft">
              <Spinner /> Loading projects…
            </p>
          </Panel>
        ) : productions.length === 0 ? (
          <Panel>
            <div className="mx-auto max-w-lg py-8 text-center">
              <span className="mx-auto flex size-12 items-center justify-center border-2 border-ink bg-brand text-ink shadow-press">
                <FolderPlus className="size-6" aria-hidden />
              </span>
              <BungeeHeading className="mt-5 text-lg">Create your first project</BungeeHeading>
              <p className="mt-3 text-sm leading-6 text-lavender-pale">
                Projects keep research cases, agent runs, and clearance decisions organized by
                production.
              </p>
              <div className="mt-5">
                <PrimaryButton type="button" onClick={onCreateProject}>
                  <FolderPlus className="size-4" aria-hidden />
                  ▶ Create project
                </PrimaryButton>
              </div>
            </div>
          </Panel>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {productions.map((production) => {
              const Icon = productionIcon(production.icon);
              const status = production.status ?? 'development';
              return (
                <button
                  key={production.id}
                  type="button"
                  onClick={() => onOpenProject(production.id)}
                  className="group flex min-h-56 flex-col border-2 border-line bg-panel p-5 text-left transition hover:-translate-y-1 hover:border-cyan-pop hover:shadow-card focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="flex size-11 shrink-0 items-center justify-center border-2 border-ink bg-white text-ink shadow-press">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span
                      className={`border px-1.5 py-1 font-pixel text-[7px] ${STATUS_COLORS[status]}`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                  </div>
                  <div className="mt-5">
                    <h3 className="font-display text-base text-paper">{production.title}</h3>
                    <p className="mt-1 text-[11px] text-lavender-soft">
                      {production.studio || 'Independent production'}
                    </p>
                  </div>
                  <div className="mt-auto grid grid-cols-3 gap-2 border-t-2 border-line pt-4">
                    {[
                      { label: 'CASES', value: production.case_count ?? 0 },
                      { label: 'OPEN', value: production.open_finding_count ?? 0 },
                      { label: 'ESC.', value: production.escalated_finding_count ?? 0 }
                    ].map((stat) => (
                      <div key={stat.label}>
                        <PixelLabel>{stat.label}</PixelLabel>
                        <p className="mt-1 font-display text-lg text-paper">{stat.value}</p>
                      </div>
                    ))}
                  </div>
                  <span className="mt-5 inline-flex items-center gap-1 font-display text-[9px] text-brand transition group-hover:text-brand-soft">
                    Open workspace <ChevronRight className="size-3.5" aria-hidden />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function formatWorkspaceRole(role: WorkspaceMember['role']): string {
  const labels = {
    production: 'Production',
    clearance: 'Clearance',
    legal: 'Legal'
  };
  return labels[role ?? 'clearance'];
}

function OrganizationIssueQueue({
  issues,
  isLoading,
  onRefresh,
  onOpenProject
}: {
  issues: OrganizationIssue[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onOpenProject: (productionId: string) => void;
}) {
  const escalatedCount = issues.filter((issue) => issue.reviewer_status === 'escalated').length;
  const unassignedCount = issues.filter((issue) => !issue.assignee).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <PixelLabel>ORGANIZATION / REVIEW OPERATIONS</PixelLabel>
          <BungeeHeading className="mt-1 text-2xl">Issue queue</BungeeHeading>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-lavender-pale">
            Every open research lead across your projects. Escalations land here with an owner,
            deadline, and handoff note so follow-up is visible beyond a single production.
          </p>
        </div>
        <GhostButton disabled={isLoading} onClick={() => void onRefresh()}>
          {isLoading ? <Spinner className="size-3.5" /> : null}
          Refresh queue
        </GhostButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'OPEN ISSUES', value: issues.length, detail: 'across all projects', icon: FileSearch },
          { label: 'ESCALATED', value: escalatedCount, detail: 'active handoffs', icon: Bot },
          { label: 'NEEDS OWNER', value: unassignedCount, detail: 'requires assignment', icon: Users }
        ].map((stat) => (
          <Panel key={stat.label} glow={false}>
            <div className="flex items-center justify-between">
              <PixelLabel>{stat.label}</PixelLabel>
              <stat.icon className="size-4 text-cyan-pop" aria-hidden />
            </div>
            <p className="mt-2 font-display text-3xl text-paper [text-shadow:2px_2px_0_#aab5c4]">
              {stat.value}
            </p>
            <p className="mt-1 text-[11px] text-lavender-soft">{stat.detail}</p>
          </Panel>
        ))}
      </div>

      <Panel glow={false}>
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-lavender-soft">
            <Spinner /> Loading the organization queue…
          </p>
        ) : issues.length === 0 ? (
          <div className="py-6 text-center">
            <BungeeHeading className="text-lg">The queue is clear</BungeeHeading>
            <p className="mt-3 text-sm text-lavender-pale">
              Open findings from every project will appear here as research begins.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {issues.map((issue) => {
              const escalated = issue.reviewer_status === 'escalated';
              return (
                <li
                  key={issue.finding_id}
                  className={`border-2 p-4 ${
                    escalated ? 'border-accent bg-danger-bg' : 'border-line bg-panel'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-pixel text-[8px] text-lavender">
                        {issue.production_title.toUpperCase()} · {issue.category.toUpperCase()}
                      </p>
                      <h3 className="mt-2 font-display text-base text-paper">{issue.detected_item}</h3>
                      <p className="mt-1 max-w-2xl text-[11px] leading-[17px] text-lavender-pale">
                        {issue.case_excerpt}
                      </p>
                    </div>
                    <span
                      className={`border px-2 py-1 font-display text-[9px] ${
                        escalated
                          ? 'border-accent bg-accent text-white'
                          : 'border-cyan-pop text-cyan-pop'
                      }`}
                    >
                      {escalated ? 'ESCALATED' : 'OPEN'}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <span className="border border-line px-2 py-1 text-lavender-pale">
                        {Math.round(issue.confidence * 100)}% signal
                      </span>
                      <span
                        className={`border px-2 py-1 ${
                          issue.assignee ? 'border-brand text-brand' : 'border-accent text-accent'
                        }`}
                      >
                        {issue.assignee ? `Owner: ${issue.assignee}` : 'Needs an owner'}
                      </span>
                      {issue.due_date ? (
                        <span className="border border-line px-2 py-1 text-lavender-pale">
                          Due {issue.due_date}
                        </span>
                      ) : null}
                      {issue.comment_count > 0 ? (
                        <span className="border border-line px-2 py-1 text-lavender-pale">
                          {issue.comment_count} handoff note{issue.comment_count === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </div>
                    <GhostButton onClick={() => onOpenProject(issue.production_id)}>
                      Open project <ChevronRight className="size-3.5" aria-hidden />
                    </GhostButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function TeamDirectory({
  members,
  isLoading,
  onChanged
}: {
  members: WorkspaceMember[];
  isLoading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<NonNullable<WorkspaceMember['role']>>('clearance');
  const [isSaving, setIsSaving] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setIsSaving(true);
    setMemberError(null);
    try {
      await createWorkspaceMember(
        { name: name.trim(), email: email.trim(), role },
        API_BASE_URL
      );
      setName('');
      setEmail('');
      setRole('clearance');
      await onChanged();
    } catch {
      setMemberError('Could not add this workspace member.');
    } finally {
      setIsSaving(false);
    }
  }

  async function removeMember(memberId: string) {
    setMemberError(null);
    try {
      await deleteWorkspaceMember(memberId, API_BASE_URL);
      await onChanged();
    } catch {
      setMemberError('Could not remove this workspace member.');
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <PixelLabel>ORGANIZATION / COLLABORATION</PixelLabel>
        <BungeeHeading className="mt-1 text-2xl">Team directory</BungeeHeading>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-lavender-pale">
          Add the people who can own clearance follow-up. Escalations assign a named owner and are
          then tracked in the organization issue queue.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel glow={false}>
          <div className="flex items-center justify-between">
            <div>
              <PixelLabel>WORKSPACE MEMBERS</PixelLabel>
              <BungeeHeading className="mt-1 text-lg">{members.length} collaborators</BungeeHeading>
            </div>
            <Users className="size-5 text-cyan-pop" aria-hidden />
          </div>
          {isLoading ? (
            <p className="mt-5 flex items-center gap-2 text-sm text-lavender-soft">
              <Spinner /> Loading members…
            </p>
          ) : members.length === 0 ? (
            <p className="mt-5 text-sm leading-6 text-lavender-pale">
              Add a production, clearance, or legal teammate before escalating a finding.
            </p>
          ) : (
            <ul className="mt-5 space-y-3">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-2 border-line bg-panel p-3"
                >
                  <div>
                    <p className="font-display text-[11px] text-paper">{member.name}</p>
                    <p className="mt-1 text-[10px] text-lavender-soft">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="border border-brand px-1.5 py-1 font-pixel text-[7px] text-brand">
                      {formatWorkspaceRole(member.role).toUpperCase()}
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeMember(member.id)}
                      className="border border-line px-1.5 py-1 font-pixel text-[7px] text-lavender-soft transition hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      REMOVE
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PixelLabel>ADD COLLABORATOR</PixelLabel>
          <form onSubmit={addMember} className="mt-4 space-y-4">
            <label className="block">
              <span className="font-pixel text-[8px] text-lavender">NAME</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Avery Chen"
                required
                className="mt-1.5 block w-full border-2 border-ink bg-white px-2.5 py-2 text-[11px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              />
            </label>
            <label className="block">
              <span className="font-pixel text-[8px] text-lavender">EMAIL</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="avery@studio.com"
                required
                className="mt-1.5 block w-full border-2 border-ink bg-white px-2.5 py-2 text-[11px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              />
            </label>
            <label className="block">
              <span className="font-pixel text-[8px] text-lavender">ROLE</span>
              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as NonNullable<WorkspaceMember['role']>)
                }
                className="mt-1.5 block w-full border-2 border-ink bg-white px-2.5 py-2 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              >
                <option value="production">Production</option>
                <option value="clearance">Clearance</option>
                <option value="legal">Legal</option>
              </select>
            </label>
            {memberError ? (
              <p role="alert" className="text-[11px] font-semibold text-accent">
                {memberError}
              </p>
            ) : null}
            <PrimaryButton disabled={isSaving || !name.trim() || !email.trim()}>
              {isSaving ? <Spinner className="size-3.5" /> : <Users className="size-3.5" aria-hidden />}
              Add member
            </PrimaryButton>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function NewProductionDialog({
  title,
  studio,
  onTitleChange,
  onStudioChange,
  onSubmit,
  onClose
}: {
  title: string;
  studio: string;
  onTitleChange: (value: string) => void;
  onStudioChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="new-project-title"
        aria-modal="true"
        role="dialog"
        className="w-full max-w-lg border-2 border-cyan-pop bg-panel p-6 shadow-card"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <PixelLabel>NEW WORKSPACE</PixelLabel>
            <BungeeHeading id="new-project-title" className="mt-1 text-xl">
              Create a project
            </BungeeHeading>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-line px-2 py-1 font-pixel text-[9px] text-lavender-soft transition hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            CLOSE
          </button>
        </div>

        <p className="mt-4 text-sm leading-6 text-lavender-pale">
          Set up a dedicated workspace before you start researching scripts and tracking findings.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <PixelLabel>PROJECT TITLE</PixelLabel>
            <input
              autoFocus
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="e.g. Neon Skywalk"
              required
              className="mt-2 block w-full border-2 border-ink bg-white px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-pop"
            />
          </label>
          <label className="block">
            <PixelLabel>STUDIO · OPTIONAL</PixelLabel>
            <input
              value={studio}
              onChange={(event) => onStudioChange(event.target.value)}
              placeholder="e.g. Fabled Pictures"
              className="mt-2 block w-full border-2 border-ink bg-white px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-pop"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton disabled={!title.trim()}>
              <FolderPlus className="size-4" aria-hidden />
              ▶ Create project
            </PrimaryButton>
          </div>
        </form>
      </section>
    </div>
  );
}

function AgentRunsView({ runs }: { runs: AgentRun[] }) {
  return (
    <div className="max-w-[492px] space-y-4">
      <PixelLabel>AGENT RUNS</PixelLabel>
      <BungeeHeading className="text-xl">Agent activity</BungeeHeading>
      {runs.length === 0 ? (
        <FigmaCard>
          <p className="text-[11px] leading-[17px] text-ink-soft">
            No agent runs yet. Trigger a clearance brief or watch run from the overview.
          </p>
        </FigmaCard>
      ) : (
        <ul className="space-y-2.5">
          {runs.map((run) => (
            <li key={run.id} className="border-2 border-ink bg-exhibit p-4 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-[10px] text-ink">
                  {run.kind === 'digest' ? '✦ Clearance brief' : '⚡ Watch agent'}
                </span>
                <span
                  className={`border px-1.5 py-0.5 font-pixel text-[8px] ${
                    run.status === 'completed'
                      ? 'border-ink text-ink'
                      : run.status === 'failed'
                        ? 'border-accent text-accent'
                        : 'border-line-strong text-line-strong'
                  }`}
                >
                  {run.status.toUpperCase()}
                </span>
              </div>
              <p className="mt-2 text-[11.5px] leading-[17.83px] text-ink-soft">{run.summary}</p>
              <p className="mt-2 font-pixel text-[8px] text-muted">
                {run.trigger.toUpperCase()} · {new Date(run.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductionSettings({
  production,
  onSaved,
  onError
}: {
  production: ProductionSummary;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [title, setTitle] = useState(production.title);
  const [studio, setStudio] = useState(production.studio ?? '');
  const [status, setStatus] = useState<ProductionStatus>(production.status ?? 'development');
  const [icon, setIcon] = useState<string>(production.icon ?? 'clapperboard');
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    onError(null);
    try {
      await updateProduction(
        production.id,
        { title: title.trim(), studio: studio.trim(), status, icon },
        API_BASE_URL
      );
      await onSaved();
    } catch {
      onError('Could not save production settings.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-[492px] space-y-4">
      <div>
        <PixelLabel>SETTINGS</PixelLabel>
        <BungeeHeading className="mt-1 text-xl">Production settings</BungeeHeading>
      </div>

      <FigmaCard>
        <form onSubmit={submit} className="space-y-5">
          <div>
            <PixelLabel>ICON</PixelLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(PRODUCTION_ICONS) as ProductionIcon[]).map((name) => {
                const Icon = PRODUCTION_ICONS[name];
                const selected = icon === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setIcon(name)}
                    aria-pressed={selected}
                    aria-label={`Icon: ${name}`}
                    className={`flex size-11 items-center justify-center border-2 transition focus-visible:outline-2 focus-visible:outline-cyan-pop ${
                      selected
                        ? 'border-ink bg-brand text-ink shadow-press'
                        : 'border-line bg-panel text-lavender-soft hover:border-line-strong'
                    }`}
                  >
                    <Icon className="size-5" aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="settings-title"
                className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
              >
                TITLE
              </label>
              <input
                id="settings-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="mt-1.5 block w-full border-2 border-ink bg-white px-2.5 py-2 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              />
            </div>
            <div>
              <label
                htmlFor="settings-studio"
                className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
              >
                STUDIO
              </label>
              <input
                id="settings-studio"
                value={studio}
                onChange={(e) => setStudio(e.target.value)}
                className="mt-1.5 block w-full border-2 border-ink bg-white px-2.5 py-2 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="settings-status"
              className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
            >
              STATUS
            </label>
            <select
              id="settings-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductionStatus)}
              className="mt-1.5 block w-full border-2 border-ink bg-white px-2.5 py-2 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
            >
              {(Object.keys(STATUS_LABELS) as ProductionStatus[]).map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <PrimaryButton disabled={isSaving || !title.trim()}>
              {isSaving ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                '▶ Save settings'
              )}
            </PrimaryButton>
          </div>
        </form>
      </FigmaCard>
    </div>
  );
}
