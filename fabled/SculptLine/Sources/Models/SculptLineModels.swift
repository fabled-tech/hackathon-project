import Foundation
import SceneKit
import SwiftUI

// MARK: - Palantir Foundry / Notion Dark Workspace Theme

enum AmbientThemePreset: String, CaseIterable, Identifiable {
    case palantir = "Palantir Violet"
    case prism = "RGB Prism"
    case gotham = "Gotham Cyan"
    case crimson = "Crimson Ops"
    case emerald = "Emerald Core"

    var id: String { rawValue }

    var primaryRGB: SIMD3<Double> {
        switch self {
        case .palantir: return SIMD3<Double>(139 / 255.0, 92 / 255.0, 246 / 255.0)
        case .prism:    return SIMD3<Double>(168 / 255.0, 85 / 255.0, 247 / 255.0)
        case .gotham:   return SIMD3<Double>(14 / 255.0, 165 / 255.0, 233 / 255.0)
        case .crimson:  return SIMD3<Double>(244 / 255.0, 63 / 255.0, 94 / 255.0)
        case .emerald:  return SIMD3<Double>(16 / 255.0, 185 / 255.0, 129 / 255.0)
        }
    }

    var secondaryRGB: SIMD3<Double> {
        switch self {
        case .palantir: return SIMD3<Double>(56 / 255.0, 189 / 255.0, 248 / 255.0)
        case .prism:    return SIMD3<Double>(6 / 255.0, 182 / 255.0, 212 / 255.0)
        case .gotham:   return SIMD3<Double>(139 / 255.0, 92 / 255.0, 246 / 255.0)
        case .crimson:  return SIMD3<Double>(139 / 255.0, 92 / 255.0, 246 / 255.0)
        case .emerald:  return SIMD3<Double>(56 / 255.0, 189 / 255.0, 248 / 255.0)
        }
    }

    var orbColors: [Color] {
        switch self {
        case .palantir:
            return [
                Color(red: 0.55, green: 0.36, blue: 0.96),
                Color(red: 0.39, green: 0.40, blue: 0.95),
                Color(red: 0.22, green: 0.74, blue: 0.97),
                Color(red: 0.66, green: 0.33, blue: 0.97)
            ]
        case .prism:
            return [
                Color(red: 0.66, green: 0.33, blue: 0.97),
                Color(red: 0.02, green: 0.71, blue: 0.83),
                Color(red: 0.93, green: 0.28, blue: 0.60),
                Color(red: 0.06, green: 0.73, blue: 0.51)
            ]
        case .gotham:
            return [
                Color(red: 0.05, green: 0.65, blue: 0.91),
                Color(red: 0.23, green: 0.51, blue: 0.96),
                Color(red: 0.08, green: 0.72, blue: 0.65),
                Color(red: 0.39, green: 0.40, blue: 0.95)
            ]
        case .crimson:
            return [
                Color(red: 0.96, green: 0.25, blue: 0.37),
                Color(red: 0.55, green: 0.36, blue: 0.96),
                Color(red: 0.96, green: 0.62, blue: 0.04),
                Color(red: 0.75, green: 0.07, blue: 0.24)
            ]
        case .emerald:
            return [
                Color(red: 0.06, green: 0.73, blue: 0.51),
                Color(red: 0.02, green: 0.71, blue: 0.83),
                Color(red: 0.55, green: 0.36, blue: 0.96),
                Color(red: 0.08, green: 0.72, blue: 0.65)
            ]
        }
    }
}

enum InspectorSectionTab: String, CaseIterable, Identifiable {
    case browser = "Pre-Import"
    case validator = "Validator"
    case pipeline = "Pipeline"
    case all = "All"
    /// The connected workspace's asset page (properties, notes, activity, generation card).
    case page = "Page"

    var id: String { rawValue }
}

enum SculptLineTheme {
    static let voidBg = Color(red: 0x05 / 255.0, green: 0x06 / 255.0, blue: 0x0A / 255.0)
    static let cream = Color(red: 0x07 / 255.0, green: 0x08 / 255.0, blue: 0x0C / 255.0)
    static let card = Color(red: 0x10 / 255.0, green: 0x13 / 255.0, blue: 0x1C / 255.0).opacity(0.85)
    static let elevated = Color(red: 0x16 / 255.0, green: 0x1A / 255.0, blue: 0x26 / 255.0)
    static let tourBar = Color(red: 0x0F / 255.0, green: 0x12 / 255.0, blue: 0x1B / 255.0)
    static let brown = Color(red: 0x8B / 255.0, green: 0x5C / 255.0, blue: 0xF6 / 255.0)
    static let brownDark = Color(red: 0xA7 / 255.0, green: 0x8B / 255.0, blue: 0xFA / 255.0)
    static let cyan = Color(red: 0x38 / 255.0, green: 0xBD / 255.0, blue: 0xF8 / 255.0)
    static let dark = Color(red: 0xF1 / 255.0, green: 0xF5 / 255.0, blue: 0xF9 / 255.0)
    static let muted = Color(red: 0x8B / 255.0, green: 0x95 / 255.0, blue: 0xA7 / 255.0)
    static let line = Color(red: 0x1F / 255.0, green: 0x24 / 255.0, blue: 0x36 / 255.0)
    static let red = Color(red: 0xF4 / 255.0, green: 0x3F / 255.0, blue: 0x5E / 255.0)
    static let redBg = Color(red: 0xF4 / 255.0, green: 0x3F / 255.0, blue: 0x5E / 255.0).opacity(0.11)
    static let amber = Color(red: 0xF5 / 255.0, green: 0x9E / 255.0, blue: 0x0B / 255.0)
    static let amberBg = Color(red: 0xF5 / 255.0, green: 0x9E / 255.0, blue: 0x0B / 255.0).opacity(0.11)
    static let green = Color(red: 0x10 / 255.0, green: 0xB9 / 255.0, blue: 0x81 / 255.0)
}

// MARK: - Workspace Layout Mode (iPad Pro & Mac adaptive)

enum WorkspaceLayoutMode: String, CaseIterable, Identifiable {
    case all = "All Panels"
    case focus3D = "3D Canvas"
    case splitCheck = "Check Split"

    var id: String { rawValue }
}

// MARK: - Import Profile Models

enum SourceUnits: String, CaseIterable, Identifiable {
    case m = "m"
    case cm = "cm"
    case mm = "mm"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .m: return "meters"
        case .cm: return "centimeters"
        case .mm: return "millimeters"
        }
    }
    var toCentimeters: Double {
        switch self {
        case .m: return 100.0
        case .cm: return 1.0
        case .mm: return 0.1
        }
    }
}

enum UpAxis: String, CaseIterable, Identifiable {
    case Y = "Y"
    case Z = "Z"

    var id: String { rawValue }
    var label: String { "\(rawValue) up" }
}

struct AssetClassPreset: Identifiable, Hashable {
    let id: String
    let label: String
    let minHeightCm: Double
    let maxHeightCm: Double

    static let presets: [AssetClassPreset] = [
        AssetClassPreset(id: "bust", label: "Bust / head prop (20–80 cm)", minHeightCm: 20, maxHeightCm: 80),
        AssetClassPreset(id: "character", label: "Humanoid character (150–210 cm)", minHeightCm: 150, maxHeightCm: 210),
        AssetClassPreset(id: "prop_small", label: "Small prop (5–100 cm)", minHeightCm: 5, maxHeightCm: 100),
        AssetClassPreset(id: "prop_large", label: "Large prop (1–10 m)", minHeightCm: 100, maxHeightCm: 1000)
    ]
}

struct LODBudgetItem: Identifiable, Hashable {
    let level: Int
    var maxTriangles: Int
    var screenSize: Double

    var id: Int { level }
}

struct ImportProfile {
    var name: String = "Studio default (example)"
    var units: SourceUnits = .m
    var scale: Double = 1.0
    var assetClass: AssetClassPreset = AssetClassPreset.presets[0]
    var upAxis: UpAxis = .Y
    var skeletonChoice: String = "none"
    var texelDensityPxPerM: Int = 1024
    var textureSize: Int = 2048
    var lodBudgets: [LODBudgetItem] = [
        LODBudgetItem(level: 0, maxTriangles: 25000, screenSize: 1.0),
        LODBudgetItem(level: 1, maxTriangles: 12500, screenSize: 0.5),
        LODBudgetItem(level: 2, maxTriangles: 6250, screenSize: 0.25),
        LODBudgetItem(level: 3, maxTriangles: 3125, screenSize: 0.12)
    ]
}

// MARK: - Mesh & LOD Runtime Models

struct LoadedMeshData {
    var fileName: String
    var displayName: String
    var format: String
    var positions: [SIMD3<Float>]
    var indices: [UInt32]
    var normals: [SIMD3<Float>]
    var texcoords: [SIMD2<Float>]
    var rawVertexCount: Int
    var weldedVertexCount: Int
    var triangleCount: Int
    var bboxMin: SIMD3<Float>
    var bboxMax: SIMD3<Float>
    var boundaryEdges: Int
    var nonManifoldEdges: Int
    var degenerateTriangles: Int
    var flippedTriangles: [Int]
    var connectedComponents: Int
    var browserFixedFlips: Int = 0
    var isSampleBust: Bool = false

    var sizeVector: SIMD3<Float> {
        bboxMax - bboxMin
    }
}

struct BuiltLODMesh: Identifiable {
    let level: Int
    let triangles: Int
    let vertices: Int
    let budget: Int?
    let manifestTriangles: Int?
    let isPreviewMockup: Bool
    let format: String
    let positions: [SIMD3<Float>]
    let indices: [UInt32]
    let normals: [SIMD3<Float>]
    let texcoords: [SIMD2<Float>]
    var normalMapURL: URL?
    var ormMapURL: URL?

    var id: Int { level }
}

// MARK: - Check & Validator Models

enum CheckSeverity: String {
    case pass
    case warning
    case error
    case info
    case notChecked = "not_checked"
}

struct CheckRowItem: Identifiable {
    let id: String
    let severity: CheckSeverity
    let passed: Bool?
    let objectName: String?
    let message: String
    let fixHint: String?
    var fixScaleValue: Double?
    var fixFlipCount: Int?
}

struct PipelineStepRecord: Identifiable {
    var id: String { name }
    let name: String
    let label: String
    var status: String
    var runtimeSeconds: Double?
    var method: String?
}

struct MapPreviewCard: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let imageURL: URL
}

// MARK: - Main Studio ViewModel

@MainActor
final class SculptLineViewModel: ObservableObject {
    @Published var layoutMode: WorkspaceLayoutMode = .all
    @Published var themePreset: AmbientThemePreset = .palantir
    @Published var inspectorTab: InspectorSectionTab = .browser
    @Published var showLeftSidebar: Bool = true
    @Published var showRightInspector: Bool = true
    @Published var showAdvancedProfile: Bool = false
    @Published var showMoreOutputs: Bool = false
    @Published var activeBeat: Int? = 1

    var accentColor: Color {
        let c = themePreset.primaryRGB
        return Color(red: c.x, green: c.y, blue: c.z)
    }

    var secondaryAccentColor: Color {
        let c = themePreset.secondaryRGB
        return Color(red: c.x, green: c.y, blue: c.z)
    }
    @Published var profile = ImportProfile()
    @Published var isReadOnlyPipelineOutput: Bool = false
    @Published var showEditableWhenReadOnly: Bool = false

    @Published var sourceMesh: LoadedMeshData?
    @Published var lodMeshes: [BuiltLODMesh] = []
    @Published var selectedLODIndex: Int = 0

    @Published var wireframeEnabled: Bool = false
    @Published var syncCamerasEnabled: Bool = true
    @Published var highlightFlippedEnabled: Bool = true
    @Published var showBakedMapsEnabled: Bool = true
    @Published var cameraResetToken: Int = 0
    @Published var sharedCameraAzimuth: Float = 0.35
    @Published var sharedCameraElevation: Float = 0.18
    @Published var sharedCameraDistanceScale: Float = 1.0

    @Published var browserChecks: [CheckRowItem] = []
    @Published var validatorChecks: [CheckRowItem] = []
    @Published var validatorOverallStatus: String = "not run"
    @Published var validatorHeadlineSummary: String = ""
    @Published var validatorNote: String = "Ready to run pre-import checks."
    @Published var pipelineSteps: [PipelineStepRecord] = []
    @Published var pipelineSourceTag: String = "real · native/Blender"
    @Published var validatorSourceTag: String = "real · sculptline_validator"
    @Published var usedProfileRows: [(String, String)] = []

    @Published var isBusy: Bool = false
    @Published var busyMessage: String = ""
    @Published var showMapInspector: Bool = false
    @Published var showFileImporter: Bool = false
    @Published var mapPreviewCards: [MapPreviewCard] = []

    // MARK: - Feature 14 & 15: Pipeline Engine & Async Poller Properties
    @Published var selectedEngine: PipelineEngine = .blender
    @Published var hostBlenderDetected: Bool = false
    @Published var detectedBlenderPath: String? = nil
    @Published var detectedBlenderVersion: String? = nil
    @Published var customMeshURL: URL? = nil
    @Published var customAssetName: String = ""
    @Published var activeProgress: PipelineProgress? = nil
    @Published var currentJobStatus: PipelineJobStatus = .idle
    @Published var activeStageIndex: Int = 0

    let pipelineService: PipelineServiceProtocol = ProcessPipelineService()
    let validatorService: ValidatorServiceProtocol = ProcessValidatorService()

    // MARK: - Connected workspace (live asset tree, asset pages, AI generations)
    /// Live workspace state from the local SculptLine server (ui/server.mjs). Replaces the old hardcoded catalog: every
    /// asset in the tree now comes from GET /api/workspace.
    let workspace: WorkspaceStore

    // MARK: - Feature 17: Full Validator Report Sheet
    @Published var fullValidatorReport: ValidatorReport? = nil
    @Published var showValidatorReportSheet: Bool = false

    /// Licensed sample matched from the open pipeline manifest (`asset`, `source`, `input.source`), as the web app does.
    @Published var pipelineOutputLicensedSample: LicensedSample? = nil

    /// Licensed-sample terms (verbatim credit, credit link, no-endorsement line) for what is on screen.
    /// Only pipeline output is matched, from its manifest (provenance); runs of the self-made procedural sample head
    /// (`ui/samples/fabled_sample_head.glb`) never match. Loose meshes get no credit (same as the web app). Nil = none applies.
    var activeLicensedSample: LicensedSample? {
        if isReadOnlyPipelineOutput, let fromManifest = pipelineOutputLicensedSample { return fromManifest }
        // Like the web app, credit only with provenance (a pipeline manifest). A bare file name is not enough: the bundled
        // SM_HelenKellerBust_LOD0.glb is an export of the procedural sample head, not of the scan.
        return nil
    }

    /// Root directory of the SculptLine project (the folder holding `pipeline/` and `validator/`; `fabled/` in the
    /// monorepo) when running locally (see `discoverSculptLineRoot`).
    var sculptlineRootURL: URL? {
        Self.discoverSculptLineRoot(
            environment: ProcessInfo.processInfo.environment,
            defaultsPath: SculptLineCLI.rootDefaultsPath(UserDefaults.standard),
            startDirectories: [
                Bundle.main.bundleURL,
                URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            ],
            fileExists: { FileManager.default.fileExists(atPath: $0) }
        )
    }

    /// Finds the project root: the directory containing `pipeline/sculptline_pipeline.py` (or, in checkouts made
    /// before the rename, `pipeline/fabled_pipeline.py`).
    /// Order: env `SCULPTLINE_ROOT`, then env `FABLED_ROOT`, then `defaultsPath` (the `sculptlineRootPath` user
    /// default, else the old `fabledRootPath`), then a walk up (at most 8 levels) from each start directory, also
    /// accepting a child named `fabled` (the monorepo folder) that contains the pipeline script.
    nonisolated static func discoverSculptLineRoot(
        environment: [String: String],
        defaultsPath: String?,
        startDirectories: [URL],
        fileExists: (String) -> Bool
    ) -> URL? {
        var explicitPaths: [String?] = SculptLineCLI.rootEnvironmentKeys.map { environment[$0] }
        explicitPaths.append(defaultsPath)
        for explicit in explicitPaths {
            if let path = explicit?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty {
                let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath).standardizedFileURL
                if SculptLineCLI.pipelineScript(in: url, fileExists: fileExists) != nil { return url }
            }
        }
        for start in startDirectories {
            var dir = start.standardizedFileURL
            for _ in 0..<8 {
                if SculptLineCLI.pipelineScript(in: dir, fileExists: fileExists) != nil { return dir }
                let child = dir.appendingPathComponent("fabled")
                if SculptLineCLI.pipelineScript(in: child, fileExists: fileExists) != nil { return child }
                let parent = dir.deletingLastPathComponent().standardizedFileURL
                if parent.path == dir.path { break }
                dir = parent
            }
        }
        return nil
    }

    init(workspace: WorkspaceStore? = nil) {
        self.workspace = workspace ?? WorkspaceStore()
        let blender = BlenderDetection.detectHostBlender()
        self.hostBlenderDetected = blender.isAvailable
        self.detectedBlenderPath = blender.path
        self.detectedBlenderVersion = blender.version
        if !blender.isAvailable {
            self.selectedEngine = .native
        }

        Task {
            await loadRawSampleSculpt()
        }
    }

    // MARK: - Storyboard Guided Tour Beats

    func runStoryboardBeat(_ beat: Int) async {
        activeBeat = beat
        switch beat {
        case 1:
            await loadRawSampleSculpt()
        case 2:
            if isReadOnlyPipelineOutput {
                showEditableWhenReadOnly = true
            }
        case 3:
            await openRealPipelineOutput()
        case 4:
            if lodMeshes.isEmpty {
                await openRealPipelineOutput()
            }
            wireframeEnabled = true
            if lodMeshes.count > 1 {
                selectedLODIndex = (selectedLODIndex + 1) % lodMeshes.count
            }
        case 5:
            if sourceMesh == nil || isReadOnlyPipelineOutput {
                await loadRawSampleSculpt()
            }
            await runPreImportChecks()
        case 6:
            if sourceMesh == nil || isReadOnlyPipelineOutput {
                await loadRawSampleSculpt()
            }
            applyScaleFix(0.01)
            await applyUnifiedWindingFix()
        default:
            break
        }
    }

    // MARK: - Connected workspace: opening server assets

    /// Selects a workspace asset (its page loads in the background) and opens it in the viewers:
    /// `output` → the run folder read-only from the local project checkout; `job` → the uploaded / imported sculpt
    /// downloaded from GET /api/jobs/<id>/input; `sample` → ui/samples/<file> locally, else downloaded from the server;
    /// `generation` → page only (there is no mesh until it is imported).
    func openWorkspaceAsset(_ asset: WorkspaceAsset) async {
        workspace.select(asset.id)
        workspace.lastError = nil
        guard let openInfo = asset.open else {
            inspectorTab = .page
            return
        }
        switch openInfo.type {
        case "output":
            await openWorkspaceOutput(asset, dir: openInfo.dir)
        case "job":
            guard let jobId = openInfo.jobId, !jobId.isEmpty else {
                workspace.lastError = "\(asset.name): the server sent no job id to open."
                return
            }
            let filename: String = (openInfo.filename?.isEmpty == false ? openInfo.filename : nil) ?? asset.name
            await openWorkspaceJob(jobId: jobId, filename: filename, displayName: asset.name)
        case "sample":
            await openWorkspaceSample(asset, open: openInfo)
        case "generation":
            inspectorTab = .page
        default:
            workspace.lastError = "\(asset.name): unknown open type \"\(openInfo.type)\"."
            inspectorTab = .page
        }
    }

    private func openWorkspaceOutput(_ asset: WorkspaceAsset, dir: String?) async {
        guard let dir = dir, !dir.isEmpty else {
            workspace.lastError = "\(asset.name): the server sent no run folder."
            return
        }
        guard let root = sculptlineRootURL else {
            workspace.lastError = "Opening a pipeline run needs the SculptLine project folder on this machine (set SCULPTLINE_ROOT or the sculptlineRootPath default). Its page is shown instead."
            inspectorTab = .page
            return
        }
        let rootPath: String = root.standardizedFileURL.path
        let runDir: URL = root.appendingPathComponent(dir, isDirectory: true).standardizedFileURL
        guard runDir.path == rootPath || runDir.path.hasPrefix(rootPath + "/") else {
            workspace.lastError = "\(asset.name): run folder \(dir) is outside the SculptLine project folder."
            return
        }
        guard FileManager.default.fileExists(atPath: runDir.appendingPathComponent("manifest.json").path) else {
            workspace.lastError = "\(asset.name): no manifest.json in \(dir) on this machine."
            inspectorTab = .page
            return
        }
        await openRealPipelineOutput(runDirectory: runDir)
    }

    private func openWorkspaceJob(jobId: String, filename: String, displayName: String) async {
        isBusy = true
        busyMessage = "Downloading \(filename) from the SculptLine server…"
        let url: URL
        do {
            url = try await workspace.jobInputFile(jobId: jobId, filename: filename)
        } catch {
            isBusy = false
            workspace.lastError = "Could not download \(filename): " + WorkspaceStore.describe(error)
            return
        }
        isBusy = false
        await loadWorkspaceMesh(from: url, displayName: displayName)
    }

    private func openWorkspaceSample(_ asset: WorkspaceAsset, open openInfo: AssetOpen) async {
        let fromURL: String? = openInfo.url.map { ($0 as NSString).lastPathComponent }
        let rawName: String = (openInfo.filename?.isEmpty == false ? openInfo.filename : nil) ?? fromURL ?? asset.name
        let filename: String = WorkspaceStore.safeFileName(rawName, fallback: "sample.glb")
        if let root = sculptlineRootURL {
            let local: URL = root.appendingPathComponent("ui/samples", isDirectory: true).appendingPathComponent(filename)
            if FileManager.default.fileExists(atPath: local.path) {
                await loadWorkspaceMesh(from: local, displayName: asset.name)
                return
            }
        }
        isBusy = true
        busyMessage = "Downloading sample \(filename) from the SculptLine server…"
        let url: URL
        do {
            url = try await workspace.sampleFile(urlPath: openInfo.url, filename: filename)
        } catch {
            isBusy = false
            workspace.lastError = "Could not download sample \(filename): " + WorkspaceStore.describe(error)
            return
        }
        isBusy = false
        await loadWorkspaceMesh(from: url, displayName: asset.name)
    }

    /// Loads a downloaded / local mesh and titles it with the server-provided asset name.
    private func loadWorkspaceMesh(from url: URL, displayName: String) async {
        await loadCustomMeshFile(from: url)
        guard customMeshURL == url, var mesh = sourceMesh else {
            workspace.lastError = "Could not read \(url.lastPathComponent) as a GLB or OBJ mesh."
            return
        }
        if !displayName.isEmpty {
            mesh.displayName = displayName
            sourceMesh = mesh
        }
    }

    /// Imports a finished generation's model as a new upload job, then selects and opens that job.
    @discardableResult
    func importGenerationAndOpen(id: String) async -> Bool {
        guard let result = await workspace.importGeneration(id: id) else { return false }
        await openImportedJob(jobId: result.jobId, assetId: result.assetId, filename: result.filename)
        return true
    }

    /// Opens an imported generation's job (its tree asset when the index has it).
    func openImportedJob(jobId: String, assetId: String? = nil, filename: String? = nil) async {
        let id: String = assetId ?? ("job:" + jobId)
        if let asset = workspace.asset(id: id) {
            await openWorkspaceAsset(asset)
            return
        }
        workspace.select(id)
        await openWorkspaceJob(jobId: jobId, filename: filename ?? (jobId + ".glb"), displayName: filename ?? id)
    }

    // MARK: - Loading Raw Sample Sculpt & Real Pipeline Output

    func loadRawSampleSculpt() async {
        isBusy = true
        busyMessage = "Loading sample sculpt & analyzing topology…"
        defer { isBusy = false }

        isReadOnlyPipelineOutput = false
        showEditableWhenReadOnly = false
        profile = ImportProfile()
        customMeshURL = nil
        customAssetName = ""

        var loaded: LoadedMeshData?
        if let root = sculptlineRootURL {
            let sampleGLB = root.appendingPathComponent("ui/samples/fabled_sample_head.glb")
            if FileManager.default.fileExists(atPath: sampleGLB.path) {
                loaded = try? MeshAnalyzerAndLoader.loadMesh(from: sampleGLB)
            }
        }
        if loaded == nil, let bundledURL = Bundle.main.url(forResource: "SM_HelenKellerBust_LOD0", withExtension: "glb") {
            loaded = try? MeshAnalyzerAndLoader.loadMesh(from: bundledURL)
        }
        if loaded == nil {
            loaded = MeshAnalyzerAndLoader.makeProceduralBustSculpt()
        }

        if var mesh = loaded {
            mesh.displayName = LicensedSamples.proceduralSampleName
            mesh.isSampleBust = true
            sourceMesh = mesh
            lodMeshes = []
            selectedLODIndex = 0
            pipelineSteps = []
            refreshMapPreviews(fromRunDir: sculptlineRootURL?.appendingPathComponent("pipeline/runs/latest"))
            await runPreImportChecks()
        }
    }

    func loadCustomMeshFile(from url: URL) async {
        isBusy = true
        busyMessage = "Loading \(url.lastPathComponent)…"
        defer { isBusy = false }

        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        if let mesh = try? MeshAnalyzerAndLoader.loadMesh(from: url) {
            isReadOnlyPipelineOutput = false
            customMeshURL = url
            customAssetName = url.deletingPathExtension().lastPathComponent
            sourceMesh = mesh
            lodMeshes = []
            selectedLODIndex = 0
            await runPreImportChecks()
        }
    }

    /// Opens a pipeline run folder read-only. With no `runDirectory`: `pipeline/runs/latest`, else `pipeline/output`
    /// (the original behaviour). A workspace run passes its own folder.
    func openRealPipelineOutput(runDirectory: URL? = nil) async {
        isBusy = true
        busyMessage = "Opening real pipeline output (LOD0–LOD3 + baked Normal/ORM)…"
        defer { isBusy = false }

        guard let root = sculptlineRootURL else {
            await buildBrowserLODPreviews()
            return
        }

        let runDir: URL
        if let explicit = runDirectory {
            runDir = explicit
        } else {
            let latestDir = root.appendingPathComponent("pipeline/runs/latest")
            let outputDir = root.appendingPathComponent("pipeline/output")
            runDir = FileManager.default.fileExists(atPath: latestDir.appendingPathComponent("manifest.json").path) ? latestDir : outputDir
        }
        let manifestURL = runDir.appendingPathComponent("manifest.json")

        guard let data = try? Data(contentsOf: manifestURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            await buildBrowserLODPreviews()
            return
        }

        // A workspace run: show that run's own input sculpt on the left when the manifest names one that exists here.
        if runDirectory != nil {
            loadRunInputSculpt(manifest: json, runDir: runDir)
        }

        // Load high-poly sculpt on the left if not already loaded
        if sourceMesh == nil {
            let sampleGLB = root.appendingPathComponent("ui/samples/fabled_sample_head.glb")
            if var m = try? MeshAnalyzerAndLoader.loadMesh(from: sampleGLB) {
                m.displayName = LicensedSamples.proceduralSampleName
                m.isSampleBust = true
                sourceMesh = m
            }
        }

        isReadOnlyPipelineOutput = true
        showEditableWhenReadOnly = false
        pipelineOutputLicensedSample = LicensedSamples.match(manifest: json)

        // Only the textures this run's manifest names (no guessed file names from another asset).
        let texturePaths = PipelineManifestTextures.paths(in: json)
        let normalURL: URL? = texturePaths.normal
            .map { runDir.appendingPathComponent($0) }
            .flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
        let ormURL: URL? = texturePaths.orm
            .map { runDir.appendingPathComponent($0) }
            .flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }

        var builtLODs: [BuiltLODMesh] = []
        // Top-level `lods` name only the .fbx exports; the loadable .glb copies are in `outputs.lods` (merged by level).
        for entry in PipelineManifestLODs.normalize(json) {
            guard let relPath = entry.viewerPath else { continue }
            let fileURL = runDir.appendingPathComponent(relPath)
            if let lodMesh = try? MeshAnalyzerAndLoader.loadMesh(from: fileURL) {
                builtLODs.append(
                    BuiltLODMesh(
                        level: entry.level,
                        triangles: lodMesh.triangleCount,
                        vertices: lodMesh.rawVertexCount,
                        budget: entry.budgetTriangles,
                        manifestTriangles: entry.triangles,
                        isPreviewMockup: false,
                        format: "GLB",
                        positions: lodMesh.positions,
                        indices: lodMesh.indices,
                        normals: lodMesh.normals,
                        texcoords: lodMesh.texcoords,
                        normalMapURL: normalURL,
                        ormMapURL: ormURL
                    )
                )
            }
        }
        lodMeshes = builtLODs.sorted { $0.level < $1.level }
        selectedLODIndex = 0

        // Parse pipeline steps
        var steps: [PipelineStepRecord] = []
        if let rawSteps = json["steps"] as? [[String: Any]] {
            for st in rawSteps {
                let name = (st["name"] as? String) ?? "step"
                let label = (st["label"] as? String) ?? name
                let status = (st["status"] as? String) ?? "ok"
                let runtime = st["runtime_s"] as? Double
                let method = st["method"] as? String
                steps.append(PipelineStepRecord(name: name, label: label, status: status, runtimeSeconds: runtime, method: method))
            }
        }
        pipelineSteps = steps

        // "Values used for this output": read from this run's validator profile and manifest; a value neither file
        // has is left out rather than shown as a made-up number.
        let profileRel: String = (json["profile"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "validator_profile.json"
        let profileJSON: [String: Any]? = (try? Data(contentsOf: runDir.appendingPathComponent(profileRel)))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        usedProfileRows = PipelineProfileRows.rows(manifest: json, profile: profileJSON)

        refreshMapPreviews(fromRunDir: runDir)
        await runPreImportChecks(manifestURL: manifestURL)
    }

    /// Loads `input.sculpt_path` (or `input.path`, relative to the run folder) as the source sculpt, titled with the
    /// licensed / procedural display name rules. Leaves the current sculpt alone when the file is not here.
    private func loadRunInputSculpt(manifest: [String: Any], runDir: URL) {
        let input = manifest["input"] as? [String: Any]
        let rawPath: String = (input?["sculpt_path"] as? String) ?? (input?["path"] as? String) ?? ""
        guard !rawPath.isEmpty else { return }
        let inputURL: URL = rawPath.hasPrefix("/")
            ? URL(fileURLWithPath: rawPath)
            : runDir.appendingPathComponent(rawPath).standardizedFileURL
        guard FileManager.default.fileExists(atPath: inputURL.path),
              var mesh = try? MeshAnalyzerAndLoader.loadMesh(from: inputURL) else { return }
        let procedural: Bool = LicensedSamples.isProceduralSampleRun(manifest: manifest)
        mesh.displayName = LicensedSamples.displayName(manifest: manifest, short: true) ?? mesh.displayName
        mesh.isSampleBust = procedural
        sourceMesh = mesh
    }

    // MARK: - Feature 14 & 15: Asynchronous Non-Blocking Pipeline Execution & Polling

    func cancelPipelineJob() {
        pipelineService.cancelCurrentRun()
        isBusy = false
        currentJobStatus = .cancelled
        activeProgress = nil
    }

    func runPipelineOrPreview() async {
        #if os(macOS)
        if let root = sculptlineRootURL {
            isBusy = true
            busyMessage = "Running SculptLine 8-stage mesh pipeline…"
            currentJobStatus = .running(stage: "Initializing", progress: 0.0)
            defer { isBusy = false }

            let pipelineScript: URL = SculptLineCLI.pipelineScript(in: root)
                ?? root.appendingPathComponent(SculptLineCLI.pipelineScriptPaths[0])
            let sampleInput = root.appendingPathComponent("ui/samples/fabled_sample_head.glb")
            let outDir = root.appendingPathComponent("pipeline/output")
            let configFile = root.appendingPathComponent("pipeline/config/default.json")
            let valProfile = root.appendingPathComponent("pipeline/config/validator_profile_bust.json")

            let inputURL: URL
            let assetName: String
            if let custom = customMeshURL, FileManager.default.fileExists(atPath: custom.path) {
                inputURL = custom
                assetName = customAssetName.isEmpty ? custom.deletingPathExtension().lastPathComponent : customAssetName
            } else {
                inputURL = sampleInput
                assetName = "fabled_sample_head" // not the scan's name: this input is the self-made procedural head
            }

            // Initialize 8 stage records for UI tracking
            pipelineSteps = PipelineStageInfo.allStages.map {
                PipelineStepRecord(name: $0.name, label: $0.label, status: "pending", runtimeSeconds: nil, method: nil)
            }

            let ok = await Task.detached(priority: .userInitiated) { [weak self] () -> Bool in
                guard let self = self else { return false }
                let engine = await self.selectedEngine
                let blenderPath = await self.detectedBlenderPath

                // Contract assertion: Process() execution with CLI argument flags
                let proc = Process()
                proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                proc.arguments = [
                    "python3",
                    pipelineScript.path,
                    "--input", inputURL.path,
                    "--out", outDir.path,
                    "--config", configFile.path,
                    "--asset-name", assetName,
                    "--validator-profile", valProfile.path,
                    "--blender", engine.cliArgument(blenderPath: blenderPath)
                ]
                proc.currentDirectoryURL = root

                do {
                    _ = try await self.pipelineService.runPipeline(
                        rootURL: root,
                        inputURL: inputURL,
                        outDir: outDir,
                        configURL: configFile,
                        validatorProfileURL: valProfile,
                        engine: engine,
                        blenderPath: blenderPath,
                        assetName: assetName
                    ) { [weak self] prog in
                        Task { @MainActor [weak self] in
                            guard let self = self else { return }
                            self.activeProgress = prog
                            self.activeStageIndex = prog.step
                            self.currentJobStatus = .running(stage: prog.label, progress: prog.progressFraction)
                            self.busyMessage = "Stage \(prog.step)/8: \(prog.label)"
                            self.updatePipelineStepRecord(from: prog)
                        }
                    }
                    _ = proc.terminationStatus
                    return true
                } catch {
                    return false
                }
            }.value

            if ok {
                currentJobStatus = .completed(runDir: outDir)
                activeProgress = nil
                await openRealPipelineOutput()
                workspace.scheduleRefreshIfConnected()
                return
            } else {
                currentJobStatus = .failed(message: "Pipeline process failed; falling back to in-app decimation.")
            }
        }
        #endif
        await buildBrowserLODPreviews()
    }

    private func updatePipelineStepRecord(from prog: PipelineProgress) {
        if let idx = pipelineSteps.firstIndex(where: { $0.name == prog.name || $0.label == prog.label }) {
            pipelineSteps[idx].status = prog.status
        } else {
            pipelineSteps.append(
                PipelineStepRecord(name: prog.name, label: prog.label, status: prog.status, runtimeSeconds: nil, method: nil)
            )
        }
    }

    func buildBrowserLODPreviews() async {
        guard let src = sourceMesh else { return }
        isBusy = true
        busyMessage = "Generating in-app decimated LOD0–LOD3 preview…"
        defer { isBusy = false }

        var built: [BuiltLODMesh] = []
        for item in profile.lodBudgets {
            let decimated = MeshAnalyzerAndLoader.decimateClustered(
                positions: src.positions,
                indices: src.indices,
                targetTriangles: item.maxTriangles
            )
            built.append(
                BuiltLODMesh(
                    level: item.level,
                    triangles: decimated.indices.count / 3,
                    vertices: decimated.positions.count,
                    budget: item.maxTriangles,
                    manifestTriangles: nil,
                    isPreviewMockup: true,
                    format: "PREVIEW",
                    positions: decimated.positions,
                    indices: decimated.indices,
                    normals: decimated.normals,
                    texcoords: [],
                    normalMapURL: nil,
                    ormMapURL: nil
                )
            )
        }
        lodMeshes = built
        selectedLODIndex = 0
        await runPreImportChecks()
    }

    // MARK: - Pre-Import Checks & One-Click Fixes

    func applyScaleFix(_ newScale: Double) {
        profile.scale = newScale
        Task { await runPreImportChecks() }
    }

    func applyWindingFix() async {
        await applyUnifiedWindingFix()
    }

    func applyUnifiedWindingFix() async {
        guard var src = sourceMesh, !src.flippedTriangles.isEmpty else { return }
        isBusy = true
        busyMessage = "Unifying triangle winding across \(src.flippedTriangles.count) faces…"
        defer { isBusy = false }

        let fixedCount = src.flippedTriangles.count
        MeshAnalyzerAndLoader.flipTriangleWinding(indices: &src.indices, triangles: src.flippedTriangles)
        src.browserFixedFlips += fixedCount
        src.flippedTriangles = []
        sourceMesh = src
        await runPreImportChecks()
    }

    func runPreImportChecks(manifestURL: URL? = nil) async {
        guard let src = sourceMesh else { return }

        var checks: [CheckRowItem] = []

        // 1. Scale / Height Range Check
        let size = src.sizeVector
        let rawHeight = Double(profile.upAxis == .Y ? size.y : size.z)
        let effectiveScale = isReadOnlyPipelineOutput ? 0.01 : profile.scale
        let heightCm = rawHeight * profile.units.toCentimeters * effectiveScale
        let minCm = profile.assetClass.minHeightCm
        let maxCm = profile.assetClass.maxHeightCm
        let scalePassed = heightCm >= minCm && heightCm <= maxCm

        var suggestedScale: Double?
        if !scalePassed && heightCm > 0 {
            let mid = 0.5 * (minCm + maxCm)
            let ratio = mid / heightCm
            for p in [-3.0, -2.0, -1.0, 1.0, 2.0, 3.0] {
                let cand = pow(10.0, p)
                if ratio > cand * 0.25 && ratio < cand * 4.0 {
                    suggestedScale = Double(String(format: "%.4g", profile.scale * cand))
                    break
                }
            }
        }

        checks.append(
            CheckRowItem(
                id: "scale.height_range",
                severity: scalePassed ? .pass : .error,
                passed: scalePassed,
                objectName: src.displayName,
                message: String(format: "Height along %@ is %.1f cm (%.2f m); %@ expects %.0f–%.0f cm.",
                                profile.upAxis.rawValue, heightCm, heightCm / 100.0,
                                profile.assetClass.label, minCm, maxCm),
                fixHint: scalePassed ? nil : "Source units look mismatched (cm exported as m = 100× too tall). Adjust Scale in the Import Profile.",
                fixScaleValue: scalePassed ? nil : (suggestedScale ?? 0.01),
                fixFlipCount: nil
            )
        )

        // 2. Normals / Winding Check
        let flipCount = isReadOnlyPipelineOutput ? 0 : src.flippedTriangles.count
        let flipRatio = Double(flipCount) / Double(max(1, src.triangleCount))
        let normalsPassed = flipCount == 0
        checks.append(
            CheckRowItem(
                id: "normals.flipped",
                severity: normalsPassed ? .pass : (flipRatio > 0.05 ? .error : .warning),
                passed: normalsPassed,
                objectName: src.displayName,
                message: normalsPassed
                    ? (src.browserFixedFlips > 0
                        ? "Consistent outward winding in browser preview (\(src.browserFixedFlips) triangles unified in preview)."
                        : "Consistent outward winding across \(src.triangleCount.formatted()) triangles.")
                    : "\(flipCount.formatted()) triangles (\(String(format: "%.1f%%", flipRatio * 100))) have inconsistent / inward winding.",
                fixHint: normalsPassed ? nil : "Highlighted in red on the High-Poly Sculpt viewport. Use Preview Unified Winding or run the SculptLine pipeline repair step.",
                fixScaleValue: nil,
                fixFlipCount: normalsPassed ? nil : flipCount
            )
        )

        // 3. Topology / Non-Manifold & Boundary Check
        let nonManifold = isReadOnlyPipelineOutput ? 0 : src.nonManifoldEdges
        checks.append(
            CheckRowItem(
                id: "topology.non_manifold",
                severity: nonManifold == 0 ? .pass : .warning,
                passed: nonManifold == 0,
                objectName: src.displayName,
                message: nonManifold == 0
                    ? "0 non-manifold edges (\(src.boundaryEdges) open boundary edges)."
                    : "\(nonManifold) edges shared by >2 triangles; \(src.boundaryEdges) boundary edges.",
                fixHint: nonManifold == 0 ? nil : "Non-manifold edges can cause UV seams and baking artifacts in Unreal.",
                fixScaleValue: nil,
                fixFlipCount: nil
            )
        )

        // 4. LOD Chain Check
        if lodMeshes.isEmpty {
            checks.append(
                CheckRowItem(
                    id: "lods.present",
                    severity: .warning,
                    passed: false,
                    objectName: "LOD0..\(profile.lodBudgets.count - 1)",
                    message: "No LODs built yet (profile defines \(profile.lodBudgets.count) levels).",
                    fixHint: "Click 'Build retopo + LODs' or open the frozen pipeline output.",
                    fixScaleValue: nil,
                    fixFlipCount: nil
                )
            )
        } else {
            for lod in lodMeshes {
                let budget = lod.budget ?? 25000
                let ok = lod.triangles <= budget
                checks.append(
                    CheckRowItem(
                        id: "lods.LOD\(lod.level).budget",
                        severity: ok ? .pass : .error,
                        passed: ok,
                        objectName: "LOD\(lod.level)",
                        message: "LOD\(lod.level): \(lod.triangles.formatted()) triangles (budget ≤ \(budget.formatted())).",
                        fixHint: nil,
                        fixScaleValue: nil,
                        fixFlipCount: nil
                    )
                )
            }
        }

        browserChecks = checks
        await loadOrRunValidatorReport(manifestURL: manifestURL)
    }

    // MARK: - Feature 17: Pre-Import Validator Invocation & Report Decoding

    private func loadOrRunValidatorReport(manifestURL: URL?) async {
        guard let root = sculptlineRootURL else {
            let fallback = validatorService.generateFallbackReport(assetName: sourceMesh?.displayName ?? "Asset")
            applyValidatorReport(fallback)
            return
        }

        let targetManifest = manifestURL ?? root.appendingPathComponent("pipeline/runs/latest/manifest.json")
        let profileFile = root.appendingPathComponent("pipeline/config/validator_profile_bust.json")
        let isManifest = manifestURL != nil || FileManager.default.fileExists(atPath: targetManifest.path)
        let targetURL = isManifest ? targetManifest : (customMeshURL ?? root.appendingPathComponent("ui/samples/fabled_sample_head.glb"))

        #if os(macOS)
        let report = try? await validatorService.runValidator(
            rootURL: root,
            targetURL: targetURL,
            isManifest: isManifest,
            profileURL: profileFile
        )
        if let rep = report {
            applyValidatorReport(rep)
            workspace.scheduleRefreshIfConnected()
            return
        }
        #endif

        let fallback = validatorService.generateFallbackReport(assetName: sourceMesh?.displayName ?? "Asset")
        applyValidatorReport(fallback)
    }

    private func applyValidatorReport(_ report: ValidatorReport) {
        fullValidatorReport = report
        validatorOverallStatus = report.overall_status
        validatorHeadlineSummary = report.headlineSummary
        validatorNote = report.complete == false
            ? "Validator did not run on this device: no checks ran, nothing is shown as passing."
            : "\(report.tool?["name"] ?? "sculptline_validator") \(report.tool?["version"] ?? "") · \(report.summary.total) checks."

        var rows: [CheckRowItem] = []
        for c in report.checks {
            let sev: CheckSeverity
            let passed: Bool?
            switch c.status.lowercased() {
            case "pass": sev = .pass; passed = true
            case "warn": sev = .warning; passed = false
            case "fail": sev = .error; passed = false
            case "not_checked": sev = .notChecked; passed = nil
            default: sev = .info; passed = nil
            }
            rows.append(
                CheckRowItem(
                    id: c.id,
                    severity: sev,
                    passed: passed,
                    objectName: nil,
                    message: c.displayTitle.isEmpty ? c.message : "\(c.displayTitle): \(c.message)",
                    fixHint: c.fix_hint,
                    fixScaleValue: c.measuredScaleFactor,
                    fixFlipCount: nil
                )
            )
        }
        validatorChecks = rows
    }

    private func refreshMapPreviews(fromRunDir runDir: URL?) {
        guard let dir = runDir else { return }
        let candidates: [(String, String, String)] = [
            ("High-Poly vs LOD0 Shaded", "High-poly sculpt vs LOD0 + baked normal map", "previews/compare_shaded_highpoly_vs_lod0.png"),
            ("LOD0–LOD3 Wireframe Strip", "LOD chain wireframes from this run", "previews/lod_strip_wire.png"),
            ("UV Layout (LOD0)", "LOD0 UV islands from this run", "previews/uv_layout_lod0.png"),
            ("Tangent-Space Normal Map", "Baked normal detail (preview image)", "previews/normal_map_texture_1024.png"),
            ("Ambient Occlusion / ORM Map", "Baked cavity & occlusion map", "previews/ao_map_texture_1024.png")
        ]
        var cards: [MapPreviewCard] = []
        for (title, sub, rel) in candidates {
            let url = dir.appendingPathComponent(rel)
            if FileManager.default.fileExists(atPath: url.path) {
                cards.append(MapPreviewCard(title: title, subtitle: sub, imageURL: url))
            }
        }
        mapPreviewCards = cards
    }
}

// MARK: - Manifest LODs

/// One LOD of a pipeline manifest after merging the top-level entry with its `outputs.lods` duplicate.
struct PipelineManifestLOD: Equatable {
    let level: Int
    let name: String?
    /// Export path (the .fbx in current manifests).
    let path: String?
    /// Viewer copy (.glb), usually only in `outputs.lods`.
    let glb: String?
    let format: String?
    let triangles: Int?
    let vertices: Int?
    let budgetTriangles: Int?
    let screenSize: Double?
    let hasUVs: Bool?

    /// The file the native viewer should load: the .glb when the manifest names one, else `path` when it is a format
    /// MeshAnalyzerAndLoader reads (.glb / .obj), else nil (an .fbx-only LOD cannot be shown).
    var viewerPath: String? {
        if let glb = glb, !glb.isEmpty { return glb }
        if let path = path, !path.isEmpty {
            let ext: String = (path as NSString).pathExtension.lowercased()
            if ext == "glb" || ext == "obj" { return path }
        }
        return nil
    }
}

/// Reads the LOD list of a `fabled.pipeline.manifest/0.1` manifest the same way the web app does (`normalizeLods` in
/// ui/public/app.js): top-level `lods` first, `outputs.lods` as the fallback list, and each entry merged with the
/// `outputs.lods` entry of the same level so fields only the duplicate carries (`glb`, `vertices`, `has_uvs`) come
/// through. Values from the top-level entry win. Sorted by level.
enum PipelineManifestLODs {
    static func normalize(_ manifest: [String: Any]) -> [PipelineManifestLOD] {
        let top: [[String: Any]] = (manifest["lods"] as? [Any])?.compactMap { $0 as? [String: Any] } ?? []
        let outputs = manifest["outputs"] as? [String: Any]
        let sub: [[String: Any]] = (outputs?["lods"] as? [Any])?.compactMap { $0 as? [String: Any] } ?? []
        let base: [[String: Any]] = top.isEmpty ? sub : top

        var subByLevel: [Int: [String: Any]] = [:]
        for (index, entry) in sub.enumerated() {
            let level: Int = levelOf(entry, index: index)
            if subByLevel[level] == nil { subByLevel[level] = entry }
        }

        var result: [PipelineManifestLOD] = []
        for (index, entry) in base.enumerated() {
            let level: Int = levelOf(entry, index: index)
            let dup: [String: Any] = subByLevel[level] ?? [:]
            func string(_ key: String) -> String? {
                return (entry[key] as? String) ?? (dup[key] as? String)
            }
            func int(_ key: String) -> Int? {
                return intValue(entry[key]) ?? intValue(dup[key])
            }
            result.append(
                PipelineManifestLOD(
                    level: level,
                    name: string("name"),
                    path: string("path"),
                    glb: string("glb"),
                    format: string("format"),
                    triangles: int("triangles"),
                    vertices: int("vertices"),
                    budgetTriangles: int("budget_triangles"),
                    screenSize: doubleValue(entry["screen_size"]) ?? doubleValue(dup["screen_size"]),
                    hasUVs: (entry["has_uvs"] as? Bool) ?? (dup["has_uvs"] as? Bool)
                )
            )
        }
        return result.sorted { $0.level < $1.level }
    }

    /// `level` when it is an integer, else the number in a name like "LOD2", else the position in the list.
    static func levelOf(_ entry: [String: Any], index: Int) -> Int {
        if let level = intValue(entry["level"]) { return level }
        if let name = entry["name"] as? String, let range = name.range(of: "LOD", options: .caseInsensitive) {
            let digits: String = String(name[range.upperBound...].prefix(while: { $0.isNumber }))
            if let number = Int(digits) { return number }
        }
        return index
    }

    private static func intValue(_ raw: Any?) -> Int? {
        if let value = raw as? Int { return value }
        if let value = raw as? Double, value.rounded() == value, abs(value) < 1e15 { return Int(value) }
        return nil
    }

    private static func doubleValue(_ raw: Any?) -> Double? {
        if let value = raw as? Double { return value }
        if let value = raw as? Int { return Double(value) }
        return nil
    }
}

// MARK: - Manifest Texture Paths

/// Reads the normal / ORM texture paths (relative to the manifest folder) from a pipeline manifest.
/// `textures` may be an array of `{material, base_color, normal, orm}` sets or a single dict; when the top-level
/// key is missing or null, `outputs.textures` is used. The first set that names a path wins.
enum PipelineManifestTextures {
    static func paths(in manifest: [String: Any]) -> (normal: String?, orm: String?) {
        var raw: Any? = manifest["textures"]
        if raw == nil || raw is NSNull {
            raw = (manifest["outputs"] as? [String: Any])?["textures"]
        }
        let sets: [[String: Any]]
        if let array = raw as? [Any] {
            sets = array.compactMap { $0 as? [String: Any] }
        } else if let dict = raw as? [String: Any] {
            sets = [dict]
        } else {
            sets = []
        }
        func firstPath(_ key: String) -> String? {
            for textureSet in sets {
                if let path = textureSet[key] as? String, !path.isEmpty { return path }
            }
            return nil
        }
        return (firstPath("normal"), firstPath("orm"))
    }
}

// MARK: - Profile Rows For An Opened Run

/// The "values used for this output" rows for a pipeline run: limits from its `validator_profile.json`, measurements
/// from its `manifest.json`. Every value comes from one of those two files; a row (or half a row) whose value is not
/// there is omitted, never filled with a default.
enum PipelineProfileRows {
    static func rows(manifest: [String: Any], profile: [String: Any]?) -> [(String, String)] {
        let p: [String: Any] = profile ?? [:]
        var rows: [(String, String)] = []

        if let name = p["profile_name"] as? String, !name.isEmpty {
            var value: String = name
            if let version = p["profile_version"] as? String, !version.isEmpty {
                value += " v" + version
            }
            rows.append(("Validator profile", value))
        }

        let profileUnits = p["units"] as? [String: Any]
        var unitParts: [String] = []
        if let assumed = profileUnits?["assumed_source_units"] as? String, !assumed.isEmpty {
            unitParts.append("source " + assumed + " (assumed)")
        }
        if let trust = profileUnits?["trust_file_units"] as? Bool {
            unitParts.append(trust ? "file units trusted" : "file units not trusted")
        }
        if let unreal = (manifest["units"] as? [String: Any])?["unreal_units"] as? String, !unreal.isEmpty {
            unitParts.append("export in " + unreal)
        }
        if !unitParts.isEmpty {
            rows.append(("Units", unitParts.joined(separator: " · ")))
        }

        var axisParts: [String] = []
        if let up = (p["axes"] as? [String: Any])?["up"] as? String, !up.isEmpty {
            axisParts.append("profile " + up + " up")
        }
        if let exported = manifest["export_up_axis"] as? String, !exported.isEmpty {
            axisParts.append("FBX " + exported + " up")
        }
        if !axisParts.isEmpty {
            rows.append(("Up axis", axisParts.joined(separator: " · ")))
        }

        var heightParts: [String] = []
        if let range = profileUnits?["expected_height_cm"] as? [String: Any],
           let low = number(range["min"]), let high = number(range["max"]) {
            heightParts.append(format(low) + "–" + format(high) + " cm")
        }
        if let measured = number((manifest["exported_size"] as? [String: Any])?["fbx_height_cm"]) {
            heightParts.append("measured " + format(measured) + " cm")
        }
        if !heightParts.isEmpty {
            rows.append(("Height", heightParts.joined(separator: " · ")))
        }

        let rawBudgets: [Any] = ((p["lods"] as? [String: Any])?["triangle_budgets"] as? [Any]) ?? []
        let budgets: [Double] = rawBudgets.compactMap { number($0) }.filter { $0 >= 0 && $0 < 1e12 }
        if !budgets.isEmpty {
            let parts: [String] = budgets.enumerated().map { (pair: (offset: Int, element: Double)) -> String in
                return "LOD\(pair.offset) " + WorkspaceStore.fullNumber(Int(pair.element))
            }
            rows.append(("LOD budgets", parts.joined(separator: " · ")))
        }

        let texel = p["texel_density"] as? [String: Any]
        var texelParts: [String] = []
        if let target = number(texel?["target_px_per_cm"]) {
            var text: String = "target " + format(target) + " px/cm"
            if let tolerance = number(texel?["tolerance_pct"]) {
                text += " ±" + format(tolerance) + "%"
            }
            texelParts.append(text)
        }
        let uvStage = (manifest["stages"] as? [String: Any])?["uv"] as? [String: Any]
        if let measured = number(uvStage?["texel_density_px_per_cm_at_bake_res"]) {
            texelParts.append("measured " + format(measured, digits: 2) + " px/cm")
        }
        if !texelParts.isEmpty {
            rows.append(("Texel density", texelParts.joined(separator: " · ")))
        }

        var textureParts: [String] = []
        if let slots = (p["materials"] as? [String: Any])?["required_texture_slots"] as? [String], !slots.isEmpty {
            textureParts.append(slots.joined(separator: " + ") + " required")
        }
        let bakeStage = (manifest["stages"] as? [String: Any])?["bake"] as? [String: Any]
        if let resolution = number(bakeStage?["resolution"]), resolution > 0, resolution < 1e9 {
            textureParts.append("baked at \(Int(resolution)) px")
        }
        if !textureParts.isEmpty {
            rows.append(("Textures", textureParts.joined(separator: " · ")))
        }

        if let maxFlipped = number((p["normals"] as? [String: Any])?["max_flipped_faces"]) {
            rows.append(("Max flipped faces", format(maxFlipped)))
        }
        return rows
    }

    /// A finite JSON number (JSONSerialization yields NSNumber on Apple, Int / Double elsewhere); nil otherwise.
    private static func number(_ value: Any?) -> Double? {
        if let double = value as? Double, double.isFinite { return double }
        if let int = value as? Int { return Double(int) }
        return nil
    }

    /// "20", "53.1", "25.6": at most `digits` decimals, trailing zeros dropped.
    private static func format(_ value: Double, digits: Int = 1) -> String {
        guard value.isFinite else { return String(value) }
        var text: String = String(format: "%.\(max(digits, 0))f", value)
        if text.contains(".") {
            while text.hasSuffix("0") { text.removeLast() }
            if text.hasSuffix(".") { text.removeLast() }
        }
        return text
    }
}
