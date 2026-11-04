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
        XCTAssertEqual(vm.selectedAssetId, "helen-keller-bust")
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

    func testNotionAssetTreeFiltering() {
        let vm = FabledStudioViewModel()

        vm.assetSearchText = ""
        XCTAssertEqual(vm.filteredCategories.count, 3)

        vm.assetSearchText = "shield"
        let filtered = vm.filteredCategories
        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered.first?.assets.first?.id, "paladin-shield")

        vm.assetSearchText = "nonexistent_query_xyz"
        XCTAssertEqual(vm.filteredCategories.count, 0)
    }

    func testAssetSelectionAndNotesPersistence() async {
        let vm = FabledStudioViewModel()

        await vm.selectAsset(id: "paladin-shield")
        XCTAssertEqual(vm.selectedAssetId, "paladin-shield")

        // Modify note
        vm.assetNotes["paladin-shield"] = "Updated note for paladin shield."
        XCTAssertEqual(vm.assetNotes["paladin-shield"], "Updated note for paladin shield.")

        // Switch and switch back
        await vm.selectAsset(id: "helen-keller-bust")
        XCTAssertEqual(vm.selectedAssetId, "helen-keller-bust")
        XCTAssertEqual(vm.assetNotes["paladin-shield"], "Updated note for paladin shield.")
    }
}
