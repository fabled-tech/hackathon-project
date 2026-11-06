import Foundation

// Licensed sample assets. Mirrors ui/public/licensed.js character for character, so the native app and the web app
// apply the same rules. The NPG.75.16 scan: verbatim credit + no-endorsement line, neutral display name (never her
// name as a title), height shown as measured from the file. File and mesh names may stay as exported.

struct LicensedSample: Equatable, Sendable {
    /// Case-insensitive regular expression tested against the asset name and the source text.
    let matchPattern: String
    let displayName: String
    let shortName: String
    let credit: String
    let creditURL: String
    let disclaimer: String
    let heightNote: String

    var creditLink: URL? { URL(string: creditURL) }

    func matches(_ text: String) -> Bool {
        guard !text.isEmpty,
              let regex = try? NSRegularExpression(pattern: matchPattern, options: [.caseInsensitive]) else {
            return false
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.firstMatch(in: text, options: [], range: range) != nil
    }
}

enum LicensedSamples {
    static let all: [LicensedSample] = [
        LicensedSample(
            matchPattern: "NPG[._ ]?75[._ ]?16|d8c64ccc-4ebc-11ea-b77f-2e728ce88125|HelenKeller",
            displayName: "Sample asset: historical bust scan (CC0)",
            shortName: "Historical bust scan (CC0)",
            credit: "Helen Adams Keller by Onorio Ruotolo, 1916. National Portrait Gallery, Smithsonian Institution (NPG.75.16). 3D model via Smithsonian 3D, CC0.",
            creditURL: "https://3d.si.edu/object/3d/helen-adams-keller:d8c64ccc-4ebc-11ea-b77f-2e728ce88125",
            disclaimer: "Fabled is not affiliated with or endorsed by the Smithsonian Institution.",
            heightNote: "source units inferred"
        )
    ]

    /// Returns the licensed sample whose rule matches the asset name or the source text (e.g. a manifest's
    /// `source` / `input.source` serialized as JSON), or nil when neither is given or nothing matches.
    static func match(asset: String?, sourceJSON: String?) -> LicensedSample? {
        guard asset != nil || sourceJSON != nil else { return nil }
        let haystack = (asset ?? "") + "\n" + (sourceJSON ?? "")
        return all.first { $0.matches(haystack) }
    }

    /// Neutral title for pipeline runs of the self-made procedural sample head (mirrors licensed.js).
    static let proceduralSampleName = "Procedural sample head (self-made)"

    /// True when a manifest's input is the procedural sample head (`ui/samples/fabled_sample_head.glb|obj`). Such runs are
    /// NOT the scan even when exported under the scan's asset name: the committed pipeline/output and
    /// runs/20261103-195336 are exactly that (asset "HelenKellerBust", input fabled_sample_head.glb, all source fields null).
    static func isProceduralSampleRun(manifest: [String: Any]) -> Bool {
        let input = manifest["input"] as? [String: Any]
        let path = (input?["sculpt_path"] as? String) ?? (input?["path"] as? String) ?? ""
        let file = (path as NSString).lastPathComponent.lowercased()
        return file == "fabled_sample_head.glb" || file == "fabled_sample_head.obj"
    }

    /// Title for a manifest: licensed display name, else the procedural name, else the asset name (mirrors manifestDisplayName).
    static func displayName(manifest: [String: Any], short: Bool = false) -> String? {
        if let lic = match(manifest: manifest) { return short ? lic.shortName : lic.displayName }
        if isProceduralSampleRun(manifest: manifest) { return proceduralSampleName }
        return manifest["asset"] as? String
    }

    /// Mirrors `licensedSample(manifest)` in licensed.js, which tests `{ a: m.asset, s: m.source, i: m.input.source }`
    /// and never credits a run of the procedural sample head.
    static func match(manifest: [String: Any]) -> LicensedSample? {
        if isProceduralSampleRun(manifest: manifest) { return nil }
        let asset = manifest["asset"] as? String
        var sources: [Any] = []
        if let source = manifest["source"], !(source is NSNull) { sources.append(source) }
        if let inputSource = (manifest["input"] as? [String: Any])?["source"], !(inputSource is NSNull) {
            sources.append(inputSource)
        }
        let sourceJSON: String? = sources.isEmpty ? nil : sources.map(jsonText).joined(separator: "\n")
        return match(asset: asset, sourceJSON: sourceJSON)
    }

    private static func jsonText(_ value: Any) -> String {
        if let text = value as? String { return text }
        if JSONSerialization.isValidJSONObject(value),
           let data = try? JSONSerialization.data(withJSONObject: value, options: []),
           let text = String(data: data, encoding: .utf8) {
            return text
        }
        return String(describing: value)
    }
}
