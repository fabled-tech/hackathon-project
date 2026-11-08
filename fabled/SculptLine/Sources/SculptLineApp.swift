import SwiftUI

@main
struct SculptLineApp: App {
    @StateObject private var viewModel = SculptLineViewModel()

    var body: some Scene {
        WindowGroup("SculptLine · Foundry Workspace") {
            ContentView(viewModel: viewModel)
                .frame(minWidth: 1020, minHeight: 640)
        }
        #if os(macOS)
        .defaultSize(width: 1380, height: 840)
        #endif
        .commands {
            CommandMenu("SculptLine") {
                Button("Toggle Left Sidebar") {
                    viewModel.showLeftSidebar.toggle()
                }
                .keyboardShortcut("b", modifiers: [.command])

                Button("Toggle Right Telemetry Inspector") {
                    viewModel.showRightInspector.toggle()
                }
                .keyboardShortcut("i", modifiers: [.command])

                Divider()

                Button("Beat 1: Load Raw Sample Sculpt") {
                    Task { await viewModel.runStoryboardBeat(1) }
                }
                .keyboardShortcut("1", modifiers: [.command])

                Button("Beat 3: Open Real Pipeline Output (LOD0–LOD3)") {
                    Task { await viewModel.runStoryboardBeat(3) }
                }
                .keyboardShortcut("3", modifiers: [.command])

                Button("Beat 5: Run Pre-Import Check (Hero Beat)") {
                    Task { await viewModel.runStoryboardBeat(5) }
                }
                .keyboardShortcut("5", modifiers: [.command])

                Button("Beat 6: Apply One-Click Scale & Winding Fixes") {
                    Task { await viewModel.runStoryboardBeat(6) }
                }
                .keyboardShortcut("6", modifiers: [.command])

                Divider()

                Button("Build Retopo + LODs (Run Pipeline)") {
                    Task { await viewModel.runPipelineOrPreview() }
                }
                .keyboardShortcut("b", modifiers: [.command, .shift])

                Button("Re-run Pre-Import Check & Validator") {
                    Task { await viewModel.runPreImportChecks() }
                }
                .keyboardShortcut("r", modifiers: [.command])

                Button("Inspect UVs & Baked Maps…") {
                    viewModel.showMapInspector = true
                }
                .keyboardShortcut("u", modifiers: [.command])
            }
        }
    }
}
