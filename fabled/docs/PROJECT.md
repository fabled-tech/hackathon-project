# Project: SculptLine Workspace & Live Pipeline Capability Showcase

## Architecture
The SculptLine capability showcase integrates an 8-stage 3D mesh processing pipeline and pre-import quality assurance validator into two client workspace applications: a modern web application (`fabled/ui/`) and a native macOS/iPad app (`fabled/SculptLine/`). Both applications present a dark Notion/Palantir Foundry aesthetic with dynamic ambient light accents.

```
+---------------------------------------------------------------------------------------+
|                                    Client Workspace                                   |
|                                                                                       |
|   +------------------------------------+    +-------------------------------------+   |
|   |         Web App (fabled/ui)        |    |   Native macOS/iPad (SculptLine)    |   |
|   | - Three.js dual synced viewports   |    | - SceneKit dual synced viewports    |   |
|   | - Dynamic 60fps ambient canvas     |    | - SwiftUI native ambient light show |   |
|   | - Notion-style asset/page tree     |    | - Notion-style asset/page tree      |   |
|   | - Live stage progress bar & cards  |    | - Async pipeline progress poller    |   |
|   | - Embedded validator inspection    |    | - In-app validator report viewer    |   |
|   | - Engine toggle (Blender/Native)   |    | - Engine toggle (Blender/Native)    |   |
|   +-----------------+------------------+    +------------------+------------------+   |
|                     |                                          |                      |
+---------------------|------------------------------------------|----------------------+
                      | HTTP / REST                              | macOS Process / CLI
                      v                                          v
+---------------------------------------------------------------------------------------+
|                               Pipeline & Validator Layer                              |
|                                                                                       |
|   +------------------------------------+    +-------------------------------------+   |
|   |   Pipeline Driver (fabled_pipeline)|    | Pre-Import Validator (fabled_val)   |   |
|   | - 8 discrete processing stages     |    | - 15 core geometric/texture checks  |   |
|   | - Headless Blender (Cycles CPU)    |    | - 16th manifest cross-check         |   |
|   | - Native Python/NumPy fallback     |    | - Schema 0.2.0 JSON reporting       |   |
|   | - Atomic progress.json telemetry   |    | - Auto-fix helpers (scale, winding) |   |
|   | - Standard manifest.json output    |    +-------------------------------------+   |
|   +------------------------------------+                                              |
+---------------------------------------------------------------------------------------+
```

## Feature Inventory
Every feature from the Survey phase is enumerated below with its assigned milestone.

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Live Pipeline Job Dispatching | Backend job processing supporting uploaded/custom assets and profiles | M1 | Survey (Spec Miner & Explorer 2) |
| 2 | Dual-Engine Execution | Headless Blender (Blender 5.2.3 LTS) with seamless fallback to Native Python/NumPy engine (`native_pipeline.py`) | M1 | Survey (Explorer 2) |
| 3 | Atomic Live Progress Telemetry | 8-stage progress reporting to `progress.json` with step index, label, status, and timestamps | M1 | Survey (Explorer 2 & Spec Miner) |
| 4 | In-Workspace Pre-Import Validation | 15 core checks + manifest check via `sculptline_validator` CLI with Schema 0.2.0 JSON output | M1 | Survey (Spec Miner & Explorer 2) |
| 5 | Pipeline Manifest Generation | Standardized `manifest.json` recording LOD metrics, textures, and per-stage telemetry | M1 | Survey (Explorer 2) |
| 6 | Automated Pipeline Integration Tests | Verification suite testing job dispatch, Blender execution, native fallback, telemetry, and validator | M1 | Survey (Explorer 2) |
| 7 | Web UI Engine Toggle | Interactive UI toggle in Web app allowing users to explicitly select Blender vs Native fallback engine | M2 | Survey (Explorer 3) |
| 8 | Web UI Live Stage Telemetry Cards | Real-time progress bar, animated stage progression, and telemetry metrics in Web UI | M2 | Survey (Explorer 3) |
| 9 | Web UI Embedded Validator Report | Visual check list displaying pass/warn/fail status, measured values, and one-click fixes | M2 | Survey (Explorer 3 & Spec Miner) |
| 10 | Web UI Notion-Style Asset Tree | Multi-asset project sidebar organizing Character Busts, Props, and Environment assets with status pills | M2 | Survey (Explorer 3) |
| 11 | Web UI Dual Synced 3D Viewports | Three.js viewports with orbit sync, wireframe toggle, red flipped-normal overlay, and normal/ORM mapping | M2 | Survey (Explorer 3) |
| 12 | Web UI Dark Theme & Ambient Styling | Palantir/Notion dark aesthetic (`--bg-void: #07080c`), dynamic 60fps canvas orbs, RGB hairline, theme presets | M2 | Survey (Explorer 3) |
| 13 | Web UI Automated Test Suite | Working `npm test` script and test runner verifying web server API, asset serving, and UI components | M2 | Survey (Explorer 3) |
| 14 | Native Studio Async Pipeline Poller | Non-blocking execution of pipeline jobs in `SculptLine` with live polling of `<out>/progress.json` | M3 | Survey (Explorer 3) |
| 15 | Native Studio Engine Toggle & Custom Mesh | Explicit Blender vs Native engine selector and dynamic input mesh passing in `SculptLine` | M3 | Survey (Explorer 3) |
| 16 | Native Studio Notion-Style Asset Tree | Multi-asset navigation tree in the native sidebar supporting categorized asset pages and notes | M3 | Survey (Explorer 3) |
| 17 | Native Studio Validator Integration | In-app pre-import validator invocation, report inspector sheet, and one-click fix action triggers | M3 | Survey (Explorer 3) |
| 18 | Native Studio SceneKit Viewports | Synced dual SceneKit viewports with wireframe mode, red flipped-face highlight geometry, and PBR textures | M3 | Survey (Explorer 3) |
| 19 | Native Studio Theme & Ambient Light Show | SwiftUI `TimelineView(.animation)` ambient light canvas, Palantir dark theme tokens, responsive multi-pane modes | M3 | Survey (Explorer 3) |
| 20 | Native Studio Multiplatform Test Suite | Swift Package Manager `testTarget` (`SculptLineTests`) passing `swift test` on macOS/iPadOS | M3 | Survey (Explorer 3) |
| 21 | 100% E2E Test Suite Pass (Tiers 1-4) | Pass all requirement-driven opaque-box E2E test cases published by E2E Testing Track | M4 | Project Architecture |
| 22 | Adversarial Coverage Hardening (Tier 5) | Challenger-driven white-box adversarial stress tests covering edge geometries, corrupt files, and concurrency | M4 | Project Architecture |

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Pipeline & Validator Engine Service | Dual-engine execution (Blender & Native fallback), explicit engine routing, telemetry streaming contract, integration tests | none | DONE |
| 2 | Web Workspace Feature Expansion | Web UI (`fabled/ui/`): Engine toggle, live telemetry cards, Notion-style asset tree, embedded validator, `npm test` runner | M1 | DONE |
| 3 | Native Studio Feature Expansion | Native App (`fabled/SculptLine/`): Async pipeline poller, engine selector, Notion-style asset tree, validator sheet, `swift test` target | M1 | DONE |
| 4 | Final E2E Integration & Hardening | Phase 1: 100% pass of E2E test suite (Tiers 1-4); Phase 2: Tier 5 adversarial stress testing | M2, M3, TEST_READY.md | DONE |


## Interface Contracts

### 1. Web Server ↔ Pipeline Driver (`fabled/ui/server.mjs` ↔ `fabled/pipeline/sculptline_pipeline.py`)
- **Trigger Request**: `POST /api/jobs/:id/process`
  - Body: JSON containing import profile, asset settings, and optional engine override (`"engine": "blender" | "native"`).
  - CLI invocation:
    - If `engine === "native"`: `python sculptline_pipeline.py --input <path> --out <dir> --config <cfg> --blender none`
    - If `engine === "blender"`: `python sculptline_pipeline.py --input <path> --out <dir> --config <cfg> --blender /opt/homebrew/bin/blender`
- **Telemetry Polling**: `GET /api/jobs/:id/progress`
  - Returns: `{ running: boolean, exit_code: number|null, progress: ProgressObject|null }`
  - ProgressObject: `{ step: number (1..8), total: 8, name: string, label: string, done: boolean, status: "running"|"ok"|"failed", updated_at: string }`
- **Output Manifest**: `GET /api/jobs/:id/result`
  - Returns: `{ manifest: ManifestObject, stdout_tail: string, stderr_tail: string, outputs: [...] }`

### 2. Pre-Import Validator Contract (`sculptline_validator`)
- **Invocation**: `fabled/validator/.venv/bin/python -m sculptline_validator check <asset_or_manifest> --profile <profile.json> [--manifest <manifest.json>] --json-only`
- **Exit codes**:
  - `0`: Pass (no warnings or failures)
  - `1`: Flagged (warnings or failures present)
  - `2`: Error (unsupported format or unparseable input)
- **Output**: JSON report adhering to `schema/report.schema.json` (v0.2.0) containing `summary: { pass, warn, fail, not_checked, total, flagged }` and `checks: [...]`.

### 3. Native Studio ↔ Pipeline / Telemetry Contract (`SculptLine` ↔ `sculptline_pipeline.py`)
- **Job Execution**: macOS `Process()` executes `sculptline_pipeline.py` asynchronously in background Task.
- **Progress Tracking**: Periodic timer / async poller checks `<out>/progress.json` every 250ms, decoding stage progress and updating `@Published var activeStage` in `SculptLineViewModel`.
- **Completion**: Parses `<out>/manifest.json`, reloads scene geometries into `SyncedSceneView`, and triggers pre-import validator check.

## Code Layout
- `fabled/pipeline/`: 8-stage mesh processing pipeline
  - `sculptline_pipeline.py`: Main CLI driver, stage orchestrator, and telemetry manager
  - `native_pipeline.py`: Pure Python/NumPy fallback engine implementing all 8 stages
  - `scripts/`: Headless Blender bpy stage scripts (01–07, post_previews)
  - `config/`: Pipeline configuration profiles
- `fabled/validator/`: Pre-import quality assurance validator
  - `sculptline_validator/`: Pure Python validation package (15 core checks + manifest check)
  - `profiles/`: Studio validation profile JSONs
  - `fixtures/`: Synthetic 3D asset test fixtures
  - `tests/`: Pytest test suite for validator
- `fabled/ui/`: Web application workspace
  - `server.mjs`: Node.js local REST server and job orchestrator
  - `public/`: Three.js frontend client (index.html, app.js, viewer.js, styles.css)
  - `tools/`: Build, test, and verification scripts
- `fabled/SculptLine/`: Native macOS & iPad Studio application
  - `Package.swift`: Swift Package Manager manifest
  - `Sources/`: SwiftUI + SceneKit multiplatform implementation
  - `Tests/`: Native test target and test cases
