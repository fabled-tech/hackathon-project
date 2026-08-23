'use client';

import {
  createCase,
  escalateFinding,
  getCase,
  listAssets,
  listCases,
  type Asset,
  type Case,
  type CaseSummary,
  type Finding,
  type ReviewerStatus,
  type WorkspaceMember,
  uploadAsset,
  updateFindingStatus
} from '@rightsrader/api-client';
import { ArrowUpRight, CircleAlert, FileText, Loader2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

function statusLabel(status: ReviewerStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
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
  pending: 'border-ink text-ink',
  dismissed: 'border-muted text-muted',
  escalated: 'border-ink bg-accent-soft text-ink',
  accepted: 'border-ink text-ink'
};

const STATUS_LABELS: Record<ReviewerStatus, string> = {
  pending: 'Pending',
  dismissed: 'Dismissed',
  escalated: '⚡ Escalated',
  accepted: '✓ Cleared'
};

function StatusStamp({ status }: { status: ReviewerStatus }) {
  return (
    <span className="inline-block rotate-2 shrink-0">
      <span
        className={`inline-flex items-center border px-2.5 py-1 font-display text-[10px] uppercase ${
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
    <p className="font-pixel text-[9.5px] leading-relaxed text-lavender">{children}</p>
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
  onClick,
  type = 'button'
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'submit' | 'button';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex shrink-0 items-center gap-1.5 border-2 border-ink bg-gradient-to-b from-accent-soft via-accent to-accent-strong px-3 py-2 font-display text-[10px] text-white shadow-press [text-shadow:0_1px_1px_rgb(0_0_0/0.3)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function ScriptReview({
  productionId,
  productionTitle,
  members,
  onCaseCreated,
  onHandoffCompleted,
  onOpenTeam
}: {
  productionId: string;
  productionTitle: string;
  members: WorkspaceMember[];
  onCaseCreated?: () => void | Promise<void>;
  onHandoffCompleted?: () => void | Promise<void>;
  onOpenTeam: () => void;
}) {
  const [scriptText, setScriptText] = useState('');
  const [caseResult, setCaseResult] = useState<Case | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recentCases, setRecentCases] = useState<CaseSummary[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingRecentCases, setIsLoadingRecentCases] = useState(false);
  const [isLoadingCaseId, setIsLoadingCaseId] = useState<string | null>(null);
  const [updatingFindingId, setUpdatingFindingId] = useState<string | null>(null);
  const [handoffFinding, setHandoffFinding] = useState<Finding | null>(null);
  const [handoffAssigneeId, setHandoffAssigneeId] = useState('');
  const [handoffDueDate, setHandoffDueDate] = useState('');
  const [isEscalating, setIsEscalating] = useState(false);
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
      const nextCase = await createCase(
        { script_text: scriptText, production_id: productionId ?? null },
        API_BASE_URL
      );
      if (caseOperationGeneration.current !== operationGeneration) {
        return;
      }
      activeCaseIdRef.current = nextCase.id;
      setCaseResult(nextCase);
      setAssets([]);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await onCaseCreated?.();
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

  function openHandoff(finding: Finding) {
    setHandoffFinding(finding);
    setHandoffAssigneeId('');
    setHandoffDueDate('');
  }

  async function submitHandoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caseResult || !handoffFinding || !handoffAssigneeId) return;
    setIsEscalating(true);
    setError(null);
    try {
      const updatedFinding = await escalateFinding(
        productionId,
        caseResult.id,
        handoffFinding.id,
        { assignee: handoffAssigneeId, due_date: handoffDueDate || null },
        API_BASE_URL
      );
      setCaseResult((current) =>
        current
          ? {
              ...current,
              findings: current.findings.map((finding) =>
                finding.id === updatedFinding.id ? updatedFinding : finding
              )
            }
          : current
      );
      setHandoffFinding(null);
      await onHandoffCompleted?.();
    } catch {
      setError('The handoff could not be created. Confirm the assignee is still in the team directory.');
    } finally {
      setIsEscalating(false);
    }
  }

  return (
    <div className="max-w-[960px]">
      <div className="pb-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center border-2 border-ink bg-white text-ink">
            <FileText className="size-4" aria-hidden />
          </span>
          <div>
            <PixelLabel>NEW CASE</PixelLabel>
            <h1 className="mt-1 font-display text-xl text-paper [text-shadow:2px_2px_0_#aab5c4]">
              Script intake
            </h1>
            <p className="mt-1 text-[9.5px] text-lavender-soft">{productionTitle}</p>
          </div>
        </div>
        <p className="mt-5 max-w-[680px] text-[11px] leading-[17px] text-lavender-soft">
          Surface potential research leads for brands, quotations, characters, franchises, and
          likenesses, then let a human reviewer decide what needs follow-up.
        </p>
      </div>

        <div className="space-y-5">
          <div className="space-y-5">
            <div className="animate-fade-up">
              <section className="border-2 border-ink bg-exhibit p-[14px] text-ink shadow-card">
                  <p className="font-pixel text-[8px] tracking-[0.16px] text-line-strong">
                    ▸ STEP 1 / SCRIPT TEXT
                  </p>
                  <aside
                    className="mt-3 border border-warn-line bg-warn-bg p-3 text-[10px] leading-[15px] text-ink-soft"
                    aria-label="Legal disclaimer"
                  >
                    <p>
                      <strong className="font-bold text-ink">Research assistance only.</strong>{' '}
                      RightsRadar does not provide legal advice or make final infringement
                      determinations. Verify findings with qualified counsel and your clearance
                      process.
                    </p>
                  </aside>

                  <form
                    onSubmit={submitScript}
                    className="mt-3 border-2 border-ink bg-white px-3 pb-3 pt-4"
                  >
                    <textarea
                      id="script-text"
                      name="script-text"
                      value={scriptText}
                      onChange={(event) => setScriptText(event.target.value)}
                      rows={5}
                      maxLength={20_000}
                      required
                      placeholder="Paste a script excerpt to scan for rights-clearance research leads…"
                      className="mt-2.5 block w-full resize-y border-2 border-ink bg-white px-2.5 py-2.5 text-[11px] leading-[17px] text-ink-soft transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cyan-pop"
                    />
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
                      <span className="font-pixel text-[8px] tabular-nums text-muted">
                        {scriptText.length.toLocaleString()} / 20,000
                      </span>
                      <PrimaryButton disabled={isSubmitting || scriptText.trim().length === 0}>
                        {isSubmitting ? (
                          <>
                            <Spinner /> Analyzing…
                          </>
                        ) : (
                          '▶ Analyze script'
                        )}
                      </PrimaryButton>
                    </div>
                  </form>
              </section>
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

            {caseResult ? (
              <>
                <div className="animate-fade-up">
                  <PixelLabel>02: Searching</PixelLabel>
                  <div className="mt-3">
                    <section className="border-2 border-ink bg-exhibit p-[14px] text-ink shadow-card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-pixel text-[8px] tracking-[0.16px] text-line-strong">
                            STEP 2 / FINDINGS
                          </p>
                          <h2 className="mt-2 font-display text-base text-ink">
                            Potential research leads
                          </h2>
                        </div>
                        <span className="border border-ink bg-white px-2 py-1 font-pixel text-[8.5px] text-ink">
                          {caseResult.findings.length}{' '}
                          {caseResult.findings.length === 1 ? 'FINDING' : 'FINDINGS'}
                        </span>
                      </div>

                      <div className="mt-4 space-y-4">
                        {caseResult.findings.length === 0 ? (
                          <p className="text-[11.5px] leading-[17.83px] text-lavender-soft">
                            No deterministic research leads were found in this excerpt. That is not
                            a clearance conclusion.
                          </p>
                        ) : (
                          caseResult.findings.map((finding, findingIndex) => (
                            <article
                              className="border-2 border-ink bg-exhibit p-[18px] shadow-pop"
                              data-testid="finding-card"
                              key={finding.id}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <span className="font-pixel text-[8px] uppercase leading-[14px] tracking-[0.16px] text-line-strong">
                                  Exhibit {String.fromCharCode(65 + findingIndex)}
                                  <br />
                                  {finding.category.replace(/_/g, ' ')}
                                </span>
                                <StatusStamp status={finding.reviewer_status} />
                              </div>
                              <h3 className="mt-2 font-display text-base leading-[21.6px] text-ink">
                                {finding.detected_item}
                              </h3>
                              <p className="mt-1.5 text-[11.5px] leading-[17.83px] text-ink-soft">
                                {finding.explanation}
                              </p>
                              <div className="mt-2.5 flex flex-wrap gap-1.5">
                                <span className="border border-ink bg-white px-2 py-0.5 text-[10.5px] font-bold text-ink">
                                  {Math.round(finding.confidence * 100)}% match
                                </span>
                                <span className="border border-ink bg-white px-2 py-0.5 text-[10.5px] font-bold text-ink">
                                  {formatDateTime(finding.retrieved_at)}
                                </span>
                              </div>
                              {finding.reviewer_status === 'escalated' ? (
                                <div className="mt-3 border border-accent bg-danger-bg px-3 py-2 text-[10.5px] text-ink">
                                  <strong>Organization handoff:</strong>{' '}
                                  {finding.assignee
                                    ? `Assigned to ${finding.assignee}`
                                    : 'Needs an owner'}
                                  {finding.due_date ? ` · Due ${finding.due_date}` : ''}
                                </div>
                              ) : null}
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
                                    disabled={updatingFindingId === finding.id || isEscalating}
                                    onClick={() => openHandoff(finding)}
                                  >
                                    {finding.reviewer_status === 'escalated'
                                      ? 'Reassign owner'
                                      : 'Assign follow-up ⚡'}
                                  </EscalateButton>
                                </div>
                              </div>
                              <p className="mt-2 text-right text-[9.5px] text-muted">
                                Sends this finding to the organization issue queue with an owner and due date.
                              </p>
                            </article>
                          ))
                        )}
                      </div>
                    </section>
                  </div>
                </div>

                <div className="animate-fade-up">
                  <PixelLabel>03: Tracklist</PixelLabel>
                  <div className="mt-3">
                    <section className="border-2 border-ink bg-exhibit p-[14px] text-ink shadow-card">
                      <p className="font-pixel text-[8px] tracking-[0.16px] text-line-strong">
                        STEP 3 / PRODUCTION NOTES
                      </p>
                      <h2 className="mt-2 font-display text-base text-ink">
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
                        <input
                          ref={fileInputRef}
                          id="asset-file"
                          name="asset-file"
                          type="file"
                          accept="text/plain,.txt"
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
                          <span className="font-pixel text-[8px] text-muted">
                            PLAIN-TEXT · 256 KIB MAX
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
                    </section>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <aside className="animate-fade-up">
            <PixelLabel>RECENT CASES</PixelLabel>
            <div className="mt-3">
              <Panel>
                <h2 className="font-display text-base text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4,1px_1px_0_#aab5c4]">
                  Your cases
                </h2>
                <p className="mt-1.5 text-[11.5px] leading-[17.83px] text-lavender-soft">
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
        </div>
      {handoffFinding ? (
        <HandoffDialog
          finding={handoffFinding}
          members={members}
          assigneeId={handoffAssigneeId}
          dueDate={handoffDueDate}
          isSubmitting={isEscalating}
          onAssigneeChange={setHandoffAssigneeId}
          onDueDateChange={setHandoffDueDate}
          onSubmit={submitHandoff}
          onClose={() => setHandoffFinding(null)}
          onOpenTeam={onOpenTeam}
        />
      ) : null}
    </div>
  );
}

function HandoffDialog({
  finding,
  members,
  assigneeId,
  dueDate,
  isSubmitting,
  onAssigneeChange,
  onDueDateChange,
  onSubmit,
  onClose,
  onOpenTeam
}: {
  finding: Finding;
  members: WorkspaceMember[];
  assigneeId: string;
  dueDate: string;
  isSubmitting: boolean;
  onAssigneeChange: (memberId: string) => void;
  onDueDateChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onOpenTeam: () => void;
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
        aria-labelledby="handoff-dialog-title"
        aria-modal="true"
        role="dialog"
        className="w-full max-w-xl border-2 border-accent bg-panel p-6 shadow-pop"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <PixelLabel>ORGANIZATION HANDOFF</PixelLabel>
            <h2
              id="handoff-dialog-title"
              className="mt-1 font-display text-xl text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4,1px_1px_0_#aab5c4]"
            >
              Assign follow-up
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-line px-2 py-1 font-pixel text-[9px] text-lavender-soft transition hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            CLOSE
          </button>
        </div>

        <div className="mt-5 border-2 border-line bg-ink/30 p-4">
          <p className="font-display text-[11px] text-paper">{finding.detected_item}</p>
          <p className="mt-2 text-[11px] leading-[17px] text-lavender-pale">
            This will mark the finding as escalated, create a visible item in the organization issue
            queue, and log the handoff for the assigned teammate.
          </p>
        </div>

        {members.length === 0 ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-lavender-pale">
              Add at least one teammate before escalating. A handoff needs a named owner so it does
              not disappear into an unassigned queue.
            </p>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton
                onClick={() => {
                  onClose();
                  onOpenTeam();
                }}
              >
                Open team directory
              </SecondaryButton>
              <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <label className="block">
              <span className="font-pixel text-[8px] text-lavender">ASSIGN TO</span>
              <select
                autoFocus
                required
                value={assigneeId}
                onChange={(event) => onAssigneeChange(event.target.value)}
                className="mt-1.5 block w-full border-2 border-ink bg-white px-2.5 py-2.5 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              >
                <option value="" disabled>
                  Select a workspace member
                </option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {member.role ?? 'clearance'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-pixel text-[8px] text-lavender">FOLLOW-UP DUE DATE</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => onDueDateChange(event.target.value)}
                className="mt-1.5 block w-full border-2 border-ink bg-white px-2.5 py-2.5 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
              <EscalateButton type="submit" disabled={isSubmitting || !assigneeId}>
                {isSubmitting ? <Spinner className="size-3.5" /> : null}
                Escalate and assign
              </EscalateButton>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
