import XCTest
@testable import SculptLine

final class ThemeAndModelTests: XCTestCase {
    func testThemePresets() {
        let presets = AmbientThemePreset.allCases
        XCTAssertEqual(presets.count, 5, "Must have exactly 5 ambient theme presets")

        for preset in presets {
            XCTAssertFalse(preset.rawValue.isEmpty)
            XCTAssertEqual(preset.id, preset.rawValue)

            let p = preset.primaryRGB
            XCTAssertGreaterThanOrEqual(p.x, 0.0)
            XCTAssertLessThanOrEqual(p.x, 1.0)
            XCTAssertGreaterThanOrEqual(p.y, 0.0)
            XCTAssertLessThanOrEqual(p.y, 1.0)
            XCTAssertGreaterThanOrEqual(p.z, 0.0)
            XCTAssertLessThanOrEqual(p.z, 1.0)

            let s = preset.secondaryRGB
            XCTAssertGreaterThanOrEqual(s.x, 0.0)
            XCTAssertLessThanOrEqual(s.x, 1.0)
            XCTAssertGreaterThanOrEqual(s.y, 0.0)
            XCTAssertLessThanOrEqual(s.y, 1.0)
            XCTAssertGreaterThanOrEqual(s.z, 0.0)
            XCTAssertLessThanOrEqual(s.z, 1.0)

            XCTAssertEqual(preset.orbColors.count, 4, "Each preset must provide 4 animated orb colors")
        }
    }

    func testWorkspaceLayoutModes() {
        let modes = WorkspaceLayoutMode.allCases
        XCTAssertEqual(modes.count, 3)
        XCTAssertTrue(modes.contains(.all))
        XCTAssertTrue(modes.contains(.focus3D))
        XCTAssertTrue(modes.contains(.splitCheck))
    }

    func testSourceUnitsConversions() {
        XCTAssertEqual(SourceUnits.m.toCentimeters, 100.0, accuracy: 1e-6)
        XCTAssertEqual(SourceUnits.cm.toCentimeters, 1.0, accuracy: 1e-6)
        XCTAssertEqual(SourceUnits.mm.toCentimeters, 0.1, accuracy: 1e-6)

        XCTAssertEqual(SourceUnits.m.rawValue, "m")
        XCTAssertEqual(SourceUnits.cm.rawValue, "cm")
        XCTAssertEqual(SourceUnits.mm.rawValue, "mm")
    }

    func testUpAxisOptions() {
        let axes = UpAxis.allCases
        XCTAssertEqual(axes.count, 2)
        XCTAssertEqual(UpAxis.Y.rawValue, "Y")
        XCTAssertEqual(UpAxis.Z.rawValue, "Z")
    }

    func testAssetClassPresets() {
        let presets = AssetClassPreset.presets
        XCTAssertEqual(presets.count, 4, "Should define 4 standard asset class presets")

        let ids = presets.map { $0.id }
        XCTAssertTrue(ids.contains("bust"))
        XCTAssertTrue(ids.contains("character"))
        XCTAssertTrue(ids.contains("prop_small"))
        XCTAssertTrue(ids.contains("prop_large"))

        for p in presets {
            XCTAssertLessThan(p.minHeightCm, p.maxHeightCm)
            XCTAssertGreaterThan(p.minHeightCm, 0)
        }
    }

    func testLODBudgetsOrdering() {
        let profile = ImportProfile()
        XCTAssertEqual(profile.lodBudgets.count, 4)

        for i in 0..<profile.lodBudgets.count {
            XCTAssertEqual(profile.lodBudgets[i].level, i)
            if i > 0 {
                XCTAssertLessThan(profile.lodBudgets[i].maxTriangles, profile.lodBudgets[i - 1].maxTriangles)
            }
        }
    }

    func testInspectorHasAssetPageTab() {
        XCTAssertTrue(InspectorSectionTab.allCases.contains(.page))
        XCTAssertEqual(InspectorSectionTab.page.rawValue, "Page")
        XCTAssertEqual(Set(InspectorSectionTab.allCases.map { $0.rawValue }).count, InspectorSectionTab.allCases.count)
    }
}
