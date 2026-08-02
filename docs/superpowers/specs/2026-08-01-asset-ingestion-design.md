# Mock-first Asset Ingestion and Case History Design

## Goal

Let a reviewer attach a small production asset to an existing case, see its metadata in the browser, and revisit recent cases. The complete workflow must work in `mock` mode without credentials. In an explicitly selected real repository mode, the same interfaces persist case data to Firestore and asset bytes to the private Cloud Storage bucket.

## Scope and constraints

- Keep `RIGHTSRADAR_MODE=mock` as the default. No real Gemini, Parallel, Firestore, or Cloud Storage call occurs unless its integration mode is explicitly `real`.
- Keep FastAPI OpenAPI as the source of truth and regenerate the TypeScript client from it.
- Preserve the existing legal-assistance disclaimer and the rule that reviewers make decisions.
- Store only script and production assets supplied by the user; do not perform media analysis in this increment.
- Accept only small plain-text assets initially. The API validates the content type and byte size before storage.
- Do not add authentication, payments, queues, deployments, public asset URLs, or direct browser-to-cloud storage uploads.
- Do not alter or provision additional cloud resources. The existing `hackathon-cinema` Firestore database and private Cloud Storage bucket are used only when real repository mode is explicitly enabled.

## Data and repository boundaries

Add an `Asset` Pydantic model with a UUID, parent `case_id`, original filename, content type, byte size, storage reference, and creation timestamp. The model deliberately excludes raw bytes.

Change `AssetRepository` to provide three operations:

```python
def store(case_id: str, asset: AssetUpload) -> Asset: ...
def list_for_case(case_id: str) -> list[Asset]: ...
def get_content(asset_id: str) -> bytes: ...
```

`AssetUpload` is an internal value containing validated filename, content type, and bytes. `InMemoryAssetRepository` retains uploads only for the process lifetime. `CloudStorageAssetRepository` stores bytes below the non-public object prefix `cases/{case_id}/assets/{asset_id}` and returns only the `gs://` reference in metadata.

Extend `CaseRepository` with `list_recent(limit: int) -> list[CaseSummary]`. `CaseSummary` contains the case ID, created timestamp, script excerpt, finding count, and asset count. In-memory mode derives the summaries from stored cases. Firestore mode queries the existing case collection in newest-first order and does not expose asset bytes through Firestore.

Case documents remain the source of finding/reviewer-status data. Asset metadata is recorded with its parent case in a dedicated Firestore subcollection, while bytes remain in Cloud Storage. This avoids database size pressure and keeps one clear source of truth for each kind of data.

## API design

Add the following focused routes beneath the existing `/api/cases` router:

| Route | Request | Response | Behaviour |
| --- | --- | --- | --- |
| `GET /api/cases` | optional `limit`, default 10, max 50 | `list[CaseSummary]` | Returns most recent cases. |
| `POST /api/cases/{case_id}/assets` | `multipart/form-data` field `file` | `Asset` with HTTP 201 | Validates the case exists, allows `text/plain` only, and enforces a 256 KiB maximum. |
| `GET /api/cases/{case_id}/assets` | none | `list[Asset]` | Returns only safe metadata, never file bytes. |

Return 404 for an unknown case and 422 for an unsupported type or oversized upload. Return a generic storage-failure response without revealing cloud configuration or object paths beyond the stored metadata reference. Existing case creation, retrieval, and reviewer-status routes are unchanged.

## Browser workflow

After analysis, the result screen gains an **Assets** section. A reviewer selects a `.txt` file, uploads it, and immediately sees filename, type, size, and timestamp. The section keeps the existing disclaimer visible on the page and makes no inference from the uploaded asset.

The landing view also gains a compact **Recent cases** list. Selecting a row loads that case through the current case endpoint and presents its findings and uploaded-asset metadata. Local state is updated only from API responses, so mock and real repositories produce the same UI contract.

## Error handling and safety

- File names are displayed as text and are not used as Cloud Storage object paths.
- The backend generates all asset identifiers and storage paths.
- The bucket stays private; this increment adds no download endpoint, signed URL, or browser storage credential.
- No secrets are added to `.env.example`, commits, test fixtures, browser bundles, logs, or error responses.
- Cloud adapters remain lazily imported and unreachable in the default mock configuration.

## Testing and verification

Backend pytest coverage will prove upload validation, metadata persistence, case-history ordering, and 404 paths against the in-memory repositories. Frontend Vitest coverage will prove typed client calls; Playwright will upload the fixture, view it, navigate recent cases, and keep the reviewer-status flow working.

The generated-client check, linting, type checks, production builds, Docker mock smoke, and full mocked browser workflow must remain green. A real repository smoke path will stay opt-in and will not upload content or call paid integrations unless separately enabled by configuration.

## Out of scope

Image, audio, video, OCR, transcription, malware scanning, signed upload/download URLs, authentication, authorization, retention automation, background processing, real Gemini/Parallel calls, deployment, and new cloud-resource provisioning are all deferred.
