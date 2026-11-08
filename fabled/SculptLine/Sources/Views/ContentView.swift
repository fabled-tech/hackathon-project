import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @ObservedObject var viewModel: SculptLineViewModel

    var body: some View {
        ZStack {
            // 60fps Subtle Ambient Light-Show Canvas against Palantir Void Black
            AmbientLightShowView(preset: viewModel.themePreset)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                rgbHairlineBar
                topCommandHeader
                mainWorkspaceBody
                footerStatusStrip
            }
        }
        .preferredColorScheme(.dark)
        .background(SculptLineTheme.voidBg)
        .foregroundStyle(SculptLineTheme.dark)
        .fileImporter(
            isPresented: $viewModel.showFileImporter,
            allowedContentTypes: [.item],
            allowsMultipleSelection: false
        ) { result in
            if case .success(let urls) = result, let first = urls.first {
                Task { await viewModel.loadCustomMeshFile(from: first) }
            }
        }
        .sheet(isPresented: $viewModel.showMapInspector) {
            MapInspectorSheet(viewModel: viewModel)
        }
        .sheet(isPresented: $viewModel.showValidatorReportSheet) {
            ValidatorReportSheet(viewModel: viewModel)
        }
        .modifier(GenerateSheetPresenter(viewModel: viewModel, store: viewModel.workspace))
        .task {
            await viewModel.workspace.refresh()
        }
    }

    // MARK: - Subtle RGB + Theme Top Hairline

    private var rgbHairlineBar: some View {
        LinearGradient(
            colors: [
                viewModel.accentColor,
                Color(red: 0.39, green: 0.40, blue: 0.95),
                viewModel.secondaryAccentColor,
                Color(red: 0.93, green: 0.28, blue: 0.60)
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(height: 2)
    }

    // MARK: - Unified Single-Row Notion / Palantir Command Header

    private var topCommandHeader: some View {
        HStack(spacing: 10) {
            // Brand + Left Sidebar Toggle
            HStack(spacing: 8) {
                Button {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.84)) {
                        viewModel.showLeftSidebar.toggle()
                    }
                } label: {
                    Text("☰")
                        .font(.system(size: 12, weight: .semibold))
                        .frame(width: 24, height: 24)
                        .background(viewModel.showLeftSidebar ? viewModel.accentColor.opacity(0.18) : SculptLineTheme.elevated)
                        .foregroundStyle(viewModel.showLeftSidebar ? viewModel.accentColor : SculptLineTheme.muted)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(viewModel.showLeftSidebar ? viewModel.accentColor.opacity(0.45) : SculptLineTheme.line, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .help("Toggle Left Sidebar")

                Text("◆")
                    .font(.system(size: 11, weight: .bold))
                    .frame(width: 22, height: 22)
                    .background(viewModel.accentColor.opacity(0.2))
                    .foregroundStyle(viewModel.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                    .overlay(
                        RoundedRectangle(cornerRadius: 5)
                            .stroke(viewModel.accentColor.opacity(0.45), lineWidth: 1)
                    )

                Text("SculptLine")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(SculptLineTheme.dark)

                Text("by Fabled")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(SculptLineTheme.muted)

                Text("/")
                    .foregroundStyle(SculptLineTheme.muted.opacity(0.5))

                Text("FOUNDRY WORKSPACE")
                    .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                    .tracking(0.7)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(viewModel.accentColor.opacity(0.14))
                    .foregroundStyle(viewModel.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(viewModel.accentColor.opacity(0.38), lineWidth: 1)
                    )
            }

            Spacer(minLength: 4)

            // Compact Walkthrough Beats
            HStack(spacing: 4) {
                Text("WALKTHROUGH")
                    .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(SculptLineTheme.muted)
                    .padding(.horizontal, 4)

                tourStepButton(beat: 1, title: "1·Sculpt")
                tourStepButton(beat: 2, title: "2·Spec")
                tourStepButton(beat: 3, title: "3·Retopo")
                tourStepButton(beat: 4, title: "4·LODs")
                tourStepButton(beat: 5, title: "5·Check")
                tourStepButton(beat: 6, title: "6·Fix")
            }
            .padding(3)
            .background(SculptLineTheme.elevated.opacity(0.85))
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(SculptLineTheme.line, lineWidth: 1))

            Spacer(minLength: 4)

            // Theme Selector + Layout Mode + Right Inspector Toggle
            HStack(spacing: 6) {
                HStack(spacing: 5) {
                    Circle()
                        .fill(viewModel.accentColor)
                        .frame(width: 7, height: 7)
                        .shadow(color: viewModel.accentColor, radius: 4)

                    Picker("Theme", selection: $viewModel.themePreset) {
                        ForEach(AmbientThemePreset.allCases) { preset in
                            Text(preset.rawValue).tag(preset)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 128)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(SculptLineTheme.elevated)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(viewModel.accentColor.opacity(0.35), lineWidth: 1))

                HStack(spacing: 2) {
                    ForEach(WorkspaceLayoutMode.allCases) { mode in
                        let active = viewModel.layoutMode == mode
                        Button(mode.rawValue) {
                            withAnimation(.spring(response: 0.26, dampingFraction: 0.85)) {
                                viewModel.layoutMode = mode
                            }
                        }
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: active ? .semibold : .regular))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(active ? viewModel.accentColor.opacity(0.18) : Color.clear)
                        .foregroundStyle(active ? viewModel.accentColor : SculptLineTheme.muted)
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                }
                .padding(2)
                .background(SculptLineTheme.elevated)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(SculptLineTheme.line, lineWidth: 1))

                Button {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.84)) {
                        viewModel.showRightInspector.toggle()
                    }
                } label: {
                    Text("◫")
                        .font(.system(size: 12, weight: .semibold))
                        .frame(width: 24, height: 24)
                        .background(viewModel.showRightInspector ? viewModel.accentColor.opacity(0.18) : SculptLineTheme.elevated)
                        .foregroundStyle(viewModel.showRightInspector ? viewModel.accentColor : SculptLineTheme.muted)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(viewModel.showRightInspector ? viewModel.accentColor.opacity(0.45) : SculptLineTheme.line, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .help("Toggle Right Telemetry Inspector")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(Color(red: 0.04, green: 0.05, blue: 0.08).opacity(0.84))
        .overlay(alignment: .bottom) {
            Rectangle().fill(SculptLineTheme.line).frame(height: 1)
        }
    }

    private func tourStepButton(beat: Int, title: String) -> some View {
        let isActive = viewModel.activeBeat == beat
        return Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                viewModel.activeBeat = beat
            }
            Task { await viewModel.runStoryboardBeat(beat) }
        } label: {
            Text(title)
                .font(.system(size: 11, weight: isActive ? .semibold : .regular))
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(isActive ? viewModel.accentColor.opacity(0.2) : Color.clear)
                .foregroundStyle(isActive ? viewModel.accentColor : SculptLineTheme.muted)
                .clipShape(RoundedRectangle(cornerRadius: 5))
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .stroke(isActive ? viewModel.accentColor.opacity(0.45) : Color.clear, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Main Workspace Body (Fixed, Well-Proportioned Pane Widths)

    private var mainWorkspaceBody: some View {
        HStack(alignment: .top, spacing: 10) {
            if viewModel.layoutMode == .all && viewModel.showLeftSidebar {
                leftSidebarColumn
                    .frame(width: 265)
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }

            centerViewportsColumn
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            if (viewModel.layoutMode == .all || viewModel.layoutMode == .splitCheck) && viewModel.showRightInspector {
                rightInspectorColumn
                    .frame(width: 315)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .padding(10)
    }

    // MARK: - Column 1: Left Workspace Sidebar (Notion-Style Collapsible Blocks)

    private var leftSidebarColumn: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                WorkspaceTreeView(viewModel: viewModel, store: viewModel.workspace)
                ConnectionsView(store: viewModel.workspace)
                sculptSourceCard
                studioSpecProfileCard
            }
        }
    }

    private var sculptSourceCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle(num: "01", title: "SCULPT SOURCE")

            Button {
                viewModel.showFileImporter = true
            } label: {
                VStack(spacing: 3) {
                    Text("Drop 3D sculpt or click to browse")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(SculptLineTheme.dark)
                    Text(".glb · .obj (local SceneKit topology engine)")
                        .font(.system(size: 10.5))
                        .foregroundStyle(SculptLineTheme.muted)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(SculptLineTheme.elevated)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                        .foregroundStyle(viewModel.accentColor.opacity(0.6))
                )
            }
            .buttonStyle(.plain)

            HStack(spacing: 6) {
                secondaryActionButton("Load sample") {
                    Task { await viewModel.loadRawSampleSculpt() }
                }
                secondaryActionButton("Open frozen run") {
                    Task { await viewModel.openRealPipelineOutput() }
                }
            }

            if let src = viewModel.sourceMesh {
                let sz = src.sizeVector
                VStack(alignment: .leading, spacing: 2) {
                    Text(src.displayName)
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(viewModel.accentColor)
                    Text("\(src.triangleCount.formatted()) tris · \(src.weldedVertexCount.formatted()) welded verts")
                        .font(.system(size: 10.5, design: .monospaced))
                    Text(String(format: "bbox %.2f × %.2f × %.2f (file units)", sz.x, sz.y, sz.z))
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(SculptLineTheme.muted)
                }
                .padding(7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SculptLineTheme.elevated)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(SculptLineTheme.line, lineWidth: 1))
            }

            DisclosureGroup("Source credit & details", isExpanded: $viewModel.showMoreOutputs) {
                VStack(alignment: .leading, spacing: 4) {
                    if let sample = viewModel.activeLicensedSample {
                        if let creditURL = sample.creditLink {
                            Link(sample.credit, destination: creditURL)
                                .font(.system(size: 10.5))
                                .foregroundStyle(SculptLineTheme.dark)
                        } else {
                            Text(sample.credit)
                                .font(.system(size: 10.5))
                                .foregroundStyle(SculptLineTheme.dark)
                        }
                        Text(sample.disclaimer)
                            .font(.system(size: 10))
                            .italic()
                            .foregroundStyle(SculptLineTheme.muted)
                    } else {
                        Text("No licensed-sample credit applies to this asset.")
                            .font(.system(size: 10))
                            .foregroundStyle(SculptLineTheme.muted)
                    }
                }
                .padding(.top, 4)
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(SculptLineTheme.muted)
        }
        .modifier(SculptLineCardModifier())
    }

    private var studioSpecProfileCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle(num: "02", title: "STUDIO SPEC PROFILE")

            if viewModel.isReadOnlyPipelineOutput && !viewModel.showEditableWhenReadOnly {
                VStack(alignment: .leading, spacing: 5) {
                    Text("VALUES USED FOR THIS OUTPUT")
                        .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(viewModel.accentColor.opacity(0.18))
                        .foregroundStyle(viewModel.accentColor)
                        .clipShape(RoundedRectangle(cornerRadius: 4))

                    ForEach(viewModel.usedProfileRows.prefix(5), id: \.0) { row in
                        HStack(alignment: .firstTextBaseline) {
                            Text(row.0)
                                .font(.system(size: 10.5))
                                .foregroundStyle(SculptLineTheme.muted)
                            Spacer()
                            Text(row.1)
                                .font(.system(size: 10.5, design: .monospaced))
                                .foregroundStyle(SculptLineTheme.dark)
                                .lineLimit(1)
                        }
                    }

                    secondaryActionButton("Show editable profile") {
                        viewModel.showEditableWhenReadOnly = true
                    }
                }
                .padding(8)
                .background(SculptLineTheme.elevated)
                .clipShape(RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(SculptLineTheme.line, lineWidth: 1))
            } else {
                VStack(alignment: .leading, spacing: 7) {
                    labeledField("Profile name") {
                        TextField("Profile name", text: $viewModel.profile.name)
                            .textFieldStyle(.roundedBorder)
                    }

                    HStack(spacing: 6) {
                        labeledField("Units") {
                            Picker("Units", selection: $viewModel.profile.units) {
                                ForEach(SourceUnits.allCases) { u in
                                    Text(u.rawValue).tag(u)
                                }
                            }
                            .labelsHidden()
                        }

                        labeledField("Scale") {
                            TextField("Scale", value: $viewModel.profile.scale, format: .number)
                                .textFieldStyle(.roundedBorder)
                        }
                    }

                    HStack(spacing: 6) {
                        labeledField("Asset class") {
                            Picker("Class", selection: $viewModel.profile.assetClass) {
                                ForEach(AssetClassPreset.presets) { preset in
                                    Text(preset.id.capitalized).tag(preset)
                                }
                            }
                            .labelsHidden()
                        }

                        labeledField("Up axis") {
                            Picker("Up", selection: $viewModel.profile.upAxis) {
                                ForEach(UpAxis.allCases) { ax in
                                    Text(ax.label).tag(ax)
                                }
                            }
                            .labelsHidden()
                        }
                    }

                    DisclosureGroup("Texel density & LOD budgets", isExpanded: $viewModel.showAdvancedProfile) {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                labeledField("Texel (px/m)") {
                                    TextField("Texel", value: $viewModel.profile.texelDensityPxPerM, format: .number)
                                        .textFieldStyle(.roundedBorder)
                                }
                                labeledField("Map res") {
                                    Picker("Res", selection: $viewModel.profile.textureSize) {
                                        Text("1024").tag(1024)
                                        Text("2048").tag(2048)
                                        Text("4096").tag(4096)
                                    }
                                    .labelsHidden()
                                }
                            }

                            ForEach($viewModel.profile.lodBudgets) { $lod in
                                HStack {
                                    Text("LOD\(lod.level)")
                                        .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                                        .foregroundStyle(viewModel.accentColor)
                                        .frame(width: 38, alignment: .leading)
                                    TextField("Max tris", value: $lod.maxTriangles, format: .number)
                                        .textFieldStyle(.roundedBorder)
                                }
                            }
                        }
                        .padding(.top, 6)
                    }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(SculptLineTheme.muted)
                }
            }

            // Pipeline Engine Toggle & Host Blender Detection (Feature 15)
            VStack(alignment: .leading, spacing: 5) {
                Text("PIPELINE ENGINE")
                    .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                    .foregroundStyle(SculptLineTheme.muted)

                Picker("Engine", selection: $viewModel.selectedEngine) {
                    ForEach(PipelineEngine.allCases) { eng in
                        Text(eng.shortLabel).tag(eng)
                    }
                }
                .pickerStyle(.segmented)

                if viewModel.hostBlenderDetected {
                    HStack(spacing: 4) {
                        Text("✓")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(SculptLineTheme.green)
                        Text(viewModel.detectedBlenderVersion ?? "Blender detected")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(SculptLineTheme.green)
                        if let path = viewModel.detectedBlenderPath {
                            Text("(\(path))")
                                .font(.system(size: 8.5, design: .monospaced))
                                .foregroundStyle(SculptLineTheme.muted)
                                .lineLimit(1)
                        }
                    }
                } else {
                    HStack(spacing: 4) {
                        Text("⚠")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(SculptLineTheme.amber)
                        Text("Blender not detected · Native Fallback active")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(SculptLineTheme.amber)
                    }
                }
            }
            .padding(7)
            .background(SculptLineTheme.elevated)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(SculptLineTheme.line, lineWidth: 1))

            Button {
                Task { await viewModel.runPipelineOrPreview() }
            } label: {
                Text("Build retopo + LODs")
                    .font(.system(size: 12.5, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(
                        LinearGradient(
                            colors: [viewModel.accentColor, Color(red: 0.39, green: 0.40, blue: 0.95)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .foregroundStyle(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
            }
            .buttonStyle(.plain)
            .disabled(viewModel.sourceMesh == nil || viewModel.isBusy)
        }
        .modifier(SculptLineCardModifier())
    }

    // MARK: - Column 2: Center Dual 3D Viewports

    private var centerViewportsColumn: some View {
        VStack(spacing: 8) {
            viewerToolbar
            HStack(spacing: 8) {
                leftHighPolyViewport
                rightRetopoViewport
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .overlay(alignment: .bottom) {
            if viewModel.isBusy || viewModel.activeProgress != nil {
                liveProgressTrackerOverlay
                    .padding(.bottom, 12)
            }
        }
    }

    private var liveProgressTrackerOverlay: some View {
        VStack(spacing: 7) {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)

                if let prog = viewModel.activeProgress {
                    Text("Stage \(prog.step)/8: \(prog.label)")
                        .font(.system(size: 11.5, weight: .semibold))
                } else {
                    Text(viewModel.busyMessage)
                        .font(.system(size: 11.5, weight: .medium))
                }

                Spacer()

                Button("Cancel") {
                    viewModel.cancelPipelineJob()
                }
                .buttonStyle(.plain)
                .font(.system(size: 10, weight: .bold))
                .padding(.horizontal, 7)
                .padding(.vertical, 2.5)
                .background(SculptLineTheme.red.opacity(0.2))
                .foregroundStyle(SculptLineTheme.red)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }

            // 8-stage progress indicator chain
            HStack(spacing: 4) {
                ForEach(PipelineStageInfo.allStages) { stage in
                    let step = viewModel.activeProgress?.step ?? 0
                    let isCompleted = stage.id < step || viewModel.activeProgress?.done == true
                    let isCurrent = stage.id == step
                    Capsule()
                        .fill(isCompleted ? SculptLineTheme.green : (isCurrent ? viewModel.accentColor : SculptLineTheme.line))
                        .frame(height: 4)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: 420)
        .background(SculptLineTheme.elevated.opacity(0.95))
        .foregroundStyle(SculptLineTheme.dark)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(viewModel.accentColor.opacity(0.5), lineWidth: 1))
    }

    private var viewerToolbar: some View {
        HStack(spacing: 10) {
            Toggle("Wireframe", isOn: $viewModel.wireframeEnabled)
                .modifier(ToolbarToggleStyleModifier())
                .font(.system(size: 11.5))

            Toggle("Sync", isOn: $viewModel.syncCamerasEnabled)
                .modifier(ToolbarToggleStyleModifier())
                .font(.system(size: 11.5))

            Toggle("Flipped", isOn: $viewModel.highlightFlippedEnabled)
                .modifier(ToolbarToggleStyleModifier())
                .font(.system(size: 11.5))

            Toggle("Baked maps", isOn: $viewModel.showBakedMapsEnabled)
                .modifier(ToolbarToggleStyleModifier())
                .font(.system(size: 11.5))

            toolbarPillButton("Frame") {
                viewModel.sharedCameraAzimuth = 0.35
                viewModel.sharedCameraElevation = 0.18
                viewModel.sharedCameraDistanceScale = 1.0
            }

            toolbarPillButton("UVs & Maps") {
                viewModel.showMapInspector = true
            }

            Spacer(minLength: 4)

            HStack(spacing: 4) {
                Text("LOD")
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(SculptLineTheme.muted)

                if viewModel.lodMeshes.isEmpty {
                    Text("none")
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(SculptLineTheme.muted)
                } else {
                    ForEach(Array(viewModel.lodMeshes.enumerated()), id: \.element.id) { idx, lod in
                        let isSelected = idx == viewModel.selectedLODIndex
                        Button("LOD\(lod.level)") {
                            viewModel.selectedLODIndex = idx
                        }
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: isSelected ? .semibold : .regular, design: .monospaced))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(isSelected ? viewModel.accentColor.opacity(0.22) : SculptLineTheme.elevated)
                        .foregroundStyle(isSelected ? viewModel.accentColor : SculptLineTheme.muted)
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                        .overlay(
                            RoundedRectangle(cornerRadius: 5)
                                .stroke(isSelected ? viewModel.accentColor.opacity(0.5) : SculptLineTheme.line, lineWidth: 1)
                        )
                    }
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(SculptLineTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 9))
        .overlay(
            RoundedRectangle(cornerRadius: 9).stroke(SculptLineTheme.line, lineWidth: 1)
        )
    }

    private func toolbarPillButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(SculptLineTheme.elevated)
                .foregroundStyle(SculptLineTheme.dark)
                .clipShape(RoundedRectangle(cornerRadius: 5))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(SculptLineTheme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var leftHighPolyViewport: some View {
        ZStack(alignment: .topLeading) {
            if let src = viewModel.sourceMesh {
                SyncedSceneView(
                    positions: src.positions,
                    indices: src.indices,
                    normals: src.normals,
                    texcoords: src.texcoords,
                    flippedTriangles: src.flippedTriangles,
                    showFlippedHighlight: viewModel.highlightFlippedEnabled,
                    showWireframe: viewModel.wireframeEnabled,
                    showBakedMaps: false,
                    normalMapURL: nil,
                    ormMapURL: nil,
                    syncEnabled: viewModel.syncCamerasEnabled,
                    azimuth: $viewModel.sharedCameraAzimuth,
                    elevation: $viewModel.sharedCameraElevation,
                    distanceScale: $viewModel.sharedCameraDistanceScale
                )
            } else {
                Color(red: 0.04, green: 0.05, blue: 0.08)
                Text("Drop a sculpt or load the sample")
                    .font(.system(size: 12))
                    .foregroundStyle(SculptLineTheme.muted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            HStack(spacing: 6) {
                Text("SOURCE")
                    .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(SculptLineTheme.elevated.opacity(0.9))
                    .foregroundStyle(SculptLineTheme.muted)
                    .clipShape(RoundedRectangle(cornerRadius: 4))

                Text("High-poly sculpt")
                    .font(.system(size: 12.5, weight: .semibold))

                Spacer()

                if let src = viewModel.sourceMesh {
                    Text("\(src.triangleCount.formatted()) tris · \(src.flippedTriangles.count.formatted()) flip")
                        .font(.system(size: 10.5, design: .monospaced))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.black.opacity(0.55))
                        .foregroundStyle(SculptLineTheme.muted)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            }
            .padding(9)
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10).stroke(SculptLineTheme.line, lineWidth: 1)
        )
    }

    private var rightRetopoViewport: some View {
        let currentLOD: BuiltLODMesh? = (viewModel.selectedLODIndex < viewModel.lodMeshes.count)
            ? viewModel.lodMeshes[viewModel.selectedLODIndex]
            : nil

        return ZStack(alignment: .topLeading) {
            if let lod = currentLOD {
                SyncedSceneView(
                    positions: lod.positions,
                    indices: lod.indices,
                    normals: lod.normals,
                    texcoords: lod.texcoords,
                    flippedTriangles: [],
                    showFlippedHighlight: false,
                    showWireframe: viewModel.wireframeEnabled,
                    showBakedMaps: viewModel.showBakedMapsEnabled,
                    normalMapURL: lod.normalMapURL,
                    ormMapURL: lod.ormMapURL,
                    syncEnabled: viewModel.syncCamerasEnabled,
                    azimuth: $viewModel.sharedCameraAzimuth,
                    elevation: $viewModel.sharedCameraElevation,
                    distanceScale: $viewModel.sharedCameraDistanceScale
                )
            } else {
                Color(red: 0.04, green: 0.05, blue: 0.08)
                VStack(spacing: 8) {
                    Text("Run “Build retopo + LODs” or open real pipeline output")
                        .font(.system(size: 12))
                        .foregroundStyle(SculptLineTheme.muted)
                    Button("Open Real Pipeline Output (LOD0–LOD3)") {
                        Task { await viewModel.openRealPipelineOutput() }
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11.5, weight: .semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(viewModel.accentColor.opacity(0.22))
                    .foregroundStyle(viewModel.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(viewModel.accentColor.opacity(0.5), lineWidth: 1))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            HStack(spacing: 6) {
                Text("OUTPUT")
                    .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(viewModel.accentColor.opacity(0.2))
                    .foregroundStyle(viewModel.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 4))

                Text(currentLOD.map { $0.isPreviewMockup ? "LOD\($0.level) preview" : "Retopo LOD\($0.level)" } ?? "Retopo mesh")
                    .font(.system(size: 12.5, weight: .semibold))

                Spacer()

                if let lod = currentLOD {
                    Text("\(lod.triangles.formatted()) tris · ≤\((lod.budget ?? 25000).formatted())")
                        .font(.system(size: 10.5, design: .monospaced))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.black.opacity(0.55))
                        .foregroundStyle(SculptLineTheme.muted)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            }
            .padding(9)
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10).stroke(SculptLineTheme.line, lineWidth: 1)
        )
    }

    // MARK: - Column 3: Right Telemetry Inspector (Segmented Notion-Style Tabs)

    private var rightInspectorColumn: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        sectionTitle(num: "03", title: "TELEMETRY & CHECKS")
                        Spacer()
                        Button("Re-check") {
                            Task { await viewModel.runPreImportChecks() }
                        }
                        .buttonStyle(.plain)
                        .font(.system(size: 11.5, weight: .semibold))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(viewModel.accentColor)
                        .foregroundStyle(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }

                    let flaggedCount = viewModel.browserChecks.filter { $0.passed == false }.count
                    let passedCount = viewModel.browserChecks.filter { $0.passed == true }.count
                    HStack(spacing: 6) {
                        if flaggedCount > 0 {
                            Text("\(flaggedCount) flagged")
                                .font(.system(size: 11.5, weight: .bold, design: .monospaced))
                                .foregroundStyle(SculptLineTheme.red)
                        } else {
                            Text("No blocking issues")
                                .font(.system(size: 11.5, weight: .bold, design: .monospaced))
                                .foregroundStyle(SculptLineTheme.green)
                        }
                        Text("· \(passedCount) passed")
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundStyle(SculptLineTheme.muted)
                    }
                    .padding(7)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SculptLineTheme.elevated)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(SculptLineTheme.line, lineWidth: 1))

                    // Segmented Inspector Tabs
                    HStack(spacing: 3) {
                        ForEach(InspectorSectionTab.allCases) { tab in
                            let active = viewModel.inspectorTab == tab
                            Button(tab.rawValue) {
                                withAnimation(.easeInOut(duration: 0.18)) {
                                    viewModel.inspectorTab = tab
                                }
                            }
                            .buttonStyle(.plain)
                            .font(.system(size: 11, weight: active ? .semibold : .regular))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                            .background(active ? viewModel.accentColor.opacity(0.2) : Color.clear)
                            .foregroundStyle(active ? viewModel.accentColor : SculptLineTheme.muted)
                            .clipShape(RoundedRectangle(cornerRadius: 5))
                        }
                    }
                    .padding(3)
                    .background(SculptLineTheme.voidBg)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(SculptLineTheme.line, lineWidth: 1))

                    if viewModel.inspectorTab == .page {
                        AssetPageView(viewModel: viewModel, store: viewModel.workspace)
                    }

                    if viewModel.inspectorTab == .browser || viewModel.inspectorTab == .all {
                        subsectionHeader("BROWSER CHECKS", badge: "computed from mesh")
                        ForEach(viewModel.browserChecks) { check in
                            checkCardRow(check)
                        }
                    }

                    if viewModel.inspectorTab == .pipeline || viewModel.inspectorTab == .all {
                        subsectionHeader("PIPELINE RUN", badge: "8 stages")
                        if viewModel.pipelineSteps.isEmpty {
                            Text("Open frozen pipeline output or build LODs to inspect step timings.")
                                .font(.system(size: 11))
                                .foregroundStyle(SculptLineTheme.muted)
                        } else {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(viewModel.pipelineSteps) { step in
                                    HStack(spacing: 6) {
                                        Text(step.status == "ok" ? "✓" : "·")
                                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                                            .foregroundStyle(step.status == "ok" ? SculptLineTheme.green : SculptLineTheme.muted)
                                            .frame(width: 14)
                                        Text(step.label)
                                            .font(.system(size: 11.5, weight: .medium))
                                        Spacer()
                                        if let rt = step.runtimeSeconds {
                                            Text(String(format: "%.2fs", rt))
                                                .font(.system(size: 10.5, design: .monospaced))
                                                .foregroundStyle(SculptLineTheme.muted)
                                        }
                                    }
                                }
                            }
                            .padding(8)
                            .background(SculptLineTheme.elevated)
                            .clipShape(RoundedRectangle(cornerRadius: 7))
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(SculptLineTheme.line, lineWidth: 1))
                        }
                    }

                    if viewModel.inspectorTab == .validator || viewModel.inspectorTab == .all {
                        subsectionHeader("VALIDATOR REPORT", badge: "sculptline_validator")
                        HStack(spacing: 6) {
                            Text(viewModel.validatorOverallStatus.uppercased())
                                .font(.system(size: 10, weight: .bold, design: .monospaced))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(statusColor(for: viewModel.validatorOverallStatus))
                                .foregroundStyle(Color.white)
                                .clipShape(RoundedRectangle(cornerRadius: 4))

                            Text(viewModel.validatorHeadlineSummary)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(SculptLineTheme.dark)

                            Spacer()

                            Button("Full Sheet") {
                                viewModel.showValidatorReportSheet = true
                            }
                            .buttonStyle(.plain)
                            .font(.system(size: 10, weight: .semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2.5)
                            .background(viewModel.accentColor.opacity(0.2))
                            .foregroundStyle(viewModel.accentColor)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        ForEach(viewModel.validatorChecks) { check in
                            checkCardRow(check)
                        }
                    }
                }
                .modifier(SculptLineCardModifier())
            }
        }
    }

    private func checkCardRow(_ item: CheckRowItem) -> some View {
        let borderColor: Color = {
            switch item.severity {
            case .pass: return SculptLineTheme.green
            case .error: return SculptLineTheme.red
            case .warning: return SculptLineTheme.amber
            case .info, .notChecked: return SculptLineTheme.muted
            }
        }()

        let rowBg: Color = {
            switch item.severity {
            case .error: return SculptLineTheme.redBg
            case .warning: return SculptLineTheme.amberBg
            default: return SculptLineTheme.elevated
            }
        }()

        let iconText: String = {
            switch item.severity {
            case .pass: return "✓"
            case .error, .warning: return "!"
            case .notChecked: return "–"
            case .info: return "i"
            }
        }()

        return HStack(alignment: .top, spacing: 7) {
            Text(iconText)
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundStyle(borderColor)
                .frame(width: 14)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Text(item.severity.rawValue.uppercased())
                        .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                        .foregroundStyle(borderColor)
                    Text(item.id)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(SculptLineTheme.muted)
                }

                Text(item.message)
                    .font(.system(size: 11.5))
                    .foregroundStyle(SculptLineTheme.dark)

                if let hint = item.fixHint {
                    Text(hint)
                        .font(.system(size: 10.5))
                        .foregroundStyle(SculptLineTheme.muted)
                }

                if let fixScale = item.fixScaleValue {
                    Button("Set profile scale to \(String(format: "%g", fixScale))") {
                        viewModel.applyScaleFix(fixScale)
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(viewModel.accentColor.opacity(0.18))
                    .foregroundStyle(viewModel.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(viewModel.accentColor.opacity(0.45), lineWidth: 1))
                }

                if let flipCount = item.fixFlipCount {
                    Button("Preview unified winding (\(flipCount.formatted()) tris)") {
                        Task { await viewModel.applyUnifiedWindingFix() }
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(viewModel.accentColor.opacity(0.18))
                    .foregroundStyle(viewModel.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(viewModel.accentColor.opacity(0.45), lineWidth: 1))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(rowBg)
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .overlay(
            RoundedRectangle(cornerRadius: 7).stroke(SculptLineTheme.line, lineWidth: 1)
        )
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(borderColor)
                .frame(width: 3)
                .clipShape(RoundedRectangle(cornerRadius: 2))
        }
    }

    private func statusColor(for status: String) -> Color {
        switch status.lowercased() {
        case "pass": return SculptLineTheme.green
        case "warn": return SculptLineTheme.amber
        case "fail": return SculptLineTheme.red
        default: return SculptLineTheme.elevated
        }
    }

    // MARK: - Footer Status Strip

    private var footerStatusStrip: some View {
        HStack {
            Text("SculptLine by Fabled · Foundry Workspace · All geometry figures are computed directly from the loaded files.")
                .font(.system(size: 10.5))
                .foregroundStyle(SculptLineTheme.muted)
            Spacer()
            Text("Pipeline: \(viewModel.pipelineSourceTag) · Validator: \(viewModel.validatorSourceTag)")
                .font(.system(size: 10.5, design: .monospaced))
                .foregroundStyle(SculptLineTheme.muted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 5)
        .background(Color(red: 0.04, green: 0.05, blue: 0.08).opacity(0.84))
        .overlay(alignment: .top) {
            Rectangle().fill(SculptLineTheme.line).frame(height: 1)
        }
    }

    // MARK: - Reusable UI Helpers

    private func sectionTitle(num: String, title: String) -> some View {
        HStack(spacing: 6) {
            Text(num)
                .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                .padding(.horizontal, 5)
                .padding(.vertical, 1.5)
                .background(viewModel.accentColor.opacity(0.18))
                .foregroundStyle(viewModel.accentColor)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            Text(title)
                .font(.system(size: 11.5, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(SculptLineTheme.dark)
        }
    }

    private func subsectionHeader(_ title: String, badge: String) -> some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(0.6)
                .foregroundStyle(SculptLineTheme.muted)
            Text(badge)
                .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                .padding(.horizontal, 6)
                .padding(.vertical, 1.5)
                .background(SculptLineTheme.green.opacity(0.12))
                .foregroundStyle(SculptLineTheme.green)
                .clipShape(RoundedRectangle(cornerRadius: 4))
        }
        .padding(.top, 2)
    }

    private func secondaryActionButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11.5, weight: .medium))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .background(SculptLineTheme.elevated)
                .foregroundStyle(SculptLineTheme.dark)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6).stroke(SculptLineTheme.line, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func labeledField<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 10.5))
                .foregroundStyle(SculptLineTheme.muted)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - 60fps Subtle Ambient Light-Show Background

struct AmbientLightShowView: View {
    let preset: AmbientThemePreset

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, size in
                context.fill(
                    Path(CGRect(origin: .zero, size: size)),
                    with: .color(SculptLineTheme.voidBg)
                )

                let colors = preset.orbColors
                let minDim = min(size.width, size.height)
                for (i, orbColor) in colors.enumerated() {
                    let phase = Double(i) * 1.65
                    let fx = 0.22 + Double(i) * 0.06
                    let fy = 0.18 + Double(i) * 0.05
                    let cx = size.width * (0.5 + 0.36 * sin(t * fx + phase))
                    let cy = size.height * (0.5 + 0.34 * cos(t * fy + phase * 1.3))
                    let radius = max(220.0, minDim * (0.38 + Double(i % 2) * 0.08))

                    let center = CGPoint(x: cx, y: cy)
                    let gradient = Gradient(stops: [
                        .init(color: orbColor.opacity(0.15), location: 0.0),
                        .init(color: orbColor.opacity(0.06), location: 0.45),
                        .init(color: Color.clear, location: 1.0)
                    ])
                    context.fill(
                        Path(ellipseIn: CGRect(x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2)),
                        with: .radialGradient(gradient, center: center, startRadius: 0, endRadius: radius)
                    )
                }
            }
        }
    }
}

// MARK: - UV & Baked Map Inspector Sheet

struct MapInspectorSheet: View {
    @ObservedObject var viewModel: SculptLineViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("UV Layout & Baked Texture Inspector")
                        .font(.system(size: 16, weight: .bold))
                    Text("Real pipeline artifacts generated from the active asset run (2048×2048 tangent-space Normal + Packed ORM).")
                        .font(.system(size: 11.5))
                        .foregroundStyle(SculptLineTheme.muted)
                }
                Spacer()
                Button("Close") {
                    dismiss()
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(viewModel.accentColor)
                .foregroundStyle(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 7))
            }

            Divider()

            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                    ForEach(viewModel.mapPreviewCards) { card in
                        VStack(alignment: .leading, spacing: 6) {
                            PlatformFileImage(url: card.imageURL)
                                .frame(height: 200)
                                .frame(maxWidth: .infinity)
                                .background(SculptLineTheme.voidBg)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(SculptLineTheme.line, lineWidth: 1))

                            Text(card.title)
                                .font(.system(size: 12, weight: .semibold))
                            Text(card.subtitle)
                                .font(.system(size: 10.5, design: .monospaced))
                                .foregroundStyle(SculptLineTheme.muted)
                        }
                        .padding(10)
                        .background(SculptLineTheme.elevated)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(SculptLineTheme.line, lineWidth: 1))
                    }
                }
            }
        }
        .padding(18)
        .frame(minWidth: 740, minHeight: 520)
        .background(SculptLineTheme.voidBg)
        .preferredColorScheme(.dark)
    }
}

struct PlatformFileImage: View {
    let url: URL

    var body: some View {
        #if os(macOS)
        if let nsImg = NSImage(contentsOf: url) {
            Image(nsImage: nsImg)
                .resizable()
                .scaledToFit()
        } else {
            Text("Image unavailable")
                .font(.caption)
        }
        #else
        if let uiImg = UIImage(contentsOfFile: url.path) {
            Image(uiImage: uiImg)
                .resizable()
                .scaledToFit()
        } else {
            Text("Image unavailable")
                .font(.caption)
        }
        #endif
    }
}

/// Checkbox toggles on macOS; `.checkbox` does not exist on iOS, where a compact button-style toggle is used instead.
private struct ToolbarToggleStyleModifier: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        #if os(macOS)
        content.toggleStyle(.checkbox)
        #else
        content.toggleStyle(.button)
        #endif
    }
}

private struct SculptLineCardModifier: ViewModifier {
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
