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
import { type FormEvent, useRef, useState } from 'react';

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
  const [isLoadingRecentCases, setIsLoadingRecentCases] = useState(false);
  const [isLoadingCaseId, setIsLoadingCaseId] = useState<string | null>(null);
  const [updatingFindingId, setUpdatingFindingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function submitScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const nextCase = await createCase({ script_text: scriptText }, API_BASE_URL);
      setCaseResult(nextCase);
      setAssets([]);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      setError('RightsRadar could not analyze this script right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caseResult || !selectedFile) return;
    setIsUploading(true);
    setError(null);
    try {
      await uploadAsset(caseResult.id, selectedFile, API_BASE_URL);
      setAssets(await listAssets(caseResult.id, API_BASE_URL));
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      setError('The asset could not be uploaded. Use a plain-text file no larger than 256 KiB.');
    } finally {
      setIsUploading(false);
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
    setIsLoadingCaseId(caseId);
    setError(null);
    try {
      const nextCase = await getCase(caseId, API_BASE_URL);
      const nextAssets = await listAssets(caseId, API_BASE_URL);
      setCaseResult(nextCase);
      setAssets(nextAssets);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      setError('This case could not be reopened. Please try again.');
    } finally {
      setIsLoadingCaseId(null);
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

      <section className="workspace" aria-labelledby="script-heading">
        <div className="section-heading">
          <p className="eyebrow">Step 1</p>
          <h2 id="script-heading">Review a script excerpt</h2>
        </div>
        <form onSubmit={submitScript} className="script-form">
          <label htmlFor="script-text">Script text</label>
          <textarea
            id="script-text"
            name="script-text"
            value={scriptText}
            onChange={(event) => setScriptText(event.target.value)}
            rows={8}
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

      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}

      {caseResult ? (
        <>
          <section className="results" aria-labelledby="findings-heading">
            <div className="section-heading results-heading">
              <div>
                <p className="eyebrow">Step 2</p>
                <h2 id="findings-heading">Potential clearance findings</h2>
              </div>
              <span className="finding-count">
                {caseResult.findings.length}{' '}
                {caseResult.findings.length === 1 ? 'finding' : 'findings'}
              </span>
            </div>
            {caseResult.findings.length === 0 ? (
              <p className="empty-state">
                No deterministic research leads were found in this excerpt. That is not a clearance
                conclusion.
              </p>
            ) : (
              <div className="finding-list">
                {caseResult.findings.map((finding) => (
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
                      <h4>Evidence and citations</h4>
                      {finding.supporting_evidence.map((evidence) => (
                        <blockquote key={evidence.source.url}>
                          <p>“{evidence.excerpt}”</p>
                          <a href={evidence.source.url} target="_blank" rel="noreferrer">
                            {evidence.source.title}
                          </a>
                        </blockquote>
                      ))}
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
                ))}
              </div>
            )}
          </section>

          <section className="asset-panel" aria-labelledby="assets-heading">
            <div className="section-heading">
              <p className="eyebrow">Step 3</p>
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
                        {fileSizeLabel(asset.byte_size)} · uploaded{' '}
                        {new Date(asset.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      ) : null}

      <section className="recent-cases-panel" aria-labelledby="recent-cases-heading">
        <div className="section-heading results-heading">
          <div>
            <p className="eyebrow">Case history</p>
            <h2 id="recent-cases-heading">Recent cases</h2>
          </div>
          <button type="button" onClick={refreshRecentCases} disabled={isLoadingRecentCases}>
            {isLoadingRecentCases ? 'Loading…' : 'Refresh recent cases'}
          </button>
        </div>
        <div className="recent-cases" data-testid="recent-cases" aria-live="polite">
          {recentCases.length === 0 ? (
            <p className="empty-state">Refresh to load recently reviewed cases.</p>
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
      </section>
    </main>
  );
}
