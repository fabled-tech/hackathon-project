import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// HTTP client for the local SculptLine server (ui/server.mjs, default port 5178): the "connected workspace" API
// (asset index, notes, activity), AI provider plugins and generation tasks. Contracts: ui/INTERFACES.md §4 and §10.
//
// Models mirror the JSON the server actually sends (see Tests/SculptLineTests/Fixtures, captured from a running
// server). Anything the server may send as null, or leave out, is Optional. Unknown fields are ignored. Timestamps stay
// ISO-8601 strings, exactly as sent; WorkspaceModel.timeAgo / parseISODate turn them into display text.

// MARK: - Errors

enum SculptLineServerError: Error, Equatable, LocalizedError {
    /// The server could not be reached (connection refused, DNS, timeout, no HTTP response).
    case unreachable(String)
    /// Non-2xx HTTP status. The message is the server's `error` field when it sent one.
    case http(Int, String)
    /// HTTP 200 with `{ok: false, error}`: the server understood the request and refused it.
    case server(String)
    /// The response was not the JSON shape this client expects.
    case decoding(String)
    /// The client could not build the request (bad base URL, unencodable body).
    case invalidRequest(String)

    var errorDescription: String? {
        switch self {
        case .unreachable(let message):
            return "SculptLine server unreachable: \(message)"
        case .http(let status, let message):
            return "SculptLine server HTTP \(status): \(message)"
        case .server(let message):
            return message
        case .decoding(let message):
            return "Unexpected response from the SculptLine server: \(message)"
        case .invalidRequest(let message):
            return "Could not build the request: \(message)"
        }
    }
}

// MARK: - /api/status

struct ServerStatus: Codable, Equatable, Sendable {
    let pipeline: PipelineAvailability
    let validator: ValidatorAvailability
}

struct PipelineAvailability: Codable, Equatable, Sendable {
    let dir: String?
    let dirExists: Bool?
    let available: Bool
    let commandPreview: String?
    let forcedOff: Bool?
    let supportsValidatorProfile: Bool?
    let supportsAssetName: Bool?
    let frozenRun: String?
    let latestOutputManifest: Bool?
    let blenderPath: String?
    let engines: EngineAvailability?

    enum CodingKeys: String, CodingKey {
        case dir
        case dirExists = "dir_exists"
        case available
        case commandPreview = "command_preview"
        case forcedOff = "forced_off"
        case supportsValidatorProfile = "supports_validator_profile"
        case supportsAssetName = "supports_asset_name"
        case frozenRun = "frozen_run"
        case latestOutputManifest = "latest_output_manifest"
        case blenderPath = "blender_path"
        case engines
    }
}

struct EngineAvailability: Codable, Equatable, Sendable {
    let blender: Bool?
    let native: Bool?
}

struct ValidatorAvailability: Codable, Equatable, Sendable {
    let dir: String?
    let dirExists: Bool?
    let available: Bool
    let commandPreview: String?
    let forcedOff: Bool?
    let supportsManifest: Bool?

    enum CodingKeys: String, CodingKey {
        case dir
        case dirExists = "dir_exists"
        case available
        case commandPreview = "command_preview"
        case forcedOff = "forced_off"
        case supportsManifest = "supports_manifest"
    }
}

// MARK: - /api/workspace (fabled.workspace/0.1)

struct WorkspaceIndex: Codable, Hashable, Sendable {
    let schema: String
    let generatedAt: String?
    let groups: [WorkspaceGroup]
    /// Every asset the server knows about, including uploads hidden by its cap (`hidden_count`).
    let total: Int

    enum CodingKeys: String, CodingKey {
        case schema
        case generatedAt = "generated_at"
        case groups
        case total
    }

    func asset(id: String) -> WorkspaceAsset? {
        for group in groups {
            for asset in group.assets where asset.id == id {
                return asset
            }
        }
        return nil
    }
}

struct WorkspaceGroup: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let label: String
    var assets: [WorkspaceAsset]
    /// Uploads beyond the server's display cap (only the "uploads" group sends this).
    let hiddenCount: Int?
    /// Assets in this group the client could not decode (skipped rather than failing the whole index). Not sent by
    /// the server; the UI can show it so nothing disappears silently.
    var undecodableCount: Int = 0

    enum CodingKeys: String, CodingKey {
        case id
        case label
        case assets
        case hiddenCount = "hidden_count"
    }
}

extension WorkspaceGroup {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedId: String = try container.decode(String.self, forKey: .id)
        let decodedLabel: String = try container.decode(String.self, forKey: .label)
        let decodedHidden: Int? = try container.decodeIfPresent(Int.self, forKey: .hiddenCount)
        var decodedAssets: [WorkspaceAsset] = []
        var skipped: Int = 0
        var hasAssets: Bool = false
        if container.contains(.assets) {
            let isNull: Bool = try container.decodeNil(forKey: .assets)
            hasAssets = !isNull
        }
        if hasAssets {
            var list = try container.nestedUnkeyedContainer(forKey: .assets)
            while !list.isAtEnd {
                if let asset = try? list.decode(WorkspaceAsset.self) {
                    decodedAssets.append(asset)
                } else {
                    skipped += 1
                    // A failed decode does not advance the container; consume the element explicitly.
                    if (try? list.decode(SkippedJSONValue.self)) == nil {
                        break
                    }
                }
            }
        }
        self.init(id: decodedId, label: decodedLabel, assets: decodedAssets, hiddenCount: decodedHidden,
                  undecodableCount: skipped)
    }
}

/// Decodes (and discards) any JSON value.
private struct SkippedJSONValue: Decodable {
    init(from decoder: Decoder) throws {}
}

struct WorkspaceAsset: Codable, Hashable, Identifiable, Sendable {
    /// `run:<path from fabled/>`, `job:<job id>`, `gen:<generation id>` or `sample:<file>`.
    let id: String
    /// pipeline_output, frozen_run, upload, generated, generation, sample, fixture.
    let kind: String
    let name: String
    let status: AssetStatus
    let triangles: TriangleFacts?
    let createdAt: String?
    let conceptMockup: Bool?
    let testFixture: Bool?
    let folder: String?
    let open: AssetOpen?
    let validator: WorkspaceValidatorStatus?
    let provenance: Provenance?
    let pipelineStatus: String?
    let hasNote: Bool?
    let source: AssetSource?
    let engine: String?
    let licensed: Bool?
    /// true for runs whose input was the self-made procedural sample head (ui/samples/fabled_sample_head.*): such runs
    /// are named "Procedural sample head (self-made)" and are never shown as the licensed scan. Runs/fixtures only.
    let proceduralSampleRun: Bool?
    /// The asset name recorded in the manifest (may differ from `name` for the licensed sample).
    let fileAssetName: String?
    let label: String?
    let frozenLatest: Bool?
    /// The provider task, only for not-yet-imported generations (`kind == "generation"`).
    let generation: Generation?

    enum CodingKeys: String, CodingKey {
        case id, kind, name, status, triangles
        case createdAt = "created_at"
        case conceptMockup = "concept_mockup"
        case testFixture = "test_fixture"
        case folder, open, validator, provenance
        case pipelineStatus = "pipeline_status"
        case hasNote = "has_note"
        case source, engine, licensed
        case proceduralSampleRun = "procedural_sample_run"
        case fileAssetName = "file_asset_name"
        case label
        case frozenLatest = "frozen_latest"
        case generation
    }
}

enum AssetTone: String, CaseIterable, Sendable {
    case ok, warn, fail, running, neutral, mock
}

struct AssetStatus: Codable, Hashable, Sendable {
    let label: String
    /// Raw tone as sent. Use `resolvedTone` for display; unknown values map to `.neutral` (same as toneOf in JS).
    let tone: String

    var resolvedTone: AssetTone {
        return AssetTone(rawValue: tone) ?? .neutral
    }
}

struct TriangleFacts: Codable, Hashable, Sendable {
    let input: Int?
    let lodCount: Int?
    let lod0Triangles: Int?

    enum CodingKeys: String, CodingKey {
        case input
        case lodCount = "lod_count"
        case lod0Triangles = "lod0_triangles"
    }
}

/// How to open the asset: `output` (dir → POST /api/open-output), `job` (job_id → GET /api/jobs/<id>/input),
/// `sample` (url, served by the server), `generation` (task_id → GET /api/generations/<id>).
struct AssetOpen: Codable, Hashable, Sendable {
    let type: String
    let dir: String?
    let jobId: String?
    let filename: String?
    let hasManifest: Bool?
    let url: String?
    let taskId: String?

    enum CodingKeys: String, CodingKey {
        case type, dir
        case jobId = "job_id"
        case filename
        case hasManifest = "has_manifest"
        case url
        case taskId = "task_id"
    }
}

/// The stored validator report's headline (workspace.mjs `validatorStatus`). Named to avoid clashing with the
/// report model's `ValidatorSummary`.
struct WorkspaceValidatorStatus: Codable, Hashable, Sendable {
    let overall: String?
    let summary: WorkspaceValidatorCounts?
    let generatedAt: String?
    let conceptMockup: Bool?

    enum CodingKeys: String, CodingKey {
        case overall, summary
        case generatedAt = "generated_at"
        case conceptMockup = "concept_mockup"
    }
}

struct WorkspaceValidatorCounts: Codable, Hashable, Sendable {
    let pass: Int?
    let warn: Int?
    let fail: Int?
    let notChecked: Int?
    let total: Int?
    let flagged: Int?

    enum CodingKeys: String, CodingKey {
        case pass, warn, fail
        case notChecked = "not_checked"
        case total, flagged
    }
}

/// Where an AI-generated asset came from (job.json `provenance`, or built from the task for generations).
struct Provenance: Codable, Hashable, Sendable {
    let provider: String?
    let providerName: String?
    let kind: String?
    let taskId: String?
    let prompt: String?
    let imageLabel: String?
    let sourceAssetId: String?
    let conceptMockup: Bool?

    enum CodingKeys: String, CodingKey {
        case provider
        case providerName = "provider_name"
        case kind
        case taskId = "task_id"
        case prompt
        case imageLabel = "image_label"
        case sourceAssetId = "source_asset_id"
        case conceptMockup = "concept_mockup"
    }
}

struct AssetSource: Codable, Hashable, Sendable {
    let name: String?
    let license: String?
    let url: String?
}

// MARK: - /api/providers, generations

struct ProviderInfo: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let category: String
    let kinds: [String]
    let kindLabels: [String]
    /// Environment variable NAMES the server needs (never values).
    let env: [String]
    let configured: Bool
    let docs: String?
    /// verified / partial / unverified / mock.
    let verification: String
    let verificationNote: String
    let feeds: String
    let conceptMockup: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, category, kinds
        case kindLabels = "kind_labels"
        case env, configured, docs, verification
        case verificationNote = "verification_note"
        case feeds
        case conceptMockup = "concept_mockup"
    }
}

struct ProvidersResponse: Codable, Hashable, Sendable {
    let providers: [ProviderInfo]
    let generations: [Generation]
    /// Generation kind → human label, e.g. "text-to-3d" → "Text → 3D mesh".
    let kinds: [String: String]
}

struct Generation: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let provider: String
    let providerName: String
    /// text-to-3d, image-to-3d, image-to-video.
    let kind: String
    let prompt: String
    let imageLabel: String?
    let sourceAssetId: String?
    /// queued, running, succeeded, failed.
    let status: String
    /// 0-100, or null when the provider does not report it.
    let progress: Double?
    let outputs: [GenerationOutput]
    let error: String?
    /// Last poll failure (network etc.); the task itself is not failed by it.
    let pollError: String?
    let createdAt: String
    let updatedAt: String?
    let conceptMockup: Bool
    let importedJobId: String?
    let remoteId: String?

    enum CodingKeys: String, CodingKey {
        case id, provider
        case providerName = "provider_name"
        case kind, prompt
        case imageLabel = "image_label"
        case sourceAssetId = "source_asset_id"
        case status, progress, outputs, error
        case pollError = "poll_error"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case conceptMockup = "concept_mockup"
        case importedJobId = "imported_job_id"
        case remoteId = "remote_id"
    }

    var isTerminal: Bool {
        return status == "succeeded" || status == "failed"
    }

    var modelOutput: GenerationOutput? {
        return outputs.first(where: { $0.type == "model" })
    }
}

struct GenerationOutput: Codable, Hashable, Sendable {
    /// model or video.
    let type: String
    let format: String?
    /// Remote (https) output.
    let url: String?
    /// Server-local output (offline mock), relative to fabled/ui.
    let local: String?
}

/// The image sent with an image-to-3d / image-to-video request. The server forwards it to the provider and never stores it.
enum GenerationImage: Equatable, Sendable {
    case none
    /// A .png/.jpg/.webp inside that job's output folder (`{job_id, rel}`).
    case jobFile(jobId: String, rel: String)
    /// `data:image/(png|jpeg|webp);base64,...` (`{data_uri, label}`).
    case dataURI(String, label: String?)
    /// An https URL (`{url}`).
    case url(String)
}

struct GenerationImportResult: Codable, Hashable, Sendable {
    let jobId: String
    let assetId: String
    let filename: String
    let alreadyImported: Bool?

    enum CodingKeys: String, CodingKey {
        case jobId = "job_id"
        case assetId = "asset_id"
        case filename
        case alreadyImported = "already_imported"
    }
}

// MARK: - Activity, notes, open-output

struct ActivityEvent: Codable, Hashable, Identifiable, Sendable {
    let at: String
    /// uploaded, pipeline_started/finished/failed, validator_run, generation_started/succeeded/failed/imported, note.
    let type: String
    let assetId: String?
    let message: String?
    let conceptMockup: Bool?

    enum CodingKeys: String, CodingKey {
        case at, type
        case assetId = "asset_id"
        case message
        case conceptMockup = "concept_mockup"
    }

    /// Events carry no id; this composite is stable for display lists.
    var id: String {
        return at + "|" + type + "|" + (assetId ?? "") + "|" + (message ?? "")
    }
}

struct AssetNote: Codable, Hashable, Sendable {
    let text: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case text
        case updatedAt = "updated_at"
    }
}

/// POST /api/open-output: a read-only job over an existing pipeline output folder.
struct OpenOutputResult: Decodable, Equatable, Sendable {
    let jobId: String
    let assetId: String?
    let source: String?
    let outDir: String?
    let manifestPath: String?
    let exportAsset: String?
    /// The full response body (it also carries the manifest and the validator profile), for callers that need them.
    var rawResponse: Data = Data()

    enum CodingKeys: String, CodingKey {
        case jobId = "job_id"
        case assetId = "asset_id"
        case source
        case outDir = "out_dir"
        case manifestPath = "manifest_path"
        case exportAsset = "export_asset"
    }
}

// MARK: - Transport

protocol SculptLineHTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// URLSession transport. Uses dataTask + a continuation so it builds on Linux, where the async
/// `URLSession.data(for:)` is not available on every toolchain.
final class URLSessionTransport: SculptLineHTTPTransport, @unchecked Sendable {
    let session: URLSession

    init(session: URLSession = URLSession.shared) {
        self.session = session
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let session: URLSession = self.session
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>) in
            let task = session.dataTask(with: request) { (data: Data?, response: URLResponse?, error: Error?) in
                if let error = error {
                    continuation.resume(throwing: SculptLineServerError.unreachable(error.localizedDescription))
                    return
                }
                guard let http = response as? HTTPURLResponse else {
                    continuation.resume(throwing: SculptLineServerError.unreachable("no HTTP response"))
                    return
                }
                continuation.resume(returning: (data ?? Data(), http))
            }
            task.resume()
        }
    }
}

// MARK: - Client

final class SculptLineServerClient: @unchecked Sendable {
    static let defaultURLString: String = "http://127.0.0.1:5178"
    /// Environment variable read first; `legacyEnvironmentKey` (the pre-rename name) is the fallback.
    static let environmentKey: String = "SCULPTLINE_SERVER_URL"
    static let legacyEnvironmentKey: String = "FABLED_SERVER_URL"
    /// User default written by Connections; `legacyDefaultsKey` (the pre-rename key) is only read, as a fallback.
    static let defaultsKey: String = "sculptlineServerURL"
    static let legacyDefaultsKey: String = "fabledServerURL"

    let baseURL: URL
    let transport: SculptLineHTTPTransport
    let timeout: TimeInterval

    init(baseURL: URL = SculptLineServerClient.defaultBaseURL(),
         transport: SculptLineHTTPTransport = URLSessionTransport(),
         timeout: TimeInterval = 30) {
        self.baseURL = baseURL
        self.transport = transport
        self.timeout = timeout
    }

    /// `SCULPTLINE_SERVER_URL`, then `FABLED_SERVER_URL`, then the `sculptlineServerURL` user default, then the old
    /// `fabledServerURL` user default, else http://127.0.0.1:5178. Values that are not http(s) URLs with a host are
    /// ignored (and the next source is tried).
    static func defaultBaseURL(environment: [String: String] = ProcessInfo.processInfo.environment,
                               defaults: UserDefaults = .standard) -> URL {
        for key in [environmentKey, legacyEnvironmentKey] {
            if let raw = environment[key], let url = validatedServerURL(raw) {
                return url
            }
        }
        for key in [defaultsKey, legacyDefaultsKey] {
            if let raw = defaults.string(forKey: key), let url = validatedServerURL(raw) {
                return url
            }
        }
        return URL(string: defaultURLString)!
    }

    /// Returns the URL when `raw` is an http(s) URL with a host, else nil.
    static func validatedServerURL(_ raw: String) -> URL? {
        let trimmed: String = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased() else { return nil }
        guard scheme == "http" || scheme == "https" else { return nil }
        guard let host = url.host, !host.isEmpty else { return nil }
        return url
    }

    // MARK: Endpoints

    /// GET /api/status
    func status() async throws -> ServerStatus {
        let data = try await sendJSON(method: "GET", path: "/api/status")
        return try decode(ServerStatus.self, from: data)
    }

    /// GET /api/workspace
    func workspace() async throws -> WorkspaceIndex {
        let data = try await sendJSON(method: "GET", path: "/api/workspace")
        return try decode(WorkspaceIndex.self, from: data)
    }

    /// GET /api/workspace/notes?asset=<id> → the note, or nil when there is none.
    func note(assetId: String) async throws -> AssetNote? {
        let data = try await sendJSON(method: "GET", path: "/api/workspace/notes", query: [("asset", assetId)])
        return try decode(NoteEnvelope.self, from: data).note
    }

    /// PUT /api/workspace/notes?asset=<id> with `{text}`. Empty text clears the note (returns nil).
    @discardableResult
    func saveNote(assetId: String, text: String) async throws -> AssetNote? {
        let body = try encodeBody(NoteBody(text: text))
        let data = try await sendJSON(method: "PUT", path: "/api/workspace/notes", query: [("asset", assetId)], body: body)
        return try decode(NoteEnvelope.self, from: data).note
    }

    /// GET /api/activity?asset=<id>&limit=n, newest first. The server clamps limit to 1...200.
    func activity(assetId: String? = nil, limit: Int = 50) async throws -> [ActivityEvent] {
        var query: [(String, String)] = []
        if let assetId = assetId {
            query.append(("asset", assetId))
        }
        query.append(("limit", String(limit)))
        let data = try await sendJSON(method: "GET", path: "/api/activity", query: query)
        return try decode(ActivityEnvelope.self, from: data).events
    }

    /// GET /api/providers
    func providers() async throws -> ProvidersResponse {
        let data = try await sendJSON(method: "GET", path: "/api/providers")
        return try decode(ProvidersResponse.self, from: data)
    }

    /// POST /api/providers/<provider>/generations with `{kind, prompt, image?, source_asset_id?}`.
    func startGeneration(provider: String, kind: String, prompt: String, image: GenerationImage = .none,
                         sourceAssetId: String? = nil) async throws -> Generation {
        let payload = GenerationRequestBody(kind: kind, prompt: prompt, image: image, sourceAssetId: sourceAssetId)
        let body = try encodeBody(payload)
        let path = "/api/providers/" + SculptLineServerClient.percentEncode(provider) + "/generations"
        let data = try await sendJSON(method: "POST", path: path, body: body)
        return try decode(GenerationEnvelope.self, from: data).generation
    }

    /// GET /api/generations/<id>: the server polls the provider (at most every 2 s) and returns the task.
    func generation(id: String) async throws -> Generation {
        let data = try await sendJSON(method: "GET", path: "/api/generations/" + SculptLineServerClient.percentEncode(id))
        return try decode(GenerationEnvelope.self, from: data).generation
    }

    /// POST /api/generations/<id>/import: downloads the model into a new upload job. Idempotent.
    func importGeneration(id: String) async throws -> GenerationImportResult {
        let path = "/api/generations/" + SculptLineServerClient.percentEncode(id) + "/import"
        let data = try await sendJSON(method: "POST", path: path)
        return try decode(GenerationImportResult.self, from: data)
    }

    /// GET /api/jobs/<id>/input: the uploaded or imported sculpt bytes.
    func jobInput(jobId: String) async throws -> Data {
        let path = "/api/jobs/" + SculptLineServerClient.percentEncode(jobId) + "/input"
        var request = URLRequest(url: try makeURL(path: path, query: []))
        request.httpMethod = "GET"
        request.timeoutInterval = max(timeout, 300)
        let (data, _) = try await perform(request)
        return data
    }

    /// POST /api/open-output?dir=<path from fabled/>: a read-only job over an existing output folder.
    func openOutput(dir: String) async throws -> OpenOutputResult {
        let data = try await sendJSON(method: "POST", path: "/api/open-output", query: [("dir", dir)])
        var result = try decode(OpenOutputResult.self, from: data)
        result.rawResponse = data
        return result
    }

    // MARK: Request plumbing

    /// Percent-encodes everything except RFC 3986 unreserved characters (so ':' '/' '+' '&' '=' ' ' are all escaped).
    static func percentEncode(_ value: String) -> String {
        return value.addingPercentEncoding(withAllowedCharacters: unreservedCharacters) ?? value
    }

    private static let unreservedCharacters: CharacterSet = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    func makeURL(path: String, query: [(String, String)]) throws -> URL {
        var base: String = baseURL.absoluteString
        while base.hasSuffix("/") {
            base.removeLast()
        }
        var string: String = base + path
        if !query.isEmpty {
            let pairs: [String] = query.map { (pair: (String, String)) -> String in
                return SculptLineServerClient.percentEncode(pair.0) + "=" + SculptLineServerClient.percentEncode(pair.1)
            }
            string += "?" + pairs.joined(separator: "&")
        }
        guard let url = URL(string: string) else {
            throw SculptLineServerError.invalidRequest("bad URL \(string)")
        }
        return url
    }

    private func sendJSON(method: String, path: String, query: [(String, String)] = [], body: Data? = nil) async throws -> Data {
        var request = URLRequest(url: try makeURL(path: path, query: query))
        request.httpMethod = method
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, _) = try await perform(request)
        return data
    }

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let result: (Data, HTTPURLResponse)
        do {
            result = try await transport.send(request)
        } catch let error as SculptLineServerError {
            throw error
        } catch {
            throw SculptLineServerError.unreachable(error.localizedDescription)
        }
        let data: Data = result.0
        let response: HTTPURLResponse = result.1
        if response.statusCode < 200 || response.statusCode > 299 {
            let message: String = SculptLineServerClient.errorMessage(in: data) ?? "HTTP \(response.statusCode)"
            throw SculptLineServerError.http(response.statusCode, message)
        }
        return (data, response)
    }

    private func encodeBody<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        do {
            return try encoder.encode(value)
        } catch {
            throw SculptLineServerError.invalidRequest("could not encode body: \(error.localizedDescription)")
        }
    }

    /// Decodes `T`, first turning `{ok: false, error}` into `.server(error)`.
    func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder()
        if let envelope = try? decoder.decode(OKFlag.self, from: data), envelope.ok == false {
            let message: String = SculptLineServerClient.errorMessage(in: data) ?? "the server reported ok:false"
            throw SculptLineServerError.server(message)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch let error as DecodingError {
            throw SculptLineServerError.decoding(SculptLineServerClient.describe(error))
        } catch {
            throw SculptLineServerError.decoding(error.localizedDescription)
        }
    }

    /// The `error` string of a JSON error body, or a short plain-text body.
    static func errorMessage(in data: Data) -> String? {
        if let body = try? JSONDecoder().decode(ErrorField.self, from: data), let message = body.error, !message.isEmpty {
            return message
        }
        if data.count > 0, data.count <= 500, let text = String(data: data, encoding: .utf8) {
            let trimmed: String = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty && !trimmed.hasPrefix("{") {
                return trimmed
            }
        }
        return nil
    }

    static func describe(_ error: DecodingError) -> String {
        func path(_ codingPath: [CodingKey]) -> String {
            let parts: [String] = codingPath.map { (key: CodingKey) -> String in
                if let index = key.intValue { return "[\(index)]" }
                return key.stringValue
            }
            return parts.isEmpty ? "<root>" : parts.joined(separator: ".")
        }
        switch error {
        case .keyNotFound(let key, let context):
            return "missing key '\(key.stringValue)' at \(path(context.codingPath))"
        case .valueNotFound(_, let context):
            return "null value at \(path(context.codingPath))"
        case .typeMismatch(_, let context):
            return "wrong type at \(path(context.codingPath)): \(context.debugDescription)"
        case .dataCorrupted(let context):
            return "invalid JSON at \(path(context.codingPath)): \(context.debugDescription)"
        @unknown default:
            return String(describing: error)
        }
    }
}

// MARK: - Private wire types

private struct OKFlag: Decodable {
    let ok: Bool?
}

private struct ErrorField: Decodable {
    let error: String?
}

private struct NoteEnvelope: Decodable {
    let note: AssetNote?
}

private struct NoteBody: Encodable {
    let text: String
}

private struct ActivityEnvelope: Decodable {
    let events: [ActivityEvent]
}

private struct GenerationEnvelope: Decodable {
    let generation: Generation
}

private struct GenerationRequestBody: Encodable {
    let kind: String
    let prompt: String
    let image: GenerationImage
    let sourceAssetId: String?

    enum CodingKeys: String, CodingKey {
        case kind
        case prompt
        case image
        case sourceAssetId = "source_asset_id"
    }

    enum ImageKeys: String, CodingKey {
        case jobId = "job_id"
        case rel
        case dataURI = "data_uri"
        case label
        case url
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(prompt, forKey: .prompt)
        if let sourceAssetId = sourceAssetId {
            try container.encode(sourceAssetId, forKey: .sourceAssetId)
        }
        switch image {
        case .none:
            break
        case .jobFile(let jobId, let rel):
            var nested = container.nestedContainer(keyedBy: ImageKeys.self, forKey: .image)
            try nested.encode(jobId, forKey: .jobId)
            try nested.encode(rel, forKey: .rel)
        case .dataURI(let uri, let label):
            var nested = container.nestedContainer(keyedBy: ImageKeys.self, forKey: .image)
            try nested.encode(uri, forKey: .dataURI)
            if let label = label {
                try nested.encode(label, forKey: .label)
            }
        case .url(let url):
            var nested = container.nestedContainer(keyedBy: ImageKeys.self, forKey: .image)
            try nested.encode(url, forKey: .url)
        }
    }
}
