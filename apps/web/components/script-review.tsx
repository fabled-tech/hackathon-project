'use client';

import {
  createCase,
  type Case,
  type Finding,
  type ReviewerStatus,
  updateFindingStatus
} from '@rightsrader/api-client';
import { type FormEvent, useState } from 'react';

const SAMPLE_SCRIPT =
  'INT. EDIT SUITE — NIGHT\n\nMARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says, and marks the take.';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

function statusLabel(status: ReviewerStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}% confidence`;
}

export function ScriptReview() {
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT);
  const [caseResult, setCaseResult] = useState<Case | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingFindingId, setUpdatingFindingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const nextCase = await createCase({ script_text: scriptText }, API_BASE_URL);
      setCaseResult(nextCase);
    } catch {
      setError('RightsRadar could not analyze this script right now. Please try again.');
    } finally {
      setIsSubmitting(false);
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
        <section className="results" aria-labelledby="findings-heading">
          <div className="section-heading results-heading">
            <div>
              <p className="eyebrow">Step 2</p>
              <h2 id="findings-heading">Potential clearance findings</h2>
            </div>
            <span className="finding-count">
              {caseResult.findings.length} {caseResult.findings.length === 1 ? 'finding' : 'findings'}
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
      ) : null}
    </main>
  );
}
