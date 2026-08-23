'use client';

import {
  createProduction,
  listAgentRuns,
  listProductions,
  runDigest,
  runWatch,
  updateProduction,
  type AgentRun,
  type ProductionStatus,
  type ProductionSummary
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
  Radar,
  Settings,
  Sparkles,
  Star,
  Tv,
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

function BungeeHeading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2
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

type View = { kind: 'case' } | { kind: 'overview' } | { kind: 'runs' } | { kind: 'settings' };

export function Dashboard() {
  const [productions, setProductions] = useState<ProductionSummary[]>([]);
  const [activeProductionId, setActiveProductionId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'case' });
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [isLoadingProductions, setIsLoadingProductions] = useState(false);
  const [isRunningAgent, setIsRunningAgent] = useState<'digest' | 'watch' | null>(null);
  const [showNewProduction, setShowNewProduction] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStudio, setNewStudio] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeProduction = productions.find((p) => p.id === activeProductionId) ?? null;

  const refreshProductions = useCallback(async () => {
    setError(null);
    try {
      const list = await listProductions(API_BASE_URL);
      setProductions(list);
      setActiveProductionId((current) => current ?? (list[0]?.id ?? null));
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoadingProductions(true);
      try {
        const list = await listProductions(API_BASE_URL);
        if (cancelled) return;
        setProductions(list);
        if (list.length > 0) {
          setActiveProductionId((current) => current ?? list[0].id);
        }
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

  async function triggerAgent(kind: 'digest' | 'watch') {
    if (!activeProductionId) return;
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
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r-2 border-line bg-panel">
        <div className="border-b-2 border-line p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center border-2 border-ink bg-brand shadow-press">
              <Radar className="size-4 text-ink" aria-hidden />
            </span>
            <span className="font-display text-sm text-paper [text-shadow:2px_2px_0_#aab5c4]">
              RightsRadar
            </span>
          </div>
          <p className="mt-2 font-pixel text-[8px] text-lavender">RIGHTS CLEARANCE OS</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between">
            <PixelLabel>PRODUCTIONS</PixelLabel>
            <button
              type="button"
              onClick={() => setShowNewProduction((v) => !v)}
              className="text-lavender transition hover:text-brand focus-visible:outline-2 focus-visible:outline-brand"
              aria-label="New production"
            >
              <FolderPlus className="size-4" aria-hidden />
            </button>
          </div>

          {showNewProduction ? (
            <form
              onSubmit={submitProduction}
              className="mb-3 space-y-2 border-2 border-ink bg-exhibit p-2.5 shadow-card"
            >
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Production title"
                required
                className="block w-full border-2 border-ink bg-white px-2 py-1.5 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              />
              <input
                value={newStudio}
                onChange={(e) => setNewStudio(e.target.value)}
                placeholder="Studio (optional)"
                className="block w-full border-2 border-ink bg-white px-2 py-1.5 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              />
              <PrimaryButton disabled={!newTitle.trim()}>▶ Create</PrimaryButton>
            </form>
          ) : null}

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
                        ? 'border-ink bg-white text-ink shadow-press'
                        : 'border-transparent text-lavender-soft hover:border-line hover:bg-panel'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {(() => {
                          const Icon = productionIcon(production.icon);
                          return <Icon className="size-3.5 shrink-0" aria-hidden />;
                        })()}
                        <span className="line-clamp-1 font-display text-[10px]">
                          {production.title}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 border px-1 py-0.5 font-pixel text-[7px] ${STATUS_COLORS[production.status ?? 'development']}`}
                      >
                        {STATUS_LABELS[production.status ?? 'development']}
                      </span>
                    </span>
                    <span className="mt-1 block text-[9.5px] text-muted">
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
          <nav className="border-t-2 border-line p-3">
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

      {/* Main pane */}
      <main className="min-w-0 flex-1 overflow-y-auto p-6 sm:p-8">
        {error ? (
          <p
            className="mb-4 flex items-start gap-2.5 border-2 border-accent bg-danger-bg px-4 py-3 text-sm font-semibold text-accent"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {view.kind === 'case' || !activeProduction ? (
          <ScriptReview productionId={activeProduction?.id} />
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
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                {(() => {
                  const Icon = productionIcon(activeProduction.icon);
                  return (
                    <span className="flex size-12 shrink-0 items-center justify-center border-2 border-ink bg-white shadow-press">
                      <Icon className="size-6 text-ink" aria-hidden />
                    </span>
                  );
                })()}
                <div>
                  <PixelLabel>PRODUCTION</PixelLabel>
                  <BungeeHeading className="mt-1 text-2xl">{activeProduction.title}</BungeeHeading>
                  <p className="mt-1 text-[11.5px] text-lavender-soft">
                    {activeProduction.studio || 'No studio'} ·{' '}
                    {STATUS_LABELS[activeProduction.status ?? 'development']}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <GhostButton
                  disabled={isRunningAgent !== null}
                  onClick={() => triggerAgent('digest')}
                >
                  {isRunningAgent === 'digest' ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <Sparkles className="size-3.5" aria-hidden />
                  )}
                  Clearance brief
                </GhostButton>
                <PrimaryButton
                  type="button"
                  disabled={isRunningAgent !== null}
                  onClick={() => triggerAgent('watch')}
                >
                  {isRunningAgent === 'watch' ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <Bot className="size-3.5" aria-hidden />
                  )}
                  ▶ Run watch agent
                </PrimaryButton>
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: 'CASES', value: activeProduction.case_count ?? 0, icon: Briefcase },
                {
                  label: 'OPEN FINDINGS',
                  value: activeProduction.open_finding_count ?? 0,
                  icon: FileSearch
                },
                {
                  label: 'ESCALATED',
                  value: activeProduction.escalated_finding_count ?? 0,
                  icon: Bot
                }
              ].map((stat) => (
                <Panel key={stat.label} glow={false}>
                  <div className="flex items-center justify-between">
                    <PixelLabel>{stat.label}</PixelLabel>
                    <stat.icon className="size-4 text-cyan-pop" aria-hidden />
                  </div>
                  <p className="mt-2 font-display text-3xl text-paper [text-shadow:2px_2px_0_#aab5c4]">
                    {stat.value}
                  </p>
                </Panel>
              ))}
            </div>

            {/* Latest brief */}
            <Panel>
              <div className="flex items-center justify-between">
                <PixelLabel>LATEST CLEARANCE BRIEF</PixelLabel>
                <Sparkles className="size-4 text-brand" aria-hidden />
              </div>
              {latestBrief ? (
                <>
                  <p className="mt-3 text-[12px] leading-[18px] text-paper">{latestBrief.summary}</p>
                  <p className="mt-2 font-pixel text-[8px] text-muted">
                    {new Date(latestBrief.created_at).toLocaleString()}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-[11.5px] italic leading-[17.83px] text-lavender-soft">
                  No brief yet. Run the clearance brief agent to summarize open findings across this
                  production.
                </p>
              )}
            </Panel>

            {/* Cases quick link */}
            <Panel glow={false}>
              <div className="flex items-center justify-between">
                <PixelLabel>CASES</PixelLabel>
                <button
                  type="button"
                  onClick={() => setView({ kind: 'case' })}
                  className="inline-flex items-center gap-1 font-display text-[9px] text-brand transition hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-brand"
                >
                  New case <ChevronRight className="size-3.5" aria-hidden />
                </button>
              </div>
              <p className="mt-2 text-[11.5px] leading-[17.83px] text-lavender-soft">
                {activeProduction.case_count ?? 0} case(s) in this production. Open the New case
                workspace to analyze a script excerpt against this production.
              </p>
            </Panel>
          </div>
        )}
      </main>
    </div>
  );
}

function AgentRunsView({ runs }: { runs: AgentRun[] }) {
  return (
    <div className="space-y-4">
      <PixelLabel>AGENT RUNS</PixelLabel>
      <BungeeHeading className="text-xl">Agent activity</BungeeHeading>
      {runs.length === 0 ? (
        <Panel>
          <p className="text-[11.5px] italic leading-[17.83px] text-lavender-soft">
            No agent runs yet. Trigger a clearance brief or watch run from the overview.
          </p>
        </Panel>
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
    <div className="space-y-6">
      <div>
        <PixelLabel>SETTINGS</PixelLabel>
        <BungeeHeading className="mt-1 text-xl">Production settings</BungeeHeading>
      </div>

      <Panel glow={false}>
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
      </Panel>
    </div>
  );
}
