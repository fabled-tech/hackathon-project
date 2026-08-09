'use client';

import {
  createCase,
  getCase,
  listAssets,
  listCases,
  type Asset,
  type Case,
  type CaseSummary,
  type Finding,
  type ReviewerStatus,
  uploadAsset,
  updateFindingStatus
} from '@rightsrader/api-client';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  Film,
  Flag,
  History,
  Loader2,
  Paperclip,
  Quote,
  Radar,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Upload,
  XCircle
} from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';

const SAMPLE_SCRIPT =
  'INT. EDIT SUITE — NIGHT\n\nMARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says, and marks the take.';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

function statusLabel(status: ReviewerStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}% confidence`;
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
  pending: 'border-slate-200 bg-slate-100 text-slate-600',
  dismissed: 'border-rose-200 bg-rose-50 text-rose-700',
  escalated: 'border-amber-200 bg-amber-50 text-amber-700',
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700'
};

const STATUS_ICONS: Record<ReviewerStatus, typeof Clock3> = {
  pending: Clock3,
  dismissed: XCircle,
  escalated: Flag,
  accepted: CheckCircle2
};

function StatusBadge({ status }: { status: ReviewerStatus }) {
  const Icon = STATUS_ICONS[status] ?? Clock3;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
        STATUS_STYLES[status] ?? STATUS_STYLES.pending
      }`}
    >
      <Icon className="size-3.5" aria-hidden />
      {statusLabel(status)}
    </span>
  );
}

function Spinner({ className = 'size-4' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden />;
}

function SectionCard({
  step,
  icon,
  title,
  action,
  children
}: {
  step?: string;
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-6 shadow-card sm:p-7">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            {icon}
          </span>
          <div>
            {step ? (
              <p className="text-xs font-bold uppercase tracking-widest text-brand">{step}</p>
            ) : null}
            <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
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
      className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function ScriptReview() {
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT);
  const [caseResult, setCaseResult] = useState<Case | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recentCases, setRecentCases] = useState<CaseSummary[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingRecentCases, setIsLoadingRecentCases] = useState(false);
  const [isLoadingCaseId, setIsLoadingCaseId] = useState<string | null>(null);
  const [updatingFindingId, setUpdatingFindingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const caseOperationGeneration = useRef(0);
  const activeCaseIdRef = useRef<string | null>(null);
  const submissionGeneration = useRef(0);
  const uploadGeneration = useRef(0);
  const caseLoadingGeneration = useRef(0);

  async function submitScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operationGeneration = ++caseOperationGeneration.current;
    const requestGeneration = ++submissionGeneration.current;
    setIsSubmitting(true);
    setError(null);
    try {
      const nextCase = await createCase({ script_text: scriptText }, API_BASE_URL);
      if (caseOperationGeneration.current !== operationGeneration) {
        return;
      }
      activeCaseIdRef.current = nextCase.id;
      setCaseResult(nextCase);
      setAssets([]);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      if (caseOperationGeneration.current === operationGeneration) {
        setError('RightsRadar could not analyze this script right now. Please try again.');
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
    if (!caseResult) return;
    setUpdatingFindingId(finding.id);
    setError(null);
    try {
      const updatedFinding = await updateFindingStatus(
        caseResult.id,
        finding.id,
        reviewerStatus,
        API_BASE_URL
      );
      setCaseResult((current) =>
        current
          ? {
              ...current,
              findings: current.findings.map((candidate) =>
                candidate.id === updatedFinding.id ? updatedFinding : candidate
              )
            }
          : current
      );
    } catch {
      setError('The reviewer status could not be saved. Please try again.');
    } finally {
      setUpdatingFindingId(null);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-panel/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand text-white shadow-card">
              <Radar className="size-5" aria-hidden />
            </span>
            <span className="text-lg font-bold tracking-tight text-ink">RightsRadar</span>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1 text-xs font-semibold text-muted sm:inline-flex">
            <ShieldCheck className="size-3.5 text-brand" aria-hidden />
            Research assistance only
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
        <div className="max-w-2xl pb-10 pt-12 sm:pt-16">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand-soft px-3 py-1 text-xs font-bold uppercase tracking-widest text-brand">
            <Film className="size-3.5" aria-hidden />
            Rights clearance research
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            Clear scripts with confidence
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            Surface potential research leads for brands, quotations, characters, franchises, and
            likenesses, then let a human reviewer decide what needs follow-up.
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <aside
              className="flex items-start gap-3 rounded-xl border border-warn-line bg-warn-bg p-4 text-sm leading-relaxed text-warn"
              aria-label="Legal disclaimer"
            >
              <Scale className="mt-0.5 size-5 shrink-0" aria-hidden />
              <p>
                <strong className="font-semibold">Research assistance only.</strong> RightsRadar
                does not provide legal advice or make final infringement determinations. Verify
                findings with qualified counsel and your clearance process.
              </p>
            </aside>

            <div className="animate-fade-up">
              <SectionCard
                step="Step 1"
                icon={<Search className="size-5" aria-hidden />}
                title="Review a script excerpt"
              >
                <form onSubmit={submitScript} className="space-y-3">
                  <label
                    htmlFor="script-text"
                    className="block text-sm font-semibold text-ink-soft"
                  >
                    Script text
                  </label>
                  <textarea
                    id="script-text"
                    name="script-text"
                    value={scriptText}
                    onChange={(event) => setScriptText(event.target.value)}
                    rows={9}
                    maxLength={20_000}
                    required
                    placeholder="Paste a script excerpt to scan for rights-clearance research leads…"
                    className="block w-full resize-y rounded-xl border border-line-strong bg-white px-4 py-3 font-mono text-sm leading-relaxed text-ink shadow-inner transition placeholder:text-faint hover:border-faint focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs tabular-nums text-muted">
                      {scriptText.length.toLocaleString()} / 20,000 characters
                    </span>
                    <PrimaryButton disabled={isSubmitting || scriptText.trim().length === 0}>
                      {isSubmitting ? (
                        <>
                          <Spinner /> Analyzing…
                        </>
                      ) : (
                        <>
                          <Search className="size-4" aria-hidden /> Analyze script
                        </>
                      )}
                    </PrimaryButton>
                  </div>
                </form>
              </SectionCard>
            </div>

            {error ? (
              <p
                className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-danger-bg px-4 py-3 text-sm font-semibold text-danger"
                role="alert"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}

            {caseResult ? (
              <>
                <div className="animate-fade-up">
                  <SectionCard
                    step="Step 2"
                    icon={<Flag className="size-5" aria-hidden />}
                    title="Potential research leads"
                    action={
                      <span className="rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold tabular-nums text-brand">
                        {caseResult.findings.length}{' '}
                        {caseResult.findings.length === 1 ? 'finding' : 'findings'}
                      </span>
                    }
                  >
                    {caseResult.findings.length === 0 ? (
                      <p className="text-sm leading-relaxed text-muted">
                        No deterministic research leads were found in this excerpt. That is not a
                        clearance conclusion.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {caseResult.findings.map((finding) => (
                          <article
                            className="rounded-xl border border-line bg-white p-5 shadow-card transition hover:shadow-pop"
                            data-testid="finding-card"
                            key={finding.id}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                                {finding.category.replace(/_/g, ' ')}
                              </span>
                              <StatusBadge status={finding.reviewer_status} />
                            </div>
                            <h3 className="mt-2 text-base font-semibold tracking-tight text-ink">
                              {finding.detected_item}
                            </h3>
                            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                              {finding.explanation}
                            </p>
                            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                              <div>
                                <dt className="text-xs font-bold uppercase tracking-wider text-muted">
                                  Assessment
                                </dt>
                                <dd className="mt-1 text-sm font-medium text-ink">
                                  {confidenceLabel(finding.confidence)}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-bold uppercase tracking-wider text-muted">
                                  Retrieved
                                </dt>
                                <dd className="mt-1 text-sm font-medium text-ink">
                                  {formatDateTime(finding.retrieved_at)}
                                </dd>
                              </div>
                            </dl>
                            <div className="mt-4 space-y-3 border-t border-line pt-4">
                              <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
                                Evidence and citations
                              </h4>
                              {finding.supporting_evidence.map((evidence) => (
                                <blockquote
                                  key={evidence.source.url}
                                  className="flex gap-3 rounded-lg bg-canvas p-3.5"
                                >
                                  <Quote
                                    className="mt-0.5 size-4 shrink-0 text-brand"
                                    aria-hidden
                                  />
                                  <div>
                                    <p className="text-sm italic leading-relaxed text-ink-soft">
                                      “{evidence.excerpt}”
                                    </p>
                                    <a
                                      href={evidence.source.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-brand underline-offset-2 transition hover:text-brand-strong hover:underline"
                                    >
                                      {evidence.source.title}
                                      <ArrowUpRight className="size-3.5" aria-hidden />
                                    </a>
                                  </div>
                                </blockquote>
                              ))}
                            </div>
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                                Human review
                              </span>
                              <div className="flex gap-2.5">
                                <button
                                  type="button"
                                  disabled={updatingFindingId === finding.id}
                                  onClick={() => changeStatus(finding, 'dismissed')}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink-soft shadow-card transition hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {updatingFindingId === finding.id ? (
                                    <Spinner className="size-3.5" />
                                  ) : (
                                    <XCircle className="size-4" aria-hidden />
                                  )}
                                  Dismiss
                                </button>
                                <button
                                  type="button"
                                  disabled={updatingFindingId === finding.id}
                                  onClick={() => changeStatus(finding, 'escalated')}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {updatingFindingId === finding.id ? (
                                    <Spinner className="size-3.5" />
                                  ) : (
                                    <AlertTriangle className="size-4" aria-hidden />
                                  )}
                                  Escalate
                                </button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                </div>

                <div className="animate-fade-up">
                  <SectionCard
                    step="Step 3"
                    icon={<Paperclip className="size-5" aria-hidden />}
                    title="Attach a production note"
                  >
                    <form onSubmit={submitAsset} className="space-y-3">
                      <label
                        htmlFor="asset-file"
                        className="block text-sm font-semibold text-ink-soft"
                      >
                        Attach plain-text asset
                      </label>
                      <input
                        ref={fileInputRef}
                        id="asset-file"
                        name="asset-file"
                        type="file"
                        accept="text/plain,.txt"
                        onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                        className="block w-full cursor-pointer rounded-xl border border-dashed border-line-strong bg-canvas px-3.5 py-3 text-sm text-muted transition file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-soft file:px-3.5 file:py-2 file:text-sm file:font-semibold file:text-brand hover:border-brand/40 hover:file:bg-brand-ring/40 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
                      />
                      {selectedFile ? (
                        <p
                          className="flex items-center gap-2 text-sm text-muted"
                          aria-live="polite"
                        >
                          <FileText className="size-4 shrink-0 text-brand" aria-hidden />
                          Selected: {selectedFile.name} ({fileSizeLabel(selectedFile.size)})
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs text-muted">
                          Plain-text files only, up to 256 KiB.
                        </span>
                        <PrimaryButton disabled={!selectedFile || isUploading}>
                          {isUploading ? (
                            <>
                              <Spinner /> Uploading…
                            </>
                          ) : (
                            <>
                              <Upload className="size-4" aria-hidden /> Upload asset
                            </>
                          )}
                        </PrimaryButton>
                      </div>
                    </form>

                    <div
                      className="mt-6 border-t border-line pt-5"
                      data-testid="asset-list"
                      aria-live="polite"
                    >
                      <h3 className="mb-3 text-sm font-semibold text-ink">Attached assets</h3>
                      {assets.length === 0 ? (
                        <p className="text-sm leading-relaxed text-muted">
                          No plain-text production notes are attached yet.
                        </p>
                      ) : (
                        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
                          {assets.map((asset) => (
                            <li
                              key={asset.id}
                              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
                            >
                              <span className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-ink">
                                <FileText className="size-4 shrink-0 text-brand" aria-hidden />
                                <span className="truncate">{asset.filename}</span>
                              </span>
                              <span className="text-xs text-muted">
                                {asset.content_type} · {fileSizeLabel(asset.byte_size)} · uploaded{' '}
                                {formatDateTime(asset.created_at)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </SectionCard>
                </div>
              </>
            ) : null}
          </div>

          <aside className="animate-fade-up lg:sticky lg:top-24">
            <SectionCard
              icon={<History className="size-5" aria-hidden />}
              title="Recent cases"
              action={
                <button
                  type="button"
                  onClick={refreshRecentCases}
                  disabled={isLoadingRecentCases}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-soft shadow-card transition hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingRecentCases ? (
                    <>
                      <Spinner className="size-3.5" /> Loading…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="size-3.5" aria-hidden /> Refresh recent cases
                    </>
                  )}
                </button>
              }
            >
              <div data-testid="recent-cases" aria-live="polite">
                {recentCases.length === 0 ? (
                  <p className="text-sm leading-relaxed text-muted">
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
                          className="group w-full rounded-xl border border-line bg-white px-4 py-3 text-left shadow-card transition hover:border-brand/40 hover:bg-brand-soft/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span className="flex items-start justify-between gap-2 text-sm font-medium leading-snug text-ink">
                            <span className="line-clamp-2">{recentCase.script_excerpt}</span>
                            {isLoadingCaseId === recentCase.id ? (
                              <Spinner className="mt-0.5 size-4 shrink-0" />
                            ) : null}
                          </span>
                          <span className="mt-1.5 block text-xs tabular-nums text-muted">
                            {recentCase.finding_count} findings · {recentCase.asset_count} assets ·{' '}
                            {formatDateTime(recentCase.created_at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </SectionCard>
          </aside>
        </div>
      </main>
    </div>
  );
}
