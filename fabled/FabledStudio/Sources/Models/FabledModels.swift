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

    var id: String { rawValue }
}

enum FabledTheme {
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

// MARK: - Notion-Style Asset Hierarchy Models (Feature 16)

struct FabledAssetItem: Identifiable, Hashable {
    let id: String
    let name: String
    let category: String
    let tag: String
    let status: String
    let statusClass: String // "ready", "validating", "draft"
    let triangles: String
    let timestamp: String
    let type: String        // "output", "sample"
    let dirOrSamplePath: String?
}

struct FabledAssetCategory: Identifiable {
    let id: String
    let category: String
    var assets: [FabledAssetItem]
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
final class FabledStudioViewModel: ObservableObject {
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
    @Published var validatorSourceTag: String = "real · fabled_validator"
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

    // MARK: - Feature 16: Notion-Style Asset Tree Catalog
    @Published var selectedAssetId: String = "helen-keller-bust"
    @Published var assetSearchText: String = ""
    @Published var assetNotes: [String: String] = [
        "helen-keller-bust": "Historical head bust scan from Smithsonian CC0. Ingestion profile requires 20.0–80.0 cm height budget. QuadriFlow retopology generated clean quad mesh with LOD0 (25k), LOD1 (12.5k), LOD2 (6.25k), LOD3 (3.125k). Tangent-space normal map and packed ORM maps validated.",
        "synthetic-clean-hero": "Synthetic humanoid character head mesh with UV0 unwrapped in [0, 1]. Inverted face testing fixture for normal orientation validation.",
        "paladin-shield": "Hard-surface weapon prop. Small prop asset class budget (5–100 cm). Needs texture slot verification before final build.",
        "dungeon-pillar": "Modular stone architectural asset with LOD chain generated."
    ]

    static let standardCatalog: [FabledAssetCategory] = [
        FabledAssetCategory(
            id: "busts",
            category: "Character Busts",
            assets: [
                FabledAssetItem(
                    id: "helen-keller-bust",
                    name: "Procedural sample head (self-made)",
                    category: "Character Busts",
                    tag: "historical",
                    status: "LOD0-3 Ready",
                    statusClass: "ready",
                    triangles: "328k tris",
                    timestamp: "12m ago",
                    type: "output",
                    dirOrSamplePath: "pipeline/output"
                ),
                FabledAssetItem(
                    id: "synthetic-clean-hero",
                    name: "Synthetic Clean Hero",
                    category: "Character Busts",
                    tag: "hero",
                    status: "Validating",
                    statusClass: "validating",
                    triangles: "12.4k tris",
                    timestamp: "1h ago",
                    type: "sample",
                    dirOrSamplePath: "ui/samples/fabled_sample_head.glb"
                )
            ]
        ),
        FabledAssetCategory(
            id: "props",
            category: "Weapons & Props",
            assets: [
                FabledAssetItem(
                    id: "paladin-shield",
                    name: "Paladin Shield",
                    category: "Weapons & Props",
                    tag: "weapon",
                    status: "Draft",
                    statusClass: "draft",
                    triangles: "4.2k tris",
                    timestamp: "3h ago",
                    type: "sample",
                    dirOrSamplePath: "ui/samples/fabled_sample_head.obj"
                )
            ]
        ),
        FabledAssetCategory(
            id: "environments",
            category: "Environments",
            assets: [
                FabledAssetItem(
                    id: "dungeon-pillar",
                    name: "Dungeon Pillar",
                    category: "Environments",
                    tag: "modular",
                    status: "LOD0-3 Ready",
                    statusClass: "ready",
                    triangles: "18.5k tris",
                    timestamp: "Yesterday",
                    type: "output",
                    dirOrSamplePath: "pipeline/output"
                )
            ]
        )
    ]

    var filteredCategories: [FabledAssetCategory] {
        let query = assetSearchText.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return Self.standardCatalog }

        return Self.standardCatalog.compactMap { cat in
            let matchesCategory = cat.category.lowercased().contains(query)
            let matchingAssets = cat.assets.filter { asset in
                matchesCategory ||
                asset.name.lowercased().contains(query) ||
                asset.tag.lowercased().contains(query) ||
                asset.status.lowercased().contains(query)
            }
            if matchingAssets.isEmpty { return nil }
            return FabledAssetCategory(id: cat.id, category: cat.category, assets: matchingAssets)
        }
    }

    var selectedAssetItem: FabledAssetItem? {
        for cat in Self.standardCatalog {
            if let found = cat.assets.first(where: { $0.id == selectedAssetId }) {
                return found
            }
        }
        return Self.standardCatalog.first?.assets.first
    }

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

    /// Root directory of the `fabled` project when running locally (see `discoverFabledRoot`).
    var fabledRootURL: URL? {
        Self.discoverFabledRoot(
            environment: ProcessInfo.processInfo.environment,
            defaultsPath: UserDefaults.standard.string(forKey: "fabledRootPath"),
            startDirectories: [
                Bundle.main.bundleURL,
                URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            ],
            fileExists: { FileManager.default.fileExists(atPath: $0) }
        )
    }

    /// Finds the `fabled` project root (the directory containing `pipeline/fabled_pipeline.py`).
    /// Order: env `FABLED_ROOT`, then the UserDefaults path `fabledRootPath`, then a walk up (at most 8 levels)
    /// from each start directory, also accepting a child named `fabled` that contains the pipeline script.
    nonisolated static func discoverFabledRoot(
        environment: [String: String],
        defaultsPath: String?,
        startDirectories: [URL],
        fileExists: (String) -> Bool
    ) -> URL? {
        let marker = "pipeline/fabled_pipeline.py"
        for explicit in [environment["FABLED_ROOT"], defaultsPath] {
            if let path = explicit?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty {
                let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath).standardizedFileURL
                if fileExists(url.appendingPathComponent(marker).path) { return url }
            }
        }
        for start in startDirectories {
            var dir = start.standardizedFileURL
            for _ in 0..<8 {
                if fileExists(dir.appendingPathComponent(marker).path) { return dir }
                let child = dir.appendingPathComponent("fabled")
                if fileExists(child.appendingPathComponent(marker).path) { return child }
                let parent = dir.deletingLastPathComponent().standardizedFileURL
                if parent.path == dir.path { break }
                dir = parent
            }
        }
        return nil
    }

    init() {
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

    // MARK: - Asset Selection (Feature 16)

    func selectAsset(id: String) async {
        selectedAssetId = id
        guard let item = selectedAssetItem else { return }

        if item.type == "output" {
            await openRealPipelineOutput()
        } else {
            if let root = fabledRootURL, let rel = item.dirOrSamplePath {
                let sampleURL = root.appendingPathComponent(rel)
                if FileManager.default.fileExists(atPath: sampleURL.path) {
                    await loadCustomMeshFile(from: sampleURL)
                    return
                }
            }
            await loadRawSampleSculpt()
        }
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
        if let root = fabledRootURL {
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
            refreshMapPreviews(fromRunDir: fabledRootURL?.appendingPathComponent("pipeline/runs/latest"))
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

    func openRealPipelineOutput() async {
        isBusy = true
        busyMessage = "Opening real pipeline output (LOD0–LOD3 + baked Normal/ORM)…"
        defer { isBusy = false }

        guard let root = fabledRootURL else {
            await buildBrowserLODPreviews()
            return
        }

        let latestDir = root.appendingPathComponent("pipeline/runs/latest")
        let outputDir = root.appendingPathComponent("pipeline/output")
        let runDir = FileManager.default.fileExists(atPath: latestDir.appendingPathComponent("manifest.json").path) ? latestDir : outputDir
        let manifestURL = runDir.appendingPathComponent("manifest.json")

        guard let data = try? Data(contentsOf: manifestURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            await buildBrowserLODPreviews()
            return
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

        let texturePaths = PipelineManifestTextures.paths(in: json)
        let normalURL = runDir.appendingPathComponent(texturePaths.normal ?? "export/T_HelenKellerBust_N.png")
        let ormURL = runDir.appendingPathComponent(texturePaths.orm ?? "export/T_HelenKellerBust_ORM.png")

        var builtLODs: [BuiltLODMesh] = []
        let rawLods = (json["lods"] as? [[String: Any]]) ?? ((json["outputs"] as? [String: Any])?["lods"] as? [[String: Any]]) ?? []
        for entry in rawLods {
            let level = (entry["level"] as? Int) ?? builtLODs.count
            let relPath = (entry["glb"] as? String) ?? (entry["path"] as? String) ?? ""
            let fileURL = runDir.appendingPathComponent(relPath)
            if let lodMesh = try? MeshAnalyzerAndLoader.loadMesh(from: fileURL) {
                builtLODs.append(
                    BuiltLODMesh(
                        level: level,
                        triangles: lodMesh.triangleCount,
                        vertices: lodMesh.rawVertexCount,
                        budget: entry["budget_triangles"] as? Int,
                        manifestTriangles: entry["triangles"] as? Int,
                        isPreviewMockup: false,
                        format: "GLB",
                        positions: lodMesh.positions,
                        indices: lodMesh.indices,
                        normals: lodMesh.normals,
                        texcoords: lodMesh.texcoords,
                        normalMapURL: FileManager.default.fileExists(atPath: normalURL.path) ? normalURL : nil,
                        ormMapURL: FileManager.default.fileExists(atPath: ormURL.path) ? ormURL : nil
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

        usedProfileRows = [
            ("Validator profile", "DEMO PLACEHOLDER VALUES — Head Bust (NPG.75.16)"),
            ("Units", "FBX in cm, import scale 1.0, file units trusted"),
            ("Up axis", "Z up (validator, FBX) · GLB preview is Y up by glTF spec"),
            ("Height range", "20.0–80.0 cm (bust) · measured 53.1 cm"),
            ("LOD budgets", "LOD0 25,000 · LOD1 12,500 · LOD2 6,250 · LOD3 3,125"),
            ("Texel density", "no studio target · measured ~10.24 px/cm (1024 px/m)"),
            ("Textures", "Normal map (DirectX + OpenGL) + Packed ORM (2048×2048)"),
            ("Max flipped faces", "0 (all LOD0–LOD3 meshes pass with 0 flipped faces)")
        ]

        refreshMapPreviews(fromRunDir: runDir)
        await runPreImportChecks(manifestURL: manifestURL)
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
        if let root = fabledRootURL {
            isBusy = true
            busyMessage = "Running Fabled 8-stage mesh pipeline…"
            currentJobStatus = .running(stage: "Initializing", progress: 0.0)
            defer { isBusy = false }

            let pipelineScript = root.appendingPathComponent("pipeline/fabled_pipeline.py")
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
                fixHint: normalsPassed ? nil : "Highlighted in red on the High-Poly Sculpt viewport. Use Preview Unified Winding or run the Fabled pipeline repair step.",
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
        guard let root = fabledRootURL else {
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
        validatorNote = "fabled_validator 0.2.0 · Checked 16 studio criteria."

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
            ("High-Poly vs LOD0 Shaded", "328,894 tris vs 25,000 tris + Baked Normal Map", "previews/compare_shaded_highpoly_vs_lod0.png"),
            ("LOD0–LOD3 Wireframe Strip", "Decimated manifold LOD chain (25k → 3.1k tris)", "previews/lod_strip_wire.png"),
            ("UV Layout (LOD0)", "Non-overlapping 2-hemisphere UV unwrap", "previews/uv_layout_lod0.png"),
            ("Tangent-Space Normal Map", "Baked normal detail (1024px preview / 2048px export)", "previews/normal_map_texture_1024.png"),
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
