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
import { type FormEvent, type SyntheticEvent, useEffect, useRef, useState } from 'react';

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

export function ScriptReview() {
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT);
  const [caseResult, setCaseResult] = useState<Case | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recentCases, setRecentCases] = useState<CaseSummary[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLoadingRecentCases, setIsLoadingRecentCases] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isLoadingCaseId, setIsLoadingCaseId] = useState<string | null>(null);
  const [updatingFindingId, setUpdatingFindingId] = useState<string | null>(null);
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const caseOperationGeneration = useRef(0);
  const activeCaseIdRef = useRef<string | null>(null);
  const submissionGeneration = useRef(0);
  const uploadGeneration = useRef(0);
  const caseLoadingGeneration = useRef(0);
  const historyDialogRef = useRef<HTMLDialogElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const closeHistoryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = historyDialogRef.current;
    if (!dialog) return;

    if (isHistoryOpen && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => closeHistoryButtonRef.current?.focus());
    } else if (!isHistoryOpen && dialog.open) {
      dialog.close();
    }
  }, [isHistoryOpen]);

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
      setExpandedEvidenceIds({});
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
    setHistoryError(null);
    try {
      setRecentCases(await listCases(10, API_BASE_URL));
    } catch {
      setHistoryError('Past cases could not be loaded. Please try again.');
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
      setExpandedEvidenceIds({});
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

  function openHistory() {
    setHistoryError(null);
    setIsHistoryOpen(true);
    void refreshRecentCases();
  }

  function closeHistory() {
    historyDialogRef.current?.close();
  }

  function handleHistoryClosed() {
    setIsHistoryOpen(false);
    historyTriggerRef.current?.focus();
  }

  function handleHistoryCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    closeHistory();
  }

  function toggleEvidence(findingId: string) {
    setExpandedEvidenceIds((current) => ({
      ...current,
      [findingId]: !current[findingId]
    }));
  }

  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">Rights clearance research</p>
        <h1>RightsRadar</h1>
        <p className="hero-copy">
          Surface potential brand and quotation references, then let a human reviewer decide what
          needs follow-up.
        </p>
      </header>

      <aside className="disclaimer" aria-label="Legal disclaimer">
        <strong>Research assistance only.</strong> RightsRadar does not provide legal advice or make
        final infringement determinations. Verify findings with qualified counsel and your clearance
        process.
      </aside>

      <div className="history-toolbar">
        <button
          type="button"
          className="secondary-button"
          ref={historyTriggerRef}
          aria-expanded={isHistoryOpen}
          aria-haspopup="dialog"
          onClick={openHistory}
          disabled={isLoadingRecentCases}
        >
          {isLoadingRecentCases ? 'Loading…' : 'Past cases'}
        </button>
      </div>

      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}

      <div className="focused-workspace" data-testid="focused-workspace">
        <section className="workspace" aria-labelledby="script-heading">
          <div className="section-heading">
            <p className="eyebrow">Script</p>
            <h2 id="script-heading">Review a script excerpt</h2>
          </div>
          <form onSubmit={submitScript} className="script-form">
            <label htmlFor="script-text">Script text</label>
            <textarea
              id="script-text"
              name="script-text"
              value={scriptText}
              onChange={(event) => setScriptText(event.target.value)}
              rows={12}
              maxLength={20_000}
              required
            />
            <div className="form-footer">
              <span>{scriptText.length.toLocaleString()} / 20,000 characters</span>
              <button type="submit" disabled={isSubmitting || scriptText.trim().length === 0}>
                {isSubmitting ? 'Analyzing…' : 'Analyze script'}
              </button>
            </div>
          </form>
        </section>

        <section
          className="results review-queue"
          data-testid="review-queue"
          aria-labelledby="findings-heading"
        >
            <div className="section-heading results-heading">
              <div>
                <p className="eyebrow">Review queue</p>
                <h2 id="findings-heading">Potential clearance findings</h2>
              </div>
              {caseResult ? (
                <span className="finding-count">
                  {caseResult.findings.length}{' '}
                  {caseResult.findings.length === 1 ? 'finding' : 'findings'}
                </span>
              ) : null}
            </div>
            {!caseResult ? (
              <p className="empty-state">
                Analyze a script excerpt to create a research review queue.
              </p>
            ) : caseResult.findings.length === 0 ? (
              <p className="empty-state">
                No deterministic research leads were found in this excerpt. That is not a clearance
                conclusion.
              </p>
            ) : (
              <div className="finding-list">
                {caseResult.findings.map((finding) => {
                  const primaryEvidence = finding.evidence?.primary ?? null;
                  const alternatives = finding.evidence?.alternatives ?? [];
                  const rationale = finding.evidence?.rationale?.trim() ?? '';
                  const hasValidatedPrimary = primaryEvidence !== null && rationale !== '';
                  const isEvidenceExpanded = expandedEvidenceIds[finding.id] ?? false;

                  return (
                    <article className="finding-card" data-testid="finding-card" key={finding.id}>
                    <div className="finding-topline">
                      <span className="category">{finding.category.replace('_', ' ')}</span>
                      <span className={`status status-${finding.reviewer_status}`}>
                        {statusLabel(finding.reviewer_status)}
                      </span>
                    </div>
                    <h3>{finding.detected_item}</h3>
                    <p>{finding.explanation}</p>
                    <dl className="finding-meta">
                      <div>
                        <dt>Assessment</dt>
                        <dd>{confidenceLabel(finding.confidence)}</dd>
                      </div>
                      <div>
                        <dt>Retrieved</dt>
                        <dd>{new Date(finding.retrieved_at).toLocaleString()}</dd>
                      </div>
                    </dl>
                    <div className="evidence-block">
                      <h4>Evidence</h4>
                      {hasValidatedPrimary ? (
                        <div data-testid="evidence-primary">
                          <blockquote>
                            <p>“{primaryEvidence.excerpt}”</p>
                            <a href={primaryEvidence.source.url} target="_blank" rel="noreferrer">
                              {primaryEvidence.source.title}
                            </a>
                          </blockquote>
                          <p className="evidence-rationale">
                            <strong>Why this source:</strong> {rationale}
                          </p>
                        </div>
                      ) : primaryEvidence ? (
                        <p className="empty-state" data-testid="evidence-validation-state">
                          This source cannot be presented as validated because its relevance rationale
                          is missing. Please try again.
                        </p>
                      ) : (
                        <p className="empty-state" data-testid="no-source-state">
                          No validated source was selected for this research lead. This neutral state
                          is not a clearance conclusion.
                        </p>
                      )}
                      {alternatives.length > 0 ? (
                        <>
                          <button
                            type="button"
                            className="evidence-toggle secondary-button"
                            aria-controls={`evidence-alternatives-${finding.id}`}
                            aria-expanded={isEvidenceExpanded}
                            onClick={() => toggleEvidence(finding.id)}
                          >
                            More evidence
                          </button>
                          <div
                            id={`evidence-alternatives-${finding.id}`}
                            className="evidence-alternatives"
                            data-testid="evidence-alternatives"
                            hidden={!isEvidenceExpanded}
                          >
                            <h5>Alternative sources</h5>
                            {alternatives.map((evidence) => (
                              <blockquote key={evidence.source.url}>
                                <p>“{evidence.excerpt}”</p>
                                <a href={evidence.source.url} target="_blank" rel="noreferrer">
                                  {evidence.source.title}
                                </a>
                              </blockquote>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                    <div className="review-actions">
                      <span>Human review</span>
                      <div>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={updatingFindingId === finding.id}
                          onClick={() => changeStatus(finding, 'dismissed')}
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          disabled={updatingFindingId === finding.id}
                          onClick={() => changeStatus(finding, 'escalated')}
                        >
                          Escalate
                        </button>
                      </div>
                    </div>
                    </article>
                  );
                })}
              </div>
            )}
        </section>
      </div>

      {caseResult ? (
          <section className="asset-panel" aria-labelledby="assets-heading">
            <div className="section-heading">
              <p className="eyebrow">Production note</p>
              <h2 id="assets-heading">Attach a production note</h2>
            </div>
            <form onSubmit={submitAsset} className="asset-form">
              <label htmlFor="asset-file">Attach plain-text asset</label>
              <input
                ref={fileInputRef}
                id="asset-file"
                name="asset-file"
                type="file"
                accept="text/plain,.txt"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
              {selectedFile ? (
                <p className="selected-file" aria-live="polite">
                  Selected: {selectedFile.name} ({fileSizeLabel(selectedFile.size)})
                </p>
              ) : null}
              <div className="form-footer">
                <span>Plain-text files only, up to 256 KiB.</span>
                <button type="submit" disabled={!selectedFile || isUploading}>
                  {isUploading ? 'Uploading…' : 'Upload asset'}
                </button>
              </div>
            </form>

            <div className="asset-list" data-testid="asset-list" aria-live="polite">
              <h3>Attached assets</h3>
              {assets.length === 0 ? (
                <p className="empty-state">No plain-text production notes are attached yet.</p>
              ) : (
                <ul>
                  {assets.map((asset) => (
                    <li key={asset.id}>
                      <strong>{asset.filename}</strong>
                      <span>
                        {asset.content_type} · {fileSizeLabel(asset.byte_size)} · uploaded{' '}
                        {new Date(asset.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
      ) : null}

      <dialog
        ref={historyDialogRef}
        className="past-cases-drawer"
        data-testid="past-cases"
        aria-labelledby="past-cases-heading"
        onCancel={handleHistoryCancel}
        onClose={handleHistoryClosed}
      >
            <div className="section-heading results-heading">
              <div>
                <p className="eyebrow">Case history</p>
                <h2 id="past-cases-heading">Past cases</h2>
              </div>
              <button
                type="button"
                className="secondary-button"
                aria-label="Close Past cases"
                ref={closeHistoryButtonRef}
                onClick={closeHistory}
              >
                Close
              </button>
            </div>
            <div className="recent-cases" data-testid="recent-cases" aria-live="polite">
              {historyError ? (
                <div className="error-message" role="alert">
                  <p>{historyError}</p>
                  <button type="button" onClick={() => void refreshRecentCases()}>
                    Retry
                  </button>
                </div>
              ) : recentCases.length === 0 ? (
                <p className="empty-state">
                  {isLoadingRecentCases ? 'Loading recently reviewed cases…' : 'No past cases yet.'}
                </p>
              ) : (
                <ul>
                  {recentCases.map((recentCase) => (
                    <li key={recentCase.id}>
                      <button
                        type="button"
                        className="recent-case-button"
                        disabled={isLoadingCaseId === recentCase.id}
                        onClick={() => reopenCase(recentCase.id)}
                      >
                        <span>{recentCase.script_excerpt}</span>
                        <small>
                          {recentCase.finding_count} findings · {recentCase.asset_count} assets ·{' '}
                          {new Date(recentCase.created_at).toLocaleString()}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
      </dialog>
    </main>
  );
}
