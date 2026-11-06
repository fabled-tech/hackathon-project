import XCTest
@testable import FabledStudio

@MainActor
final class ViewModelActionTests: XCTestCase {
    func testInitialViewModelState() {
        let vm = FabledStudioViewModel()

        XCTAssertEqual(vm.themePreset, .palantir)
        XCTAssertEqual(vm.layoutMode, .all)
        XCTAssertTrue(vm.showLeftSidebar)
        XCTAssertTrue(vm.showRightInspector)
        XCTAssertFalse(vm.wireframeEnabled)
        XCTAssertTrue(vm.syncCamerasEnabled)
        XCTAssertTrue(vm.highlightFlippedEnabled)
        // The asset tree is the live server workspace now: nothing is selected or invented before it loads.
        XCTAssertNil(vm.workspace.selectedAssetId)
        XCTAssertNil(vm.workspace.index)
    }

    func testStoryboardBeatsExecution() async {
        let vm = FabledStudioViewModel()

        // Beat 1: Load sample sculpt
        await vm.runStoryboardBeat(1)
        XCTAssertEqual(vm.activeBeat, 1)
        XCTAssertNotNil(vm.sourceMesh)

        // Beat 2: Spec inspection
        await vm.runStoryboardBeat(2)
        XCTAssertEqual(vm.activeBeat, 2)

        // Beat 4: LOD inspection & wireframe
        await vm.runStoryboardBeat(4)
        XCTAssertEqual(vm.activeBeat, 4)
        XCTAssertTrue(vm.wireframeEnabled)

        // Beat 5: Pre-import check
        await vm.runStoryboardBeat(5)
        XCTAssertEqual(vm.activeBeat, 5)
        XCTAssertFalse(vm.browserChecks.isEmpty)

        // Beat 6: Auto-fix scale and winding
        await vm.runStoryboardBeat(6)
        XCTAssertEqual(vm.activeBeat, 6)
        XCTAssertEqual(vm.profile.scale, 0.01)
    }

    func testScaleFixApplication() {
        let vm = FabledStudioViewModel()
        vm.profile.scale = 1.0

        vm.applyScaleFix(0.01)
        XCTAssertEqual(vm.profile.scale, 0.01, accuracy: 1e-6)
    }

    func testUnifiedWindingFix() async {
        let vm = FabledStudioViewModel()
        await vm.loadRawSampleSculpt()

        guard var src = vm.sourceMesh else {
            XCTFail("Source mesh must not be nil")
            return
        }

        // Simulate synthetic flipped triangles
        src.flippedTriangles = [0, 1]
        vm.sourceMesh = src

        await vm.applyUnifiedWindingFix()

        XCTAssertEqual(vm.sourceMesh?.flippedTriangles.count, 0, "All flipped triangles must be resolved")
        XCTAssertGreaterThanOrEqual(vm.sourceMesh?.browserFixedFlips ?? 0, 2)
    }

    func testWorkspaceTreeFilteringUsesServerIndex() throws {
        let vm = FabledStudioViewModel()
        vm.workspace.index = try WorkspaceFixtures.workspaceIndex()

        vm.workspace.query = ""
        XCTAssertEqual(vm.workspace.filteredGroups.count, 4)
        XCTAssertEqual(vm.workspace.filteredTotal, 11)

        vm.workspace.query = "potion"
        XCTAssertEqual(vm.workspace.filteredTotal, 2)

        vm.workspace.query = "nonexistent_query_xyz"
        XCTAssertEqual(vm.workspace.filteredTotal, 0)
    }

    func testOpeningAGenerationAssetShowsItsPage() async throws {
        let transport = WorkspaceRouteTransport()
        let client = FabledServerClient(baseURL: try XCTUnwrap(URL(string: "http://127.0.0.1:5178")), transport: transport)
        let vm = FabledStudioViewModel(workspace: WorkspaceStore(client: client))
        let asset = try JSONDecoder().decode(WorkspaceAsset.self, from: Data("""
        {"id":"gen:gen-1","kind":"generation","name":"knight helmet","status":{"label":"running","tone":"running"},
         "open":{"type":"generation","task_id":"gen-1"}}
        """.utf8))

        await vm.openWorkspaceAsset(asset)

        XCTAssertEqual(vm.workspace.selectedAssetId, "gen:gen-1")
        XCTAssertEqual(vm.inspectorTab, .page)
    }
}
