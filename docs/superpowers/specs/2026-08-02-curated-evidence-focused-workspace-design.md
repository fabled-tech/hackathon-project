# Curated Evidence and Focused Workspace Design

**Date:** 2026-08-02
**Status:** Approved

## Goal

Run RightsRadar in its existing full-cloud configuration and make each real-cloud review easier to act on. The product will present focused, contextual evidence for each potential lead, use a horizontal desktop review workspace, and retain a chronological history of reopenable cases.

RightsRadar remains research assistance only. It must not make legal conclusions or imply that an unverified reference is an infringement.

## Scope

- Use the existing Gemini Enterprise Agent Platform, Parallel Search, Firestore, and Cloud Storage integrations in `RIGHTSRADAR_MODE=cloud`.
- Keep Gemini for lead detection and add a second Gemini curation pass for source selection and relevance explanation.
- Keep Parallel Search as the retrieval provider and use Parallel Extract to verify shortlisted pages.
- Process independent leads concurrently with a small configurable bound while preserving detector order in the saved case.
- Persist and reopen cases in newest-first chronological order.
- Replace the vertically stacked review UI with the approved Focused Canvas layout.
- Show one selected citation and a concise relevance rationale by default; place any remaining candidates behind an explicit disclosure.
- Return a retryable error without creating a case when a required analysis provider fails.

## Non-goals

- Replacing Gemini, Parallel Search, Firestore, or Cloud Storage.
- Adding chatbot-style conversations, free-text case search, filters, tags, or manual case titles.
- Giving legal advice, issuing clearance conclusions, or asserting ownership.
- Persisting a case when detection, retrieval, or citation curation fails.
- Adding Parallel Task API, Task Groups, webhooks, Cloud Tasks, or deployment resources in this milestone; those remain an escalation-path follow-up.

## Runtime and configuration

The demo starts in `RIGHTSRADAR_MODE=cloud`. It uses the existing environment variables for the Google Cloud project, location, Gemini model, Parallel API key, Firestore collection, and Cloud Storage bucket. Local Application Default Credentials authenticate Google Cloud calls.

`RIGHTSRADAR_PARALLEL_MAX_CONCURRENCY` defaults to `4` and bounds the number of lead pipelines active inside one analysis request. Search and Extract share a provider session identifier derived from the case ID and lead index, never from script text. Search uses the configured Gemini model as `client_model`, returns at most five unique candidate URLs, and uses the Parallel `advanced` mode. Extract receives those URLs in one batch and returns only verified candidates from that shortlist.

The launch procedure restarts both the API and web application after configuration validation. Credentials and API keys remain server-only and are never logged or passed to the browser.

## Analysis and evidence flow

For each submitted excerpt:

1. Gemini identifies potential rights-clearance research leads, including the detected item, category, explanation, confidence, and enough scene context to make retrieval specific.
2. The server starts one asynchronous pipeline per lead, bounded by `RIGHTSRADAR_PARALLEL_MAX_CONCURRENCY`. Each pipeline constructs a self-contained Parallel objective and three concise contextual queries.
3. Parallel Search returns a bounded shortlist. The server normalizes and deduplicates candidate URLs, then sends the shortlist to Parallel Extract in one request using the same provider session.
4. Extracted candidates are restricted to URLs returned by Search. A partial Extract success uses the successful candidates; a complete Extract failure is a retryable provider failure. An empty Search result is a valid no-source result.
5. Gemini receives only the lead plus extracted candidate titles, URLs, publication dates, and excerpts. It selects at most one candidate URL and writes a short explanation of why that source is relevant to the lead.
6. The server validates that the selected URL exactly matches an extracted candidate. Gemini must not create citations, URLs, or quoted evidence.
7. The server gathers lead results in detector order and persists the complete case to Firestore only after every lead pipeline succeeds.

Gemini may return no suitable source. That is a valid result and produces a saved lead with an explicit neutral `no reliable source selected` state. In contrast, invalid structured output, a citation URL not present in the candidate set, a Gemini/Parallel service failure, or persistence failure produces a retryable error and no partial case is saved.

## Data contract

Replace the unranked `supporting_evidence` presentation with an explicit evidence-selection object on each finding:

```text
evidence:
  primary: Evidence | null
  rationale: string | null
  alternatives: Evidence[]
```

`primary` contains exactly one validated retrieved source when Gemini selected one. `rationale` is required when `primary` is present and explains relevance without making a legal conclusion. `alternatives` contains the remaining normalized candidates and is empty when there are none.

The generated TypeScript API client is regenerated from the FastAPI OpenAPI schema after the model changes. Existing case history is not migrated; the backend defaults an absent `evidence` object to no primary evidence and no alternatives, and the client displays that neutral state rather than inventing a source.

## Focused Canvas UI

On desktop, the main workspace is a horizontal two-pane review surface:

- **Left:** a large editable script excerpt, character count, and Analyze action.
- **Right:** a compact review queue, with a category, detected item, confidence, explanation, and reviewer actions per lead.
- Expanding a lead shows its single selected citation, source link, and relevance rationale. A `More evidence (n)` control reveals alternatives only when the reviewer requests them.
- A lead with no selected source states that no reliable source was selected and repeats the research-only disclaimer.
- The application preserves the current generic, user-safe retry messaging for provider failures; it does not disclose credentials, provider responses, or implementation details.

The header includes `Past cases`. It opens a chronological drawer, newest first, with the stored script excerpt, date, finding count, asset count, and review-state summary. Selecting a case restores its saved script, findings, attached-asset metadata, and reviewer decisions. The initial release uses the existing script excerpt as the list label and has no title, search, filter, or tagging capability.

On narrow viewports, the two panes stack accessibly, while the evidence and case-history controls retain their labels and keyboard behavior.

## Error handling and persistence

- The UI keeps the submitted excerpt visible while analysis is in progress and disables duplicate submission.
- A temporary provider failure returns a retryable API error. Since analysis happens before repository creation, no incomplete Firestore case is written.
- A valid no-source decision still stores the finding so reviewers can see why it was flagged.
- If the history request fails, the active review remains visible and the UI offers retry.
- Existing review-status updates remain transactional in Firestore.

## Verification

Automated coverage will include:

- Lead detection, retrieval-query construction, candidate normalization, and candidate deduplication.
- Search-to-Extract session reuse, batched URL extraction, partial extraction success, and complete extraction failure.
- A concurrency test proving independent lead pipelines overlap without exceeding the configured bound and retain detector order.
- Gemini curation selecting a valid candidate, declining all candidates, returning invalid JSON, and returning an unknown URL.
- No case persistence after detector, retriever, curator, or repository failures.
- API serialization and TypeScript-client freshness for the new evidence object.
- Focused Canvas rendering of the primary citation, rationale, disclosed alternatives, no-source state, progress/error state, chronological drawer, and case reopening.

An opt-in real-cloud smoke run submits a controlled test excerpt, validates that the stored case contains curated evidence, reopens the case through the API, and reports a safe failure without exposing secrets. It is separate from regular unit and browser test suites.

## Acceptance criteria

1. A changed excerpt in full-cloud mode reaches Gemini and receives context-sensitive potential leads rather than mock-keyword behavior.
2. Every saved lead shows either one validated primary citation with a relevance rationale or an explicit no-source state.
3. Extra evidence is hidden until requested and never replaces the selected citation by default.
4. A user can reopen prior cloud cases in newest-first order and recover their review state.
5. Provider failures do not produce partial cases or secret-bearing error output.
6. The desktop UI is primarily horizontal and remains usable on narrow screens.
7. Multiple leads are researched concurrently within the configured bound, and every citation selected by Gemini comes from a successfully extracted Parallel candidate.
