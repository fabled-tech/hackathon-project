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
      <div className="evidence-block">
        <a href={primary.source.url} target="_blank" rel="noreferrer">
          {primary.source.title}
        </a>
        <p>{rationale}</p>
      </div>
    );
  }

  if (alternatives.length > 0) {
    return (
      <div className="evidence-block alternative-evidence">
        <p className="evidence-disclosure">
          No primary source was selected. The alternative evidence below is additional research
          material for human review.
        </p>
        {alternatives.map((evidence) => (
          <blockquote key={evidence.source.url}>
            <p>“{evidence.excerpt}”</p>
            <a href={evidence.source.url} target="_blank" rel="noreferrer">
              {evidence.source.title}
            </a>
          </blockquote>
        ))}
      </div>
    );
  }

  return (
    <p className="empty-state">
      No supporting source is available for this possible lead. This neutral state is not a
      research conclusion.
    </p>
  );
}

export function ProductionMonitor() {
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
    <main className="page-shell production-page">
      <header className="hero">
        <p className="eyebrow">Production monitoring</p>
        <h1>RightsRadar</h1>
        <p className="hero-copy">
          Organize possible research leads across a production&apos;s changing scripts and plain-text
          assets, then keep human review decisions with the monitoring history.
        </p>
      </header>

      <aside className="disclaimer" aria-label="Research assistance notice">
        <strong>Research assistance only.</strong> This workspace surfaces possible leads for human
        follow-up. It does not provide legal advice or make clearance, infringement, or release
        decisions.
      </aside>

      <p className="progress-message" aria-live="polite">{isLoading ? 'Loading productions…' : notice}</p>
      {error ? <p className="error-message" role="alert" aria-live="polite">{error}</p> : null}

      <section className="production-picker" aria-labelledby="production-picker-heading">
        <div>
          <p className="eyebrow">Production</p>
          <h2 id="production-picker-heading">Open a monitoring workspace</h2>
        </div>
        <div className="picker-controls">
          <label htmlFor="selected-production">Selected production</label>
          <select
            id="selected-production"
            value={production?.id ?? ''}
            onChange={(event) => void openProduction(event.target.value)}
          >
            <option value="">Choose a production</option>
            {productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <form onSubmit={submitProduction} className="inline-form">
            <label htmlFor="production-name">Production name</label>
            <input
              id="production-name"
              value={productionName}
              onChange={(event) => setProductionName(event.target.value)}
              maxLength={120}
              required
            />
            <button type="submit" disabled={isSavingProduction}>{isSavingProduction ? 'Creating…' : 'Create production'}</button>
          </form>
        </div>
      </section>

      <div className="production-workspace">
        <section className="workspace source-workspace" data-testid="source-workspace" aria-labelledby="sources-heading">
          <div className="section-heading">
            <p className="eyebrow">Source inventory</p>
            <h2 id="sources-heading">Scripts and assets</h2>
          </div>
          {!production ? (
            <p className="empty-state">Create or open a production to inventory the sources to monitor.</p>
          ) : (
            <>
              <form onSubmit={submitScript} className="script-form">
                <label htmlFor="script-name">Script name</label>
                <input id="script-name" value={scriptName} onChange={(event) => setScriptName(event.target.value)} maxLength={120} required />
                <label htmlFor="script-text">Script text</label>
                <textarea id="script-text" value={scriptText} onChange={(event) => setScriptText(event.target.value)} rows={8} maxLength={20_000} required />
                <div className="form-footer">
                  <span>{editingScriptId ? 'Editing named script' : 'Add a named script'}</span>
                  <button type="submit" disabled={isSavingScript}>{isSavingScript ? 'Saving…' : 'Save script'}</button>
                </div>
              </form>

              <form onSubmit={submitAsset} className="asset-form">
                <label htmlFor="plain-text-asset">Plain-text asset</label>
                <input
                  ref={assetInputRef}
                  id="plain-text-asset"
                  type="file"
                  accept="text/plain,.txt"
                  onChange={(event) => setAssetFile(event.currentTarget.files?.[0] ?? null)}
                />
                <button type="submit" disabled={!assetFile || isSavingAsset}>{isSavingAsset ? 'Uploading…' : 'Upload asset'}</button>
              </form>

              <div className="source-inventory" data-testid="source-inventory">
                {production.sources.length === 0 ? <p className="empty-state">No sources are attached yet.</p> : null}
                {scripts.map((source) => (
                  <article className="source-card" key={source.id}>
                    <div className="source-card-heading"><div><span className="source-kind">Script</span><h3>{source.name}</h3></div><span className={`status status-${source.change_state}`}>{sentenceCase(source.change_state)}</span></div>
                    <p className="source-state">{source.active ? 'Active source' : 'Retired source'}</p>
                    <div className="source-actions">
                      <button type="button" className="secondary-button" onClick={() => editScript(source)} disabled={!source.active}>Edit script</button>
                      <button type="button" className="secondary-button" onClick={() => void retireSource(source.id)} disabled={!source.active || retiringSourceId === source.id}>{retiringSourceId === source.id ? 'Retiring…' : 'Retire source'}</button>
                    </div>
                  </article>
                ))}
                {assets.map((source) => (
                  <article className="source-card" key={source.id}>
                    <div className="source-card-heading"><div><span className="source-kind">Plain-text asset</span><h3>{source.name}</h3></div><span className={`status status-${source.change_state}`}>{sentenceCase(source.change_state)}</span></div>
                    <dl className="asset-metadata"><div><dt>Type</dt><dd>{source.content_type ?? 'text/plain'}</dd></div><div><dt>Size</dt><dd>{formatSize(source.byte_size)}</dd></div><div><dt>Updated</dt><dd>{formatDate(source.updated_at)}</dd></div></dl>
                    <p className="source-state">{source.active ? 'Active source' : 'Retired source'}</p>
                    <label htmlFor={`replace-${source.id}`}>Replace {source.name}</label>
                    <input id={`replace-${source.id}`} type="file" accept="text/plain,.txt" disabled={!source.active} onChange={(event: ChangeEvent<HTMLInputElement>) => setAssetReplacement((current) => ({ ...current, [source.id]: event.currentTarget.files?.[0] ?? null }))} />
                    <div className="source-actions">
                      <button type="button" className="secondary-button" onClick={() => void replaceAsset(source.id)} disabled={!source.active || !assetReplacement[source.id] || isSavingAsset}>Replace asset</button>
                      <button type="button" className="secondary-button" onClick={() => void retireSource(source.id)} disabled={!source.active || retiringSourceId === source.id}>{retiringSourceId === source.id ? 'Retiring…' : 'Retire source'}</button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="workspace monitoring-workspace" data-testid="monitoring-workspace" aria-labelledby="monitoring-heading">
          <div className="section-heading"><p className="eyebrow">Current view</p><h2 id="monitoring-heading">Monitoring summary</h2></div>
          {!production ? <p className="empty-state">No production is selected for monitoring.</p> : <>
            <div className="summary-counts">
              <span>{sourceSummary(production.script_count, 'script')}</span><span>{sourceSummary(production.asset_count, 'asset')}</span><span>{sourceSummary(production.sources_needing_recheck, 'source needing recheck')}</span><span>Latest run: {formatDate(production.latest_run_at)}</span><span>{sourceSummary(latestRun?.findings.length ?? 0, 'latest possible research lead')}</span>
            </div>
            <dl className="reviewer-counts">{reviewerStatusCounts(production).map(([status, count]) => <div key={status}><dt>{sentenceCase(status)}</dt><dd>{count}</dd></div>)}</dl>
            <div className="monitor-actions"><button type="button" onClick={() => void startMonitoring(false)} disabled={isMonitoring}>{isMonitoring ? 'Monitoring…' : 'Monitor changes'}</button><button type="button" className="secondary-button" onClick={() => void startMonitoring(true)} disabled={isMonitoring}>{isMonitoring ? 'Monitoring…' : 'Recheck all sources'}</button></div>
            <section className="run-section" aria-labelledby="runs-heading"><h3 id="runs-heading">Monitoring runs</h3><div className="run-list" data-testid="run-list">{runs.length === 0 ? <p className="empty-state">No monitoring runs yet.</p> : runs.map((run) => <button type="button" key={run.id} className={`run-card ${selectedRun?.id === run.id ? 'selected-run' : ''}`} onClick={() => void selectRun(run.id)}><strong>{runTriggerLabel(run.trigger)}</strong><span>{formatDate(run.created_at)}</span><small>{sourceSummary(run.source_count, 'source')} · {sourceSummary(run.changed_source_count, 'changed source')}</small></button>)}</div></section>
          </>}
        </section>
      </div>

      {production ? <section className="review-history" aria-label="Review history">
        <section className="workspace findings-panel" aria-labelledby="research-leads-heading"><div className="section-heading"><p className="eyebrow">Selected run</p><h2 id="research-leads-heading">Research leads</h2></div>{!selectedRun ? <p className="empty-state">Select a monitoring run to review its possible research leads.</p> : <><ul className="run-source-snapshots" aria-label="Selected run source snapshot">{selectedRun.source_snapshots.map((source) => <li key={source.source_id}><strong>{source.name}</strong><span>{sentenceCase(source.kind)} · {sentenceCase(source.change_state)}</span></li>)}</ul>{selectedRun.findings.length === 0 ? <p className="empty-state">No possible research leads were found in this run. That is not a clearance conclusion.</p> : Object.entries(groupedFindings ?? {}).map(([sourceId, findings]) => <section className="finding-source-group" key={sourceId}><h3>{selectedRun.source_snapshots.find((source) => source.source_id === sourceId)?.name ?? 'Source'}</h3>{findings.map((finding) => <article className="finding-card" data-testid="production-finding" key={finding.id}><div className="finding-topline"><div><span className="category">{sentenceCase(finding.category)}</span><h3>{finding.detected_item}</h3></div><span className={`status status-${finding.reviewer_status}`}>{sentenceCase(finding.reviewer_status)}</span></div><p>{finding.explanation}</p><p className="finding-meta-line">Possible research lead · {Math.round(finding.confidence * 100)}% confidence</p><FindingEvidence finding={finding} /><div className="review-actions"><span>Human review</span><div><button type="button" className="secondary-button" onClick={() => void updateFinding(finding, 'dismissed')} disabled={updatingFindingId === finding.id}>Dismiss</button><button type="button" onClick={() => void updateFinding(finding, 'escalated')} disabled={updatingFindingId === finding.id}>Escalate</button></div></div></article>)}</section>)}</>}</section>
        <section className="workspace audit-panel" aria-labelledby="audit-heading"><div className="section-heading"><p className="eyebrow">Review record</p><h2 id="audit-heading">Audit timeline</h2></div>{reviewEvents.length === 0 ? <p className="empty-state">No review updates have been recorded yet.</p> : <ol className="audit-timeline">{reviewEvents.map((event) => <li key={event.id}><strong>{sentenceCase(event.reviewer_status)}</strong><span>{formatDate(event.created_at)}</span><small>Run {event.run_id} · finding {event.finding_id}</small><small>Changed from {sentenceCase(event.previous_status)}</small></li>)}</ol>}</section>
      </section> : null}
    </main>
  );
}
