import Foundation

// MARK: - Pre-Import Validator Schema 0.2.0 Models (Feature 17)

struct ValidatorSummary: Codable, Equatable {
    let pass: Int
    let warn: Int
    let fail: Int
    let not_checked: Int
    let total: Int
    let flagged: Int

    static let zero = ValidatorSummary(pass: 0, warn: 0, fail: 0, not_checked: 0, total: 0, flagged: 0)
}

struct ValidatorFixHintItem: Codable, Equatable {
    let action: String?
    let factor: Double?
    let target: String?
    let description: String?
}

struct ValidatorCheck: Codable, Identifiable, Equatable {
    let id: String
    let group: String?
    let title: String?
    let status: String
    let message: String
    let fix_hint: String?

    // Optional parsed metrics
    var measuredScaleFactor: Double? {
        // Can be inferred from fix_hint or measured values
        if let hint = fix_hint, hint.contains("0.01") {
            return 0.01
        }
        return nil
    }

    var isPass: Bool { status.lowercased() == "pass" }
    var isWarn: Bool { status.lowercased() == "warn" }
    var isFail: Bool { status.lowercased() == "fail" }
    var isNotChecked: Bool { status.lowercased() == "not_checked" }

    var displayTitle: String {
        title ?? id
    }

    var statusGlyph: String {
        switch status.lowercased() {
        case "pass": return "✓"
        case "warn": return "!"
        case "fail": return "✕"
        default:     return "–"
        }
    }
}

struct ValidatorReport: Codable, Equatable {
    let schema_version: String?
    let tool: [String: String]?
    let overall_status: String
    let complete: Bool?
    let summary: ValidatorSummary
    let checks: [ValidatorCheck]

    var isPassing: Bool { overall_status.lowercased() == "pass" }
    var isFlagged: Bool { overall_status.lowercased() == "warn" || overall_status.lowercased() == "fail" }

    var headlineSummary: String {
        "pass \(summary.pass) · warn \(summary.warn) · fail \(summary.fail) · not checked \(summary.not_checked)"
    }
}

// MARK: - 16 Standard Studio Pre-Import Check IDs
enum StandardValidatorCheckID: String, CaseIterable {
    case scale = "scale"
    case upAxis = "up_axis"
    case normals = "normals"
    case nonManifold = "non_manifold"
    case degenerateTriangles = "degenerate_triangles"
    case triangleBudget = "triangle_budget"
    case skeletonBinding = "skeleton_binding"
    case boneNaming = "bone_naming"
    case textureFiles = "texture_files"
    case textureSlots = "texture_slots"
    case textureNaming = "texture_naming"
    case textureSize = "texture_size"
    case materialCount = "material_count"
    case uvLayout = "uv_layout"
    case texelDensity = "texel_density"
    case manifest = "manifest"

    var groupTitle: String {
        switch self {
        case .scale, .upAxis:
            return "Scale & Orientation"
        case .normals:
            return "Normals & Winding"
        case .nonManifold, .degenerateTriangles, .triangleBudget:
            return "Geometry & Budgets"
        case .skeletonBinding, .boneNaming:
            return "Skeleton & Rigging"
        case .textureFiles, .textureSlots, .textureNaming, .textureSize, .materialCount:
            return "Textures & Materials"
        case .uvLayout, .texelDensity:
            return "UVs & Texel Density"
        case .manifest:
            return "Pipeline Manifest"
        }
    }
}
