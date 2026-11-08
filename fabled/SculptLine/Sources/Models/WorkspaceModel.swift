import Foundation

// Pure helpers for the connected workspace, ported from ui/public/workspace-model.js (filterWorkspace, trisLabel,
// compact, timeAgo, KIND_LABEL, toneOf). Keep the semantics identical to the JS so the web UI and the native app
// show the same labels and filter results. Namespaced in an enum to avoid clashing with other free functions.

enum WorkspaceModel {
    static let kindLabels: [String: String] = [
        "pipeline_output": "Pipeline output",
        "frozen_run": "Frozen pipeline run",
        "upload": "Uploaded sculpt",
        "generated": "AI-generated sculpt",
        "generation": "AI generation",
        "sample": "Sample sculpt",
        "fixture": "Test fixture"
    ]

    /// KIND_LABEL[kind]; nil for kinds the web UI does not know either.
    static func kindLabel(_ kind: String) -> String? {
        return kindLabels[kind]
    }

    /// SF Symbol per asset kind (the native counterpart of KIND_ICON).
    static func sfSymbol(forKind kind: String) -> String {
        switch kind {
        case "pipeline_output": return "shippingbox"
        case "frozen_run": return "archivebox"
        case "upload": return "square.and.arrow.up"
        case "generated": return "sparkles"
        case "generation": return "wand.and.stars"
        case "sample": return "cube"
        case "fixture": return "flag"
        default: return "doc"
        }
    }

    /// toneOf(asset): the status tone, or neutral when unknown.
    static func tone(of asset: WorkspaceAsset) -> AssetTone {
        return asset.status.resolvedTone
    }

    // MARK: Filtering

    /// The lowercased text a query is matched against: name, kind, kind label, status label, folder, provenance
    /// provider name and prompt, group label (empty values skipped, joined by spaces).
    static func haystack(_ asset: WorkspaceAsset, group: WorkspaceGroup?) -> String {
        let parts: [String?] = [
            asset.name,
            asset.kind,
            kindLabel(asset.kind),
            asset.status.label,
            asset.folder,
            asset.provenance?.providerName,
            asset.provenance?.prompt,
            group?.label
        ]
        let present: [String] = parts.compactMap { (part: String?) -> String? in
            guard let part = part, !part.isEmpty else { return nil }
            return part
        }
        return present.joined(separator: " ").lowercased()
    }

    /// Filters the groups by a free-text query. Every whitespace-separated term must match (AND); matching is a
    /// literal, case-insensitive substring test, so regex metacharacters are harmless. Groups are kept even when
    /// empty; `total` counts the matching (visible) assets only.
    static func filterWorkspace(_ index: WorkspaceIndex?, query: String?) -> (groups: [WorkspaceGroup], total: Int) {
        let terms: [String] = (query ?? "").lowercased()
            .components(separatedBy: CharacterSet.whitespacesAndNewlines)
            .filter { !$0.isEmpty }
        let sourceGroups: [WorkspaceGroup] = index?.groups ?? []
        var groups: [WorkspaceGroup] = []
        var total: Int = 0
        for group in sourceGroups {
            var filtered: WorkspaceGroup = group
            if !terms.isEmpty {
                filtered.assets = group.assets.filter { (asset: WorkspaceAsset) -> Bool in
                    let hay: String = haystack(asset, group: group)
                    return terms.allSatisfy { (term: String) -> Bool in hay.contains(term) }
                }
            }
            total += filtered.assets.count
            groups.append(filtered)
        }
        return (groups: groups, total: total)
    }

    // MARK: Labels

    /// compact(n): 999 → "999", 1050 → "1.1k", 18636 → "19k", 1250000 → "1.3M", 12500000 → "13M".
    static func compactCount(_ n: Int?) -> String? {
        guard let n = n else { return nil }
        let value: Double = Double(n)
        if value >= 1e6 {
            return toFixed(value / 1e6, digits: value >= 1e7 ? 0 : 1) + "M"
        }
        if value >= 1e4 {
            return String(Int((value / 1e3).rounded(.toNearestOrAwayFromZero))) + "k"
        }
        if value >= 1e3 {
            return toFixed(value / 1e3, digits: 1) + "k"
        }
        return String(n)
    }

    /// Number.prototype.toFixed for non-negative values with small `digits`. Like JS, the rounding decision uses the
    /// exact binary value of `value` (ties go up): (1150 / 1e3).toFixed(1) is "1.1" because 1.15 is stored as
    /// 1.1499999…, while a naive (value * 10).rounded() gives "1.2". The comparisons use fused multiply-add, whose single
    /// rounding preserves the sign of the exact result.
    private static func toFixed(_ value: Double, digits: Int) -> String {
        if digits <= 0 {
            return String(Int(value.rounded(.toNearestOrAwayFromZero)))
        }
        let scale: Double = pow(10.0, Double(digits))
        // k = floor(value * scale), computed exactly.
        var k: Double = (value * scale).rounded(.down)
        if (-k).addingProduct(value, scale) < 0 {
            k -= 1
        } else if (-(k + 1)).addingProduct(value, scale) >= 0 {
            k += 1
        }
        // Round up when value >= (k + 0.5) / scale, i.e. value * 2 * scale - (2k + 1) >= 0 (exactly).
        let roundUp: Bool = (-(2 * k + 1)).addingProduct(value, 2 * scale) >= 0
        let scaled: Int = Int(roundUp ? k + 1 : k)
        let divisor: Int = Int(scale)
        let whole: Int = scaled / divisor
        var fraction: String = String(scaled % divisor)
        while fraction.count < digits {
            fraction = "0" + fraction
        }
        return String(whole) + "." + fraction
    }

    /// "LOD0 19k tris · 4 LODs" for runs, "328k tris" for sculpts, nil when nothing is known. Never invented.
    static func trisLabel(_ asset: WorkspaceAsset) -> String? {
        return trisLabel(asset.triangles)
    }

    static func trisLabel(_ triangles: TriangleFacts?) -> String? {
        guard let t = triangles else { return nil }
        // JS truthiness: lod_count counts only when non-null and non-zero.
        let lodCount: Int? = (t.lodCount ?? 0) != 0 ? t.lodCount : nil
        if let lod0 = t.lod0Triangles {
            var label: String = "LOD0 " + (compactCount(lod0) ?? String(lod0)) + " tris"
            if let count = lodCount {
                label += " · \(count) LODs"
            }
            return label
        }
        if let count = lodCount {
            var label: String = "\(count) LODs"
            if let input = t.input {
                label += " · in " + (compactCount(input) ?? String(input))
            }
            return label
        }
        if let input = t.input {
            return (compactCount(input) ?? String(input)) + " tris"
        }
        return nil
    }

    // MARK: Time

    /// "just now" (< 45 s, or in the future), "Nm ago" (< 1 h), "Nh ago" (< 1 d), "Nd ago" (< 30 d), else the UTC
    /// date as yyyy-MM-dd. nil for a missing or unparseable timestamp.
    static func timeAgo(_ iso: String?, now: Date = Date()) -> String? {
        guard let iso = iso, !iso.isEmpty, let date = parseISODate(iso) else { return nil }
        let seconds: Double = now.timeIntervalSince(date).rounded(.toNearestOrAwayFromZero)
        if seconds < 45 { return "just now" }
        if seconds < 3600 { return "\(Int((seconds / 60).rounded(.toNearestOrAwayFromZero)))m ago" }
        if seconds < 86400 { return "\(Int((seconds / 3600).rounded(.toNearestOrAwayFromZero)))h ago" }
        if seconds < 86400 * 30 { return "\(Int((seconds / 86400).rounded(.toNearestOrAwayFromZero)))d ago" }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    /// Parses ISO-8601 timestamps as the server writes them: "2026-11-06T06:05:04.521Z", "2026-11-04T04:44:03Z",
    /// "2026-11-03T20:44:03-08:00" (any number of fractional digits), plus a bare "2026-11-06" (UTC, like JS).
    static func parseISODate(_ raw: String) -> Date? {
        let trimmed: String = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        let normalized: String = normalizeFraction(trimmed)

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: normalized) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: normalized) { return date }

        // Fallbacks in case a Foundation build's ISO8601DateFormatter rejects one of the forms above.
        let patterns: [String] = ["yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX", "yyyy-MM-dd'T'HH:mm:ssXXXXX"]
        for pattern in patterns {
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: "UTC")
            formatter.dateFormat = pattern
            if let date = formatter.date(from: normalized) { return date }
        }

        if trimmed.count == 10 {
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: "UTC")
            formatter.dateFormat = "yyyy-MM-dd"
            if let date = formatter.date(from: trimmed) { return date }
        }
        return nil
    }

    /// Pads or truncates fractional seconds to exactly 3 digits ("…:03.5Z" → "…:03.500Z", "…:03.123456Z" → "…:03.123Z").
    private static func normalizeFraction(_ s: String) -> String {
        guard let dot = s.firstIndex(of: ".") else { return s }
        let start: String.Index = s.index(after: dot)
        var end: String.Index = start
        while end < s.endIndex {
            let c: Character = s[end]
            guard c.isASCII, c.isNumber else { break }
            end = s.index(after: end)
        }
        let digits: String = String(s[start..<end])
        if digits.isEmpty { return s }
        var fixed: String = String(digits.prefix(3))
        while fixed.count < 3 {
            fixed += "0"
        }
        return String(s[..<start]) + fixed + String(s[end...])
    }
}
