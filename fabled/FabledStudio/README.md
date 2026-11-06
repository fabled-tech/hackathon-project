# Fabled Studio — Native macOS & iPad Pro App

Native SwiftUI + SceneKit multiplatform studio application for **Fabled** (*"From sculpt to screen"*).

## Opening in Xcode

Open the Xcode project directly:
```bash
open fabled/FabledStudio/FabledStudio.xcodeproj
```
Select either **My Mac** (macOS) or any **iPad Pro** destination in the Xcode scheme selector and press **⌘R** to build and run.

## Building

- The Xcode project (classic file references) now lists every Swift file under `Sources/` in the app target's Sources build phase; `Resources/SM_HelenKellerBust_LOD0.glb` is bundled via the Resources phase.
- Xcode does not pick up new files automatically. After adding, moving, or deleting a Swift file, add it to the project (or edit `project.pbxproj`) and run, from `fabled/FabledStudio/`:
  ```bash
  python3 tools/check_xcodeproj.py
  ```
  It fails if a `Sources/**/*.swift` file is missing from the target, a target file is missing on disk, an object ID is duplicated, or a reference dangles. Pass `--project <path>` to check another copy of the file.
- SwiftPM works too: `swift build` and `swift test` (the tests live in SwiftPM only; the Xcode project has no test target).

## Architecture & Features

- **`Sources/FabledStudioApp.swift`**: Application entry point and `Fabled Pipeline` menu bar commands (`⌘1` Raw Sculpt, `⌘3` Real Pipeline Output, `⌘5` Pre-Import Check, `⌘6` One-Click Fixes, `⇧⌘B` Build Retopo + LODs, `⌘R` Re-check, `⌘U` Inspect UVs & Baked Maps).
- **`Sources/Models/FabledModels.swift`**: Studio theme palette, `ImportProfile`, `LoadedMeshData`, `BuiltLODMesh`, `CheckRowItem`, and `FabledStudioViewModel` (manages the 6 Storyboard walkthrough beats, one-click scale/winding fixes, and macOS process integration with `fabled/pipeline/fabled_pipeline.py` and `fabled/validator`).
- **`Sources/Services/MeshAnalyzerAndLoader.swift`**: Native Swift binary GLB 2.0 & Wavefront OBJ mesh loader, quantized vertex welder, manifold edge counter, normal/winding orientation analyzer, spatial vertex-cluster decimator, and `SCNGeometry` builder (including red flipped-face overlay geometry).
- **`Sources/Views/SyncedSceneView.swift`**: Multiplatform `SCNView` bridge (`NSViewRepresentable` on macOS, `UIViewRepresentable` on iPadOS) with synchronized dual-camera orbit/zoom, wireframe toggle, flipped-normal red highlight overlay, and PBR Normal/ORM map binding.
- **`Sources/Views/ContentView.swift`**: Adaptive 3-column studio workspace with iPad Pro workspace mode switcher (`All Panels`, `3D Canvas`, `Check Split`), Storyboard Demo Walkthrough bar, and UV & Baked Map Inspector sheet.
- **`Sources/Models/WorkspaceStore.swift`**: Connected-workspace state (`@MainActor ObservableObject`): asset index, server status, AI providers and generation tasks (polled every ~1.5 s while any is running), the selected asset's note (autosaved ~0.6 s after the last edit, always to the asset it was typed for) and activity, plus downloads of job inputs / samples to a temp folder.
- **`Sources/Views/WorkspaceViews.swift`**: `WorkspaceTreeView` (live asset tree), `ConnectionsView` (pipeline / Blender / validator / Unreal rows, AI providers, server URL), `AssetPageView` (inspector **Page** tab) and `GenerateSheet`.

## Connected workspace

The left sidebar's asset tree, the inspector's **Page** tab and the **Generate** sheet are live views of the local Fabled server (`fabled/ui/server.mjs`), the same API the web app's connected workspace uses (`ui/INTERFACES.md` §10, `ui/PROVIDERS.md`). Nothing in them is hardcoded: the old demo catalog (with invented assets) is gone.

What is live:
- **Asset tree**: `GET /api/workspace` — pipeline runs, uploads (older ones beyond the server's cap are counted, not listed), AI generations, samples and fixtures, with status pills, tris, age, note markers and MOCKUP labels as the server sends them. Search filters with the same rules as the web tree.
- **Opening an asset**: pipeline runs open read-only from the local `fabled/` checkout (needs the folder on this machine; see `FABLED_ROOT`); uploads and imported generations are downloaded from `GET /api/jobs/<id>/input`; samples load from `ui/samples/` when present, otherwise from the server; a running generation just shows its page.
- **Page tab**: properties (the validator line is the **saved report** stored with the run or job; a live Re-check can use a different profile), notes (saved to `ui/work/workspace_notes.json` on the server), activity.
- **Connections**: pipeline, Blender engine and validator availability from `GET /api/status`; Unreal import is listed as a draft script that has never run; AI providers with their configuration state (`set <ENV> to enable`) and how far their API is verified. The offline mock provider stays labelled CONCEPT MOCKUP.
- **Generate**: starts a provider task (text → 3D, image → 3D, image → video), shows progress, and imports finished meshes as a new sculpt (then Build retopo + LODs and run the pre-import check as usual). Video results are a link on the generation page; they do not enter the mesh pipeline.

Run the server (from `fabled/ui`):
```bash
npm install
npm start        # http://127.0.0.1:5178
```
If the server is not running, the tree shows how to start it and the URL it is trying. The rest of the app (sample sculpt, local pipeline and validator runs) works without it.

Server URL: defaults to `http://127.0.0.1:5178`. Change it in **Connections → Fabled server** (stored in the `fabledServerURL` user default); the `FABLED_SERVER_URL` environment variable, when set, wins at launch.

iPad: there is no local server or `Process` on iPadOS, so point the app at the Mac running `npm start`:
- start the server on the Mac's network interface, e.g. `HOST=0.0.0.0 npm start` (it binds to 127.0.0.1 by default). This exposes the server's API (uploads, notes, pipeline runs) to your local network; only do it on a network you trust;
- enter the Mac's LAN address in Connections, e.g. `http://192.168.1.20:5178`;
- plain-http access to a LAN address needs an App Transport Security exception in the app's Info.plist (`NSAppTransportSecurity` → `NSAllowsLocalNetworking` = YES), and iPadOS will ask for Local Network permission (`NSLocalNetworkUsageDescription` supplies the prompt text). The Xcode project generates its Info.plist (`GENERATE_INFOPLIST_FILE`); `NSAppTransportSecurity` is a dictionary, which the `INFOPLIST_KEY_*` build settings cannot express, so this has not been added yet: add an Info.plist (or the keys in the target's Info tab) before testing on a device.
- Opening pipeline runs needs the run folder on the device, so on iPad a run shows its page only; uploads, imported generations and samples download from the server.
