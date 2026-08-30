'use client';

import {
  addFindingComment,
  createCase,
  createCaseFromFile,
  getCase,
  listAssets,
  listCases,
  type Asset,
  type Case,
  type CaseSummary,
  type Finding,
  type ProjectIndustry,
  type ReviewerStatus,
  uploadAsset,
  updateFindingMeta,
  updateFindingStatus
} from '@rightsrader/api-client';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  CircleAlert,
  FileSearch,
  FileText,
  FileUp,
  Globe2,
  Loader2,
  MessageSquareText,
  UserRound,
  Sparkles
} from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';

const SAMPLE_SCRIPT =
  'EXT. NEON SKYWALK — MIDNIGHT\n\nMARA skates through the rain, kicks a Nimbus Soda can into her palm, and smirks. "Time keeps the reel turning," she says as a drone camera dives past.';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

const INDUSTRY_MATERIAL_GUIDANCE: Record<
  ProjectIndustry,
  { intro: string; placeholder: string; note: string }
> = {
  film_tv: {
    intro: 'Paste a scene or upload a project file.',
    placeholder: 'Paste a script excerpt to scan for rights-clearance research leads…',
    note: 'scripts, treatments, storyboards, cuts, artwork, and clearance notes'
  },
  advertising: {
    intro: 'Paste campaign copy or upload creative.',
    placeholder: 'Paste campaign copy, a storyboard, or an ad script to scan for rights leads…',
    note: 'campaign copy, boards, spots, social creative, and brand assets'
  },
  gaming: {
    intro: 'Paste narrative content or upload game creative.',
    placeholder: 'Paste dialogue, lore, character notes, or marketing copy to scan for rights leads…',
    note: 'narrative scripts, concept art, characters, environments, and marketing assets'
  },
  music: {
    intro: 'Paste lyrics or cues, or upload release creative.',
    placeholder: 'Paste lyrics, sample notes, credits, or promotional copy to scan for rights leads…',
    note: 'lyrics, samples, recordings, artwork, visuals, and promotional materials'
  },
  podcast_audio: {
    intro: 'Paste an episode script or transcript, or upload show assets.',
    placeholder: 'Paste an episode script, transcript, ad read, or cue sheet to scan for rights leads…',
    note: 'episode scripts, transcripts, clips, music cues, artwork, and ad reads'
  },
  publishing: {
    intro: 'Paste manuscript copy or upload editorial material.',
    placeholder: 'Paste manuscript text, excerpts, quotes, or publicity copy to scan for rights leads…',
    note: 'manuscripts, excerpts, cover art, illustrations, quotes, and publicity copy'
  },
  digital_media: {
    intro: 'Paste creator copy or upload channel assets.',
    placeholder: 'Paste a video script, post, newsletter, or sponsor copy to scan for rights leads…',
    note: 'video scripts, posts, newsletters, thumbnails, clips, and sponsored content'
  }
};

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

function ClearButton({
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
      className="inline-flex shrink-0 items-center gap-1.5 border-2 border-ink bg-brand px-3 py-2 font-display text-[10px] text-ink shadow-press transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

type AgentWorkflowStatus = 'idle' | 'running' | 'complete' | 'failed';

function AgentPipeline({
  status,
  result
}: {
  status: AgentWorkflowStatus;
  result: Case | null;
}) {
  const findings = result?.findings ?? [];
  const citedSources = new Set(
    findings.flatMap((finding) => finding.source_urls)
  ).size;
  const curatedSources = findings.filter(
    (finding) => finding.evidence?.primary
  ).length;
  const stages = [
    {
      name: 'Gemini Intake',
      description: 'Detects clearance leads in text, documents, and imagery.',
      icon: <Sparkles className="size-3.5" aria-hidden />,
      output: `${findings.length} ${findings.length === 1 ? 'lead' : 'leads'} detected`
    },
    {
      name: 'Parallel Research',
      description: 'Searches and extracts relevant public web sources.',
      icon: <Globe2 className="size-3.5" aria-hidden />,
      output: `${citedSources} ${citedSources === 1 ? 'source' : 'sources'} verified`
    },
    {
      name: 'Gemini Curation',
      description: 'Selects grounded evidence and rejects unsupported citations.',
      icon: <FileSearch className="size-3.5" aria-hidden />,
      output: `${curatedSources} primary ${curatedSources === 1 ? 'source' : 'sources'} selected`
    }
  ];

  return (
    <section
      className="mt-4 border-2 border-line bg-panel p-4"
      aria-label="Case agent pipeline"
      data-testid="agent-pipeline"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-pixel text-[8px] tracking-[0.16px] text-cyan-pop">
            CASE AGENT PIPELINE
          </p>
          <p className="mt-1 text-[10.5px] leading-4 text-lavender-soft">
            Gemini and Parallel collaborate inside this case request. No separate run history is
            stored.
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
      </div>

      <ol className="mt-4 grid gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch">
        {stages.map((stage, index) => (
            <li key={stage.name} className="contents">
              <div
                className={`border-2 p-3 transition ${
                  status === 'running'
                    ? 'animate-pulse border-cyan-pop/70 bg-cyan-pop/5'
                    : status === 'complete'
                      ? 'border-brand/70 bg-brand/5'
                      : status === 'failed'
                        ? 'border-accent/70 bg-danger-bg'
                        : 'border-line bg-canvas/20'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center border border-line bg-canvas text-cyan-pop">
                    {status === 'complete' ? (
                      <Check className="size-3.5 text-brand" aria-hidden />
                    ) : status === 'running' ? (
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
                {status === 'complete' ? (
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
          ))}
      </ol>
    </section>
  );
}

function FindingHandoff({
  productionId,
  caseId,
  finding,
  onUpdated,
  onError
}: {
  productionId: string;
  caseId: string;
  finding: Finding;
  onUpdated: (finding: Finding) => void;
  onError: (message: string | null) => void;
}) {
  const [assignee, setAssignee] = useState(finding.assignee ?? '');
  const [dueDate, setDueDate] = useState(finding.due_date ?? '');
  const [commentAuthor, setCommentAuthor] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);
  const comments = finding.comments ?? [];

  async function saveHandoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingMeta(true);
    onError(null);
    try {
      const updatedFinding = await updateFindingMeta(
        productionId,
        caseId,
        finding.id,
        {
          assignee: assignee.trim(),
          due_date: dueDate
        },
        API_BASE_URL
      );
      onUpdated(updatedFinding);
    } catch {
      onError('The finding handoff could not be saved. Please try again.');
    } finally {
      setIsSavingMeta(false);
    }
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const author = commentAuthor.trim();
    const body = commentBody.trim();
    if (!author || !body) return;

    setIsAddingComment(true);
    onError(null);
    try {
      const updatedFinding = await addFindingComment(
        productionId,
        caseId,
        finding.id,
        { author, body },
        API_BASE_URL
      );
      onUpdated(updatedFinding);
      setCommentBody('');
    } catch {
      onError('The review note could not be added. Please try again.');
    } finally {
      setIsAddingComment(false);
    }
  }

  return (
    <section
      className="mt-4 border-2 border-ink bg-white p-3.5"
      aria-labelledby={`handoff-${finding.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4
            id={`handoff-${finding.id}`}
            className="font-display text-[11px] uppercase text-ink"
          >
            Review handoff
          </h4>
          <p className="mt-1 max-w-xl text-[10.5px] leading-4 text-muted">
            Assign the next owner and preserve the context creative, delivery, or counsel needs to resolve
            this lead.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 border border-ink bg-exhibit px-2 py-1 font-pixel text-[7px] text-ink">
          <MessageSquareText className="size-3" aria-hidden />
          {comments.length} {comments.length === 1 ? 'NOTE' : 'NOTES'}
        </span>
      </div>

      <form onSubmit={saveHandoff} className="mt-3 grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
        <label className="block">
          <span className="flex items-center gap-1 font-pixel text-[7px] text-line-strong">
            <UserRound className="size-3" aria-hidden /> OWNER / TEAM
          </span>
          <input
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            maxLength={120}
            placeholder="Clearance, creative, counsel…"
            aria-label={`Owner for ${finding.detected_item}`}
            className="mt-1.5 block w-full border-2 border-ink bg-white px-2 py-1.5 text-[10.5px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
          />
        </label>
        <label className="block">
          <span className="flex items-center gap-1 font-pixel text-[7px] text-line-strong">
            <CalendarClock className="size-3" aria-hidden /> DUE
          </span>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            aria-label={`Due date for ${finding.detected_item}`}
            className="mt-1.5 block w-full border-2 border-ink bg-white px-2 py-1.5 text-[10.5px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
          />
        </label>
        <div className="flex items-end">
          <PrimaryButton disabled={isSavingMeta}>
            {isSavingMeta ? <Spinner className="size-3.5" /> : null}
            Save handoff
          </PrimaryButton>
        </div>
      </form>

      {comments.length > 0 ? (
        <ol className="mt-3 space-y-2 border-t border-dashed border-faint pt-3">
          {comments.map((comment) => (
            <li key={comment.id} className="border-l-2 border-cyan-pop pl-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[10.5px] font-bold text-ink">{comment.author}</span>
                <time className="font-pixel text-[6.5px] text-muted">
                  {formatDateTime(comment.created_at)}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[10.5px] leading-4 text-ink-soft">
                {comment.body}
              </p>
            </li>
          ))}
        </ol>
      ) : null}

      <form
        onSubmit={addComment}
        className="mt-3 grid gap-2 border-t border-dashed border-faint pt-3 sm:grid-cols-[9rem_1fr_auto]"
      >
        <input
          value={commentAuthor}
          onChange={(event) => setCommentAuthor(event.target.value)}
          maxLength={120}
          required
          placeholder="Your name or team"
          aria-label={`Review note author for ${finding.detected_item}`}
          className="block w-full border-2 border-ink bg-white px-2 py-1.5 text-[10.5px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
        />
        <input
          value={commentBody}
          onChange={(event) => setCommentBody(event.target.value)}
          maxLength={4_000}
          required
          placeholder="Add the decision context, question, or next step…"
          aria-label={`Review note for ${finding.detected_item}`}
          className="block w-full border-2 border-ink bg-white px-2 py-1.5 text-[10.5px] text-ink focus:outline-none focus:ring-2 focus:ring-cyan-pop"
        />
        <SecondaryButton
          disabled={isAddingComment || !commentAuthor.trim() || !commentBody.trim()}
          type="submit"
        >
          {isAddingComment ? <Spinner className="size-3.5" /> : null}
          Add note
        </SecondaryButton>
      </form>
    </section>
  );
}

export function ScriptReview({
  productionId,
  industry = 'film_tv',
  onCaseCreated,
  onCaseUpdated
}: {
  productionId?: string;
  industry?: ProjectIndustry;
  onCaseCreated?: () => void;
  onCaseUpdated?: () => void;
} = {}) {
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT);
  const [caseResult, setCaseResult] = useState<Case | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [recentCases, setRecentCases] = useState<CaseSummary[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [agentWorkflowStatus, setAgentWorkflowStatus] =
    useState<AgentWorkflowStatus>('idle');
  const [isLoadingRecentCases, setIsLoadingRecentCases] = useState(false);
  const [isLoadingCaseId, setIsLoadingCaseId] = useState<string | null>(null);
  const [updatingFindingId, setUpdatingFindingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisFileInputRef = useRef<HTMLInputElement>(null);
  const caseOperationGeneration = useRef(0);
  const activeCaseIdRef = useRef<string | null>(null);
  const submissionGeneration = useRef(0);
  const uploadGeneration = useRef(0);
  const fileAnalysisGeneration = useRef(0);
  const caseLoadingGeneration = useRef(0);

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
    } catch {
      if (caseOperationGeneration.current === operationGeneration) {
        setAgentWorkflowStatus('failed');
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
    } catch {
      if (caseOperationGeneration.current === operationGeneration) {
        setAgentWorkflowStatus('failed');
        setError(
          'RightsRadar could not analyze this file. Use a PDF, DOCX, PNG, JPEG, or WebP file up to 10 MiB.'
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
      replaceFinding(updatedFinding);
    } catch {
      setError('The reviewer status could not be saved. Please try again.');
    } finally {
      setUpdatingFindingId(null);
    }
  }

  function replaceFinding(updatedFinding: Finding) {
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
    onCaseUpdated?.();
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-6xl px-5 pb-24 pt-12 sm:px-8 sm:pt-14">
        <div className="pb-10">
          <PixelLabel>Rights clearance research</PixelLabel>
          <h1 className="mt-3 font-display text-2xl text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4,1px_1px_0_#aab5c4] sm:text-3xl">
            RightsRadar
          </h1>
          <p className="mt-3 max-w-md text-[11.5px] leading-[17.83px] text-lavender-soft">
            Surface potential research leads for names, brands, quotations, characters, music,
            artwork, and likenesses, then let a human reviewer decide what needs follow-up.
          </p>
        </div>

        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-10">
            <div className="animate-fade-up">
              <PixelLabel>01: Material Checking</PixelLabel>
              <div className="mt-3">
                <Panel>
                  <p className="font-display text-xl text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4,1px_1px_0_#aab5c4]">
                    RightsRadar
                  </p>
                  <p className="mt-2 max-w-xs text-[11.5px] leading-[17.83px] text-lavender-soft">
                    {INDUSTRY_MATERIAL_GUIDANCE[industry].intro}{' '}
                    We&apos;ll surface what needs rights research before publication, launch, or
                    release.
                  </p>
                  <aside
                    className="mt-4 border border-warn-line bg-warn-bg p-3.5 text-[11px] leading-[17px] text-lavender-soft"
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
                    className="mt-4 border-2 border-ink bg-exhibit px-[18px] pb-[18px] pt-6 shadow-card"
                  >
                    <label
                      htmlFor="script-text"
                      className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
                    >
                      ▸ STEP 1 / Script text
                    </label>
                    <textarea
                      id="script-text"
                      name="script-text"
                      value={scriptText}
                      onChange={(event) => setScriptText(event.target.value)}
                      rows={8}
                      maxLength={20_000}
                      required
                      placeholder={INDUSTRY_MATERIAL_GUIDANCE[industry].placeholder}
                      className="mt-2.5 block w-full resize-y border-2 border-ink bg-white px-2.5 py-2.5 text-[11px] leading-[17px] text-ink-soft transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cyan-pop"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
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

                  {productionId ? (
                    <form
                      onSubmit={submitAnalysisFile}
                      className="mt-4 border-2 border-ink bg-exhibit p-[18px] shadow-card"
                    >
                      <label
                        htmlFor="analysis-file"
                        className="block font-pixel text-[8px] tracking-[0.16px] text-line-strong"
                      >
                        ▸ OR ANALYZE A PROJECT FILE
                      </label>
                      <p className="mt-2 text-[10.5px] leading-4 text-muted">
                        Best for {INDUSTRY_MATERIAL_GUIDANCE[industry].note}. Gemini reviews PDF and
                        image layout visually; DOCX text is extracted securely, then detected leads
                        are researched on the web through Parallel.
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
                  <AgentPipeline status={agentWorkflowStatus} result={caseResult} />
                </Panel>
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

            {caseResult ? (
              <>
                <div className="animate-fade-up">
                  <PixelLabel>02: Searching</PixelLabel>
                  <div className="mt-3">
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
                              {productionId ? (
                                <FindingHandoff
                                  productionId={productionId}
                                  caseId={caseResult.id}
                                  finding={finding}
                                  onUpdated={replaceFinding}
                                  onError={setError}
                                />
                              ) : null}
                              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
                                <span className="text-[10px] text-muted">✂ - - - - -</span>
                                <div className="flex gap-2.5">
                                  <ClearButton
                                    disabled={
                                      updatingFindingId === finding.id ||
                                      finding.reviewer_status === 'accepted'
                                    }
                                    onClick={() => changeStatus(finding, 'accepted')}
                                  >
                                    {updatingFindingId === finding.id ? (
                                      <Spinner className="size-3.5" />
                                    ) : (
                                      <Check className="size-3.5" aria-hidden />
                                    )}
                                    Clear
                                  </ClearButton>
                                  <SecondaryButton
                                    disabled={
                                      updatingFindingId === finding.id ||
                                      finding.reviewer_status === 'dismissed'
                                    }
                                    onClick={() => changeStatus(finding, 'dismissed')}
                                  >
                                    {updatingFindingId === finding.id ? (
                                      <Spinner className="size-3.5" />
                                    ) : null}
                                    Dismiss
                                  </SecondaryButton>
                                  <EscalateButton
                                    disabled={
                                      updatingFindingId === finding.id ||
                                      finding.reviewer_status === 'escalated'
                                    }
                                    onClick={() => changeStatus(finding, 'escalated')}
                                  >
                                    {updatingFindingId === finding.id ? (
                                      <Spinner className="size-3.5" />
                                    ) : null}
                                    Escalate ⚡
                                  </EscalateButton>
                                </div>
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </Panel>
                  </div>
                </div>

                <div className="animate-fade-up">
                  <PixelLabel>03: Tracklist</PixelLabel>
                  <div className="mt-3">
                    <Panel>
                      <p className="font-pixel text-[8px] tracking-[0.16px] text-line-strong">
                        STEP 3 / PROJECT NOTES
                      </p>
                      <h2 className="mt-2 font-display text-base text-paper [text-shadow:3px_3px_6px_rgb(0_0_0/0.5),2px_2px_0_#aab5c4,1px_1px_0_#aab5c4]">
                        Attach a project note
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
                            project-file uploader above.
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
                            No plain-text project notes are attached yet.
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
              </>
            ) : null}
          </div>

          <aside className="animate-fade-up lg:sticky lg:top-8">
            <PixelLabel>04: Dashboard</PixelLabel>
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
      </main>
    </div>
  );
}
