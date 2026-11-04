import Foundation

// MARK: - Pipeline Engine Enum (Feature 15)

enum PipelineEngine: String, CaseIterable, Identifiable {
    case blender = "Headless Blender (Cycles CPU)"
    case native = "Native Fallback (Python/NumPy)"

    var id: String { rawValue }

    var shortLabel: String {
        switch self {
        case .blender: return "Blender 5.2.3"
        case .native:  return "Native Fallback"
        }
    }

    /// Value passed to `fabled_pipeline.py --blender <val>`
    func cliArgument(blenderPath: String?) -> String {
        switch self {
        case .native:
            return "none"
        case .blender:
            if let path = blenderPath, !path.isEmpty, FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
            return "/opt/homebrew/bin/blender"
        }
    }
}

// MARK: - Host Blender Detection Helper (Feature 15)

struct BlenderDetection {
    let isAvailable: Bool
    let path: String?
    let version: String?

    static func detectHostBlender() -> BlenderDetection {
        let envOverride = ProcessInfo.processInfo.environment["FABLED_BLENDER"]
        let candidates: [String] = [
            envOverride ?? "",
            "/opt/homebrew/bin/blender",
            "/usr/local/bin/blender",
            "/Applications/Blender.app/Contents/MacOS/Blender",
            "/Applications/Blender.app/Contents/MacOS/blender"
        ].filter { !$0.isEmpty }

        for candidate in candidates {
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return BlenderDetection(
                    isAvailable: true,
                    path: candidate,
                    version: "Blender 5.2.3 LTS"
                )
            }
        }

        return BlenderDetection(isAvailable: false, path: nil, version: nil)
    }
}

// MARK: - Pipeline Atomic Progress Telemetry Model (Feature 14)

struct PipelineProgress: Codable, Equatable, Identifiable {
    var id: Int { step }

    let step: Int
    let total: Int
    let name: String
    let label: String
    let done: Bool
    let status: String
    let updated_at: String?

    enum CodingKeys: String, CodingKey {
        case step
        case total
        case name
        case label
        case done
        case status
        case updated_at
    }

    init(step: Int, total: Int = 8, name: String, label: String, done: Bool, status: String, updated_at: String? = nil) {
        self.step = step
        self.total = total
        self.name = name
        self.label = label
        self.done = done
        self.status = status
        self.updated_at = updated_at
    }

    var progressFraction: Double {
        guard total > 0 else { return 0.0 }
        let base = Double(max(0, step - 1)) / Double(total)
        return done ? Double(step) / Double(total) : base + (0.5 / Double(total))
    }
}

// MARK: - Pipeline Job Status

enum PipelineJobStatus: Equatable {
    case idle
    case running(stage: String, progress: Double)
    case completed(runDir: URL)
    case failed(message: String)
    case cancelled
}

// MARK: - 8 Standard Pipeline Stages Plan

struct PipelineStageInfo: Identifiable, Equatable {
    let id: Int
    let key: String
    let name: String
    let label: String

    static let allStages: [PipelineStageInfo] = [
        PipelineStageInfo(id: 1, key: "01", name: "import_measure", label: "Import + measure sculpt"),
        PipelineStageInfo(id: 2, key: "02", name: "retopology", label: "Retopology (QuadriFlow, fallbacks)"),
        PipelineStageInfo(id: 3, key: "03", name: "uv_unwrap", label: "UV unwrap + pack"),
        PipelineStageInfo(id: 4, key: "04", name: "lod_generation", label: "LOD chain from tri budgets"),
        PipelineStageInfo(id: 5, key: "05", name: "texture_bake", label: "Bake normal (+AO) maps, Cycles CPU"),
        PipelineStageInfo(id: 6, key: "06", name: "fbx_export", label: "FBX/GLB export + re-import check"),
        PipelineStageInfo(id: 7, key: "07", name: "previews", label: "Preview renders"),
        PipelineStageInfo(id: 8, key: "08", name: "preview_composites", label: "Labelled preview composites")
    ]
}
