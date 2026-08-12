'use client';

import {
  ApiError,
  createProduction,
  createProductionAsset,
  createProductionScript,
  getProduction,
  getProductionRun,
  listProductionReviewEvents,
  listProductionRuns,
  listProductions,
  monitorProductionChanges,
  recheckProductionSources,
  replaceProductionAsset,
  replaceProductionScript,
  retireProductionSource,
  updateProductionFindingStatus,
  type ProductionDetail,
  type ProductionFinding,
  type ProductionRun,
  type ProductionRunSummary,
  type ProductionSourceView,
  type ProductionSummary,
  type ReviewerStatus,
  type ReviewEvent
} from '@rightsrader/api-client';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

function formatDate(value: string | null | undefined): string {
  if (!value) return 'No monitoring run yet';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

function formatSize(byteSize: number | null | undefined): string {
  if (byteSize === undefined || byteSize === null) return 'Size unavailable';
  if (byteSize < 1024) return `${byteSize} bytes`;
  return `${(byteSize / 1024).toFixed(1)} KiB`;
}

function sentenceCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function runTriggerLabel(trigger: ProductionRun['trigger']): string {
  if (trigger === 'initial') return 'Initial monitoring';
  if (trigger === 'changes_detected') return 'Changed sources monitored';
  return 'Explicit recheck';
}

function reviewerStatusCounts(detail: ProductionDetail): Array<[ReviewerStatus, number]> {
  const counts = detail.reviewer_status_counts ?? {};
  return (['pending', 'accepted', 'dismissed', 'escalated'] as ReviewerStatus[]).map((status) => [
    status,
    counts[status] ?? 0
  ]);
}

function sourceSummary(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function FindingEvidence({ finding }: { finding: ProductionFinding }) {
  const primary = finding.evidence?.primary;
  const rationale = finding.evidence?.rationale?.trim();
  const alternatives = finding.evidence?.alternatives ?? [];

  if (primary && rationale) {
    return (
      <div className="space-y-3" data-testid="evidence-primary">
        <blockquote className="rounded-xl border border-line/70 bg-canvas/50 px-4 py-3">
          <p className="text-sm leading-relaxed text-ink">“{primary.excerpt}”</p>
          <a
            className="mt-2 inline-flex text-sm font-semibold text-brand hover:text-brand-strong"
            href={primary.source.url}
            target="_blank"
            rel="noreferrer"
          >
            {primary.source.title}
          </a>
        </blockquote>
        <p className="text-sm text-muted" data-testid="evidence-rationale">
          <span className="font-semibold text-ink">Why this source: </span>
          {rationale}
        </p>
      </div>
    );
  }

  if (alternatives.length > 0) {
    return (
      <div className="space-y-3" data-testid="evidence-alternatives">
        <p className="text-sm text-muted">
          No primary source was selected. The alternative evidence below is additional research
          material for human review.
        </p>
        {alternatives.map((evidence) => (
          <blockquote
            key={evidence.source.url}
            className="rounded-xl border border-line/70 bg-canvas/50 px-4 py-3"
          >
            <p className="text-sm leading-relaxed text-ink">“{evidence.excerpt}”</p>
            <a
              className="mt-2 inline-flex text-sm font-semibold text-brand hover:text-brand-strong"
              href={evidence.source.url}
              target="_blank"
              rel="noreferrer"
            >
              {evidence.source.title}
            </a>
          </blockquote>
        ))}
      </div>
    );
  }

  return (
    <p className="text-sm text-muted">
      No supporting source is available for this possible lead. This neutral state is not a
      research conclusion.
    </p>
  );
}


export function ProductionMonitor({ embedded = false }: { embedded?: boolean } = {}) {
  const [productions, setProductions] = useState<ProductionSummary[]>([]);
  const [production, setProduction] = useState<ProductionDetail | null>(null);
  const [runs, setRuns] = useState<ProductionRunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<ProductionRun | null>(null);
  const [latestRun, setLatestRun] = useState<ProductionRun | null>(null);
  const [reviewEvents, setReviewEvents] = useState<ReviewEvent[]>([]);
  const [productionName, setProductionName] = useState('');
  const [scriptName, setScriptName] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [assetReplacement, setAssetReplacement] = useState<Record<string, File | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProduction, setIsSavingProduction] = useState(false);
  const [isSavingScript, setIsSavingScript] = useState(false);
  const [isSavingAsset, setIsSavingAsset] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [updatingFindingId, setUpdatingFindingId] = useState<string | null>(null);
  const [retiringSourceId, setRetiringSourceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const productionGeneration = useRef(0);
  const runGeneration = useRef(0);
  const listGeneration = useRef(0);
  const selectedRunIdRef = useRef<string | null>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);

  function chooseRun(run: ProductionRun | null) {
    selectedRunIdRef.current = run?.id ?? null;
    setSelectedRun(run);
  }

  useEffect(() => {
    void refreshProductionList();
  }, []);

  async function refreshProductionList(): Promise<ProductionSummary[]> {
    const requestGeneration = ++listGeneration.current;
    setIsLoading(true);
    try {
      const nextProductions = await listProductions(20, API_BASE_URL);
      if (listGeneration.current === requestGeneration) setProductions(nextProductions);
      return nextProductions;
    } catch {
      if (listGeneration.current === requestGeneration) {
        setError('Productions could not be loaded. Please try again.');
      }
      return [];
    } finally {
      if (listGeneration.current === requestGeneration) setIsLoading(false);
    }
  }

  async function openProduction(productionId: string, preferredRunId?: string): Promise<void> {
    const requestGeneration = ++productionGeneration.current;
    const nextRunGeneration = ++runGeneration.current;
    setError(null);
    setNotice(null);
    try {
      const [detail, nextRuns, nextEvents] = await Promise.all([
        getProduction(productionId, API_BASE_URL),
        listProductionRuns(productionId, 25, API_BASE_URL),
        listProductionReviewEvents(productionId, 50, API_BASE_URL)
      ]);
      if (productionGeneration.current !== requestGeneration) return;
      const latestSummary = nextRuns[0] ?? null;
      const selectedSummary = nextRuns.find((run) => run.id === preferredRunId) ?? latestSummary;
      const [nextLatestRun, nextSelectedRun] = await Promise.all([
        latestSummary ? getProductionRun(productionId, latestSummary.id, API_BASE_URL) : null,
        selectedSummary && selectedSummary.id !== latestSummary?.id
          ? getProductionRun(productionId, selectedSummary.id, API_BASE_URL)
          : null
      ]);
      if (
        productionGeneration.current !== requestGeneration ||
        runGeneration.current !== nextRunGeneration
      ) {
        return;
      }
      setProduction(detail);
      setRuns(nextRuns);
      setLatestRun(nextLatestRun);
      chooseRun(nextSelectedRun ?? nextLatestRun);
      setReviewEvents(nextEvents);
      setEditingScriptId(null);
      setScriptName('');
      setScriptText('');
      setAssetReplacement({});
    } catch {
      if (productionGeneration.current === requestGeneration) {
        setError('This production could not be opened. Please try again.');
      }
    }
  }

  async function selectRun(runId: string): Promise<void> {
    if (!production) return;
    const productionId = production.id;
    const selectionGeneration = productionGeneration.current;
    const requestGeneration = ++runGeneration.current;
    setError(null);
    try {
      const nextRun = await getProductionRun(productionId, runId, API_BASE_URL);
      if (
        productionGeneration.current === selectionGeneration &&
        runGeneration.current === requestGeneration &&
        productionId === production.id
      ) {
        chooseRun(nextRun);
      }
    } catch {
      if (productionGeneration.current === selectionGeneration && runGeneration.current === requestGeneration) {
        setError('That monitoring run could not be opened. Please try again.');
      }
    }
  }

  async function submitProduction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productionName.trim()) return;
    const requestGeneration = ++productionGeneration.current;
    setIsSavingProduction(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createProduction({ name: productionName.trim() }, API_BASE_URL);
      if (productionGeneration.current !== requestGeneration) return;
      setProductionName('');
      await refreshProductionList();
      await openProduction(created.id);
    } catch {
      if (productionGeneration.current === requestGeneration) {
        setError('The production could not be created. Please try again.');
      }
    } finally {
      setIsSavingProduction(false);
    }
  }

  async function submitScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!production || !scriptName.trim() || !scriptText.trim()) return;
    const productionId = production.id;
    const selectionGeneration = productionGeneration.current;
    setIsSavingScript(true);
    setError(null);
    setNotice(null);
    try {
      if (editingScriptId) {
        await replaceProductionScript(productionId, editingScriptId, { script_text: scriptText }, API_BASE_URL);
      } else {
        await createProductionScript(
          productionId,
          { name: scriptName.trim(), script_text: scriptText },
          API_BASE_URL
        );
      }
      if (productionGeneration.current !== selectionGeneration) return;
      setEditingScriptId(null);
      setScriptName('');
      setScriptText('');
      await refreshProductionList();
      await openProduction(productionId);
    } catch {
      if (productionGeneration.current === selectionGeneration) {
        setError('The script could not be saved. Its visible edits are still available to try again.');
      }
    } finally {
      setIsSavingScript(false);
    }
  }

  function editScript(source: ProductionSourceView) {
    setEditingScriptId(source.id);
    setScriptName(source.name);
    setScriptText(source.script_text ?? '');
    setError(null);
    setNotice(null);
  }

  async function submitAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!production || !assetFile) return;
    const productionId = production.id;
    const selectionGeneration = productionGeneration.current;
    setIsSavingAsset(true);
    setError(null);
    try {
      await createProductionAsset(productionId, assetFile, API_BASE_URL);
      if (productionGeneration.current !== selectionGeneration) return;
      setAssetFile(null);
      if (assetInputRef.current) assetInputRef.current.value = '';
      await refreshProductionList();
      await openProduction(productionId);
    } catch {
      if (productionGeneration.current === selectionGeneration) {
        setError('The asset could not be uploaded. Use a plain-text file no larger than 256 KiB.');
      }
    } finally {
      setIsSavingAsset(false);
    }
  }

  async function replaceAsset(sourceId: string) {
    if (!production || !assetReplacement[sourceId]) return;
    const productionId = production.id;
    const selectionGeneration = productionGeneration.current;
    setIsSavingAsset(true);
    setError(null);
    try {
      await replaceProductionAsset(productionId, sourceId, assetReplacement[sourceId]!, API_BASE_URL);
      if (productionGeneration.current !== selectionGeneration) return;
      setAssetReplacement((current) => ({ ...current, [sourceId]: null }));
      await refreshProductionList();
      await openProduction(productionId);
    } catch {
      if (productionGeneration.current === selectionGeneration) {
        setError('The asset could not be replaced. The current metadata remains available.');
      }
    } finally {
      setIsSavingAsset(false);
    }
  }

  async function retireSource(sourceId: string) {
    if (!production) return;
    const productionId = production.id;
    const selectionGeneration = productionGeneration.current;
    setRetiringSourceId(sourceId);
    setError(null);
    try {
      await retireProductionSource(productionId, sourceId, API_BASE_URL);
      if (productionGeneration.current !== selectionGeneration) return;
      await refreshProductionList();
      await openProduction(productionId);
    } catch {
      if (productionGeneration.current === selectionGeneration) {
        setError('The source could not be retired. Please try again.');
      }
    } finally {
      setRetiringSourceId(null);
    }
  }

  async function startMonitoring(explicitRecheck: boolean) {
    if (!production) return;
    const productionId = production.id;
    const selectionGeneration = productionGeneration.current;
    const requestGeneration = ++runGeneration.current;
    setIsMonitoring(true);
    setError(null);
    setNotice(null);
    try {
      const run = explicitRecheck
        ? await recheckProductionSources(productionId, API_BASE_URL)
        : await monitorProductionChanges(productionId, API_BASE_URL);
      if (
        productionGeneration.current !== selectionGeneration ||
        runGeneration.current !== requestGeneration
      ) {
        return;
      }
      await refreshProductionList();
      await openProduction(productionId, run.id);
    } catch (cause) {
      if (productionGeneration.current === selectionGeneration && runGeneration.current === requestGeneration) {
        if (
          cause instanceof ApiError &&
          cause.status === 409 &&
          cause.detail?.startsWith('No changed sources are available to monitor.')
        ) {
          setNotice('No source changes need monitoring right now. Use Recheck all sources to run research again.');
        } else if (
          cause instanceof ApiError &&
          cause.status === 409 &&
          cause.detail?.startsWith('The production changed while monitoring.')
        ) {
          setError('The production changed while monitoring. Refresh the production and try again.');
        } else {
          setError('Monitoring is temporarily unavailable. Please try again.');
        }
      }
    } finally {
      setIsMonitoring(false);
    }
  }

  async function updateFinding(finding: ProductionFinding, reviewerStatus: ReviewerStatus) {
    if (!production || !selectedRun) return;
    const productionId = production.id;
    const runId = selectedRun.id;
    const selectionGeneration = productionGeneration.current;
    const selectedRunGeneration = runGeneration.current;
    setUpdatingFindingId(finding.id);
    setError(null);
    try {
      const update = await updateProductionFindingStatus(
        productionId,
        runId,
        finding.id,
        { reviewer_status: reviewerStatus },
        API_BASE_URL
      );
      if (
        productionGeneration.current !== selectionGeneration ||
        runGeneration.current !== selectedRunGeneration ||
        selectedRunIdRef.current !== runId
      ) {
        return;
      }
      setSelectedRun((current) =>
        current
          ? {
              ...current,
              findings: current.findings.map((candidate) =>
                candidate.id === update.finding.id ? update.finding : candidate
              )
            }
          : current
      );
      setReviewEvents((current) => [update.event, ...current]);
      const detail = await getProduction(productionId, API_BASE_URL);
      if (productionGeneration.current === selectionGeneration && selectedRunIdRef.current === runId) {
        setProduction(detail);
      }
    } catch {
      if (productionGeneration.current === selectionGeneration && selectedRunIdRef.current === runId) {
        setError('The reviewer status could not be saved. Please try again.');
      }
    } finally {
      setUpdatingFindingId(null);
    }
  }

  const scripts = production?.sources.filter((source) => source.kind === 'script') ?? [];
  const assets = production?.sources.filter((source) => source.kind === 'asset') ?? [];
  const groupedFindings = selectedRun?.findings.reduce<Record<string, ProductionFinding[]>>(
    (groups, finding) => ({ ...groups, [finding.source_id]: [...(groups[finding.source_id] ?? []), finding] }),
    {}
  );

  return (
    <main className={embedded ? "mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6" : "min-h-screen space-y-6 bg-canvas px-4 py-8 text-ink sm:px-6"}>
      <header className="mb-2 space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-brand">Production monitoring</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {embedded ? 'Whole-production clearance tracking' : 'RightsRadar'}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">
          Organize possible research leads across a production&apos;s changing scripts and plain-text
          assets, then keep human review decisions with the monitoring history.
        </p>
      </header>

      <aside className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100" aria-label="Research assistance notice">
        <strong>Research assistance only.</strong> This workspace surfaces possible leads for human
        follow-up. It does not provide legal advice or make clearance, infringement, or release
        decisions.
      </aside>

      <p className="text-sm text-muted" aria-live="polite">{isLoading ? 'Loading productions…' : notice}</p>
      {error ? <p data-testid="production-error" className="error-message rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200" role="alert" aria-live="polite">{error}</p> : null}

      <section className="rounded-2xl border border-line bg-panel p-6 shadow-card space-y-4" aria-labelledby="production-picker-heading">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-brand">Production</p>
          <h2 id="production-picker-heading" className="text-lg font-semibold tracking-tight text-ink">Open a monitoring workspace</h2>
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <label htmlFor="selected-production" className="text-sm font-semibold text-ink">Selected production</label>
          <select
            id="selected-production"
            className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none ring-brand focus:ring-2"
            value={production?.id ?? ''}
            onChange={(event) => void openProduction(event.target.value)}
          >
            <option value="">Choose a production</option>
            {productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <form onSubmit={submitProduction} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-end">
            <label htmlFor="production-name" className="text-sm font-semibold text-ink">Production name</label>
            <input
              id="production-name"
              className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none ring-brand focus:ring-2"
              value={productionName}
              onChange={(event) => setProductionName(event.target.value)}
              maxLength={120}
              required
            />
            <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-canvas shadow-card transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60" disabled={isSavingProduction}>{isSavingProduction ? 'Creating…' : 'Create production'}</button>
          </form>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-panel p-6 shadow-card space-y-4" data-testid="source-workspace" aria-labelledby="sources-heading">
          <div className="mb-2 space-y-1">
            <p className="text-xs font-bold uppercase tracking-widest text-brand">Source inventory</p>
            <h2 id="sources-heading" className="text-lg font-semibold tracking-tight text-ink">Scripts and assets</h2>
          </div>
          {!production ? (
            <p className="text-sm text-muted">Create or open a production to inventory the sources to monitor.</p>
          ) : (
            <>
              <form onSubmit={submitScript} className="space-y-3">
                <label htmlFor="script-name" className="text-sm font-semibold text-ink">Script name</label>
                <input id="script-name" className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none ring-brand focus:ring-2" value={scriptName} onChange={(event) => setScriptName(event.target.value)} maxLength={120} required />
                <label htmlFor="script-text" className="text-sm font-semibold text-ink">Script text</label>
                <textarea id="script-text" className="min-h-36 w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none ring-brand focus:ring-2" value={scriptText} onChange={(event) => setScriptText(event.target.value)} rows={8} maxLength={20_000} required />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{editingScriptId ? 'Editing named script' : 'Add a named script'}</span>
                  <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-canvas shadow-card transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60" disabled={isSavingScript}>{isSavingScript ? 'Saving…' : 'Save script'}</button>
                </div>
              </form>

              <form onSubmit={submitAsset} className="space-y-3 rounded-xl border border-line/70 bg-canvas/40 p-4">
                <label htmlFor="plain-text-asset" className="text-sm font-semibold text-ink">Plain-text asset</label>
                <input
                  ref={assetInputRef}
                  id="plain-text-asset"
                  type="file"
                  className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-semibold file:text-canvas"
                  accept="text/plain,.txt"
                  onChange={(event) => setAssetFile(event.currentTarget.files?.[0] ?? null)}
                />
                <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-canvas shadow-card transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60" disabled={!assetFile || isSavingAsset}>{isSavingAsset ? 'Uploading…' : 'Upload asset'}</button>
              </form>

              <div className="space-y-3" data-testid="source-inventory">
                {production.sources.length === 0 ? <p className="text-sm text-muted">No sources are attached yet.</p> : null}
                {scripts.map((source) => (
                  <article className="space-y-3 rounded-2xl border border-line bg-panel/80 p-5 shadow-card" key={source.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-xs font-bold uppercase tracking-widest text-brand">Script</span><h3>{source.name}</h3></div><span className="inline-flex rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">{sentenceCase(source.change_state)}</span></div>
                    <p className="text-sm text-muted">{source.active ? 'Active source' : 'Retired source'}</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-brand/40 disabled:opacity-60" onClick={() => editScript(source)} disabled={!source.active}>Edit script</button>
                      <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-brand/40 disabled:opacity-60" onClick={() => void retireSource(source.id)} disabled={!source.active || retiringSourceId === source.id}>{retiringSourceId === source.id ? 'Retiring…' : 'Retire source'}</button>
                    </div>
                  </article>
                ))}
                {assets.map((source) => (
                  <article className="space-y-3 rounded-2xl border border-line bg-panel/80 p-5 shadow-card" key={source.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-xs font-bold uppercase tracking-widest text-brand">Plain-text asset</span><h3>{source.name}</h3></div><span className="inline-flex rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">{sentenceCase(source.change_state)}</span></div>
                    <dl className="grid grid-cols-3 gap-3 text-sm"><div><dt>Type</dt><dd>{source.content_type ?? 'text/plain'}</dd></div><div><dt>Size</dt><dd>{formatSize(source.byte_size)}</dd></div><div><dt>Updated</dt><dd>{formatDate(source.updated_at)}</dd></div></dl>
                    <p className="text-sm text-muted">{source.active ? 'Active source' : 'Retired source'}</p>
                    <label htmlFor={`replace-${source.id}`} className="text-sm font-semibold text-ink">
                      Replace {source.name}
                    </label>
                    <input
                      id={`replace-${source.id}`}
                      type="file"
                      accept="text/plain,.txt"
                      disabled={!source.active}
                      className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-semibold file:text-canvas disabled:opacity-60"
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setAssetReplacement((current) => ({
                          ...current,
                          [source.id]: event.currentTarget.files?.[0] ?? null
                        }))
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-brand/40 disabled:opacity-60" onClick={() => void replaceAsset(source.id)} disabled={!source.active || !assetReplacement[source.id] || isSavingAsset}>Replace asset</button>
                      <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-brand/40 disabled:opacity-60" onClick={() => void retireSource(source.id)} disabled={!source.active || retiringSourceId === source.id}>{retiringSourceId === source.id ? 'Retiring…' : 'Retire source'}</button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-panel p-6 shadow-card space-y-4" data-testid="monitoring-workspace" aria-labelledby="monitoring-heading">
          <div className="mb-2 space-y-1"><p className="text-xs font-bold uppercase tracking-widest text-brand">Current view</p><h2 id="monitoring-heading" className="text-lg font-semibold tracking-tight text-ink">Monitoring summary</h2></div>
          {!production ? <p className="text-sm text-muted">No production is selected for monitoring.</p> : <>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">{sourceSummary(production.script_count, 'script')}</span>
              <span className="inline-flex rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">{sourceSummary(production.asset_count, 'asset')}</span>
              <span className="inline-flex rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">{sourceSummary(production.sources_needing_recheck, 'source needing recheck')}</span>
              <span className="inline-flex rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">Latest run: {formatDate(production.latest_run_at)}</span>
              <span className="inline-flex rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">{sourceSummary(latestRun?.findings.length ?? 0, 'latest possible research lead')}</span>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{reviewerStatusCounts(production).map(([status, count]) => <div key={status} className="rounded-xl border border-line/70 bg-canvas/40 px-3 py-2"><dt className="text-xs text-muted">{sentenceCase(status)}</dt><dd className="text-lg font-semibold text-ink">{count}</dd></div>)}</dl>
            <div className="flex flex-wrap gap-2"><button type="button" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-canvas shadow-card transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60" onClick={() => void startMonitoring(false)} disabled={isMonitoring}>{isMonitoring ? 'Monitoring…' : 'Monitor changes'}</button><button type="button" className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-brand/40 disabled:opacity-60" onClick={() => void startMonitoring(true)} disabled={isMonitoring}>{isMonitoring ? 'Monitoring…' : 'Recheck all sources'}</button></div>
            <section className="space-y-3" aria-labelledby="runs-heading"><h3 id="runs-heading" className="text-base font-semibold text-ink">Monitoring runs</h3><div className="space-y-2" data-testid="run-list">{runs.length === 0 ? <p className="text-sm text-muted">No monitoring runs yet.</p> : runs.map((run) => <button type="button" key={run.id} className={`w-full rounded-xl border px-4 py-3 text-left transition ${selectedRun?.id === run.id ? 'selected-run border-brand/50 bg-brand-soft shadow-card' : 'border-line bg-canvas/40 hover:border-brand/30'}`} onClick={() => void selectRun(run.id)}><strong>{runTriggerLabel(run.trigger)}</strong><span>{formatDate(run.created_at)}</span><small>{sourceSummary(run.source_count, 'source')} · {sourceSummary(run.changed_source_count, 'changed source')}</small></button>)}</div></section>
          </>}
        </section>
      </div>

      {production ? <section className="grid gap-6 lg:grid-cols-2" aria-label="Review history">
        <section className="rounded-2xl border border-line bg-panel p-6 shadow-card space-y-4" aria-labelledby="research-leads-heading"><div className="mb-2 space-y-1"><p className="text-xs font-bold uppercase tracking-widest text-brand">Selected run</p><h2 id="research-leads-heading" className="text-lg font-semibold tracking-tight text-ink">Research leads</h2></div>{!selectedRun ? <p className="text-sm text-muted">Select a monitoring run to review its possible research leads.</p> : <><ul className="mb-4 space-y-2" aria-label="Selected run source snapshot">{selectedRun.source_snapshots.map((source) => <li key={source.source_id}><strong>{source.name}</strong><span>{sentenceCase(source.kind)} · {sentenceCase(source.change_state)}</span></li>)}</ul>{selectedRun.findings.length === 0 ? <p className="text-sm text-muted">No possible research leads were found in this run. That is not a clearance conclusion.</p> : Object.entries(groupedFindings ?? {}).map(([sourceId, findings]) => <section className="mb-6 space-y-3" key={sourceId}><h3>{selectedRun.source_snapshots.find((source) => source.source_id === sourceId)?.name ?? 'Source'}</h3>{findings.map((finding) => <article className="space-y-3 rounded-2xl border border-line bg-panel/80 p-5 shadow-card" data-testid="production-finding" key={finding.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-xs font-bold uppercase tracking-widest text-brand">{sentenceCase(finding.category)}</span><h3>{finding.detected_item}</h3></div><span className="inline-flex rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">{sentenceCase(finding.reviewer_status)}</span></div><p>{finding.explanation}</p><p className="text-xs text-muted">Possible research lead · {Math.round(finding.confidence * 100)}% confidence</p><FindingEvidence finding={finding} /><div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/60 pt-3"><span className="text-sm font-semibold text-muted">Human review</span><div className="flex flex-wrap gap-2"><button type="button" className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-brand/40 disabled:opacity-60" onClick={() => void updateFinding(finding, 'dismissed')} disabled={updatingFindingId === finding.id}>Dismiss</button><button type="button" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-canvas shadow-card transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60" onClick={() => void updateFinding(finding, 'escalated')} disabled={updatingFindingId === finding.id}>Escalate</button></div></div></article>)}</section>)}</>}</section>
        <section className="rounded-2xl border border-line bg-panel p-6 shadow-card space-y-4" aria-labelledby="audit-heading"><div className="mb-2 space-y-1"><p className="text-xs font-bold uppercase tracking-widest text-brand">Review record</p><h2 id="audit-heading" className="text-lg font-semibold tracking-tight text-ink">Audit timeline</h2></div>{reviewEvents.length === 0 ? <p className="text-sm text-muted">No review updates have been recorded yet.</p> : <ol className="space-y-3">{reviewEvents.map((event) => <li key={event.id} className="rounded-xl border border-line/70 bg-canvas/40 px-4 py-3 text-sm"><strong className="block text-ink">{sentenceCase(event.reviewer_status)}</strong><span className="block text-muted">{formatDate(event.created_at)}</span><small className="block text-muted">Run {event.run_id} · finding {event.finding_id}</small><small className="block text-muted">Changed from {sentenceCase(event.previous_status)}</small></li>)}</ol>}</section>
      </section> : null}
    </main>
  );
}
