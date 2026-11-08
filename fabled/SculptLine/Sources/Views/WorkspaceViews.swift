import SwiftUI
import UniformTypeIdentifiers

// Connected-workspace views (native counterparts of ui/public/workspace.js): the live asset tree, the Connections
// panel, the Notion-style asset page and the AI generation sheet. Every asset, status, number and provider shown here
// comes from WorkspaceStore, i.e. from the local SculptLine server. Mock outputs keep their CONCEPT MOCKUP label.

// MARK: - Shared styling

enum WorkspaceStyle {
    static func color(for tone: AssetTone) -> Color {
        switch tone {
        case .ok: return SculptLineTheme.green
        case .warn: return SculptLineTheme.amber
        case .fail: return SculptLineTheme.red
        case .running: return SculptLineTheme.cyan
        case .mock: return SculptLineTheme.brown
        case .neutral: return SculptLineTheme.muted
        }
    }

    /// Pill tone for a generation task (succeeded mock → mock, failed → fail, otherwise running).
    static func tone(for generation: Generation) -> AssetTone {
        if generation.status == "succeeded" {
            return generation.conceptMockup ? .mock : .ok
        }
        if generation.status == "failed" {
            return .fail
        }
        return .running
    }

    static func verificationLabel(_ verification: String) -> String? {
        switch verification {
        case "partial": return "API partly verified"
        case "unverified": return "API unverified"
        case "mock": return "CONCEPT MOCKUP"
        default: return nil
        }
    }
}

struct WorkspacePill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 9, weight: .semibold, design: .monospaced))
            .lineLimit(1)
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .background(color.opacity(0.18))
            .foregroundStyle(color)
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }
}

struct WorkspaceCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(12)
            .background(SculptLineTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10).stroke(SculptLineTheme.line, lineWidth: 1)
            )
    }
}

private struct WorkspaceSectionLabel: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .tracking(0.6)
            .foregroundStyle(SculptLineTheme.muted)
    }
}

// MARK: - Asset tree (sidebar)

struct WorkspaceTreeView: View {
    @ObservedObject var viewModel: SculptLineViewModel
    @ObservedObject var store: WorkspaceStore
    @State private var collapsed: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            searchField
            content
            if let error = store.lastError, store.unreachableMessage == nil {
                Text(error)
                    .font(.system(size: 10))
                    .foregroundStyle(SculptLineTheme.amber)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .modifier(WorkspaceCardModifier())
    }

    private var countLabel: String {
        guard let index = store.index else { return "" }
        if store.hasQuery {
            return "\(store.filteredTotal)/\(index.total)"
        }
        return String(index.total)
    }

    private var header: some View {
        HStack(spacing: 6) {
            Text("PROJECT ASSETS")
                .font(.system(size: 11.5, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(SculptLineTheme.dark)
            Text(countLabel)
                .font(.system(size: 9.5, design: .monospaced))
                .foregroundStyle(SculptLineTheme.muted)
            Spacer(minLength: 2)
            Button {
                Task { @MainActor in
                    await store.refresh()
                }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(SculptLineTheme.muted)
            }
            .buttonStyle(.plain)
            .disabled(store.isRefreshing)
            .help("Reload the workspace from the SculptLine server")
            Button {
                store.openGenerateSheet()
            } label: {
                Label("Generate", systemImage: "sparkles")
                    .font(.system(size: 10.5, weight: .semibold))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(viewModel.accentColor.opacity(0.18))
                    .foregroundStyle(viewModel.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            .buttonStyle(.plain)
            .disabled(!store.isConnected)
            .help("Generate a sculpt or clip with an AI provider")
        }
    }

    private var searchField: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(SculptLineTheme.muted)
                .font(.system(size: 11))
            TextField("Filter assets…", text: $store.query)
                .textFieldStyle(.plain)
                .font(.system(size: 11.5))
                .foregroundStyle(SculptLineTheme.dark)
            if !store.query.isEmpty {
                Button {
                    store.query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(SculptLineTheme.muted)
                        .font(.system(size: 11))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(SculptLineTheme.elevated)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(SculptLineTheme.line, lineWidth: 1))
    }

    @ViewBuilder
    private var content: some View {
        if let message = store.unreachableMessage {
            WorkspaceUnreachableView(message: message, serverURL: store.serverURLString) {
                Task { @MainActor in
                    await store.refresh()
                }
            }
        } else if store.index == nil {
            HStack(spacing: 6) {
                ProgressView()
                    .controlSize(.small)
                Text(loadingText)
                    .font(.system(size: 11))
                    .foregroundStyle(SculptLineTheme.muted)
            }
            .padding(.vertical, 6)
        } else {
            groupsList
        }
    }

    /// With a query, groups without matches are hidden (like the web tree); without one, every group shows, with
    /// its own empty state.
    private var visibleGroups: [WorkspaceGroup] {
        let groups: [WorkspaceGroup] = store.filteredGroups
        if store.hasQuery {
            return groups.filter { !$0.assets.isEmpty }
        }
        return groups
    }

    /// Assets with a page note (index flag, or a note saved in this session).
    private var noteIds: Set<String> {
        var ids: Set<String> = []
        for group in store.filteredGroups {
            for asset in group.assets where store.hasNote(asset) {
                ids.insert(asset.id)
            }
        }
        return ids
    }

    private var emptyTreeText: String {
        return store.hasQuery ? "No assets match the filter" : "The workspace is empty"
    }

    private var loadingText: String {
        return store.connection == .unknown ? "Connecting to the SculptLine server…" : "Loading workspace…"
    }

    private var groupsList: some View {
        let groups: [WorkspaceGroup] = visibleGroups
        let notes: Set<String> = noteIds
        return VStack(alignment: .leading, spacing: 6) {
            if groups.isEmpty {
                Text(emptyTreeText)
                    .font(.system(size: 11))
                    .foregroundStyle(SculptLineTheme.muted)
                    .padding(.vertical, 6)
            }
            ForEach(groups) { group in
                WorkspaceGroupSection(
                    group: group,
                    isExpanded: expandedBinding(group.id),
                    selectedId: store.selectedAssetId,
                    accent: viewModel.accentColor,
                    noteIds: notes,
                    onSelect: { asset in
                        Task { @MainActor in
                            await viewModel.openWorkspaceAsset(asset)
                        }
                    },
                    onGenerate: { store.openGenerateSheet() }
                )
            }
        }
    }

    private func expandedBinding(_ id: String) -> Binding<Bool> {
        return Binding<Bool>(
            get: { !collapsed.contains(id) },
            set: { open in
                if open {
                    collapsed.remove(id)
                } else {
                    collapsed.insert(id)
                }
            }
        )
    }
}

struct WorkspaceGroupSection: View {
    let group: WorkspaceGroup
    @Binding var isExpanded: Bool
    let selectedId: String?
    let accent: Color
    let noteIds: Set<String>
    let onSelect: (WorkspaceAsset) -> Void
    let onGenerate: () -> Void

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 3) {
                if group.assets.isEmpty {
                    emptyState
                }
                ForEach(group.assets) { asset in
                    Button {
                        onSelect(asset)
                    } label: {
                        WorkspaceAssetRow(asset: asset, isSelected: asset.id == selectedId, hasNote: noteIds.contains(asset.id),
                                          accent: accent)
                    }
                    .buttonStyle(.plain)
                }
                footer
            }
            .padding(.top, 2)
        } label: {
            groupHeader
        }
        .font(.system(size: 11))
    }

    private var groupHeader: some View {
        HStack {
            Text(group.label.uppercased())
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(SculptLineTheme.muted)
            Spacer()
            Text(countText)
                .font(.system(size: 9.5, design: .monospaced))
                .foregroundStyle(SculptLineTheme.muted)
        }
    }

    private var countText: String {
        if let hidden = group.hiddenCount, hidden > 0 {
            return "\(group.assets.count) +\(hidden)"
        }
        return String(group.assets.count)
    }

    @ViewBuilder
    private var emptyState: some View {
        if group.id == "generated" {
            HStack(spacing: 4) {
                Text("No generations yet.")
                    .font(.system(size: 10.5))
                    .foregroundStyle(SculptLineTheme.muted)
                Button("Generate a sculpt or clip", action: onGenerate)
                    .buttonStyle(.plain)
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(accent)
            }
            .padding(.vertical, 3)
        } else {
            Text("Nothing here yet.")
                .font(.system(size: 10.5))
                .foregroundStyle(SculptLineTheme.muted)
                .padding(.vertical, 3)
        }
    }

    @ViewBuilder
    private var footer: some View {
        if let hidden = group.hiddenCount, hidden > 0 {
            Text("\(hidden) older upload\(hidden == 1 ? "" : "s") not shown")
                .font(.system(size: 10))
                .foregroundStyle(SculptLineTheme.muted)
                .padding(.top, 2)
        }
        if group.undecodableCount > 0 {
            Text("\(group.undecodableCount) asset\(group.undecodableCount == 1 ? "" : "s") in this group could not be read")
                .font(.system(size: 10))
                .foregroundStyle(SculptLineTheme.amber)
        }
    }
}

struct WorkspaceAssetRow: View {
    let asset: WorkspaceAsset
    let isSelected: Bool
    let hasNote: Bool
    let accent: Color

    private var tone: AssetTone {
        return WorkspaceModel.tone(of: asset)
    }

    private var metaText: String? {
        let parts: [String] = [WorkspaceModel.trisLabel(asset), WorkspaceModel.timeAgo(asset.createdAt)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var helpText: String {
        var text: String = WorkspaceModel.kindLabel(asset.kind) ?? asset.kind
        if let folder = asset.folder, !folder.isEmpty {
            text += " · " + folder
        }
        return text
    }

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: WorkspaceModel.sfSymbol(forKind: asset.kind))
                .font(.system(size: 10.5))
                .foregroundStyle(isSelected ? accent : SculptLineTheme.muted)
                .frame(width: 14)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                nameLine
                pillLine
                metaLine
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(isSelected ? accent.opacity(0.12) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay(
            RoundedRectangle(cornerRadius: 5)
                .stroke(isSelected ? accent.opacity(0.4) : Color.clear, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .help(helpText)
    }

    private var nameLine: some View {
        HStack(spacing: 4) {
            Text(asset.name)
                .font(.system(size: 11.5, weight: isSelected ? .semibold : .medium))
                .foregroundStyle(isSelected ? accent : SculptLineTheme.dark)
                .lineLimit(1)
                .truncationMode(.middle)
            if hasNote {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 9))
                    .foregroundStyle(SculptLineTheme.muted)
                    .help("Has page notes")
            }
        }
    }

    private var pillLine: some View {
        HStack(spacing: 4) {
            WorkspacePill(text: asset.status.label.isEmpty ? "—" : asset.status.label, color: WorkspaceStyle.color(for: tone))
            if asset.conceptMockup == true && tone != .mock {
                WorkspacePill(text: "MOCKUP", color: SculptLineTheme.brown)
            }
        }
    }

    @ViewBuilder
    private var metaLine: some View {
        if let meta = metaText {
            Text(meta)
                .font(.system(size: 9.5, design: .monospaced))
                .foregroundStyle(SculptLineTheme.muted)
                .lineLimit(1)
        }
    }
}

struct WorkspaceUnreachableView: View {
    let message: String
    let serverURL: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Label("SculptLine server not reachable", systemImage: "bolt.horizontal.circle")
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(SculptLineTheme.amber)
            Text("The live asset tree, notes, activity and AI generations come from the local server. Start it on the Mac:")
                .font(.system(size: 10.5))
                .foregroundStyle(SculptLineTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
            Text("cd fabled/ui && npm start")
                .font(.system(size: 10.5, design: .monospaced))
                .foregroundStyle(SculptLineTheme.dark)
                .textSelection(.enabled)
            Text("Server URL: \(serverURL)")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(SculptLineTheme.muted)
                .textSelection(.enabled)
            Text(message)
                .font(.system(size: 9.5, design: .monospaced))
                .foregroundStyle(SculptLineTheme.muted)
                .lineLimit(3)
            Button("Retry", action: onRetry)
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .semibold))
                .padding(.horizontal, 9)
                .padding(.vertical, 3)
                .background(SculptLineTheme.elevated)
                .foregroundStyle(SculptLineTheme.dark)
                .clipShape(RoundedRectangle(cornerRadius: 5))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(SculptLineTheme.line, lineWidth: 1))
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SculptLineTheme.amberBg)
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

// MARK: - Connections

struct ConnectionsView: View {
    @ObservedObject var store: WorkspaceStore
    @State private var serverURLDraft: String = ""
    @State private var urlMessage: String = ""
    @State private var isExpanded: Bool = true

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 6) {
                serverURLRow
                systemRows
                providersHeader
                providerRows
            }
            .padding(.top, 4)
        } label: {
            Text("CONNECTIONS")
                .font(.system(size: 11.5, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(SculptLineTheme.dark)
        }
        .modifier(WorkspaceCardModifier())
        .onAppear {
            if serverURLDraft.isEmpty {
                serverURLDraft = store.serverURLString
            }
        }
    }

    private var serverTone: AssetTone {
        switch store.connection {
        case .connected: return .ok
        case .unreachable: return .fail
        case .unknown: return .neutral
        }
    }

    private var serverDetail: String {
        switch store.connection {
        case .connected: return "Connected · " + store.serverURLString
        case .unreachable: return "Not reachable · run npm start in fabled/ui"
        case .unknown: return "Checking " + store.serverURLString + "…"
        }
    }

    private var serverURLRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            ConnectionRow(name: "SculptLine server", detail: serverDetail, tone: serverTone, help: store.serverURLString)
            HStack(spacing: 4) {
                TextField(SculptLineServerClient.defaultURLString, text: $serverURLDraft)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 10.5, design: .monospaced))
                    .modifier(PlainURLFieldModifier())
                Button("Use") {
                    let draft: String = serverURLDraft
                    Task { @MainActor in
                        let ok: Bool = await store.setServerURL(draft)
                        urlMessage = ok ? "Saved. Used on next launch too." : "Not a valid http(s) URL."
                        if ok {
                            serverURLDraft = store.serverURLString
                        }
                    }
                }
                .font(.system(size: 10.5, weight: .semibold))
            }
            Text(urlMessage.isEmpty ? "On iPad, use the Mac's LAN address, e.g. http://192.168.1.20:5178" : urlMessage)
                .font(.system(size: 9.5))
                .foregroundStyle(SculptLineTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var systemRows: some View {
        if let status = store.serverStatus {
            ConnectionRow(name: "Pipeline", detail: ConnectionsView.pipelineDetail(status.pipeline),
                          tone: status.pipeline.available ? .ok : .mock, help: status.pipeline.commandPreview)
            ConnectionRow(name: "Blender engine", detail: ConnectionsView.blenderDetail(status.pipeline),
                          tone: ConnectionsView.hasBlender(status.pipeline) ? .ok : .warn, help: status.pipeline.blenderPath)
            ConnectionRow(name: "Validator", detail: ConnectionsView.validatorDetail(status.validator),
                          tone: status.validator.available ? .ok : .mock, help: status.validator.commandPreview)
        } else {
            ConnectionRow(name: "Pipeline & validator",
                          detail: store.isConnected ? "status unavailable" : "waiting for the server",
                          tone: .neutral, help: nil)
        }
        ConnectionRow(name: "Unreal import", detail: "Draft script, never run", tone: .neutral,
                      help: "unreal/import_sculptline_asset.py (untested draft)")
    }

    private var providersHeader: some View {
        HStack {
            WorkspaceSectionLabel(title: "AI PROVIDERS")
            Spacer()
            Button("Generate…") {
                store.openGenerateSheet()
            }
            .buttonStyle(.plain)
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(SculptLineTheme.cyan)
            .disabled(!store.isConnected)
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private var providerRows: some View {
        if store.providers.isEmpty {
            Text("Provider list unavailable.")
                .font(.system(size: 10.5))
                .foregroundStyle(SculptLineTheme.muted)
        } else {
            ForEach(store.providers) { provider in
                ProviderConnectionRow(provider: provider)
            }
        }
    }

    static func hasBlender(_ pipeline: PipelineAvailability) -> Bool {
        if let path = pipeline.blenderPath, !path.isEmpty {
            return true
        }
        return false
    }

    static func pipelineDetail(_ pipeline: PipelineAvailability) -> String {
        if pipeline.available {
            return "SculptLine pipeline found"
        }
        if pipeline.forcedOff == true {
            return "forced to stub (SCULPTLINE_PIPELINE=off)"
        }
        return "not found: stub"
    }

    static func blenderDetail(_ pipeline: PipelineAvailability) -> String {
        return hasBlender(pipeline) ? "Headless Blender found" : "Blender not found: Native Python/NumPy fallback"
    }

    static func validatorDetail(_ validator: ValidatorAvailability) -> String {
        if validator.available {
            return validator.supportsManifest == true ? "SculptLine validator · --manifest" : "SculptLine validator"
        }
        return "not found: stub"
    }
}

/// Turns off autocapitalization / autocorrection for URL fields on iPad.
private struct PlainURLFieldModifier: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        #if os(iOS)
        content
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled(true)
            .keyboardType(.URL)
        #else
        content
            .autocorrectionDisabled(true)
        #endif
    }
}

struct ConnectionRow: View {
    let name: String
    let detail: String
    let tone: AssetTone
    let help: String?

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Circle()
                .fill(WorkspaceStyle.color(for: tone))
                .frame(width: 7, height: 7)
                .padding(.top, 4)
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(SculptLineTheme.dark)
                Text(detail)
                    .font(.system(size: 10))
                    .foregroundStyle(SculptLineTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .help(help ?? "")
    }
}

struct ProviderConnectionRow: View {
    let provider: ProviderInfo

    private var tone: AssetTone {
        if provider.conceptMockup {
            return .mock
        }
        return provider.configured ? .ok : .neutral
    }

    private var detail: String {
        if provider.configured {
            return provider.kindLabels.joined(separator: " · ")
        }
        if provider.env.isEmpty {
            return "not configured"
        }
        return "set \(provider.env.joined(separator: " / ")) to enable"
    }

    private var badge: String? {
        if let label = WorkspaceStyle.verificationLabel(provider.verification) {
            return label
        }
        return provider.conceptMockup ? "CONCEPT MOCKUP" : nil
    }

    private var badgeColor: Color {
        if provider.verification == "mock" || provider.conceptMockup {
            return SculptLineTheme.brown
        }
        return SculptLineTheme.amber
    }

    private var detailDesign: Font.Design {
        return provider.configured ? Font.Design.default : Font.Design.monospaced
    }

    private var docsURL: URL? {
        guard let raw = provider.docs, let url = URL(string: raw), let scheme = url.scheme?.lowercased() else { return nil }
        return (scheme == "https" || scheme == "http") ? url : nil
    }

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Circle()
                .fill(WorkspaceStyle.color(for: tone))
                .frame(width: 7, height: 7)
                .padding(.top, 4)
            VStack(alignment: .leading, spacing: 2) {
                titleLine
                Text(detail)
                    .font(.system(size: 10, weight: .regular, design: detailDesign))
                    .foregroundStyle(SculptLineTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .help(provider.category + ". " + provider.feeds + " " + provider.verificationNote)
    }

    private var titleLine: some View {
        HStack(spacing: 5) {
            Text(provider.name)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(SculptLineTheme.dark)
            if let badge = badge {
                WorkspacePill(text: badge, color: badgeColor)
            }
            Spacer(minLength: 0)
            if let url = docsURL {
                Link("docs", destination: url)
                    .font(.system(size: 10))
            }
        }
    }
}

// MARK: - Asset page (inspector "Page" tab)

struct AssetPageView: View {
    @ObservedObject var viewModel: SculptLineViewModel
    @ObservedObject var store: WorkspaceStore

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let asset = store.selectedAsset {
                AssetPageHeader(asset: asset)
                propertiesGrid(asset)
                generationSection(asset)
                notesSection
                generateFromButton(asset)
                activitySection(showAssetLinks: false)
            } else {
                Text("Workspace")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(SculptLineTheme.dark)
                Text(noSelectionText)
                    .font(.system(size: 11))
                    .foregroundStyle(SculptLineTheme.muted)
                activitySection(showAssetLinks: true)
            }
        }
    }

    private var noSelectionText: String {
        if store.selectedAssetId == nil {
            return "Select an asset in the tree to open its page."
        }
        return "This asset is no longer in the workspace index."
    }

    private func emptyActivityText(showAssetLinks: Bool) -> String {
        if showAssetLinks {
            return "No activity yet."
        }
        return "No recorded activity for this asset yet. Uploads, pipeline runs, validator runs, generations and notes appear here."
    }

    private func propertiesGrid(_ asset: WorkspaceAsset) -> some View {
        let rows: [AssetPageProperty] = store.pageProperties(for: asset)
        return VStack(alignment: .leading, spacing: 4) {
            ForEach(rows) { row in
                AssetPropertyRow(property: row, accent: viewModel.accentColor) { targetId in
                    selectAsset(targetId)
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SculptLineTheme.elevated)
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(SculptLineTheme.line, lineWidth: 1))
    }

    @ViewBuilder
    private func generationSection(_ asset: WorkspaceAsset) -> some View {
        if let generation = store.liveGeneration(for: asset) {
            GenerationCardView(
                generation: generation,
                kindLabel: store.kindLabel(forGenerationKind: generation.kind),
                importedJobId: store.importedJobId(for: generation),
                isImporting: store.importingGenerationIds.contains(generation.id),
                importError: store.importErrors[generation.id],
                videoURL: store.videoURL(for: generation),
                accent: viewModel.accentColor,
                onImport: {
                    Task { @MainActor in
                        await viewModel.importGenerationAndOpen(id: generation.id)
                    }
                },
                onOpenImported: { jobId in
                    Task { @MainActor in
                        await viewModel.openImportedJob(jobId: jobId)
                    }
                }
            )
        }
    }

    private var noteBinding: Binding<String> {
        return Binding<String>(
            get: { store.noteText },
            set: { newValue in store.editNote(newValue) }
        )
    }

    private var notesSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                WorkspaceSectionLabel(title: "NOTES")
                Text(store.noteStatus)
                    .font(.system(size: 9.5))
                    .foregroundStyle(store.noteStatus.hasPrefix("not saved") || store.noteStatus.hasPrefix("notes unavailable")
                                     ? SculptLineTheme.amber : SculptLineTheme.muted)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            TextEditor(text: noteBinding)
                .font(.system(size: 11, design: .monospaced))
                .scrollContentBackground(.hidden)
                .padding(6)
                .frame(minHeight: 80, maxHeight: 140)
                .background(SculptLineTheme.elevated)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(SculptLineTheme.line, lineWidth: 1))
                .disabled(!store.noteEditable)
            Text("Saved to ui/work/workspace_notes.json on the SculptLine server.")
                .font(.system(size: 9.5))
                .foregroundStyle(SculptLineTheme.muted)
        }
    }

    @ViewBuilder
    private func generateFromButton(_ asset: WorkspaceAsset) -> some View {
        if ["pipeline_output", "frozen_run", "upload", "generated"].contains(asset.kind) {
            Button {
                store.openGenerateSheet(sourceAssetId: asset.id)
            } label: {
                Label("Generate from this asset…", systemImage: "sparkles")
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(SculptLineTheme.elevated)
                    .foregroundStyle(SculptLineTheme.dark)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(SculptLineTheme.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(!store.isConnected)
        }
    }

    private func activitySection(showAssetLinks: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            WorkspaceSectionLabel(title: showAssetLinks ? String("RECENT ACTIVITY") : String("ACTIVITY"))
            if !store.activityStatus.isEmpty {
                Text(store.activityStatus)
                    .font(.system(size: 10.5))
                    .foregroundStyle(SculptLineTheme.muted)
            } else if store.activity.isEmpty {
                Text(emptyActivityText(showAssetLinks: showAssetLinks))
                    .font(.system(size: 10.5))
                    .foregroundStyle(SculptLineTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(store.activity) { event in
                ActivityRow(
                    event: event,
                    assetName: showAssetLinks ? assetName(for: event.assetId) : nil,
                    accent: viewModel.accentColor,
                    onGoto: { targetId in selectAsset(targetId) }
                )
            }
        }
    }

    private func assetName(for id: String?) -> String? {
        guard let id = id else { return nil }
        return store.asset(id: id)?.name ?? id
    }

    /// "From asset" / activity links: open the asset when the index has it, else just show its page.
    private func selectAsset(_ id: String) {
        if let target = store.asset(id: id) {
            Task { @MainActor in
                await viewModel.openWorkspaceAsset(target)
            }
        } else {
            store.select(id)
        }
    }
}

struct AssetPageHeader: View {
    let asset: WorkspaceAsset

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(asset.name)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(SculptLineTheme.dark)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 5) {
                Image(systemName: WorkspaceModel.sfSymbol(forKind: asset.kind))
                    .font(.system(size: 10))
                    .foregroundStyle(SculptLineTheme.muted)
                Text(WorkspaceModel.kindLabel(asset.kind) ?? asset.kind)
                    .font(.system(size: 10.5))
                    .foregroundStyle(SculptLineTheme.muted)
                WorkspacePill(text: asset.status.label.isEmpty ? "—" : asset.status.label,
                              color: WorkspaceStyle.color(for: WorkspaceModel.tone(of: asset)))
                if asset.conceptMockup == true {
                    WorkspacePill(text: "CONCEPT MOCKUP", color: SculptLineTheme.brown)
                }
            }
        }
    }
}

struct AssetPropertyRow: View {
    let property: AssetPageProperty
    let accent: Color
    let onGoto: (String) -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(property.key)
                .font(.system(size: 10.5))
                .foregroundStyle(SculptLineTheme.muted)
                .frame(width: 82, alignment: .leading)
            valueView
            Spacer(minLength: 0)
        }
        .help(property.help ?? "")
    }

    private var valueDesign: Font.Design {
        return property.key == "Folder" ? Font.Design.monospaced : Font.Design.default
    }

    @ViewBuilder
    private var valueView: some View {
        if let target = property.gotoAssetId {
            Button(property.value) {
                onGoto(target)
            }
            .buttonStyle(.plain)
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(accent)
            .multilineTextAlignment(.leading)
        } else {
            Text(property.value)
                .font(.system(size: 10.5, weight: .regular, design: valueDesign))
                .foregroundStyle(SculptLineTheme.dark)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
    }
}

struct ActivityRow: View {
    let event: ActivityEvent
    /// Shown (as a link) on the workspace-level list only.
    let assetName: String?
    let accent: Color
    let onGoto: (String) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Circle()
                .fill(SculptLineTheme.muted.opacity(0.7))
                .frame(width: 5, height: 5)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(event.message ?? event.type)
                        .font(.system(size: 10.5))
                        .foregroundStyle(SculptLineTheme.dark)
                        .fixedSize(horizontal: false, vertical: true)
                    if event.conceptMockup == true {
                        WorkspacePill(text: "MOCKUP", color: SculptLineTheme.brown)
                    }
                }
                metaLine
            }
            Spacer(minLength: 0)
        }
        .help(event.at)
    }

    private var metaLine: some View {
        HStack(spacing: 4) {
            Text(WorkspaceModel.timeAgo(event.at) ?? event.at)
                .font(.system(size: 9.5))
                .foregroundStyle(SculptLineTheme.muted)
            if let name = assetName, let id = event.assetId {
                Text("·")
                    .font(.system(size: 9.5))
                    .foregroundStyle(SculptLineTheme.muted)
                Button(name) {
                    onGoto(id)
                }
                .buttonStyle(.plain)
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(accent)
                .lineLimit(1)
            }
        }
    }
}

// MARK: - Generation card

struct GenerationCardView: View {
    let generation: Generation
    let kindLabel: String
    let importedJobId: String?
    let isImporting: Bool
    let importError: String?
    let videoURL: URL?
    let accent: Color
    let onImport: () -> Void
    let onOpenImported: (String) -> Void

    private var progressFraction: Double {
        let percent: Double = generation.progress ?? 5
        return min(max(percent / 100.0, 0.0), 1.0)
    }

    private var importTitle: String {
        return isImporting ? "Importing…" : "Import as sculpt → pipeline"
    }

    private var statusText: String {
        if !generation.isTerminal, let progress = generation.progress {
            return "\(generation.status) \(Int(progress.rounded()))%"
        }
        return generation.status
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            headLine
            if !generation.prompt.isEmpty {
                Text("“\(generation.prompt)”")
                    .font(.system(size: 10.5))
                    .italic()
                    .foregroundStyle(SculptLineTheme.dark)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !generation.isTerminal {
                ProgressView(value: progressFraction)
                    .tint(SculptLineTheme.cyan)
            }
            errorLines
            actionsLine
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SculptLineTheme.elevated)
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(SculptLineTheme.line, lineWidth: 1))
    }

    private var headLine: some View {
        HStack(spacing: 5) {
            Text(generation.providerName)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(SculptLineTheme.dark)
            Text(kindLabel)
                .font(.system(size: 10))
                .foregroundStyle(SculptLineTheme.muted)
            WorkspacePill(text: statusText, color: WorkspaceStyle.color(for: WorkspaceStyle.tone(for: generation)))
            if generation.conceptMockup {
                WorkspacePill(text: "CONCEPT MOCKUP", color: SculptLineTheme.brown)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var errorLines: some View {
        if let error = generation.error, !error.isEmpty {
            Text(error)
                .font(.system(size: 10))
                .foregroundStyle(SculptLineTheme.red)
                .fixedSize(horizontal: false, vertical: true)
        }
        if let pollError = generation.pollError, !pollError.isEmpty {
            Text("Last poll: " + pollError)
                .font(.system(size: 10))
                .foregroundStyle(SculptLineTheme.amber)
                .fixedSize(horizontal: false, vertical: true)
        }
        if let importError = importError {
            Text(importError)
                .font(.system(size: 10))
                .foregroundStyle(SculptLineTheme.red)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var actionsLine: some View {
        HStack(spacing: 8) {
            modelAction
            if let url = videoURL {
                Link("Open video ↗", destination: url)
                    .font(.system(size: 10.5, weight: .semibold))
            }
            Spacer(minLength: 0)
            Text(WorkspaceModel.timeAgo(generation.createdAt) ?? "")
                .font(.system(size: 9.5))
                .foregroundStyle(SculptLineTheme.muted)
        }
    }

    @ViewBuilder
    private var modelAction: some View {
        if generation.modelOutput != nil && generation.status == "succeeded" {
            if let jobId = importedJobId {
                Button("Open imported sculpt") {
                    onOpenImported(jobId)
                }
                .buttonStyle(.plain)
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(accent)
            } else {
                Button(importTitle) {
                    onImport()
                }
                .buttonStyle(.plain)
                .font(.system(size: 10.5, weight: .semibold))
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(accent.opacity(0.2))
                .foregroundStyle(accent)
                .clipShape(RoundedRectangle(cornerRadius: 5))
                .disabled(isImporting)
            }
        }
    }
}

// MARK: - Generate sheet

/// An input image picked from disk, ready to send as a data URI.
struct PickedGenerationImage: Equatable {
    let name: String
    let dataURI: String
    let byteCount: Int

    static let maxBytes: Int = 10 * 1024 * 1024

    /// The MIME type the server accepts for this file name (png / jpeg / webp), else nil.
    static func mimeType(forFileName name: String) -> String? {
        switch (name as NSString).pathExtension.lowercased() {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        default: return nil
        }
    }

    /// Builds the data URI, or returns a message saying why the file cannot be used.
    static func make(name: String, data: Data) -> Result<PickedGenerationImage, PickedImageError> {
        guard let mime = mimeType(forFileName: name) else {
            return .failure(PickedImageError(message: "Use a .png, .jpg or .webp image."))
        }
        if data.count > maxBytes {
            return .failure(PickedImageError(message: "Image is over 10 MB."))
        }
        if data.isEmpty {
            return .failure(PickedImageError(message: "The image file is empty."))
        }
        let uri: String = "data:" + mime + ";base64," + data.base64EncodedString()
        return .success(PickedGenerationImage(name: name, dataURI: uri, byteCount: data.count))
    }
}

struct PickedImageError: Error, Equatable {
    let message: String
}

enum GenerateImageSource: String, CaseIterable, Identifiable {
    case none = "None"
    case file = "Image file…"

    var id: String { rawValue }
}

struct GenerateSheet: View {
    @ObservedObject var viewModel: SculptLineViewModel
    @ObservedObject var store: WorkspaceStore
    @Environment(\.dismiss) private var dismiss

    @State private var providerId: String = ""
    @State private var kind: String = ""
    @State private var prompt: String = ""
    @State private var imageSource: GenerateImageSource = .none
    @State private var pickedImage: PickedGenerationImage?
    @State private var showImagePicker: Bool = false
    @State private var isSubmitting: Bool = false
    @State private var localMessage: String = ""

    private var selectedProvider: ProviderInfo? {
        return store.providers.first(where: { $0.id == providerId })
    }

    private var availableKinds: [String] {
        return selectedProvider?.kinds ?? []
    }

    private var needsImage: Bool {
        return !kind.isEmpty && kind != "text-to-3d"
    }

    private var imageTypes: [UTType] {
        return [.png, .jpeg, .webP]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            titleBar
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    providerSection
                    modeSection
                    promptSection
                    if needsImage {
                        imageSection
                    }
                    outputNote
                    submitRow
                    recentSection
                }
                .padding(.bottom, 8)
            }
        }
        .padding(18)
        .frame(minWidth: 520, minHeight: 560)
        .background(SculptLineTheme.voidBg)
        .foregroundStyle(SculptLineTheme.dark)
        .preferredColorScheme(.dark)
        .onAppear {
            chooseInitialProvider()
        }
        .fileImporter(isPresented: $showImagePicker, allowedContentTypes: imageTypes, allowsMultipleSelection: false) { result in
            handlePickedImage(result)
        }
    }

    private var titleBar: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Generate with an AI provider")
                    .font(.system(size: 16, weight: .bold))
                Text("The SculptLine server calls the provider; keys stay in its environment. Results appear under AI generations.")
                    .font(.system(size: 11))
                    .foregroundStyle(SculptLineTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button("Close") {
                dismiss()
            }
            .keyboardShortcut(.cancelAction)
        }
    }

    private var providerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            WorkspaceSectionLabel(title: "PROVIDER")
            if store.providers.isEmpty {
                Text("Provider list unavailable. Is the SculptLine server running?")
                    .font(.system(size: 11))
                    .foregroundStyle(SculptLineTheme.muted)
            }
            ForEach(store.providers) { provider in
                GenerateProviderOption(provider: provider, isSelected: provider.id == providerId,
                                       accent: viewModel.accentColor) {
                    selectProvider(provider)
                }
            }
        }
    }

    @ViewBuilder
    private var modeSection: some View {
        if !availableKinds.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                WorkspaceSectionLabel(title: "MODE")
                Picker("Mode", selection: $kind) {
                    ForEach(availableKinds, id: \.self) { k in
                        Text(store.kindLabel(forGenerationKind: k)).tag(k)
                    }
                }
                .labelsHidden()
                .pickerStyle(.segmented)
            }
        }
    }

    private var promptPlaceholder: String {
        switch kind {
        case "text-to-3d": return "e.g. stylized dwarf blacksmith bust, game prop, neutral pose"
        case "image-to-video": return "Camera move / action, e.g. slow 180° orbit around the bust, studio light"
        default: return "Optional texture prompt"
        }
    }

    private var promptSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            WorkspaceSectionLabel(title: "PROMPT")
            TextField(promptPlaceholder, text: $prompt, axis: .vertical)
                .lineLimit(3...6)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12))
        }
    }

    private var imageSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            WorkspaceSectionLabel(title: "INPUT IMAGE")
            Picker("Image", selection: $imageSource) {
                ForEach(GenerateImageSource.allCases) { source in
                    Text(source.rawValue).tag(source)
                }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            if imageSource == .file {
                HStack(spacing: 8) {
                    Button(chooseImageTitle) {
                        showImagePicker = true
                    }
                    if let picked = pickedImage {
                        Text("\(picked.name) · \(ByteCountFormatter.string(fromByteCount: Int64(picked.byteCount), countStyle: .file))")
                            .font(.system(size: 10.5, design: .monospaced))
                            .foregroundStyle(SculptLineTheme.muted)
                            .lineLimit(1)
                    }
                }
            }
            Text("PNG, JPEG or WebP up to 10 MB. Sent to the provider through the server, which does not store it.")
                .font(.system(size: 10))
                .foregroundStyle(SculptLineTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var chooseImageTitle: String {
        return pickedImage == nil ? "Choose image…" : "Choose another…"
    }

    private var outputNoteText: String {
        if kind == "image-to-video" {
            return "Output: a video clip, attached to the generation page. It does not enter the mesh pipeline."
        }
        return "Output: a mesh. Import it as a sculpt, then Build retopo + LODs and run the pre-import check."
    }

    private var outputNote: some View {
        Text(outputNoteText)
            .font(.system(size: 10.5))
            .foregroundStyle(SculptLineTheme.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var statusMessage: String {
        return localMessage.isEmpty ? store.generateMessage : localMessage
    }

    private var submitTitle: String {
        return isSubmitting ? "Submitting…" : "Generate"
    }

    private var submitRow: some View {
        HStack(spacing: 10) {
            Button {
                submit()
            } label: {
                Text(submitTitle)
                    .font(.system(size: 12.5, weight: .semibold))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                    .background(viewModel.accentColor)
                    .foregroundStyle(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
            }
            .buttonStyle(.plain)
            .disabled(isSubmitting || selectedProvider?.configured != true || kind.isEmpty)
            Text(statusMessage)
                .font(.system(size: 11))
                .foregroundStyle(SculptLineTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            WorkspaceSectionLabel(title: "RECENT GENERATIONS")
            if store.generations.isEmpty {
                Text("No generations yet.")
                    .font(.system(size: 11))
                    .foregroundStyle(SculptLineTheme.muted)
            }
            ForEach(Array(store.generations.prefix(12))) { generation in
                recentCard(generation)
            }
        }
    }

    private func recentCard(_ generation: Generation) -> some View {
        GenerationCardView(
            generation: generation,
            kindLabel: store.kindLabel(forGenerationKind: generation.kind),
            importedJobId: store.importedJobId(for: generation),
            isImporting: store.importingGenerationIds.contains(generation.id),
            importError: store.importErrors[generation.id],
            videoURL: store.videoURL(for: generation),
            accent: viewModel.accentColor,
            onImport: {
                Task { @MainActor in
                    let ok: Bool = await viewModel.importGenerationAndOpen(id: generation.id)
                    if ok {
                        dismiss()
                    }
                }
            },
            onOpenImported: { jobId in
                dismiss()
                Task { @MainActor in
                    await viewModel.openImportedJob(jobId: jobId)
                }
            }
        )
    }

    // MARK: Actions

    private func chooseInitialProvider() {
        if let current = selectedProvider, current.configured {
            fixKind()
            return
        }
        let providers: [ProviderInfo] = store.providers
        let pick: ProviderInfo? = providers.first(where: { $0.configured && !$0.conceptMockup })
            ?? providers.first(where: { $0.configured })
            ?? providers.first
        providerId = pick?.id ?? ""
        fixKind()
    }

    private func selectProvider(_ provider: ProviderInfo) {
        guard provider.configured else { return }
        providerId = provider.id
        fixKind()
        localMessage = ""
    }

    private func fixKind() {
        let kinds: [String] = availableKinds
        if !kinds.contains(kind) {
            kind = kinds.first ?? ""
        }
    }

    private func handlePickedImage(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            localMessage = "Could not open the image: " + error.localizedDescription
        case .success(let urls):
            guard let url = urls.first else { return }
            let scoped: Bool = url.startAccessingSecurityScopedResource()
            defer {
                if scoped {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            let size: Int = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            if size > PickedGenerationImage.maxBytes {
                pickedImage = nil
                localMessage = "Image is over 10 MB."
                return
            }
            guard let data = try? Data(contentsOf: url) else {
                pickedImage = nil
                localMessage = "Could not read \(url.lastPathComponent)."
                return
            }
            switch PickedGenerationImage.make(name: url.lastPathComponent, data: data) {
            case .success(let picked):
                pickedImage = picked
                localMessage = ""
            case .failure(let problem):
                pickedImage = nil
                localMessage = problem.message
            }
        }
    }

    private func submit() {
        guard let provider = selectedProvider, provider.configured else {
            localMessage = "No configured provider selected."
            return
        }
        guard !kind.isEmpty else {
            localMessage = "Pick a mode."
            return
        }
        var image: GenerationImage = .none
        if needsImage {
            guard imageSource == .file, let picked = pickedImage else {
                localMessage = "This mode needs an input image."
                return
            }
            image = .dataURI(picked.dataURI, label: picked.name)
        }
        localMessage = ""
        isSubmitting = true
        let providerKey: String = provider.id
        let kindValue: String = kind
        let promptValue: String = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let source: String? = store.generateSourceAssetId
        // A `let` copy: a captured `var` cannot be referenced from the Task's @Sendable closure.
        let imageValue: GenerationImage = image
        Task { @MainActor in
            let started: Generation? = await store.startGeneration(provider: providerKey, kind: kindValue,
                                                                   prompt: promptValue, image: imageValue,
                                                                   sourceAssetId: source)
            isSubmitting = false
            if started != nil {
                prompt = ""
            }
        }
    }
}

struct GenerateProviderOption: View {
    let provider: ProviderInfo
    let isSelected: Bool
    let accent: Color
    let onSelect: () -> Void

    private var badge: String? {
        if let label = WorkspaceStyle.verificationLabel(provider.verification) {
            return label
        }
        return provider.conceptMockup ? "CONCEPT MOCKUP" : nil
    }

    private var detail: String {
        if provider.configured {
            return provider.feeds
        }
        if provider.env.isEmpty {
            return "Not configured on the server."
        }
        return "Not configured: set \(provider.env.joined(separator: " / ")) in the server environment."
    }

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 12))
                    .foregroundStyle(isSelected ? accent : SculptLineTheme.muted)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 2) {
                    titleLine
                    Text(provider.kindLabels.joined(separator: " · "))
                        .font(.system(size: 10.5))
                        .foregroundStyle(SculptLineTheme.dark)
                    Text(detail)
                        .font(.system(size: 10))
                        .foregroundStyle(SculptLineTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(8)
            .background(isSelected ? accent.opacity(0.12) : SculptLineTheme.elevated)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(isSelected ? accent.opacity(0.45) : SculptLineTheme.line, lineWidth: 1)
            )
            .opacity(provider.configured ? 1.0 : 0.55)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!provider.configured)
        .help(provider.verificationNote)
    }

    private var titleLine: some View {
        HStack(spacing: 5) {
            Text(provider.name)
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(SculptLineTheme.dark)
            Text(provider.category)
                .font(.system(size: 10))
                .foregroundStyle(SculptLineTheme.muted)
            if let badge = badge {
                WorkspacePill(text: badge, color: provider.verification == "mock" || provider.conceptMockup
                              ? SculptLineTheme.brown : SculptLineTheme.amber)
            }
        }
    }
}

/// Presents the generate sheet from the store's flag (kept out of ContentView so only this modifier observes the store).
struct GenerateSheetPresenter: ViewModifier {
    @ObservedObject var viewModel: SculptLineViewModel
    @ObservedObject var store: WorkspaceStore

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $store.showGenerateSheet) {
                GenerateSheet(viewModel: viewModel, store: store)
            }
    }
}
