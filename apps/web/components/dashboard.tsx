'use client';

import {
  createProduction,
  deleteProductionIcon,
  listProductionCases,
  listProductions,
  uploadProductionIcon,
  updateProduction,
  type Case,
  type ProductionStatus,
  type ProductionSummary,
  type ProjectIndustry
} from '@rightsrader/api-client';
import {
  BookOpen,
  Briefcase,
  ChevronRight,
  Clapperboard,
  FileSearch,
  Film,
  FolderPlus,
  Gamepad2,
  Home,
  ImagePlus,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Megaphone,
  Mic2,
  Music,
  Newspaper,
  Radar,
  Scale,
  Settings,
  ShieldCheck,
  Star,
  Trash2,
  Tv,
  Users,
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

const PROJECT_INDUSTRIES: Record<
  ProjectIndustry,
  {
    label: string;
    organizationPlaceholder: string;
    materialSummary: string;
    defaultIcon: string;
  }
> = {
  film_tv: {
    label: 'Film & television',
    organizationPlaceholder: 'Studio or production company',
    materialSummary: 'scripts, treatments, storyboards, cuts, and production art',
    defaultIcon: 'clapperboard'
  },
  advertising: {
    label: 'Advertising & branded content',
    organizationPlaceholder: 'Agency, brand, or client',
    materialSummary: 'campaign copy, boards, spots, social creative, and brand assets',
    defaultIcon: 'megaphone'
  },
  gaming: {
    label: 'Games & interactive',
    organizationPlaceholder: 'Game studio or publisher',
    materialSummary: 'narrative scripts, concept art, environments, characters, and marketing assets',
    defaultIcon: 'gamepad'
  },
  music: {
    label: 'Music & live entertainment',
    organizationPlaceholder: 'Label, artist, promoter, or venue',
    materialSummary: 'lyrics, samples, recordings, artwork, visuals, and promotional materials',
    defaultIcon: 'music'
  },
  podcast_audio: {
    label: 'Podcasts & audio',
    organizationPlaceholder: 'Network, show, or production company',
    materialSummary: 'episode scripts, transcripts, clips, music cues, artwork, and ad reads',
    defaultIcon: 'mic'
  },
  publishing: {
    label: 'Publishing',
    organizationPlaceholder: 'Publisher, imprint, or author organization',
    materialSummary: 'manuscripts, excerpts, cover art, illustrations, quotes, and publicity copy',
    defaultIcon: 'book'
  },
  digital_media: {
    label: 'Digital media & creators',
    organizationPlaceholder: 'Publisher, channel, creator, or network',
    materialSummary: 'video scripts, posts, newsletters, thumbnails, clips, and sponsored content',
    defaultIcon: 'newspaper'
  }
};

const STATUS_LABELS: Record<ProjectIndustry, Record<ProductionStatus, string>> = {
  film_tv: {
    development: 'Development',
    pre_production: 'Pre-production',
    shooting: 'Production',
    post: 'Post',
    released: 'Released'
  },
  advertising: {
    development: 'Concept',
    pre_production: 'Pre-production',
    shooting: 'Production',
    post: 'Client review',
    released: 'Launched'
  },
  gaming: {
    development: 'Concept',
    pre_production: 'Pre-production',
    shooting: 'Development',
    post: 'QA & launch',
    released: 'Released'
  },
  music: {
    development: 'Development',
    pre_production: 'Pre-production',
    shooting: 'Recording',
    post: 'Mix & master',
    released: 'Released'
  },
  podcast_audio: {
    development: 'Concept',
    pre_production: 'Pre-production',
    shooting: 'Recording',
    post: 'Post',
    released: 'Published'
  },
  publishing: {
    development: 'Development',
    pre_production: 'Editorial',
    shooting: 'Production',
    post: 'Final review',
    released: 'Published'
  },
  digital_media: {
    development: 'Planning',
    pre_production: 'Pre-production',
    shooting: 'Production',
    post: 'Post',
    released: 'Published'
  }
};

function projectIndustry(project: ProductionSummary): ProjectIndustry {
  return project.industry ?? 'film_tv';
}

function projectStatusLabel(project: ProductionSummary): string {
  return STATUS_LABELS[projectIndustry(project)][project.status ?? 'development'];
}

const STATUS_COLORS: Record<ProductionStatus, string> = {
  development: 'border-lavender text-lavender',
  pre_production: 'border-cyan-pop text-cyan-pop',
  shooting: 'border-accent text-accent',
  post: 'border-brand text-brand',
  released: 'border-paper text-paper'
};

const CLEARANCE_TEAMS = [
  {
    title: 'Rights & clearance',
    description: 'Triage names, brands, quotes, likenesses, artwork, music, and other research leads.',
    icon: ListChecks
  },
  {
    title: 'Creative & delivery',
    description: 'Resolve material and asset changes before production or launch costs compound.',
    icon: Users
  },
  {
    title: 'Legal & business affairs',
    description: 'Review evidence, direct permissions, and prepare the record for counsel and E&O.',
    icon: Scale
  }
] as const;

const PRODUCT_DIFFERENTIATORS = [
  {
    label: 'EARLIER',
    title: 'Start with the material',
    description: 'Scan script text, PDFs, DOCX files, and imagery while creative choices can still move.'
  },
  {
    label: 'GROUNDED',
    title: 'Keep the evidence attached',
    description: 'Pair each detected lead with verified public-web sources and a curation rationale.'
  },
  {
    label: 'REVIEWABLE',
    title: 'Make the handoff explicit',
    description:
      'Let people assign, discuss, clear, dismiss, or escalate findings without pretending AI is counsel.'
  }
] as const;

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
  book: BookOpen,
  clapperboard: Clapperboard,
  film: Film,
  gamepad: Gamepad2,
  megaphone: Megaphone,
  mic: Mic2,
  video: Video,
  tv: Tv,
  music: Music,
  newspaper: Newspaper,
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
    case 'book':
      return <BookOpen {...props} />;
    case 'film':
      return <Film {...props} />;
    case 'gamepad':
      return <Gamepad2 {...props} />;
    case 'megaphone':
      return <Megaphone {...props} />;
    case 'mic':
      return <Mic2 {...props} />;
    case 'video':
      return <Video {...props} />;
    case 'tv':
      return <Tv {...props} />;
    case 'music':
      return <Music {...props} />;
    case 'newspaper':
      return <Newspaper {...props} />;
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
  const [productionCases, setProductionCases] = useState<Case[]>([]);
  const [activeProductionId, setActiveProductionId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [isLoadingProductions, setIsLoadingProductions] = useState(false);
  const [isLoadingProductionCases, setIsLoadingProductionCases] = useState(false);
  const [showNewProduction, setShowNewProduction] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStudio, setNewStudio] = useState('');
  const [newIndustry, setNewIndustry] = useState<ProjectIndustry>('film_tv');
  const [error, setError] = useState<string | null>(null);
  const [selectedProductionCaseId, setSelectedProductionCaseId] = useState<string | null>(
    null
  );
  const workspaceRef = useRef<HTMLElement>(null);

  const activeProduction = productions.find((p) => p.id === activeProductionId) ?? null;

  const refreshProductions = useCallback(async () => {
    setError(null);
    try {
      const list = await listProductions(API_BASE_URL);
      setProductions(list);
      setActiveProductionId((current) => current ?? (list[0]?.id ?? null));
    } catch {
      setError('Could not load projects.');
    }
  }, []);

  const refreshProductionCases = useCallback(async (productionId: string) => {
    setIsLoadingProductionCases(true);
    try {
      setProductionCases(await listProductionCases(productionId, API_BASE_URL));
    } catch {
      setError('Could not load this project’s cases and findings.');
    } finally {
      setIsLoadingProductionCases(false);
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
        if (!cancelled) setError('Could not load projects.');
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

  useEffect(() => {
    if (!activeProductionId) return;
    let cancelled = false;
    (async () => {
      try {
        const cases = await listProductionCases(activeProductionId, API_BASE_URL);
        if (cancelled) return;
        setProductionCases(cases);
        setSelectedProductionCaseId(null);
      } catch {
        if (!cancelled) setError('Could not load this project’s cases and findings.');
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
        {
          title: newTitle.trim(),
          studio: newStudio.trim(),
          industry: newIndustry,
          icon: PROJECT_INDUSTRIES[newIndustry].defaultIcon
        },
        API_BASE_URL
      );
      setNewTitle('');
      setNewStudio('');
      setNewIndustry('film_tv');
      setShowNewProduction(false);
      await refreshProductions();
      setActiveProductionId(created.id);
      setView({ kind: 'overview' });
    } catch {
      setError('Could not create the project.');
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
            aria-label="All projects"
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
            <PixelLabel>RIGHTS PROJECTS</PixelLabel>
            <button
              type="button"
              onClick={() => setShowNewProduction((v) => !v)}
              className="text-lavender transition hover:text-brand focus-visible:outline-2 focus-visible:outline-brand"
              aria-label="New project"
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
                placeholder="Project title"
                required
                className="block w-full border-2 border-ink bg-white px-2 py-1.5 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              />
              <select
                value={newIndustry}
                onChange={(event) => setNewIndustry(event.target.value as ProjectIndustry)}
                aria-label="Project industry"
                className="block w-full border-2 border-ink bg-white px-2 py-1.5 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              >
                {(Object.keys(PROJECT_INDUSTRIES) as ProjectIndustry[]).map((industry) => (
                  <option key={industry} value={industry}>
                    {PROJECT_INDUSTRIES[industry].label}
                  </option>
                ))}
              </select>
              <input
                value={newStudio}
                onChange={(e) => setNewStudio(e.target.value)}
                placeholder={`${PROJECT_INDUSTRIES[newIndustry].organizationPlaceholder} (optional)`}
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
              No projects yet. Create one to begin tracking clearance.
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
                        {projectStatusLabel(production)}
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
                  All projects
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
          <ScriptReview
            productionId={activeProduction?.id}
            industry={activeProduction ? projectIndustry(activeProduction) : 'film_tv'}
            onCaseCreated={() => {
              void refreshProductions();
              if (activeProductionId) void refreshProductionCases(activeProductionId);
            }}
            onCaseUpdated={() => {
              void refreshProductions();
              if (activeProductionId) void refreshProductionCases(activeProductionId);
            }}
          />
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
                  <PixelLabel>{PROJECT_INDUSTRIES[projectIndustry(activeProduction)].label}</PixelLabel>
                  <BungeeHeading className="mt-1 text-2xl">{activeProduction.title}</BungeeHeading>
                  <p className="mt-1 text-[11.5px] text-lavender-soft">
                    {activeProduction.studio || 'No organization'} ·{' '}
                    {projectStatusLabel(activeProduction)}
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

            <section aria-labelledby="production-cases-heading">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <PixelLabel>CASES &amp; FINDINGS</PixelLabel>
                  <BungeeHeading id="production-cases-heading" className="mt-1 text-xl">
                    Project inventory
                  </BungeeHeading>
                </div>
                <button
                  type="button"
                  onClick={() => setView({ kind: 'case' })}
                  className="inline-flex items-center gap-1 border-2 border-ink bg-brand px-3 py-2 font-display text-[9px] text-ink shadow-press transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-cyan-pop"
                >
                  New case <ChevronRight className="size-3.5" aria-hidden />
                </button>
              </div>

              {isLoadingProductionCases ? (
                <Panel glow={false}>
                  <p className="flex items-center gap-2 text-[11px] text-lavender-soft">
                    <Spinner className="size-3.5" /> Loading cases and findings…
                  </p>
                </Panel>
              ) : productionCases.length === 0 ? (
                <Panel glow={false}>
                  <p className="text-[11.5px] leading-[17.83px] text-lavender-soft">
                    This project has no cases yet. Create one from text, a PDF, DOCX, or image.
                  </p>
                </Panel>
              ) : (
                <ul className="space-y-4" data-testid="production-case-inventory">
                  {productionCases.map((productionCase, caseIndex) => (
                    <li
                      key={productionCase.id}
                      className={`border-2 bg-panel transition ${
                        selectedProductionCaseId === productionCase.id
                          ? 'border-cyan-pop shadow-[4px_4px_0_#00e5ff]'
                          : 'border-line hover:border-cyan-pop'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedProductionCaseId((current) =>
                            current === productionCase.id ? null : productionCase.id
                          )
                        }
                        aria-expanded={selectedProductionCaseId === productionCase.id}
                        aria-controls={`case-details-${productionCase.id}`}
                        className="block w-full p-5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-cyan-pop"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-pixel text-[7px] text-cyan-pop">
                              CASE {String(productionCases.length - caseIndex).padStart(2, '0')}
                            </p>
                            <h3 className="mt-2 font-display text-sm text-paper">
                              {productionCase.title || 'Untitled material review'}
                            </h3>
                            <p className="mt-1 font-pixel text-[7px] text-lavender">
                              {new Date(productionCase.created_at).toLocaleString()} ·{' '}
                              {productionCase.asset_count ?? 0} attached{' '}
                              {(productionCase.asset_count ?? 0) === 1 ? 'asset' : 'assets'}
                            </p>
                          </div>
                          <span className="flex items-center gap-2">
                            <span className="border border-ink bg-white px-2 py-1 font-pixel text-[7px] text-ink">
                              {productionCase.findings.length}{' '}
                              {productionCase.findings.length === 1 ? 'FINDING' : 'FINDINGS'}
                            </span>
                            <ChevronRight
                              className={`size-4 text-cyan-pop transition ${
                                selectedProductionCaseId === productionCase.id ? 'rotate-90' : ''
                              }`}
                              aria-hidden
                            />
                          </span>
                        </div>

                        <p className="mt-4 line-clamp-3 border-l-2 border-brand pl-3 text-[11px] leading-[17px] text-lavender-soft">
                          {productionCase.script_text}
                        </p>
                        <p className="mt-3 font-pixel text-[7px] text-brand">
                          {selectedProductionCaseId === productionCase.id
                            ? 'HIDE CASE DETAILS'
                            : 'VIEW CASE DETAILS'}
                        </p>
                      </button>

                      {selectedProductionCaseId === productionCase.id ? (
                        <div
                          id={`case-details-${productionCase.id}`}
                          className="border-t-2 border-line bg-canvas/20 p-5"
                          data-testid="production-case-details"
                        >
                          <div>
                            <PixelLabel>SOURCE MATERIAL</PixelLabel>
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap border border-line bg-canvas/40 p-4 font-mono text-[10.5px] leading-[17px] text-lavender-soft">
                              {productionCase.script_text}
                            </pre>
                          </div>

                          <div className="mt-5">
                            <PixelLabel>RESEARCH FINDINGS</PixelLabel>
                            {productionCase.findings.length === 0 ? (
                              <p className="mt-2 text-[10.5px] italic text-lavender-soft">
                                No research leads were found in this case.
                              </p>
                            ) : (
                              <ul className="mt-3 space-y-3">
                                {productionCase.findings.map((finding) => (
                                  <li
                                    key={finding.id}
                                    className="border border-line bg-panel p-4"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-pixel text-[7px] uppercase text-lavender">
                                        {finding.category.replace(/_/g, ' ')}
                                      </span>
                                      <span
                                        className={`border px-1.5 py-0.5 font-pixel text-[7px] ${
                                          finding.reviewer_status === 'escalated'
                                            ? 'border-accent text-accent'
                                            : finding.reviewer_status === 'dismissed'
                                              ? 'border-lavender text-lavender'
                                              : finding.reviewer_status === 'accepted'
                                                ? 'border-brand text-brand'
                                                : 'border-cyan-pop text-cyan-pop'
                                        }`}
                                      >
                                        {finding.reviewer_status.toUpperCase()}
                                      </span>
                                    </div>
                                    <h4 className="mt-2 font-display text-[11px] text-paper">
                                      {finding.detected_item}
                                    </h4>
                                    <p className="mt-2 text-[10.5px] leading-[17px] text-lavender-soft">
                                      {finding.explanation}
                                    </p>
                                    <p className="mt-3 font-pixel text-[7px] text-lavender">
                                      {Math.round(finding.confidence * 100)}% CONFIDENCE ·{' '}
                                      {finding.source_urls.length}{' '}
                                      {finding.source_urls.length === 1
                                        ? 'WEB SOURCE'
                                        : 'WEB SOURCES'}
                                    </p>
                                    {finding.assignee || finding.due_date || finding.comments?.length ? (
                                      <div className="mt-3 flex flex-wrap gap-1.5">
                                        {finding.assignee ? (
                                          <span className="border border-cyan-pop px-2 py-1 text-[9px] font-bold text-cyan-pop">
                                            OWNER: {finding.assignee}
                                          </span>
                                        ) : null}
                                        {finding.due_date ? (
                                          <span className="border border-brand px-2 py-1 text-[9px] font-bold text-brand">
                                            DUE: {finding.due_date}
                                          </span>
                                        ) : null}
                                        {finding.comments?.length ? (
                                          <span className="border border-lavender px-2 py-1 text-[9px] font-bold text-lavender">
                                            {finding.comments.length}{' '}
                                            {finding.comments.length === 1 ? 'NOTE' : 'NOTES'}
                                          </span>
                                        ) : null}
                                      </div>
                                    ) : null}

                                    {finding.evidence?.rationale ? (
                                      <p className="mt-3 border-l-2 border-brand pl-3 text-[10.5px] leading-[17px] text-paper">
                                        <strong className="text-brand">Why this evidence:</strong>{' '}
                                        {finding.evidence.rationale}
                                      </p>
                                    ) : null}

                                    {finding.supporting_evidence.length > 0 ? (
                                      <ul className="mt-3 space-y-2">
                                        {finding.supporting_evidence.map((evidence) => (
                                          <li
                                            key={evidence.source.url}
                                            className="border border-line bg-canvas/30 p-3"
                                          >
                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                              <a
                                                href={evidence.source.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 font-display text-[8px] text-cyan-pop underline-offset-2 hover:underline"
                                              >
                                                {evidence.source.title}
                                                <ChevronRight
                                                  className="size-3"
                                                  aria-hidden
                                                />
                                              </a>
                                              {finding.evidence?.primary?.source.url ===
                                              evidence.source.url ? (
                                                <span className="border border-brand px-1.5 py-0.5 font-pixel text-[6px] text-brand">
                                                  PRIMARY
                                                </span>
                                              ) : (
                                                <span className="border border-lavender px-1.5 py-0.5 font-pixel text-[6px] text-lavender">
                                                  ALTERNATIVE
                                                </span>
                                              )}
                                            </div>

                                            <div className="mt-3 border-l-2 border-cyan-pop pl-3">
                                              <p className="font-pixel text-[6.5px] text-cyan-pop">
                                                HUMAN-READABLE SUMMARY
                                              </p>
                                              <p className="mt-1.5 text-[10.5px] leading-[17px] text-paper">
                                                {finding.evidence?.primary?.source.url ===
                                                  evidence.source.url &&
                                                finding.evidence.rationale
                                                  ? finding.evidence.rationale
                                                  : `Parallel returned this as an additional source for “${finding.detected_item}.” Review it alongside the primary evidence before making a clearance decision.`}
                                              </p>
                                            </div>

                                            <details className="mt-3 border-t border-line pt-3">
                                              <summary className="cursor-pointer font-pixel text-[7px] text-brand marker:text-cyan-pop">
                                                VIEW RAW PARALLEL EXTRACT
                                              </summary>
                                              <div className="mt-3">
                                                <p className="font-pixel text-[6.5px] text-lavender">
                                                  RAW PROVIDER RETURN
                                                </p>
                                                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap border border-line bg-canvas/60 p-3 font-mono text-[9.5px] leading-4 text-lavender-pale">
                                                  {evidence.excerpt}
                                                </pre>
                                              </div>
                                            </details>
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="mt-3 text-[9.5px] italic text-lavender-soft">
                                        No web source was verified for this finding.
                                      </p>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
  const [industryFilter, setIndustryFilter] = useState<'all' | ProjectIndustry>('all');
  const sortedProductions = useMemo(() => {
    const sorted = productions.filter(
      (project) => industryFilter === 'all' || projectIndustry(project) === industryFilter
    );
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
  }, [industryFilter, productions, sortBy]);

  return (
    <div className="space-y-7">
      <header className="relative overflow-hidden border-2 border-line bg-panel px-6 py-8 sm:px-8">
        <div className="absolute -right-12 -top-16 size-48 rounded-full bg-brand/20 blur-3xl" />
        <div className="absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-pop/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <PixelLabel>EVIDENCE-FIRST CREATIVE RIGHTS CLEARANCE</PixelLabel>
            <h1 className="mt-2 font-display text-3xl text-paper [text-shadow:3px_3px_0_#aab5c4] sm:text-4xl">
              Find the lead. Route the decision.
            </h1>
            <p className="mt-3 max-w-xl text-[12px] leading-5 text-lavender-soft">
              Turn creative materials into source-backed research leads, then keep clearance,
              creative, delivery, and legal teams aligned through human review.
            </p>
          </div>
          <PrimaryButton type="button" onClick={onCreate}>
            <FolderPlus className="size-4" aria-hidden /> New project
          </PrimaryButton>
        </div>
      </header>

      <section aria-labelledby="industries-title">
        <div>
          <PixelLabel>ACROSS THE MEDIA VALUE CHAIN</PixelLabel>
          <BungeeHeading className="mt-1 text-xl" id="industries-title">
            Rights research for every creative format
          </BungeeHeading>
        </div>
        <ul className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(PROJECT_INDUSTRIES) as ProjectIndustry[]).map((industry) => (
            <li
              key={industry}
              className="border border-line bg-panel px-2.5 py-1.5 font-pixel text-[7px] text-lavender-soft"
            >
              {PROJECT_INDUSTRIES[industry].label.toUpperCase()}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="clearance-teams-title">
        <div>
          <PixelLabel>BUILT FOR THE HANDOFF</PixelLabel>
          <BungeeHeading className="mt-1 text-xl" id="clearance-teams-title">
            One record across the clearance chain
          </BungeeHeading>
        </div>
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          {CLEARANCE_TEAMS.map((team) => (
            <li key={team.title} className="border-2 border-line bg-panel p-4">
              <span className="flex size-9 items-center justify-center border-2 border-ink bg-cyan-pop text-ink shadow-press">
                <team.icon className="size-4" aria-hidden />
              </span>
              <h2 className="mt-3 font-display text-[12px] text-paper">{team.title}</h2>
              <p className="mt-2 text-[10.5px] leading-4 text-lavender-soft">
                {team.description}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="border-2 border-line bg-panel p-5"
        aria-labelledby="rights-radar-difference-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <PixelLabel>WHY RIGHTSRADAR</PixelLabel>
            <BungeeHeading className="mt-1 text-xl" id="rights-radar-difference-title">
              Research layer, not another rights database
            </BungeeHeading>
          </div>
          <ShieldCheck className="size-6 text-brand" aria-hidden />
        </div>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {PRODUCT_DIFFERENTIATORS.map((item, index) => (
            <li key={item.label} className="border-l-2 border-brand pl-3">
              <p className="font-pixel text-[7px] text-cyan-pop">
                {String(index + 1).padStart(2, '0')} / {item.label}
              </p>
              <h2 className="mt-2 font-display text-[11px] text-paper">{item.title}</h2>
              <p className="mt-1.5 text-[10.5px] leading-4 text-lavender-soft">
                {item.description}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="project-portfolio-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <PixelLabel>PORTFOLIO</PixelLabel>
            <BungeeHeading className="mt-1 text-xl" id="project-portfolio-title">
              All projects
            </BungeeHeading>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-pixel text-[8px] text-lavender">
              {sortedProductions.length} SHOWN / {productions.length} TRACKED
            </span>
            <label className="flex items-center gap-2 font-pixel text-[8px] text-lavender">
              INDUSTRY
              <select
                value={industryFilter}
                onChange={(event) =>
                  setIndustryFilter(event.target.value as 'all' | ProjectIndustry)
                }
                className="border-2 border-ink bg-white px-2 py-1.5 font-sans text-[11px] font-bold text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
                aria-label="Filter projects by industry"
              >
                <option value="all">All industries</option>
                {(Object.keys(PROJECT_INDUSTRIES) as ProjectIndustry[]).map((industry) => (
                  <option key={industry} value={industry}>
                    {PROJECT_INDUSTRIES[industry].label}
                  </option>
                ))}
              </select>
            </label>
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
                aria-label="Sort projects"
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
              <Spinner className="size-3.5" /> Loading projects…
            </p>
          </Panel>
        ) : sortedProductions.length === 0 ? (
          <Panel>
            <div className="py-8 text-center">
              <Clapperboard className="mx-auto size-9 text-brand" aria-hidden />
              <p className="mt-4 font-display text-sm text-paper">
                {industryFilter === 'all' ? 'No projects yet' : 'No projects in this industry'}
              </p>
              <p className="mt-2 text-[11px] text-lavender-soft">
                {industryFilter === 'all'
                  ? 'Create the first project to begin tracking clearance.'
                  : 'Choose another industry or create a matching project.'}
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
                      {projectStatusLabel(production)}
                    </span>
                  </div>
                  <h2 className="mt-4 font-display text-base text-paper transition group-hover:text-cyan-pop">
                    {production.title}
                  </h2>
                  <p className="mt-1 min-h-4 text-[10.5px] text-lavender-soft">
                    {production.studio || 'Independent project'}
                  </p>
                  <p className="mt-2 font-pixel text-[6.5px] text-cyan-pop">
                    {PROJECT_INDUSTRIES[projectIndustry(production)].label.toUpperCase()}
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
  const [industry, setIndustry] = useState<ProjectIndustry>(projectIndustry(production));
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
      onError('The custom project icon could not be uploaded.');
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
      onError('The custom project icon could not be removed.');
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
          industry,
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
      onError('Could not save project settings.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <PixelLabel>SETTINGS</PixelLabel>
        <BungeeHeading className="mt-1 text-xl">Project settings</BungeeHeading>
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

          <div className="grid gap-4 sm:grid-cols-3">
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
                ORGANIZATION / CLIENT
              </label>
              <input
                id="settings-studio"
                value={studio}
                onChange={(e) => setStudio(e.target.value)}
                className="mt-1.5 block w-full border-2 border-ink bg-white px-2.5 py-2 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              />
            </div>
            <div>
              <label
                htmlFor="settings-industry"
                className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
              >
                INDUSTRY
              </label>
              <select
                id="settings-industry"
                value={industry}
                onChange={(event) => setIndustry(event.target.value as ProjectIndustry)}
                className="mt-1.5 block w-full border-2 border-ink bg-white px-2.5 py-2 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              >
                {(Object.keys(PROJECT_INDUSTRIES) as ProjectIndustry[]).map((value) => (
                  <option key={value} value={value}>
                    {PROJECT_INDUSTRIES[value].label}
                  </option>
                ))}
              </select>
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
              {(Object.keys(STATUS_COLORS) as ProductionStatus[]).map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[industry][value]}
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
              results and provider usage for this project. Existing findings are unchanged.
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
