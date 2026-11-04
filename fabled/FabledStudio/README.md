# Fabled Studio — Native macOS & iPad Pro App

Native SwiftUI + SceneKit multiplatform studio application for **Fabled** (*"From sculpt to screen"*).

## Opening in Xcode

Open the Xcode project directly:
```bash
open fabled/FabledStudio/FabledStudio.xcodeproj
```
Select either **My Mac** (macOS) or any **iPad Pro** destination in the Xcode scheme selector and press **⌘R** to build and run.

## Architecture & Features

- **`Sources/FabledStudioApp.swift`**: Application entry point and `Fabled Pipeline` menu bar commands (`⌘1` Raw Sculpt, `⌘3` Real Pipeline Output, `⌘5` Pre-Import Check, `⌘6` One-Click Fixes, `⇧⌘B` Build Retopo + LODs, `⌘R` Re-check, `⌘U` Inspect UVs & Baked Maps).
- **`Sources/Models/FabledModels.swift`**: Studio theme palette, `ImportProfile`, `LoadedMeshData`, `BuiltLODMesh`, `CheckRowItem`, and `FabledStudioViewModel` (manages the 6 Storyboard walkthrough beats, one-click scale/winding fixes, and macOS process integration with `fabled/pipeline/fabled_pipeline.py` and `fabled/validator`).
- **`Sources/Services/MeshAnalyzerAndLoader.swift`**: Native Swift binary GLB 2.0 & Wavefront OBJ mesh loader, quantized vertex welder, manifold edge counter, normal/winding orientation analyzer, spatial vertex-cluster decimator, and `SCNGeometry` builder (including red flipped-face overlay geometry).
- **`Sources/Views/SyncedSceneView.swift`**: Multiplatform `SCNView` bridge (`NSViewRepresentable` on macOS, `UIViewRepresentable` on iPadOS) with synchronized dual-camera orbit/zoom, wireframe toggle, flipped-normal red highlight overlay, and PBR Normal/ORM map binding.
- **`Sources/Views/ContentView.swift`**: Adaptive 3-column studio workspace with iPad Pro workspace mode switcher (`All Panels`, `3D Canvas`, `Check Split`), Storyboard Demo Walkthrough bar, and UV & Baked Map Inspector sheet.
