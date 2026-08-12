# Production Monitoring Design

**Date:** 2026-08-03
**Status:** Approved for specification review

## Goal

Add a production-level workspace that tracks named scripts and plain-text production assets, detects content changes with server-side fingerprints, and creates immutable monitoring runs. A reviewer can explicitly recheck an unchanged production, inspect a chronological run history, and retain every review-status change as an audit event.

RightsRadar remains research assistance only. Monitoring identifies possible research leads and their traceable evidence; it never makes legal, ownership, infringement, permission, licensing, clearance, or release determinations.

## Validated product decisions

- A production is a new top-level workspace above the existing one-off case model.
- A production owns multiple named scripts and multiple plain-text assets.
- Monitoring is manual in this release. There is no scheduler, background job, notification system, or automatic recheck.
- A normal monitoring action requires changed content. An explicit recheck is available when content is unchanged.
- The recommended immutable-snapshot approach is selected over extending a mutable case or introducing a full event-sourcing platform.

## Approaches considered

### Extend the existing case in place

This would add scripts, assets, and a `last_checked_at` field to `Case`. It is small initially, but a later recheck would overwrite the exact findings and reviewer state needed to understand an earlier run. It does not meet the audit-history requirement cleanly.

### Production aggregate with immutable monitoring runs — selected

`Production` owns the current source inventory. Each script edit or asset replacement creates an immutable source version. A monitoring run snapshots the current versions, analyzes the whole active production, and stores its own findings. Review-status changes append audit events. This is small enough for the current FastAPI/Firestore architecture while preserving history.

### Full event sourcing for all production activity

An append-only event log could derive every current view. It is stronger than the need here and would make the simple mock and Firestore repositories substantially more complex. It is not selected.

## Scope

- Create, list, and open productions.
- Add and update named scripts.
- Add, replace, and retire plain-text assets while retaining old private asset versions for historical runs.
- Create SHA-256 fingerprints from the exact UTF-8 bytes of each source version.
- Show whether every active source is new, changed, or unchanged since the most recent successful monitoring run.
- Run monitoring across the complete active production when content has changed.
- Allow an explicit full recheck even when no content has changed.
- Persist chronological run snapshots, findings, reviewer decisions, and review-status audit events.
- Show a production-level monitoring summary and selected-run review queue.
- Preserve the current one-off case API and stored case history for compatibility; FAB-13 does not migrate or delete them.
- Support both deterministic mock mode and the existing real repository mode. A real agent invocation continues to use the existing one-ADK-agent research workflow for each source analysis.

## Non-goals

- Scheduled, polling, webhook-driven, or background monitoring.
- Legal conclusions, legal-risk scoring, clearance states, or advice about whether content may be used or released.
- Browser access to private asset bytes, Cloud Storage paths, credentials, or provider diagnostics.
- Source diff rendering, source search, automatic source matching, collaboration/identity, or deletion of historic source versions.
- Cross-production deduplication or migration of existing cases into productions.

## Domain model

The current production inventory is mutable only through new source versions. Monitoring and review records are append-only except that a finding's current reviewer status is updated together with its audit event.

```text
Production
  id
  name
  revision
  created_at
  updated_at

ProductionSource
  id
  production_id
  kind: script | asset
  name
  active
  current_version_id
  last_monitored_version_id | null
  created_at
  updated_at

ProductionSourceVersion
  id
  source_id
  fingerprint_sha256
  script_text | null
  asset_id | null
  created_at

ProductionRun
  id
  production_id
  production_revision
  trigger: initial | changes_detected | explicit_recheck
  created_at
  source_snapshots[]
  findings[]

ProductionRunSourceSnapshot
  source_id
  source_version_id
  kind
  name
  fingerprint_sha256
  change_state: new | changed | unchanged | retired

ProductionFinding
  id
  run_id
  source_id
  category, detected_item, explanation, confidence
  evidence, retrieved_at, reviewer_status

ReviewEvent
  id
  production_id
  run_id
  finding_id
  previous_status
  reviewer_status
  created_at
```

`ProductionSourceVersion` provides the source-content audit trail. Script versions store their text in the production repository. Asset versions store only the existing private asset identifier; the bytes remain in the existing asset repository and are read server-side only when monitoring. A replacement creates a new asset version and moves the source's current-version pointer, so prior run snapshots remain reproducible without deleting historic private bytes.

Fingerprints are lowercase SHA-256 hex digests of the exact UTF-8 source bytes. They are stored server-side and used for comparison; the browser receives only the derived change state and summary counts. An active source is `new` before its first completed run, `changed` when its current version differs from its last monitored version, and `unchanged` otherwise. Retiring a source increments the production revision. The stable monitoring snapshot includes active sources plus each source retired since the prior completed run, so retirement appears once as `retired` in the next run even though it is not sent for a new agent analysis.

## Repository and service boundaries

Introduce a focused `ProductionRepository` protocol with in-memory and Firestore implementations. It owns productions, source metadata/versions, run snapshots, and review events. It exposes operations to:

- create/list/get productions and their summary;
- append script and asset source versions or retire a source;
- read a stable production snapshot for monitoring;
- append a complete monitoring run only if the production revision still matches the snapshot;
- list/get runs newest first; and
- update a run finding's reviewer status while appending a `ReviewEvent` atomically.

The existing `AssetRepository` remains the private-content boundary. Production asset routes pass the production ID as the repository owner key and return a production-specific response that does not expose the legacy `case_id`, storage reference, or bytes.

Add `ProductionMonitoringService` between routes and repositories. It receives `ProductionRepository`, `AssetRepository`, and the existing `AgentService`:

1. Load a stable snapshot of active sources plus sources retired since the previous completed run, then determine change states from saved fingerprints.
2. For a normal run, reject only when no source is new, changed, or newly retired; the safe conflict response directs the user to explicit recheck. For an explicit recheck, proceed regardless of active-source change state.
3. Read current script text or private asset content for every active source.
4. Invoke the existing research agent once per source, using the source-version ID as its analysis identifier. This keeps each invocation a single ADK agent workflow and bounds each request to one named source.
5. Convert returned `Finding` data into source-scoped `ProductionFinding` records without changing evidence provenance or research-only guardrails.
6. Persist one complete `ProductionRun` and advance `last_monitored_version_id` only if the production revision did not change while the analyses ran.

If an agent, content read, validation, or repository operation fails, no partial run is saved and prior runs remain unchanged. If the production revision changed during monitoring, return a retryable conflict rather than attaching stale results to newer content.

## Persistence

In mock mode, `InMemoryProductionRepository` keeps deep-copied production data and review events. It is deterministic and independent of cloud credentials or network access.

In real repository mode, `FirestoreProductionRepository` uses a collection derived from the existing configured collection name:

```text
<configured-case-collection>_productions/{productionId}
  sources/{sourceId}
    versions/{versionId}
  runs/{runId}
  review_events/{eventId}
```

Writes that change a source pointer or reviewer status use Firestore transactions/batches. The run document stores its source snapshots and findings atomically, so a reader cannot observe a half-written monitoring run. Cloud Storage continues to hold production asset bytes behind the existing generation-fenced asset repository.

## HTTP and generated-client contract

Add a `/api/productions` router while leaving `/api/cases` intact:

```text
POST   /api/productions
GET    /api/productions
GET    /api/productions/{production_id}

POST   /api/productions/{production_id}/scripts
PUT    /api/productions/{production_id}/scripts/{source_id}
DELETE /api/productions/{production_id}/sources/{source_id}

POST   /api/productions/{production_id}/assets
POST   /api/productions/{production_id}/assets/{source_id}/versions

POST   /api/productions/{production_id}/runs
POST   /api/productions/{production_id}/rechecks
GET    /api/productions/{production_id}/runs
GET    /api/productions/{production_id}/runs/{run_id}
PATCH  /api/productions/{production_id}/runs/{run_id}/findings/{finding_id}
GET    /api/productions/{production_id}/review-events
```

The normal run endpoint creates `initial` or `changes_detected` runs and returns a conflict when no active source is new or changed. The explicit recheck endpoint creates an `explicit_recheck` run even when every active source is unchanged. Reviewer status values remain `pending`, `accepted`, `dismissed`, and `escalated`; they describe a human workflow only and never represent a legal result.

FastAPI remains the OpenAPI source of truth. Regenerate `packages/api-client/src/generated.ts` after adding the request/response models and use the generated helpers in the web application.

## Production-monitoring workspace

The home experience becomes a production-monitoring workspace while legacy cases remain accessible only through their existing API/history behavior.

- A compact production picker creates or opens a named production.
- The left pane is the source inventory: named scripts can be added/edited; plain-text assets can be uploaded, replaced as new versions, or retired. Asset content remains unreadable in the browser.
- The right pane is the production monitoring summary: script count, asset count, sources needing recheck, latest-run timestamp, and research-lead/reviewer-status counts. It contains **Monitor changes** and **Recheck all sources** actions.
- A chronological run list shows its trigger, timestamp, number of sources checked, and changed-source count. Selecting a run loads its immutable source snapshot and review queue.
- The review queue groups every possible research lead by source name and uses the existing evidence presentation and human review controls. A review status update appears in the selected run and the separate audit timeline.
- No copy labels a source or finding as cleared, risky, permitted, infringing, owned, or legally usable. Safe empty states state only that no possible research leads were returned for that run.
- The desktop layout remains horizontal and stacks on narrow screens. All controls retain visible labels, keyboard operation, and polite progress/error announcements.

## Error handling and concurrency

- Validate production name, script names/text, text-asset type, UTF-8 validity, and size before any repository write.
- Keep submitted script edits visible after a recoverable failure.
- Do not expose hashes, private asset content, storage locations, provider responses, credentials, or raw provider diagnostics in HTTP errors or UI copy.
- Use generation/request tokens in the client so a stale production, run, asset, or review response cannot replace a newer selection.
- Ensure an agent failure leaves the last successful monitoring summary and all historic runs available.
- Return `404` only for missing production/source/run/finding identifiers and `409` for an unchanged normal monitor request or an in-flight revision conflict.

## Verification

- Unit tests for SHA-256 determinism, change-state calculation, version append/retirement, explicit recheck eligibility, and review-event creation.
- Service tests for source-scoped agent calls, whole-production run aggregation, no partial persistence after an analysis/content failure, unchanged-run conflict, explicit recheck, and revision conflict.
- In-memory and Firestore repository tests for immutable versions/runs, newest-first listing, transactional status updates, and retained audit history.
- API tests for the production CRUD, script and asset versioning, monitoring/recheck behavior, run selection, audit endpoint, safe failure messages, and unchanged/unknown-resource status codes.
- Generated-client tests for every new endpoint and multipart asset version upload.
- Browser tests for production creation, multi-script and asset inventory, changed-source indicator, normal monitoring, explicit recheck, chronological run selection, evidence visibility, and persisted reviewer audit history.
- Run existing `make lint`, `make typecheck`, `make test`, `make check-client`, `make build`, and mocked `make e2e`. Keep real-cloud smoke explicitly opt-in.

## Acceptance-criteria mapping

1. **Production as scripts plus assets:** `Production`, logical sources, immutable script/asset versions, and the source inventory UI model both kinds of content.
2. **Fingerprinting and explicit rechecks:** exact SHA-256 fingerprints drive `new`/`changed`/`unchanged` state; `/runs` detects changes and `/rechecks` deliberately reruns unchanged sources.
3. **Review and audit history:** immutable source versions and runs retain previous research snapshots; reviewer updates create immutable `ReviewEvent` records.
4. **Production-level summary:** production details provide counts, recheck state, latest-run metadata, and neutral research/reviewer aggregates for the summary panel.
