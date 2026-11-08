import XCTest
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import SculptLine

/// Records every request and answers from a queue of canned responses. No network.
final class RecordingTransport: SculptLineHTTPTransport, @unchecked Sendable {
    struct Canned {
        let status: Int
        let body: Data
    }

    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    private var _responses: [Canned] = []
    var failure: Error?

    init(responses: [Canned] = []) {
        self._responses = responses
    }

    var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return _requests
    }

    var lastRequest: URLRequest? {
        return requests.last
    }

    func enqueue(status: Int = 200, body: Data) {
        lock.lock()
        _responses.append(Canned(status: status, body: body))
        lock.unlock()
    }

    func enqueue(status: Int = 200, json: String) {
        enqueue(status: status, body: Data(json.utf8))
    }

    /// Synchronous so the lock is never taken directly in an async context (NSLock.lock is `noasync` in newer SDKs).
    private func record(_ request: URLRequest) -> (Canned?, Error?) {
        lock.lock()
        defer { lock.unlock() }
        _requests.append(request)
        let canned: Canned? = _responses.isEmpty ? nil : _responses.removeFirst()
        return (canned, failure)
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (canned, failure) = record(request)
        if let failure = failure {
            throw failure
        }
        let reply: Canned = canned ?? Canned(status: 200, body: Data("{\"ok\":true}".utf8))
        let url: URL = request.url ?? URL(string: "http://127.0.0.1:5178")!
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        return (reply.body, response)
    }
}

final class SculptLineServerClientTests: XCTestCase {

    // MARK: Helpers

    private func fixtureData(_ name: String) throws -> Data {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
            XCTFail("missing fixture \(name).json in Bundle.module/Fixtures")
            throw SculptLineServerError.decoding("missing fixture \(name)")
        }
        return try Data(contentsOf: url)
    }

    private func makeClient(_ transport: RecordingTransport) -> SculptLineServerClient {
        return SculptLineServerClient(baseURL: URL(string: "http://127.0.0.1:5178")!, transport: transport)
    }

    private func bodyJSON(_ request: URLRequest?) -> [String: Any]? {
        guard let data = request?.httpBody else { return nil }
        return (try? JSONSerialization.jsonObject(with: data, options: [])) as? [String: Any]
    }

    private func loadWorkspace() throws -> WorkspaceIndex {
        return try JSONDecoder().decode(WorkspaceIndex.self, from: try fixtureData("workspace"))
    }

    private func ids(_ result: (groups: [WorkspaceGroup], total: Int)) -> [String] {
        return result.groups.flatMap { (group: WorkspaceGroup) -> [String] in group.assets.map { $0.id } }
    }

    // MARK: Fixture decoding

    func testDecodesWorkspaceFixture() throws {
        let ws = try loadWorkspace()
        XCTAssertEqual(ws.schema, "fabled.workspace/0.1")
        XCTAssertNotNil(ws.generatedAt)
        XCTAssertEqual(ws.groups.map { $0.id }, ["runs", "uploads", "generated", "samples"])
        XCTAssertEqual(ws.groups.map { $0.label }, ["Pipeline runs", "Uploads", "AI generations", "Samples & fixtures"])
        XCTAssertEqual(ws.groups.map { $0.assets.count }, [2, 3, 3, 3])
        XCTAssertEqual(ws.groups.map { $0.undecodableCount }, [0, 0, 0, 0], "every fixture asset must decode")
        // Only the uploads group carries hidden_count; `total` counts shown + hidden assets (workspace.mjs).
        XCTAssertNil(ws.groups[0].hiddenCount)
        XCTAssertNotNil(ws.groups[1].hiddenCount)
        XCTAssertEqual(ws.total, ws.groups.reduce(0) { (n: Int, g: WorkspaceGroup) -> Int in n + g.assets.count + (g.hiddenCount ?? 0) })

        // The latest pipeline output was run on the procedural sample head: never shown as the licensed scan.
        let run = ws.groups[0].assets[0]
        XCTAssertEqual(run.id, "run:pipeline/output")
        XCTAssertEqual(run.kind, "pipeline_output")
        XCTAssertEqual(run.name, "Procedural sample head (self-made)")
        XCTAssertEqual(run.proceduralSampleRun, true)
        XCTAssertEqual(run.licensed, false)
        XCTAssertEqual(run.source?.name, "ui/samples/fabled_sample_head.glb (procedural, tools/make_sample_sculpt.py)")
        XCTAssertEqual(run.source?.license, "no restrictions")
        XCTAssertNil(run.source?.url)
        XCTAssertEqual(run.status, AssetStatus(label: "Validator WARN", tone: "warn"))
        XCTAssertEqual(run.status.resolvedTone, .warn)
        XCTAssertEqual(run.triangles, TriangleFacts(input: 327680, lodCount: 4, lod0Triangles: 18636))
        XCTAssertEqual(run.validator?.overall, "warn")
        XCTAssertEqual(run.validator?.summary?.notChecked, 3)
        XCTAssertEqual(run.open?.type, "output")
        XCTAssertEqual(run.open?.dir, "pipeline/output")
        XCTAssertEqual(run.hasNote, true)
        XCTAssertEqual(run.createdAt, "2026-11-03T20:44:03-08:00")
        XCTAssertEqual(run.label, "Latest pipeline output")

        let frozen = ws.groups[0].assets[1]
        XCTAssertEqual(frozen.id, "run:pipeline/runs/20261103-195336")
        XCTAssertEqual(frozen.kind, "frozen_run")
        XCTAssertEqual(frozen.proceduralSampleRun, true)
        XCTAssertEqual(frozen.licensed, false)
        XCTAssertEqual(frozen.frozenLatest, true)

        for upload in ws.groups[1].assets {
            XCTAssertEqual(upload.kind, "upload")
            XCTAssertTrue(upload.id.hasPrefix("job:"))
            XCTAssertEqual(upload.open?.type, "job")
            XCTAssertEqual(upload.open?.jobId, String(upload.id.dropFirst("job:".count)))
            XCTAssertEqual(upload.open?.hasManifest, false)
            XCTAssertNil(upload.validator)
            XCTAssertNil(upload.provenance)
            XCTAssertNil(upload.proceduralSampleRun)
            XCTAssertEqual(upload.triangles, TriangleFacts(input: nil, lodCount: nil, lod0Triangles: nil))
        }

        let generated = ws.groups[2].assets
        XCTAssertEqual(generated.map { $0.kind }, ["generated", "generated", "generated"])
        XCTAssertEqual(generated.map { $0.conceptMockup }, [true, true, true])
        XCTAssertEqual(generated.map { $0.provenance?.providerName }, ["Offline mock", "Offline mock", "Offline mock"])
        let helmet = try XCTUnwrap(generated.first(where: { $0.provenance?.prompt == "knight helmet" }))
        XCTAssertEqual(helmet.id, "job:mw4klhmf-99a645cb")
        XCTAssertEqual(helmet.provenance?.taskId, "gen-mw4klgsa-98262b")
        let flask = try XCTUnwrap(ws.asset(id: "job:mw4kia2y-4536ccfe"))
        XCTAssertEqual(flask.name, "mock_potion_flask_653cde.glb")
        XCTAssertEqual(flask.status.resolvedTone, .fail)
        XCTAssertEqual(flask.provenance?.sourceAssetId, "job:mw4khpff-1153dbec")

        let sample = ws.groups[3].assets[0]
        XCTAssertEqual(sample.id, "sample:fabled_sample_head.glb")
        XCTAssertEqual(sample.kind, "sample")
        XCTAssertEqual(sample.open?.type, "sample")
        XCTAssertEqual(sample.open?.url, "/samples/fabled_sample_head.glb")
        XCTAssertNil(sample.validator)

        // The TEST FIXTURE run really is the licensed scan, so it keeps the licensed short name.
        let fixture = try XCTUnwrap(ws.asset(id: "run:ui/test_fixtures/pipeline_output_FIXTURE"))
        XCTAssertEqual(fixture.kind, "fixture")
        XCTAssertEqual(fixture.name, "Historical bust scan (CC0)")
        XCTAssertEqual(fixture.proceduralSampleRun, false)
        XCTAssertEqual(fixture.licensed, true)
        XCTAssertEqual(fixture.source?.name, "Historical bust scan (CC0)")
        XCTAssertEqual(fixture.status.resolvedTone, .mock)
        XCTAssertEqual(fixture.testFixture, true)
        XCTAssertEqual(fixture.conceptMockup, true)

        XCTAssertNil(ws.asset(id: "job:nope"))
    }

    func testUnknownToneResolvesToNeutral() {
        XCTAssertEqual(AssetStatus(label: "x", tone: "sparkly").resolvedTone, .neutral)
        XCTAssertEqual(AssetStatus(label: "x", tone: "running").resolvedTone, .running)
    }

    func testUndecodableAssetIsSkippedNotFatal() throws {
        let json = """
        {"schema":"fabled.workspace/0.1","generated_at":null,"total":2,"groups":[{"id":"runs","label":"Pipeline runs",
        "assets":[{"id":"run:a","kind":"pipeline_output","name":"A","status":{"label":"Uploaded","tone":"neutral"}},
                  {"id":"run:b","kind":"pipeline_output"}]}]}
        """
        let ws = try JSONDecoder().decode(WorkspaceIndex.self, from: Data(json.utf8))
        XCTAssertEqual(ws.groups[0].assets.map { $0.id }, ["run:a"])
        XCTAssertEqual(ws.groups[0].undecodableCount, 1)
    }

    /// Shape of a not-yet-imported generation asset (workspace.mjs `generationAsset`): no triangles/folder/validator,
    /// provenance without concept_mockup, the provider task under `generation`.
    func testDecodesPendingGenerationAsset() throws {
        let json = """
        {"id":"gen:gen-mw4klgsa-98262b","kind":"generation","name":"knight helmet",
         "status":{"label":"Generating 40%","tone":"running"},"created_at":"2026-11-06T06:05:03.418Z","concept_mockup":true,
         "open":{"type":"generation","task_id":"gen-mw4klgsa-98262b"},
         "provenance":{"provider":"mock","provider_name":"Offline mock","kind":"text-to-3d","task_id":"gen-mw4klgsa-98262b",
                       "prompt":"knight helmet","image_label":null,"source_asset_id":null},
         "generation":{"id":"gen-mw4klgsa-98262b","provider":"mock","provider_name":"Offline mock","kind":"text-to-3d",
                       "prompt":"knight helmet","image_label":null,"source_asset_id":null,"status":"running","progress":40.5,
                       "outputs":[],"error":null,"created_at":"2026-11-06T06:05:03.418Z","updated_at":"2026-11-06T06:05:03.900Z",
                       "concept_mockup":true,"imported_job_id":null,"remote_id":"mock-mw4klgsa"},
         "has_note":false}
        """
        let asset = try JSONDecoder().decode(WorkspaceAsset.self, from: Data(json.utf8))
        XCTAssertEqual(asset.status.resolvedTone, .running)
        XCTAssertNil(asset.triangles)
        XCTAssertNil(asset.folder)
        XCTAssertNil(asset.provenance?.conceptMockup)
        XCTAssertEqual(asset.open?.taskId, "gen-mw4klgsa-98262b")
        XCTAssertEqual(asset.generation?.progress, 40.5)
        XCTAssertNil(asset.generation?.pollError)
        XCTAssertNil(WorkspaceModel.trisLabel(asset))
        XCTAssertEqual(WorkspaceModel.sfSymbol(forKind: asset.kind), "wand.and.stars")
    }

    func testDecodesProvidersFixture() throws {
        let response = try JSONDecoder().decode(ProvidersResponse.self, from: try fixtureData("providers"))
        XCTAssertEqual(response.providers.map { $0.id }, ["meshy", "tripo", "higgsfield", "runway", "mock"])
        XCTAssertEqual(response.kinds["text-to-3d"], "Text \u{2192} 3D mesh")
        let mock = response.providers[4]
        XCTAssertTrue(mock.configured)
        XCTAssertTrue(mock.conceptMockup)
        XCTAssertNil(mock.docs)
        XCTAssertEqual(mock.env, [])
        XCTAssertEqual(response.providers[0].env, ["MESHY_API_KEY"])
        XCTAssertEqual(response.providers[0].kindLabels, ["Text \u{2192} 3D mesh", "Image \u{2192} 3D mesh"])
        XCTAssertEqual(response.providers[0].verification, "partial")
        XCTAssertEqual(response.generations.count, 3)
        XCTAssertEqual(response.generations[0].importedJobId, "mw4klhmf-99a645cb")
        XCTAssertEqual(response.generations[1].sourceAssetId, "job:mw4khpff-1153dbec")
        XCTAssertEqual(response.generations[0].modelOutput?.local, "samples/mock_generations/knight_helmet.glb")
    }

    func testDecodesStatusFixture() throws {
        let status = try JSONDecoder().decode(ServerStatus.self, from: try fixtureData("status"))
        XCTAssertTrue(status.pipeline.available)
        XCTAssertNil(status.pipeline.blenderPath)
        XCTAssertEqual(status.pipeline.engines, EngineAvailability(blender: false, native: true))
        XCTAssertEqual(status.pipeline.frozenRun, "pipeline/runs/20261103-195336")
        XCTAssertEqual(status.pipeline.supportsValidatorProfile, true)
        XCTAssertTrue(status.validator.available)
        XCTAssertEqual(status.validator.supportsManifest, true)
    }

    func testClientDecodesEveryFixtureThroughItsEndpoint() async throws {
        let transport = RecordingTransport()
        let client = makeClient(transport)

        transport.enqueue(body: try fixtureData("status"))
        let status = try await client.status()
        XCTAssertTrue(status.pipeline.available)

        transport.enqueue(body: try fixtureData("workspace"))
        let ws = try await client.workspace()
        XCTAssertEqual(ws.groups.map { $0.id }, ["runs", "uploads", "generated", "samples"])
        XCTAssertEqual(ws.asset(id: "run:pipeline/output")?.proceduralSampleRun, true)

        transport.enqueue(body: try fixtureData("activity"))
        let events = try await client.activity(assetId: nil, limit: 6)
        XCTAssertEqual(events.count, 6)
        XCTAssertEqual(events[0].type, "generation_imported")
        XCTAssertEqual(events[0].assetId, "job:mw4klhmf-99a645cb")
        XCTAssertEqual(events[0].conceptMockup, true)
        XCTAssertNil(events[3].conceptMockup)
        XCTAssertEqual(Set(events.map { $0.id }).count, 6)

        transport.enqueue(body: try fixtureData("providers"))
        let providers = try await client.providers()
        XCTAssertEqual(providers.providers.count, 5)

        transport.enqueue(body: try fixtureData("generation_created"))
        let created = try await client.startGeneration(provider: "mock", kind: "text-to-3d", prompt: "knight helmet")
        XCTAssertEqual(created.id, "gen-mw4klgsa-98262b")
        XCTAssertEqual(created.status, "queued")
        XCTAssertEqual(created.progress, 0)
        XCTAssertEqual(created.outputs, [])
        XCTAssertFalse(created.isTerminal)
        XCTAssertNil(created.pollError)
        XCTAssertEqual(created.remoteId, "mock-mw4klgsa")

        transport.enqueue(body: try fixtureData("generation_succeeded"))
        let done = try await client.generation(id: "gen-mw4klgsa-98262b")
        XCTAssertEqual(done.status, "succeeded")
        XCTAssertTrue(done.isTerminal)
        XCTAssertEqual(done.progress, 100)
        XCTAssertEqual(done.outputs, [GenerationOutput(type: "model", format: "glb", url: nil,
                                                       local: "samples/mock_generations/knight_helmet.glb")])

        transport.enqueue(body: try fixtureData("generation_imported"))
        let imported = try await client.importGeneration(id: "gen-mw4klgsa-98262b")
        XCTAssertEqual(imported, GenerationImportResult(jobId: "mw4klhmf-99a645cb", assetId: "job:mw4klhmf-99a645cb",
                                                        filename: "mock_knight_helmet_98262b.glb", alreadyImported: nil))

        transport.enqueue(body: try fixtureData("note_saved"))
        let saved = try await client.saveNote(assetId: "run:pipeline/output", text: "Hand off to UE import after scale sign-off.")
        XCTAssertEqual(saved, AssetNote(text: "Hand off to UE import after scale sign-off.", updatedAt: "2026-11-06T06:05:04.530Z"))

        transport.enqueue(body: try fixtureData("note_empty"))
        let empty = try await client.note(assetId: "sample:nope.glb")
        XCTAssertNil(empty)
    }

    // MARK: Requests (method, path, percent-encoded query, body)

    func testRequestShapes() async throws {
        let transport = RecordingTransport()
        let client = makeClient(transport)

        transport.enqueue(body: try fixtureData("status"))
        _ = try await client.status()
        XCTAssertEqual(transport.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString, "http://127.0.0.1:5178/api/status")

        transport.enqueue(body: try fixtureData("workspace"))
        _ = try await client.workspace()
        XCTAssertEqual(transport.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString, "http://127.0.0.1:5178/api/workspace")

        transport.enqueue(body: try fixtureData("note_saved"))
        _ = try await client.note(assetId: "run:pipeline/output")
        XCTAssertEqual(transport.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString,
                       "http://127.0.0.1:5178/api/workspace/notes?asset=run%3Apipeline%2Foutput")
        XCTAssertNil(transport.lastRequest?.httpBody)

        transport.enqueue(body: try fixtureData("note_saved"))
        _ = try await client.saveNote(assetId: "run:pipeline/output", text: "a & b = c?")
        XCTAssertEqual(transport.lastRequest?.httpMethod, "PUT")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString,
                       "http://127.0.0.1:5178/api/workspace/notes?asset=run%3Apipeline%2Foutput")
        XCTAssertEqual(transport.lastRequest?.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let noteBody = bodyJSON(transport.lastRequest)
        XCTAssertEqual(noteBody?["text"] as? String, "a & b = c?")
        XCTAssertEqual(noteBody?.count, 1)

        transport.enqueue(body: try fixtureData("activity"))
        _ = try await client.activity(assetId: "job:mw4klhmf-99a645cb", limit: 20)
        XCTAssertEqual(transport.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString,
                       "http://127.0.0.1:5178/api/activity?asset=job%3Amw4klhmf-99a645cb&limit=20")

        transport.enqueue(body: try fixtureData("activity"))
        _ = try await client.activity(assetId: nil, limit: 50)
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString, "http://127.0.0.1:5178/api/activity?limit=50")

        transport.enqueue(body: try fixtureData("providers"))
        _ = try await client.providers()
        XCTAssertEqual(transport.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString, "http://127.0.0.1:5178/api/providers")

        transport.enqueue(body: try fixtureData("generation_succeeded"))
        _ = try await client.generation(id: "gen-mw4klgsa-98262b")
        XCTAssertEqual(transport.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString,
                       "http://127.0.0.1:5178/api/generations/gen-mw4klgsa-98262b")

        transport.enqueue(body: try fixtureData("generation_imported"))
        _ = try await client.importGeneration(id: "gen-mw4klgsa-98262b")
        XCTAssertEqual(transport.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString,
                       "http://127.0.0.1:5178/api/generations/gen-mw4klgsa-98262b/import")

        transport.enqueue(body: Data([0x67, 0x6C, 0x54, 0x46]))
        let bytes = try await client.jobInput(jobId: "mw4klhmf-99a645cb")
        XCTAssertEqual(bytes, Data([0x67, 0x6C, 0x54, 0x46]))
        XCTAssertEqual(transport.lastRequest?.httpMethod, "GET")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString,
                       "http://127.0.0.1:5178/api/jobs/mw4klhmf-99a645cb/input")

        transport.enqueue(json: """
        {"ok":true,"source":"pipeline_output","job_id":"mw5aaaaa-12345678","asset_id":"run:pipeline/runs/20261103-195336",
         "out_dir":"/x/pipeline/runs/20261103-195336","manifest":{"status":"ok"},"manifest_path":"/x/manifest.json",
         "export_asset":null,"validator_profile":null}
        """)
        let opened = try await client.openOutput(dir: "pipeline/runs/20261103-195336")
        XCTAssertEqual(transport.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString,
                       "http://127.0.0.1:5178/api/open-output?dir=pipeline%2Fruns%2F20261103-195336")
        XCTAssertEqual(opened.jobId, "mw5aaaaa-12345678")
        XCTAssertEqual(opened.assetId, "run:pipeline/runs/20261103-195336")
        XCTAssertNil(opened.exportAsset)
        XCTAssertFalse(opened.rawResponse.isEmpty)
    }

    func testStartGenerationBodies() async throws {
        let transport = RecordingTransport()
        let client = makeClient(transport)

        transport.enqueue(body: try fixtureData("generation_created"))
        _ = try await client.startGeneration(provider: "mock", kind: "text-to-3d", prompt: "knight helmet",
                                             image: .none, sourceAssetId: nil)
        XCTAssertEqual(transport.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString, "http://127.0.0.1:5178/api/providers/mock/generations")
        XCTAssertEqual(transport.lastRequest?.value(forHTTPHeaderField: "Content-Type"), "application/json")
        var body = bodyJSON(transport.lastRequest)
        XCTAssertEqual(body?["kind"] as? String, "text-to-3d")
        XCTAssertEqual(body?["prompt"] as? String, "knight helmet")
        XCTAssertNil(body?["image"])
        XCTAssertNil(body?["source_asset_id"])
        XCTAssertEqual(body?.count, 2)

        transport.enqueue(body: try fixtureData("generation_created"))
        _ = try await client.startGeneration(provider: "meshy", kind: "image-to-3d", prompt: "",
                                             image: .jobFile(jobId: "mw4kggjh-ecb1a994", rel: "preview/front.png"),
                                             sourceAssetId: "job:mw4kggjh-ecb1a994")
        XCTAssertEqual(transport.lastRequest?.url?.absoluteString, "http://127.0.0.1:5178/api/providers/meshy/generations")
        body = bodyJSON(transport.lastRequest)
        XCTAssertEqual(body?["source_asset_id"] as? String, "job:mw4kggjh-ecb1a994")
        var image = body?["image"] as? [String: Any]
        XCTAssertEqual(image?["job_id"] as? String, "mw4kggjh-ecb1a994")
        XCTAssertEqual(image?["rel"] as? String, "preview/front.png")
        XCTAssertEqual(image?.count, 2)

        transport.enqueue(body: try fixtureData("generation_created"))
        _ = try await client.startGeneration(provider: "runway", kind: "image-to-video", prompt: "turntable",
                                             image: .dataURI("data:image/png;base64,iVBORw0KGgo=", label: "front.png"))
        body = bodyJSON(transport.lastRequest)
        image = body?["image"] as? [String: Any]
        XCTAssertEqual(image?["data_uri"] as? String, "data:image/png;base64,iVBORw0KGgo=")
        XCTAssertEqual(image?["label"] as? String, "front.png")
        XCTAssertEqual(image?.count, 2)

        transport.enqueue(body: try fixtureData("generation_created"))
        _ = try await client.startGeneration(provider: "tripo", kind: "image-to-3d", prompt: "",
                                             image: .url("https://example.com/a.png"))
        body = bodyJSON(transport.lastRequest)
        image = body?["image"] as? [String: Any]
        XCTAssertEqual(image?["url"] as? String, "https://example.com/a.png")
        XCTAssertEqual(image?.count, 1)
    }

    func testPathAndQueryValuesArePercentEncoded() throws {
        let client = makeClient(RecordingTransport())
        let url = try client.makeURL(path: "/api/x", query: [("asset", "run:a/b c+d&e=f?g#h")])
        XCTAssertEqual(url.absoluteString, "http://127.0.0.1:5178/api/x?asset=run%3Aa%2Fb%20c%2Bd%26e%3Df%3Fg%23h")
        XCTAssertEqual(SculptLineServerClient.percentEncode("gen-abc_1.2~"), "gen-abc_1.2~")
        XCTAssertEqual(SculptLineServerClient.percentEncode("a/b"), "a%2Fb")

        let slashed = SculptLineServerClient(baseURL: URL(string: "http://mac.local:5178/")!, transport: RecordingTransport())
        XCTAssertEqual(try slashed.makeURL(path: "/api/status", query: []).absoluteString, "http://mac.local:5178/api/status")
    }

    // MARK: Errors

    func testOkFalseBecomesServerError() async throws {
        let transport = RecordingTransport()
        let client = makeClient(transport)
        transport.enqueue(json: "{\"ok\":false,\"error\":\"Meshy is not configured: set MESHY_API_KEY in the server environment\"}")
        do {
            _ = try await client.startGeneration(provider: "meshy", kind: "text-to-3d", prompt: "x")
            XCTFail("expected an error")
        } catch let error as SculptLineServerError {
            XCTAssertEqual(error, .server("Meshy is not configured: set MESHY_API_KEY in the server environment"))
        }

        transport.enqueue(json: "{\"ok\":false,\"error\":\"generation is running, not succeeded\"}")
        do {
            _ = try await client.importGeneration(id: "gen-x")
            XCTFail("expected an error")
        } catch let error as SculptLineServerError {
            XCTAssertEqual(error, .server("generation is running, not succeeded"))
        }
    }

    func testNon2xxBecomesHTTPError() async throws {
        let transport = RecordingTransport()
        let client = makeClient(transport)
        transport.enqueue(status: 400, json: "{\"ok\":false,\"error\":\"bad or missing ?asset=\"}")
        do {
            _ = try await client.note(assetId: "bad id")
            XCTFail("expected an error")
        } catch let error as SculptLineServerError {
            XCTAssertEqual(error, .http(400, "bad or missing ?asset="))
        }

        transport.enqueue(status: 404, json: "{\"error\":\"unknown job\"}")
        do {
            _ = try await client.jobInput(jobId: "mw4kzzzz-00000000")
            XCTFail("expected an error")
        } catch let error as SculptLineServerError {
            XCTAssertEqual(error, .http(404, "unknown job"))
        }

        transport.enqueue(status: 500, body: Data())
        do {
            _ = try await client.workspace()
            XCTFail("expected an error")
        } catch let error as SculptLineServerError {
            XCTAssertEqual(error, .http(500, "HTTP 500"))
        }
    }

    func testBadJSONBecomesDecodingError() async throws {
        let transport = RecordingTransport()
        let client = makeClient(transport)
        transport.enqueue(json: "{\"schema\":\"fabled.workspace/0.1\"}")
        do {
            _ = try await client.workspace()
            XCTFail("expected an error")
        } catch let error as SculptLineServerError {
            guard case .decoding(let message) = error else {
                return XCTFail("expected .decoding, got \(error)")
            }
            XCTAssertFalse(message.isEmpty)
        }
    }

    func testTransportFailureBecomesUnreachable() async throws {
        struct Boom: Error {}
        let transport = RecordingTransport()
        transport.failure = Boom()
        let client = makeClient(transport)
        do {
            _ = try await client.status()
            XCTFail("expected an error")
        } catch let error as SculptLineServerError {
            guard case .unreachable = error else {
                return XCTFail("expected .unreachable, got \(error)")
            }
        }
    }

    // MARK: Base URL

    func testDefaultBaseURLResolution() {
        let suite = "SculptLineServerClientTests.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            return XCTFail("could not create a UserDefaults suite")
        }
        defer { defaults.removePersistentDomain(forName: suite) }

        XCTAssertEqual(SculptLineServerClient.defaultBaseURL(environment: [:], defaults: defaults).absoluteString,
                       "http://127.0.0.1:5178")

        // The pre-rename user default is still read when the new one is not set.
        defaults.set("http://old-mac.local:5178", forKey: "fabledServerURL")
        XCTAssertEqual(SculptLineServerClient.defaultBaseURL(environment: [:], defaults: defaults).absoluteString,
                       "http://old-mac.local:5178")

        // The new user default wins over the old one.
        defaults.set("http://studio-mac.local:5178", forKey: "sculptlineServerURL")
        XCTAssertEqual(SculptLineServerClient.defaultBaseURL(environment: [:], defaults: defaults).absoluteString,
                       "http://studio-mac.local:5178")

        // Environment beats user defaults; the old variable name still works.
        XCTAssertEqual(SculptLineServerClient.defaultBaseURL(environment: ["FABLED_SERVER_URL": "https://10.0.0.5:9000"],
                                                         defaults: defaults).absoluteString,
                       "https://10.0.0.5:9000")
        // ...and the new variable wins over the old one.
        XCTAssertEqual(SculptLineServerClient.defaultBaseURL(environment: ["SCULPTLINE_SERVER_URL": "https://10.0.0.6:9001",
                                                                           "FABLED_SERVER_URL": "https://10.0.0.5:9000"],
                                                         defaults: defaults).absoluteString,
                       "https://10.0.0.6:9001")

        // Non-http(s) values are rejected and fall through.
        XCTAssertEqual(SculptLineServerClient.defaultBaseURL(environment: ["SCULPTLINE_SERVER_URL": "file:///etc/passwd"],
                                                         defaults: defaults).absoluteString,
                       "http://studio-mac.local:5178")
        XCTAssertEqual(SculptLineServerClient.defaultBaseURL(environment: ["SCULPTLINE_SERVER_URL": "not a url",
                                                                           "FABLED_SERVER_URL": "https://10.0.0.5:9000"],
                                                         defaults: defaults).absoluteString,
                       "https://10.0.0.5:9000")
        defaults.set("javascript:alert(1)", forKey: "sculptlineServerURL")
        XCTAssertEqual(SculptLineServerClient.defaultBaseURL(environment: [:], defaults: defaults).absoluteString,
                       "http://old-mac.local:5178", "an invalid new default falls back to the old key")
        defaults.set("javascript:alert(1)", forKey: "fabledServerURL")
        XCTAssertEqual(SculptLineServerClient.defaultBaseURL(environment: ["FABLED_SERVER_URL": "not a url"],
                                                         defaults: defaults).absoluteString,
                       "http://127.0.0.1:5178")
    }

    // MARK: WorkspaceModel parity with ui/public/workspace-model.js

    /// Expected values computed by running ui/public/workspace-model.js filterWorkspace on the same fixture.
    func testFilterWorkspaceParity() throws {
        let ws = try loadWorkspace()

        let all = WorkspaceModel.filterWorkspace(ws, query: "")
        XCTAssertEqual(all.total, 11)
        XCTAssertEqual(all.groups.count, 4)
        XCTAssertEqual(all.groups[1].hiddenCount, ws.groups[1].hiddenCount)
        XCTAssertEqual(WorkspaceModel.filterWorkspace(ws, query: nil).total, 11)

        // Only the TEST FIXTURE is the licensed bust scan now; procedural-sample runs no longer say "bust" / "CC0".
        let bust = WorkspaceModel.filterWorkspace(ws, query: "BUST")
        XCTAssertEqual(bust.total, 1)
        XCTAssertEqual(bust.groups.map { $0.assets.count }, [0, 0, 0, 1])
        XCTAssertEqual(ids(bust), ["run:ui/test_fixtures/pipeline_output_FIXTURE"])
        XCTAssertEqual(bust.groups.count, 4, "empty groups are kept")
        XCTAssertEqual(ids(WorkspaceModel.filterWorkspace(ws, query: "(cc0)")), ["run:ui/test_fixtures/pipeline_output_FIXTURE"])
        XCTAssertEqual(ids(WorkspaceModel.filterWorkspace(ws, query: "procedural")),
                       ["run:pipeline/output", "run:pipeline/runs/20261103-195336"])
        XCTAssertEqual(ids(WorkspaceModel.filterWorkspace(ws, query: "sample head")),
                       ["run:pipeline/output", "run:pipeline/runs/20261103-195336",
                        "sample:fabled_sample_head.glb", "sample:fabled_sample_head.obj"])

        // Literal matching: regex metacharacters are harmless.
        XCTAssertEqual(WorkspaceModel.filterWorkspace(ws, query: ".*").total, 0)
        XCTAssertEqual(WorkspaceModel.filterWorkspace(ws, query: "[").total, 0)
        XCTAssertEqual(WorkspaceModel.filterWorkspace(ws, query: ".").groups.map { $0.assets.count }, [0, 3, 3, 2])

        let warn = WorkspaceModel.filterWorkspace(ws, query: "validator warn")
        XCTAssertEqual(ids(warn), ["run:pipeline/output", "run:pipeline/runs/20261103-195336"])
        XCTAssertEqual(WorkspaceModel.filterWorkspace(ws, query: "warn validator").total, 2)
        XCTAssertEqual(WorkspaceModel.filterWorkspace(ws, query: "validator").groups.map { $0.assets.count }, [2, 0, 1, 0])
        XCTAssertEqual(ids(WorkspaceModel.filterWorkspace(ws, query: "  Validator   FAIL  ")), ["job:mw4kia2y-4536ccfe"])

        // group label, provenance prompt / provider name, kind label, status label, folder
        XCTAssertEqual(WorkspaceModel.filterWorkspace(ws, query: "uploads").groups.map { $0.assets.count }, [0, 3, 0, 0])
        XCTAssertEqual(ids(WorkspaceModel.filterWorkspace(ws, query: "knight helmet")), ["job:mw4klhmf-99a645cb"])
        XCTAssertEqual(WorkspaceModel.filterWorkspace(ws, query: "offline").groups.map { $0.assets.count }, [0, 0, 3, 0])
        XCTAssertEqual(WorkspaceModel.filterWorkspace(ws, query: "ai-generated").groups.map { $0.assets.count }, [0, 0, 3, 0])
        XCTAssertEqual(ids(WorkspaceModel.filterWorkspace(ws, query: "test fixture")),
                       ["run:ui/test_fixtures/pipeline_output_FIXTURE"])
        XCTAssertEqual(ids(WorkspaceModel.filterWorkspace(ws, query: "pipeline/output")), ["run:pipeline/output"])

        XCTAssertEqual(WorkspaceModel.filterWorkspace(nil, query: "x").total, 0)
    }

    func testTrisLabelParity() throws {
        XCTAssertEqual(WorkspaceModel.trisLabel(TriangleFacts(input: nil, lodCount: 4, lod0Triangles: 18636)),
                       "LOD0 19k tris \u{00B7} 4 LODs")
        XCTAssertEqual(WorkspaceModel.trisLabel(TriangleFacts(input: 327680, lodCount: nil, lod0Triangles: nil)), "328k tris")
        XCTAssertNil(WorkspaceModel.trisLabel(TriangleFacts(input: nil, lodCount: nil, lod0Triangles: nil)))
        XCTAssertNil(WorkspaceModel.trisLabel(nil as TriangleFacts?))
        XCTAssertEqual(WorkspaceModel.trisLabel(TriangleFacts(input: 8504655, lodCount: 4, lod0Triangles: nil)),
                       "4 LODs \u{00B7} in 8.5M")
        XCTAssertEqual(WorkspaceModel.trisLabel(TriangleFacts(input: nil, lodCount: 4, lod0Triangles: nil)), "4 LODs")
        XCTAssertEqual(WorkspaceModel.trisLabel(TriangleFacts(input: nil, lodCount: 0, lod0Triangles: 500)), "LOD0 500 tris")

        let ws = try loadWorkspace()
        let labels: [String?] = ws.groups.flatMap { (g: WorkspaceGroup) -> [String?] in g.assets.map { WorkspaceModel.trisLabel($0) } }
        XCTAssertEqual(labels, ["LOD0 19k tris \u{00B7} 4 LODs", "LOD0 19k tris \u{00B7} 4 LODs", nil, nil, nil, nil, nil, nil,
                                "328k tris", "82k tris", "4 LODs \u{00B7} in 8.5M"])
    }

    func testCompactCountParity() {
        // Values from ui/public/workspace-model.js compact(). 1150 → "1.1k" (not "1.2k"): toFixed rounds the stored
        // binary value 1.1499999…, and 1250 → "1.3k" because 1.25 is exact and ties go up.
        let inputs: [Int] = [0, 999, 1000, 1050, 1150, 1250, 1450, 2550, 9999, 10000, 18636, 999999, 1000000, 1150000,
                             1250000, 2550000, 8504655, 12500000]
        let expected: [String] = ["0", "999", "1.0k", "1.1k", "1.1k", "1.3k", "1.4k", "2.5k", "10.0k", "10k", "19k", "1000k",
                                  "1.0M", "1.1M", "1.3M", "2.5M", "8.5M", "13M"]
        XCTAssertEqual(inputs.map { WorkspaceModel.compactCount($0) ?? "nil" }, expected)
        XCTAssertNil(WorkspaceModel.compactCount(nil))
    }

    func testTimeAgoParity() throws {
        let now: Date = try XCTUnwrap(WorkspaceModel.parseISODate("2026-11-06T06:00:00Z"))
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-11-06T04:00:00Z", now: now), "2h ago")
        XCTAssertNil(WorkspaceModel.timeAgo(nil, now: now))
        XCTAssertNil(WorkspaceModel.timeAgo("not a date", now: now))
        XCTAssertNil(WorkspaceModel.timeAgo("", now: now))
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-11-06T05:59:30Z", now: now), "just now")
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-11-06T07:00:00Z", now: now), "just now")
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-11-06T05:59:00.000Z", now: now), "1m ago")
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-11-06T05:59:15Z", now: now), "1m ago")
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-11-06T05:30:00Z", now: now), "30m ago")
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-11-06T05:15:30Z", now: now), "45m ago")
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-11-05T06:00:00Z", now: now), "1d ago")
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-11-03T20:44:03-08:00", now: now), "2d ago")
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-10-08T06:00:01Z", now: now), "29d ago")
        XCTAssertEqual(WorkspaceModel.timeAgo("2026-09-01T00:00:00Z", now: now), "2026-09-01")
    }

    func testParseISODateForms() throws {
        let base: Date = try XCTUnwrap(WorkspaceModel.parseISODate("2026-11-06T06:05:04Z"))
        let millis: Date = try XCTUnwrap(WorkspaceModel.parseISODate("2026-11-06T06:05:04.521Z"))
        XCTAssertEqual(millis.timeIntervalSince(base), 0.521, accuracy: 0.001)
        let micros: Date = try XCTUnwrap(WorkspaceModel.parseISODate("2026-11-06T06:05:04.521987Z"))
        XCTAssertEqual(micros.timeIntervalSince(base), 0.521, accuracy: 0.001)
        let offset: Date = try XCTUnwrap(WorkspaceModel.parseISODate("2026-11-05T22:05:04-08:00"))
        XCTAssertEqual(offset.timeIntervalSince(base), 0, accuracy: 0.001)
        let dateOnly: Date = try XCTUnwrap(WorkspaceModel.parseISODate("2026-11-06"))
        XCTAssertEqual(base.timeIntervalSince(dateOnly), 6 * 3600 + 5 * 60 + 4, accuracy: 0.001)
        XCTAssertNil(WorkspaceModel.parseISODate("yesterday"))
    }

    func testKindLabelsAndSymbols() {
        XCTAssertEqual(WorkspaceModel.kindLabel("generated"), "AI-generated sculpt")
        XCTAssertEqual(WorkspaceModel.kindLabel("frozen_run"), "Frozen pipeline run")
        XCTAssertNil(WorkspaceModel.kindLabel("mystery"))
        for kind in ["pipeline_output", "frozen_run", "upload", "generated", "generation", "sample", "fixture"] {
            XCTAssertNotNil(WorkspaceModel.kindLabel(kind))
            XCTAssertNotEqual(WorkspaceModel.sfSymbol(forKind: kind), "doc")
        }
        XCTAssertEqual(WorkspaceModel.sfSymbol(forKind: "mystery"), "doc")
    }
}
