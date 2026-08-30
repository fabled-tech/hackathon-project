'use client';

import {
  createProduction,
  deleteProductionIcon,
  listProductions,
  uploadProductionIcon,
  updateProduction,
  type ProductionStatus,
  type ProductionSummary
} from '@rightsrader/api-client';
import {
  Briefcase,
  ChevronRight,
  Clapperboard,
  FileSearch,
  Film,
  FolderPlus,
  Home,
  ImagePlus,
  LayoutDashboard,
  Loader2,
  Music,
  Radar,
  Settings,
  Star,
  Trash2,
  Tv,
  Video,
  Wand2
} from 'lucide-react';
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
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

function BuiltInProductionIcon({
  icon,
  className
}: {
  icon: string | undefined;
  className: string;
}) {
  const props = { className, 'aria-hidden': true } as const;
  switch (icon) {
    case 'film':
      return <Film {...props} />;
    case 'video':
      return <Video {...props} />;
    case 'tv':
      return <Tv {...props} />;
    case 'music':
      return <Music {...props} />;
    case 'star':
      return <Star {...props} />;
    case 'wand':
      return <Wand2 {...props} />;
    case 'briefcase':
      return <Briefcase {...props} />;
    default:
      return <Clapperboard {...props} />;
  }
}

function productionIconUrl(production: ProductionSummary): string | null {
  if (!production.icon_version) return null;
  return `${API_BASE_URL.replace(/\/$/, '')}/api/productions/${encodeURIComponent(
    production.id
  )}/icon/${encodeURIComponent(production.icon_version)}`;
}

function ProductionMark({
  production,
  className = 'size-10',
  iconClassName = 'size-5',
  forceBuiltIn = false,
  builtInIcon
}: {
  production: ProductionSummary;
  className?: string;
  iconClassName?: string;
  forceBuiltIn?: boolean;
  builtInIcon?: string;
}) {
  const customIconUrl = forceBuiltIn ? null : productionIconUrl(production);
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden border-2 border-ink bg-white bg-cover bg-center shadow-press ${className}`}
      style={customIconUrl ? { backgroundImage: `url("${customIconUrl}")` } : undefined}
      aria-label={customIconUrl ? `${production.title} custom icon` : undefined}
      role={customIconUrl ? 'img' : undefined}
    >
      {customIconUrl ? null : (
        <BuiltInProductionIcon
          icon={builtInIcon ?? production.icon}
          className={`${iconClassName} text-ink`}
        />
      )}
    </span>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const previousValue = useRef(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      previousValue.current = value;
      const frame = requestAnimationFrame(() => setDisplayValue(value));
      return () => cancelAnimationFrame(frame);
    }
    const from = previousValue.current;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / 320, 1);
      const eased = 1 - (1 - progress) ** 3;
      setDisplayValue(Math.round(from + (value - from) * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        previousValue.current = value;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{displayValue}</>;
}

type View =
  | { kind: 'home' }
  | { kind: 'case' }
  | { kind: 'overview' }
  | { kind: 'settings' };

export function Dashboard() {
  const [productions, setProductions] = useState<ProductionSummary[]>([]);
  const [activeProductionId, setActiveProductionId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [isLoadingProductions, setIsLoadingProductions] = useState(false);
  const [showNewProduction, setShowNewProduction] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStudio, setNewStudio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);

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
    const workspace = workspaceRef.current;
    if (!workspace || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const animation = workspace.animate(
      [
        { opacity: 0.55, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    );
    return () => animation.cancel();
  }, [activeProductionId, view.kind]);

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

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r-2 border-line bg-panel">
        <div className="border-b-2 border-line p-4">
          <button
            type="button"
            onClick={() => setView({ kind: 'home' })}
            className="flex items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-cyan-pop"
            aria-label="All productions"
          >
            <span className="flex size-8 items-center justify-center border-2 border-ink bg-brand shadow-press">
              <Radar className="size-4 text-ink" aria-hidden />
            </span>
            <span className="font-display text-xl text-paper [text-shadow:3px_3px_0_#aab5c4]">
              RightsRadar
            </span>
          </button>
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
                        <ProductionMark
                          production={production}
                          className="size-6 border"
                          iconClassName="size-3.5"
                        />
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
              <li>
                <button
                  type="button"
                  onClick={() => setView({ kind: 'home' })}
                  className={`flex w-full items-center gap-2 border-2 px-2.5 py-1.5 text-left font-display text-[9px] transition focus-visible:outline-2 focus-visible:outline-cyan-pop ${
                    view.kind === 'home'
                      ? 'border-ink bg-brand text-ink shadow-press'
                      : 'border-transparent text-lavender-soft hover:border-line'
                  }`}
                >
                  <Home className="size-3.5" aria-hidden />
                  All productions
                </button>
              </li>
              {(
                [
                  { kind: 'overview', label: 'Overview', icon: LayoutDashboard },
                  { kind: 'case', label: 'New case', icon: FileSearch },
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
      <main ref={workspaceRef} className="min-w-0 flex-1 overflow-y-auto p-6 sm:p-8">
        {error ? (
          <p
            className="mb-4 flex items-start gap-2.5 border-2 border-accent bg-danger-bg px-4 py-3 text-sm font-semibold text-accent"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {view.kind === 'home' ? (
          <ProductionsHome
            productions={productions}
            isLoading={isLoadingProductions}
            onCreate={() => setShowNewProduction(true)}
            onOpen={(productionId) => {
              setActiveProductionId(productionId);
              setView({ kind: 'overview' });
            }}
          />
        ) : view.kind === 'case' || !activeProduction ? (
          <ScriptReview productionId={activeProduction?.id} onCaseCreated={refreshProductions} />
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
                <ProductionMark
                  production={activeProduction}
                  className="size-12"
                  iconClassName="size-6"
                />
                <div>
                  <PixelLabel>PRODUCTION</PixelLabel>
                  <BungeeHeading className="mt-1 text-2xl">{activeProduction.title}</BungeeHeading>
                  <p className="mt-1 text-[11.5px] text-lavender-soft">
                    {activeProduction.studio || 'No studio'} ·{' '}
                    {STATUS_LABELS[activeProduction.status ?? 'development']}
                  </p>
                </div>
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
                  icon: Star
                }
              ].map((stat) => (
                <Panel key={stat.label} glow={false}>
                  <div className="flex items-center justify-between">
                    <PixelLabel>{stat.label}</PixelLabel>
                    <stat.icon className="size-4 text-cyan-pop" aria-hidden />
                  </div>
                  <p className="mt-2 font-display text-3xl text-paper [text-shadow:2px_2px_0_#aab5c4]">
                    <AnimatedNumber value={stat.value} />
                  </p>
                </Panel>
              ))}
            </div>

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

function ProductionsHome({
  productions,
  isLoading,
  onCreate,
  onOpen
}: {
  productions: ProductionSummary[];
  isLoading: boolean;
  onCreate: () => void;
  onOpen: (productionId: string) => void;
}) {
  const [sortBy, setSortBy] = useState<
    'newest' | 'title' | 'cases' | 'open' | 'escalated'
  >('newest');
  const sortedProductions = useMemo(() => {
    const sorted = [...productions];
    sorted.sort((left, right) => {
      if (sortBy === 'title') return left.title.localeCompare(right.title);
      if (sortBy === 'cases') return (right.case_count ?? 0) - (left.case_count ?? 0);
      if (sortBy === 'open') {
        return (right.open_finding_count ?? 0) - (left.open_finding_count ?? 0);
      }
      if (sortBy === 'escalated') {
        return (right.escalated_finding_count ?? 0) - (left.escalated_finding_count ?? 0);
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
    return sorted;
  }, [productions, sortBy]);

  return (
    <div className="space-y-7">
      <header className="relative overflow-hidden border-2 border-line bg-panel px-6 py-8 sm:px-8">
        <div className="absolute -right-12 -top-16 size-48 rounded-full bg-brand/20 blur-3xl" />
        <div className="absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-pop/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <PixelLabel>PRODUCTION RIGHTS WORKSPACE</PixelLabel>
            <h1 className="mt-2 font-display text-3xl text-paper [text-shadow:3px_3px_0_#aab5c4] sm:text-4xl">
              Production control room
            </h1>
            <p className="mt-3 max-w-xl text-[12px] leading-5 text-lavender-soft">
              Open a production to review scripts, track findings, attach clearance materials, and
              tune production-specific nuisance filters.
            </p>
          </div>
          <PrimaryButton type="button" onClick={onCreate}>
            <FolderPlus className="size-4" aria-hidden /> New production
          </PrimaryButton>
        </div>
      </header>

      <section aria-labelledby="production-portfolio-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <PixelLabel>PORTFOLIO</PixelLabel>
            <BungeeHeading className="mt-1 text-xl" id="production-portfolio-title">
              All productions
            </BungeeHeading>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-pixel text-[8px] text-lavender">
              {productions.length} TRACKED
            </span>
            <label className="flex items-center gap-2 font-pixel text-[8px] text-lavender">
              SORT
              <select
                value={sortBy}
                onChange={(event) =>
                  setSortBy(
                    event.target.value as 'newest' | 'title' | 'cases' | 'open' | 'escalated'
                  )
                }
                className="border-2 border-ink bg-white px-2 py-1.5 font-sans text-[11px] font-bold text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
                aria-label="Sort productions"
              >
                <option value="newest">Newest</option>
                <option value="title">Title A–Z</option>
                <option value="cases">Most cases</option>
                <option value="open">Most open findings</option>
                <option value="escalated">Most escalated</option>
              </select>
            </label>
          </div>
        </div>

        {isLoading ? (
          <Panel>
            <p className="flex items-center gap-2 text-[11px] text-lavender-soft">
              <Spinner className="size-3.5" /> Loading productions…
            </p>
          </Panel>
        ) : productions.length === 0 ? (
          <Panel>
            <div className="py-8 text-center">
              <Clapperboard className="mx-auto size-9 text-brand" aria-hidden />
              <p className="mt-4 font-display text-sm text-paper">No productions yet</p>
              <p className="mt-2 text-[11px] text-lavender-soft">
                Create the first production to begin tracking clearance.
              </p>
            </div>
          </Panel>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sortedProductions.map((production) => (
              <li key={production.id}>
                <button
                  type="button"
                  onClick={() => onOpen(production.id)}
                  className="group h-full w-full border-2 border-line bg-panel p-5 text-left transition hover:-translate-y-1 hover:border-cyan-pop hover:shadow-[5px_5px_0_#00e5ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-pop"
                >
                  <div className="flex items-start justify-between gap-3">
                    <ProductionMark
                      production={production}
                      className="size-14"
                      iconClassName="size-7"
                    />
                    <span
                      className={`border px-1.5 py-1 font-pixel text-[7px] ${
                        STATUS_COLORS[production.status ?? 'development']
                      }`}
                    >
                      {STATUS_LABELS[production.status ?? 'development']}
                    </span>
                  </div>
                  <h2 className="mt-4 font-display text-base text-paper transition group-hover:text-cyan-pop">
                    {production.title}
                  </h2>
                  <p className="mt-1 min-h-4 text-[10.5px] text-lavender-soft">
                    {production.studio || 'Independent production'}
                  </p>
                  <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                    {[
                      ['CASES', production.case_count ?? 0],
                      ['OPEN', production.open_finding_count ?? 0],
                      ['ESC.', production.escalated_finding_count ?? 0]
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="font-pixel text-[7px] text-muted">{label}</dt>
                        <dd className="mt-1 font-display text-lg text-paper">
                          <AnimatedNumber value={value as number} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
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
  const [ignoreKeywords, setIgnoreKeywords] = useState(
    (production.ignore_keywords ?? []).join('\n')
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [isRemovingIcon, setIsRemovingIcon] = useState(false);
  const [useBuiltInIcon, setUseBuiltInIcon] = useState(false);

  async function uploadCustomIcon(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      onError('Custom icons must be PNG, JPEG, or WebP images.');
      event.target.value = '';
      return;
    }
    if (file.size > 512 * 1024) {
      onError('Custom icons must not exceed 512 KiB.');
      event.target.value = '';
      return;
    }
    setIsUploadingIcon(true);
    onError(null);
    try {
      await uploadProductionIcon(production.id, file, API_BASE_URL);
      setUseBuiltInIcon(false);
      await onSaved();
    } catch {
      onError('The custom production icon could not be uploaded.');
    } finally {
      setIsUploadingIcon(false);
      event.target.value = '';
    }
  }

  async function removeCustomIcon() {
    setIsRemovingIcon(true);
    onError(null);
    try {
      await deleteProductionIcon(production.id, API_BASE_URL);
      setUseBuiltInIcon(false);
      await onSaved();
    } catch {
      onError('The custom production icon could not be removed.');
    } finally {
      setIsRemovingIcon(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    onError(null);
    try {
      await updateProduction(
        production.id,
        {
          title: title.trim(),
          studio: studio.trim(),
          status,
          icon: useBuiltInIcon || !production.icon_version ? icon : undefined,
          ignore_keywords: ignoreKeywords
            .split('\n')
            .map((keyword) => keyword.trim())
            .filter(Boolean)
        },
        API_BASE_URL
      );
      setUseBuiltInIcon(false);
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
                    onClick={() => {
                      setIcon(name);
                      setUseBuiltInIcon(true);
                    }}
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
            <div className="mt-4 flex flex-wrap items-center gap-4 border-2 border-line bg-panel p-3">
              <ProductionMark
                production={production}
                builtInIcon={icon}
                forceBuiltIn={useBuiltInIcon}
                className="size-16"
                iconClassName="size-8"
              />
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="settings-custom-icon"
                  className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
                >
                  CUSTOM ICON
                </label>
                <p className="mt-1 text-[10.5px] leading-4 text-lavender-soft">
                  PNG, JPEG, or WebP · 512 KiB max. Square images work best.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <label
                    htmlFor="settings-custom-icon"
                    className="inline-flex cursor-pointer items-center gap-1.5 border-2 border-ink bg-brand px-2.5 py-1.5 font-display text-[9px] text-ink shadow-press transition hover:brightness-105"
                  >
                    {isUploadingIcon ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <ImagePlus className="size-3.5" aria-hidden />
                    )}
                    {production.icon_version ? 'Replace image' : 'Upload image'}
                  </label>
                  <input
                    id="settings-custom-icon"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={uploadCustomIcon}
                    disabled={isUploadingIcon || isRemovingIcon}
                    className="sr-only"
                  />
                  {production.icon_version && !useBuiltInIcon ? (
                    <button
                      type="button"
                      onClick={removeCustomIcon}
                      disabled={isRemovingIcon || isUploadingIcon}
                      className="inline-flex items-center gap-1.5 border-2 border-ink bg-white px-2.5 py-1.5 font-display text-[9px] text-ink shadow-press transition hover:bg-exhibit disabled:opacity-60"
                    >
                      {isRemovingIcon ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <Trash2 className="size-3.5" aria-hidden />
                      )}
                      Remove image
                    </button>
                  ) : null}
                </div>
              </div>
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

          <div>
            <label
              htmlFor="settings-ignore-keywords"
              className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
            >
              IGNORE PHRASES
            </label>
            <textarea
              id="settings-ignore-keywords"
              value={ignoreKeywords}
              onChange={(event) => setIgnoreKeywords(event.target.value)}
              rows={5}
              maxLength={5_000}
              placeholder={'Universal Studios\nNBC peacock'}
              aria-describedby="settings-ignore-keywords-help"
              className="mt-1.5 block w-full resize-y border-2 border-ink bg-white px-2.5 py-2 font-mono text-[11px] leading-5 text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
            />
            <p
              id="settings-ignore-keywords-help"
              className="mt-2 text-[10.5px] leading-4 text-lavender-soft"
            >
              One phrase per line, up to 50. Matching is case-insensitive and requires the whole
              phrase in a detected item. Matches are removed before web research, reducing nuisance
              results and provider usage for this production. Existing findings are unchanged.
            </p>
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
