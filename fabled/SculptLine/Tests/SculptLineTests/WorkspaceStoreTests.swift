import XCTest
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import SculptLine

/// Captured server responses in Tests/SculptLineTests/Fixtures.
enum WorkspaceFixtures {
    static func data(_ name: String) throws -> Data {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
            throw SculptLineServerError.decoding("missing fixture \(name).json in Bundle.module/Fixtures")
        }
        return try Data(contentsOf: url)
    }

    static func workspaceIndex() throws -> WorkspaceIndex {
        return try JSONDecoder().decode(WorkspaceIndex.self, from: data("workspace"))
    }
}

/// Answers by "METHOD /path" and records every request. No network. Unknown routes get a 404 JSON error.
final class WorkspaceRouteTransport: SculptLineHTTPTransport, @unchecked Sendable {
    typealias Handler = (URLRequest) -> (Int, Data)

    private let lock = NSLock()
    private var routes: [String: Handler] = [:]
    private var recorded: [URLRequest] = []
    private var unreachableFlag: Bool = false

    var unreachable: Bool {
        get {
            lock.lock()
            defer { lock.unlock() }
            return unreachableFlag
        }
        set {
            lock.lock()
            unreachableFlag = newValue
            lock.unlock()
        }
    }

    func route(_ method: String, _ path: String, handler: @escaping Handler) {
        lock.lock()
        routes[method + " " + path] = handler
        lock.unlock()
    }

    func route(_ method: String, _ path: String, status: Int = 200, data: Data) {
        route(method, path) { _ in (status, data) }
    }

    func route(_ method: String, _ path: String, fixture: String) throws {
        route(method, path, data: try WorkspaceFixtures.data(fixture))
    }

    var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func requests(_ method: String, _ path: String) -> [URLRequest] {
        return requests.filter { ($0.httpMethod ?? "GET") == method && $0.url?.path == path }
    }

    static func queryValue(_ request: URLRequest, _ name: String) -> String? {
        guard let url = request.url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        return components.queryItems?.first(where: { $0.name == name })?.value
    }

    static func bodyText(_ request: URLRequest) -> String? {
        guard let body = request.httpBody,
              let json = (try? JSONSerialization.jsonObject(with: body, options: [])) as? [String: Any] else {
            return nil
        }
        return json["text"] as? String
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.lock()
        recorded.append(request)
        let key: String = (request.httpMethod ?? "GET") + " " + (request.url?.path ?? "")
        let handler: Handler? = routes[key]
        let down: Bool = unreachableFlag
        lock.unlock()
        if down {
            throw SculptLineServerError.unreachable("Could not connect to the server.")
        }
        let reply: (Int, Data) = handler?(request) ?? (404, Data("{\"ok\":false,\"error\":\"no route\"}".utf8))
        let url: URL = request.url ?? URL(fileURLWithPath: "/")
        guard let response = HTTPURLResponse(url: url, statusCode: reply.0, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": "application/json"]) else {
            throw SculptLineServerError.unreachable("could not build a response")
        }
        return (reply.1, response)
    }
}

@MainActor
final class WorkspaceStoreTests: XCTestCase {

    private func makeStore(_ transport: WorkspaceRouteTransport, noteDebounce: TimeInterval = 0.02,
                           pollInterval: TimeInterval = 0.02) -> WorkspaceStore {
        let base: URL = SculptLineServerClient.validatedServerURL("http://127.0.0.1:5178") ?? URL(fileURLWithPath: "/")
        let client = SculptLineServerClient(baseURL: base, transport: transport, timeout: 5)
        return WorkspaceStore(client: client, noteDebounce: noteDebounce, pollInterval: pollInterval)
    }

    /// status + workspace + providers + activity + notes (note_saved for every asset).
    private func makeServer() throws -> WorkspaceRouteTransport {
        let transport = WorkspaceRouteTransport()
        try transport.route("GET", "/api/status", fixture: "status")
        try transport.route("GET", "/api/workspace", fixture: "workspace")
        try transport.route("GET", "/api/providers", fixture: "providers")
        try transport.route("GET", "/api/activity", fixture: "activity")
        try transport.route("GET", "/api/workspace/notes", fixture: "note_saved")
        try transport.route("PUT", "/api/workspace/notes", fixture: "note_saved")
        return transport
    }

    // MARK: Refresh

    func testRefreshConnectsAndLoadsGroups() async throws {
        let transport = try makeServer()
        let store = makeStore(transport)
        XCTAssertEqual(store.connection, .unknown)

        await store.refresh()

        XCTAssertEqual(store.connection, .connected)
        XCTAssertNil(store.lastError)
        XCTAssertEqual(store.index?.total, 318)
        XCTAssertEqual(store.filteredGroups.map { $0.id }, ["runs", "uploads", "generated", "samples"])
        XCTAssertEqual(store.filteredGroups.first(where: { $0.id == "uploads" })?.hiddenCount, 289)
        XCTAssertEqual(store.serverStatus?.pipeline.available, true)
        XCTAssertEqual(store.providers.count, 5)
        XCTAssertEqual(store.kindLabel(forGenerationKind: "text-to-3d"), "Text → 3D mesh")
        // Generations from /api/providers, newest first; all terminal, so no polling loop.
        XCTAssertEqual(store.generations.first?.id, "gen-mw4klgsa-98262b")
        XCTAssertNil(store.pollTask)
        // Nothing selected: the page shows recent workspace activity.
        XCTAssertFalse(store.activity.isEmpty)
        // The live tree never contains the old hardcoded demo assets.
        let names: [String] = store.filteredGroups.flatMap { $0.assets.map { $0.name } }
        XCTAssertFalse(names.contains("Paladin Shield"))
        XCTAssertFalse(names.contains("Dungeon Pillar"))
    }

    func testUnreachableTransportMarksConnectionUnreachable() async throws {
        let transport = try makeServer()
        transport.unreachable = true
        let store = makeStore(transport)

        await store.refresh()

        guard case .unreachable(let message) = store.connection else {
            return XCTFail("expected .unreachable, got \(store.connection)")
        }
        XCTAssertFalse(message.isEmpty)
        XCTAssertNotNil(store.unreachableMessage)
        XCTAssertNil(store.index)
        XCTAssertFalse(store.isConnected)
        XCTAssertTrue(store.lastError?.contains("127.0.0.1:5178") ?? false)
        // Only the status call was attempted.
        XCTAssertEqual(transport.requests.count, 1)

        // The server comes up: the next refresh connects.
        transport.unreachable = false
        await store.refresh()
        XCTAssertEqual(store.connection, .connected)
        XCTAssertNotNil(store.index)
    }

    func testNon2xxStatusStillConnectsWithError() async throws {
        let transport = try makeServer()
        transport.route("GET", "/api/status", status: 500, data: Data("{\"ok\":false,\"error\":\"boom\"}".utf8))
        let store = makeStore(transport)

        await store.refresh()

        XCTAssertEqual(store.connection, .connected)
        XCTAssertNotNil(store.index)
        XCTAssertTrue(store.lastError?.contains("boom") ?? false)
    }

    // MARK: Filtering

    func testFilteredGroupsWithQuery() async throws {
        let store = makeStore(try makeServer())
        await store.refresh()

        store.query = "potion"
        XCTAssertEqual(store.filteredTotal, 2)
        XCTAssertEqual(store.filteredGroups.count, 4, "groups are kept even when empty")
        XCTAssertEqual(store.filteredGroups.first(where: { $0.id == "generated" })?.assets.count, 2)
        XCTAssertTrue(store.hasQuery)

        store.query = "knight helmet"
        XCTAssertEqual(store.filteredTotal, 1)
        XCTAssertEqual(store.filteredGroups.flatMap { $0.assets }.first?.id, "job:mw4klhmf-99a645cb")

        store.query = "  "
        XCTAssertFalse(store.hasQuery)
        XCTAssertEqual(store.filteredTotal, 11)
    }

    // MARK: Selection, notes, activity

    func testSelectLoadsNoteAndActivity() async throws {
        let transport = try makeServer()
        let store = makeStore(transport)
        await store.refresh()

        await store.selectAndWait("run:pipeline/output")

        XCTAssertEqual(store.selectedAssetId, "run:pipeline/output")
        XCTAssertEqual(store.selectedAsset?.name, "Procedural sample head (self-made)")
        XCTAssertEqual(store.noteText, "Hand off to UE import after scale sign-off.")
        XCTAssertTrue(store.noteStatus.hasPrefix("saved"))
        XCTAssertTrue(store.noteEditable)
        let noteRequests = transport.requests("GET", "/api/workspace/notes")
        XCTAssertEqual(noteRequests.count, 1)
        XCTAssertEqual(noteRequests.first.flatMap { WorkspaceRouteTransport.queryValue($0, "asset") }, "run:pipeline/output")
        XCTAssertFalse(store.activity.isEmpty)
        // Page properties: the stored report is labelled "Saved report", not presented as a live check.
        let properties = store.pageProperties(for: try XCTUnwrap(store.selectedAsset))
        let saved = properties.first(where: { $0.key == "Saved report" })
        XCTAssertEqual(saved?.value, "WARN · 10 pass / 3 warn / 0 fail / 3 not checked")
        XCTAssertEqual(properties.first(where: { $0.key == "LOD0 tris" })?.value, "18,636 · 4 LODs")
        XCTAssertEqual(properties.first(where: { $0.key == "Input tris" })?.value, "327,680")
    }

    func testEmptyNoteLoadsAsEmptyText() async throws {
        let transport = try makeServer()
        try transport.route("GET", "/api/workspace/notes", fixture: "note_empty")
        let store = makeStore(transport)
        await store.refresh()

        await store.selectAndWait("sample:fabled_sample_head.glb")

        XCTAssertEqual(store.noteText, "")
        XCTAssertEqual(store.noteStatus, "")
        XCTAssertTrue(store.noteEditable)
    }

    func testActivityMergesGenerationEventsNewestFirst() async throws {
        let transport = try makeServer()
        let store = makeStore(transport)
        await store.refresh()

        await store.selectAndWait("job:mw4klhmf-99a645cb")

        let assets: [String?] = transport.requests("GET", "/api/activity").map { WorkspaceRouteTransport.queryValue($0, "asset") }
        XCTAssertTrue(assets.contains("job:mw4klhmf-99a645cb"))
        XCTAssertTrue(assets.contains("gen:gen-mw4klgsa-98262b"), "the generation task's events are merged in")
        // The fixture answers both calls with the same 6 events: de-duplicated, newest first.
        XCTAssertEqual(store.activity.count, 6)
        let stamps: [String] = store.activity.map { $0.at }
        XCTAssertEqual(stamps, stamps.sorted(by: >))
    }

    func testNoteSaveIsDebounced() async throws {
        let transport = try makeServer()
        let store = makeStore(transport, noteDebounce: 0.05)
        await store.refresh()
        await store.selectAndWait("run:pipeline/output")

        store.editNote("first draft")
        let firstTask = store.noteSaveTask
        store.editNote("first draft, revised")
        XCTAssertEqual(store.noteStatus, "editing…")
        XCTAssertEqual(store.noteText, "first draft, revised")
        await firstTask?.value
        await store.noteSaveTask?.value

        let puts = transport.requests("PUT", "/api/workspace/notes")
        XCTAssertEqual(puts.count, 1, "two quick edits produce one save")
        XCTAssertEqual(puts.first.flatMap { WorkspaceRouteTransport.bodyText($0) }, "first draft, revised")
        XCTAssertEqual(puts.first.flatMap { WorkspaceRouteTransport.queryValue($0, "asset") }, "run:pipeline/output")
        XCTAssertEqual(store.noteStatus, "saved")
    }

    func testNoteIsNeverWrittenToANewlySelectedAsset() async throws {
        let transport = try makeServer()
        let saved: Data = try WorkspaceFixtures.data("note_saved")
        let empty: Data = try WorkspaceFixtures.data("note_empty")
        transport.route("GET", "/api/workspace/notes") { request in
            let asset: String? = WorkspaceRouteTransport.queryValue(request, "asset")
            return (200, asset == "run:pipeline/output" ? saved : empty)
        }
        let store = makeStore(transport, noteDebounce: 0.05)
        await store.refresh()
        await store.selectAndWait("run:pipeline/output")

        store.editNote("note for the run")
        let pendingSave = store.noteSaveTask
        await store.selectAndWait("sample:fabled_sample_head.glb")
        await pendingSave?.value
        await store.noteFlushTask?.value

        let puts = transport.requests("PUT", "/api/workspace/notes")
        let targets: [String?] = puts.map { WorkspaceRouteTransport.queryValue($0, "asset") }
        XCTAssertFalse(targets.contains("sample:fabled_sample_head.glb"), "nothing is written to the new selection")
        // The unsaved edit went to the asset it was typed for, exactly once.
        XCTAssertEqual(targets, ["run:pipeline/output"])
        XCTAssertEqual(puts.first.flatMap { WorkspaceRouteTransport.bodyText($0) }, "note for the run")
        XCTAssertEqual(store.selectedAssetId, "sample:fabled_sample_head.glb")
        XCTAssertEqual(store.noteText, "", "the new page shows its own (empty) note")
        XCTAssertEqual(store.noteStatus, "", "the old asset's save status does not leak onto the new page")
    }

    func testEditsBeforeTheNoteLoadsAreIgnored() async throws {
        let transport = try makeServer()
        transport.route("GET", "/api/workspace/notes", status: 500, data: Data("{\"ok\":false,\"error\":\"disk\"}".utf8))
        let store = makeStore(transport)
        await store.refresh()
        await store.selectAndWait("run:pipeline/output")

        XCTAssertFalse(store.noteEditable)
        XCTAssertTrue(store.noteStatus.hasPrefix("notes unavailable"))
        store.editNote("typed while unavailable")
        XCTAssertNil(store.noteSaveTask)
        XCTAssertTrue(transport.requests("PUT", "/api/workspace/notes").isEmpty)
    }

    // MARK: Generations

    func testPollingMarksGenerationSucceededAndRefreshesIndex() async throws {
        let transport = try makeServer()
        try transport.route("POST", "/api/providers/mock/generations", fixture: "generation_created")
        try transport.route("GET", "/api/generations/gen-mw4klgsa-98262b", fixture: "generation_succeeded")
        let store = makeStore(transport, pollInterval: 0.2)
        let indexFetchesBefore: Int = transport.requests("GET", "/api/workspace").count

        let started = await store.startGeneration(provider: "mock", kind: "text-to-3d", prompt: "knight helmet")
        XCTAssertEqual(started?.status, "queued")
        XCTAssertEqual(store.generateMessage, "Started. It appears under AI generations in the tree.")

        let loop = try XCTUnwrap(store.pollTask, "a queued generation starts the polling loop")
        let finished = expectation(description: "polling loop ends")
        Task { @MainActor in
            await loop.value
            finished.fulfill()
        }
        await fulfillment(of: [finished], timeout: 5)
        store.stopPolling()

        XCTAssertEqual(store.generations.first(where: { $0.id == "gen-mw4klgsa-98262b" })?.status, "succeeded")
        XCTAssertEqual(store.activeGenerationCount, 0)
        XCTAssertNil(store.pollTask, "the loop clears itself once nothing is active")
        XCTAssertGreaterThanOrEqual(transport.requests("GET", "/api/workspace").count, indexFetchesBefore + 2,
                                    "one index refresh after starting, one after the status change")
        XCTAssertEqual(store.generations.first?.modelOutput?.local, "samples/mock_generations/knight_helmet.glb")
    }

    func testPollOnceKeepsActiveGenerationOnError() async throws {
        let transport = try makeServer()
        try transport.route("POST", "/api/providers/mock/generations", fixture: "generation_created")
        let store = makeStore(transport, pollInterval: 60)
        _ = await store.startGeneration(provider: "mock", kind: "text-to-3d", prompt: "knight helmet")
        store.stopPolling()

        let stillActive: Bool = await store.pollOnce()

        XCTAssertTrue(stillActive)
        XCTAssertEqual(store.generations.first?.status, "queued")
    }

    func testStartGenerationFailureIsReported() async throws {
        let transport = try makeServer()
        transport.route("POST", "/api/providers/meshy/generations", status: 400,
                        data: Data("{\"ok\":false,\"error\":\"MESHY_API_KEY is not set\"}".utf8))
        let store = makeStore(transport)

        let started = await store.startGeneration(provider: "meshy", kind: "text-to-3d", prompt: "x")

        XCTAssertNil(started)
        XCTAssertTrue(store.generateMessage.hasPrefix("Not started:"))
        XCTAssertTrue(store.generateMessage.contains("MESHY_API_KEY"))
    }

    func testImportGenerationAndJobInputFile() async throws {
        let transport = try makeServer()
        try transport.route("POST", "/api/generations/gen-mw4klgsa-98262b/import", fixture: "generation_imported")
        let meshBytes = Data("glTF-bytes-for-test".utf8)
        transport.route("GET", "/api/jobs/mw4klhmf-99a645cb/input", data: meshBytes)
        let store = makeStore(transport)
        await store.refresh()

        let result = await store.importGeneration(id: "gen-mw4klgsa-98262b")

        XCTAssertEqual(result?.jobId, "mw4klhmf-99a645cb")
        XCTAssertEqual(result?.assetId, "job:mw4klhmf-99a645cb")
        XCTAssertEqual(result?.filename, "mock_knight_helmet_98262b.glb")
        XCTAssertTrue(store.importingGenerationIds.isEmpty)
        if let generation = store.generations.first(where: { $0.id == "gen-mw4klgsa-98262b" }) {
            XCTAssertEqual(store.importedJobId(for: generation), "mw4klhmf-99a645cb")
        }

        let file = try await store.jobInputFile(jobId: "mw4klhmf-99a645cb", filename: "mock_knight_helmet_98262b.glb")
        XCTAssertEqual(file.lastPathComponent, "mock_knight_helmet_98262b.glb")
        XCTAssertEqual(file.pathExtension, "glb")
        XCTAssertEqual(try Data(contentsOf: file), meshBytes)
    }

    func testImportFailureIsReportedOnTheCard() async throws {
        let transport = try makeServer()
        transport.route("POST", "/api/generations/gen-x/import", status: 409,
                        data: Data("{\"ok\":false,\"error\":\"generation has no model output\"}".utf8))
        let store = makeStore(transport)

        let result = await store.importGeneration(id: "gen-x")

        XCTAssertNil(result)
        XCTAssertTrue(store.importErrors["gen-x"]?.contains("no model output") ?? false)
        XCTAssertTrue(store.importingGenerationIds.isEmpty)
    }

    // MARK: Files and URLs

    func testSampleFileDownloadsFromServerPath() async throws {
        let transport = try makeServer()
        let bytes = Data("o sample\n".utf8)
        transport.route("GET", "/samples/fabled_sample_head.obj", data: bytes)
        let store = makeStore(transport)

        let file = try await store.sampleFile(urlPath: "/samples/fabled_sample_head.obj", filename: "fabled_sample_head.obj")

        XCTAssertEqual(file.lastPathComponent, "fabled_sample_head.obj")
        XCTAssertEqual(try Data(contentsOf: file), bytes)

        do {
            _ = try await store.sampleFile(urlPath: nil, filename: "missing.glb")
            XCTFail("a 404 must throw")
        } catch let error as SculptLineServerError {
            if case .http(let status, _) = error {
                XCTAssertEqual(status, 404)
            } else {
                XCTFail("expected .http, got \(error)")
            }
        }
    }

    func testSafeFileNameStripsPaths() {
        XCTAssertEqual(WorkspaceStore.safeFileName("../../etc/passwd", fallback: "x"), "passwd")
        XCTAssertEqual(WorkspaceStore.safeFileName(".hidden.glb", fallback: "x"), "hidden.glb")
        XCTAssertEqual(WorkspaceStore.safeFileName("", fallback: "input.bin"), "input.bin")
        XCTAssertEqual(WorkspaceStore.safeFileName("my sculpt.obj", fallback: "x"), "my sculpt.obj")
    }

    func testOutputURLForLocalAndRemoteOutputs() throws {
        let store = makeStore(WorkspaceRouteTransport())
        let local = GenerationOutput(type: "video", format: "mp4", url: nil, local: "samples/mock_generations/clip one.mp4")
        XCTAssertEqual(store.outputURL(local)?.absoluteString, "http://127.0.0.1:5178/samples/mock_generations/clip%20one.mp4")
        let remote = GenerationOutput(type: "video", format: "mp4", url: "https://cdn.example.com/v.mp4", local: nil)
        XCTAssertEqual(store.outputURL(remote)?.absoluteString, "https://cdn.example.com/v.mp4")
        let hostile = GenerationOutput(type: "video", format: nil, url: "javascript:alert(1)", local: "../secret")
        XCTAssertNil(store.outputURL(hostile))
    }

    func testSetServerURLRejectsInvalidAndRebuildsClient() async throws {
        let transport = try makeServer()
        let store = makeStore(transport)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "WorkspaceStoreTests-\(UUID().uuidString)"))

        let rejected: Bool = await store.setServerURL("ftp://nope", defaults: defaults)
        XCTAssertFalse(rejected)
        XCTAssertEqual(store.serverURLString, "http://127.0.0.1:5178")
        XCTAssertNil(defaults.string(forKey: SculptLineServerClient.defaultsKey))

        let accepted: Bool = await store.setServerURL("http://192.168.1.20:5178", defaults: defaults)
        XCTAssertTrue(accepted)
        XCTAssertEqual(store.serverURLString, "http://192.168.1.20:5178")
        XCTAssertEqual(defaults.string(forKey: SculptLineServerClient.defaultsKey), "http://192.168.1.20:5178")
        XCTAssertEqual(SculptLineServerClient.defaultsKey, "sculptlineServerURL", "writes go to the new key")
        XCTAssertNil(defaults.string(forKey: SculptLineServerClient.legacyDefaultsKey), "the old key is never written")
        XCTAssertEqual(store.connection, .connected, "the rebuilt client keeps the transport and refreshes")
        XCTAssertEqual(transport.requests.last?.url?.host, "192.168.1.20")
    }
}
