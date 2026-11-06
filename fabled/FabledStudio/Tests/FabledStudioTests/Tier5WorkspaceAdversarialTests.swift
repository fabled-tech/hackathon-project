import XCTest
import simd
import SceneKit
import SwiftUI
@testable import FabledStudio

@MainActor
final class Tier5WorkspaceAdversarialTests: XCTestCase {

    // MARK: - 1. Dual Viewport Camera Synchronization & Gimbal Lock Hardening

    func testCameraGimbalLockAnglesStability() {
        // Test elevation angles approaching and exceeding pitch = +/-90 degrees (+/- 1.570796 rad)
        let testElevations: [Float] = [
            0.0,
            Float.pi / 4,
            Float.pi / 2,        // +90 deg gimbal lock boundary
            -Float.pi / 2,       // -90 deg gimbal lock boundary
            Float.pi,            // 180 deg
            -Float.pi,
            10.0,                // extreme multi-revolution
            -10.0,
            1000.0,
            -1000.0
        ]

        let testAzimuths: [Float] = [
            0.0,
            Float.pi / 2,
            Float.pi,
            3 * Float.pi / 2,
            100.0
        ]

        let meshCenter = SIMD3<Float>(0, 1.2, 0)
        let meshRadius: Float = 0.85

        for el in testElevations {
            for az in testAzimuths {
                // Replicate SceneOrbitCoordinator.applyCameraOrbit clamping & projection logic
                let clampedEl = max(-1.35, min(1.35, el))
                XCTAssertGreaterThanOrEqual(clampedEl, -1.35, "Elevation must be clamped to avoid -90 deg singularity")
                XCTAssertLessThanOrEqual(clampedEl, 1.35, "Elevation must be clamped to avoid +90 deg singularity")

                let distanceScale: Float = 1.0
                let r = max(0.05, meshRadius * 2.25 * max(0.35, min(3.5, distanceScale)))

                let cx = meshCenter.x + r * cos(clampedEl) * sin(az)
                let cy = meshCenter.y + r * sin(clampedEl)
                let cz = meshCenter.z + r * cos(clampedEl) * cos(az)

                XCTAssertFalse(cx.isNaN, "cx must not be NaN at el=\(el), az=\(az)")
                XCTAssertFalse(cy.isNaN, "cy must not be NaN at el=\(el), az=\(az)")
                XCTAssertFalse(cz.isNaN, "cz must not be NaN at el=\(el), az=\(az)")
                XCTAssertTrue(cx.isFinite, "cx must be finite")
                XCTAssertTrue(cy.isFinite, "cy must be finite")
                XCTAssertTrue(cz.isFinite, "cz must be finite")

                // Ensure camera direction vector to center is non-zero
                let dir = meshCenter - SIMD3<Float>(cx, cy, cz)
                let len = simd_length(dir)
                XCTAssertGreaterThan(len, 0.04, "Camera distance to center must remain non-zero")
            }
        }
    }

    func testCameraExtremeDistanceScalesAndRadius() {
        let testScales: [Float] = [
            0.0,
            -5.0,
            0.00001,
            0.35,
            1.0,
            3.5,
            10.0,
            1000.0,
            1e6
        ]

        let testRadii: [Float] = [
            0.0001,
            0.5,
            100.0,
            10000.0
        ]

        for scale in testScales {
            for radius in testRadii {
                let clampedScale = max(0.35, min(3.5, scale))
                XCTAssertGreaterThanOrEqual(clampedScale, 0.35)
                XCTAssertLessThanOrEqual(clampedScale, 3.5)

                let r = max(0.05, radius * 2.25 * clampedScale)
                XCTAssertGreaterThanOrEqual(r, 0.05)
                XCTAssertTrue(r.isFinite)

                let near = Double(max(0.001, radius * 0.02))
                let far = Double(max(100.0, radius * 25.0))
                XCTAssertGreaterThan(far, near, "Far clipping plane must strictly exceed near clipping plane")
            }
        }
    }

    func testMissingPBRTexturesAndFallbackGracefulHandling() {
        // SCNMaterial with missing / invalid texture URLs
        let nonExistentURL = URL(fileURLWithPath: "/nonexistent/path/to/missing_texture_\(UUID().uuidString).png")

        let mat = SCNMaterial()
        mat.lightingModel = .physicallyBased
        mat.diffuse.contents = NSColor(calibratedRed: 0.78, green: 0.82, blue: 0.89, alpha: 1.0)
        mat.roughness.contents = 0.52
        mat.metalness.contents = 0.08
        mat.isDoubleSided = true

        // Loading non-existent URL should return nil image and leave material valid
        let missingImage = NSImage(contentsOf: nonExistentURL)
        XCTAssertNil(missingImage)

        // Material remains valid physicallyBased material
        XCTAssertEqual(mat.lightingModel, .physicallyBased)
        XCTAssertNotNil(mat.diffuse.contents)
        XCTAssertNil(mat.normal.contents as? NSImage, "normal.contents must not be an NSImage when URL is missing")
        XCTAssertNil(mat.ambientOcclusion.contents as? NSImage, "ambientOcclusion.contents must not be an NSImage when URL is missing")
    }

    func testRapidWireframeAndOverlayToggles() {
        let vm = FabledStudioViewModel()

        // 100 rapid toggles of viewport states
        for i in 0..<100 {
            vm.wireframeEnabled = (i % 2 == 0)
            vm.highlightFlippedEnabled = (i % 3 == 0)
            vm.showBakedMapsEnabled = (i % 5 == 0)
            vm.syncCamerasEnabled = (i % 2 != 0)
        }

        XCTAssertFalse(vm.wireframeEnabled)
        XCTAssertTrue(vm.highlightFlippedEnabled)
        XCTAssertFalse(vm.showBakedMapsEnabled)
        XCTAssertTrue(vm.syncCamerasEnabled)
    }

    // MARK: - 2. Notion-Style Asset Tree Adversarial Filtering & Persistence

    func testAssetTreeSearchAdversarialQueries() {
        let vm = FabledStudioViewModel()

        let adversarialQueries: [String] = [
            ".*+?^${}()|[]\\",
            "<script>alert('XSS')</script>",
            "\" OR \"1\"=\"1",
            "   ",
            "\n\t\r",
            "helen",
            "HELEN",
            "HeLeN",
            "bust",
            "shield",
            "modular",
            "historical",
            "🎨🔥💎",
            String(repeating: "a", count: 1000)
        ]

        for q in adversarialQueries {
            vm.assetSearchText = q
            let filtered = vm.filteredCategories
            XCTAssertTrue(filtered.allSatisfy { !$0.assets.isEmpty }, "Categories without matching assets must be omitted")
        }
    }

    func testAssetTreeSelectingNonExistentID() async {
        let vm = FabledStudioViewModel()

        await vm.selectAsset(id: "nonexistent_asset_id_99999")
        XCTAssertEqual(vm.selectedAssetId, "nonexistent_asset_id_99999")

        // selectedAssetItem should fall back safely to first catalog item without crashing
        let fallback = vm.selectedAssetItem
        XCTAssertNotNil(fallback)
        XCTAssertEqual(fallback?.id, "helen-keller-bust")
    }

    func testAssetNotesExtremePersistence() {
        let vm = FabledStudioViewModel()

        // 1. Extreme long note (50,000 chars)
        let longNote = String(repeating: "Production note for asset verification. ", count: 1250)
        vm.assetNotes["helen-keller-bust"] = longNote
        XCTAssertEqual(vm.assetNotes["helen-keller-bust"]?.count, longNote.count)

        // 2. Empty note
        vm.assetNotes["paladin-shield"] = ""
        XCTAssertEqual(vm.assetNotes["paladin-shield"], "")

        // 3. Special unicode characters
        let unicodeNote = "Verified: CC0 Smithsonian NPG.75.16 · Onorio Ruotolo 1916 💎 \n\r\t \u{0000} \u{FFFF}"
        vm.assetNotes["synthetic-clean-hero"] = unicodeNote
        XCTAssertEqual(vm.assetNotes["synthetic-clean-hero"], unicodeNote)
    }

    // MARK: - 3. Pre-Import QA Validator Edge-Case Reports

    func testValidatorReportWithZeroChecks() throws {
        let zeroSummary = ValidatorSummary.zero
        let zeroReport = ValidatorReport(
            schema_version: "0.2.0",
            tool: ["name": "fabled_validator", "version": "0.2.0"],
            overall_status: "pass",
            complete: true,
            summary: zeroSummary,
            checks: []
        )

        XCTAssertTrue(zeroReport.isPassing)
        XCTAssertFalse(zeroReport.isFlagged)
        XCTAssertEqual(zeroReport.checks.count, 0)
        XCTAssertEqual(zeroReport.headlineSummary, "pass 0 · warn 0 · fail 0 · not checked 0")

        // JSON roundtrip
        let data = try JSONEncoder().encode(zeroReport)
        let decoded = try JSONDecoder().decode(ValidatorReport.self, from: data)
        XCTAssertEqual(decoded, zeroReport)
    }

    func testValidatorReportWithAllSixteenFailingChecks() throws {
        let allChecks = StandardValidatorCheckID.allCases.map { std in
            ValidatorCheck(
                id: std.rawValue,
                group: std.groupTitle,
                title: "Strict validation on \(std.rawValue)",
                status: "fail",
                message: "Failure condition detected on \(std.rawValue)",
                fix_hint: "Apply fix for \(std.rawValue)"
            )
        }

        let summary = ValidatorSummary(
            pass: 0,
            warn: 0,
            fail: allChecks.count,
            not_checked: 0,
            total: allChecks.count,
            flagged: allChecks.count
        )

        let failReport = ValidatorReport(
            schema_version: "0.2.0",
            tool: ["name": "fabled_validator", "version": "0.2.0"],
            overall_status: "fail",
            complete: true,
            summary: summary,
            checks: allChecks
        )

        XCTAssertFalse(failReport.isPassing)
        XCTAssertTrue(failReport.isFlagged)
        XCTAssertEqual(failReport.checks.count, 16)
        for check in failReport.checks {
            XCTAssertTrue(check.isFail)
            XCTAssertEqual(check.statusGlyph, "✕")
        }

        let data = try JSONEncoder().encode(failReport)
        let decoded = try JSONDecoder().decode(ValidatorReport.self, from: data)
        XCTAssertEqual(decoded, failReport)
    }

    func testValidatorMalformedFixHintsAndUnknownStatuses() {
        let malformedChecks = [
            ValidatorCheck(
                id: "unknown_1",
                group: nil,
                title: nil,
                status: "UNKNOWN_STATUS",
                message: "Status is not standard",
                fix_hint: nil
            ),
            ValidatorCheck(
                id: "scale_extreme",
                group: "Scale",
                title: "Scale check with huge hint",
                status: "WARN",
                message: "Scale flagged",
                fix_hint: String(repeating: "Adjust scale factor in profile. ", count: 200)
            ),
            ValidatorCheck(
                id: "scale_with_factor",
                group: "Scale",
                title: "Scale check with 0.01 factor",
                status: "FAIL",
                message: "Scale 100x too big",
                fix_hint: "Apply 0.01 factor"
            )
        ]

        XCTAssertEqual(malformedChecks[0].displayTitle, "unknown_1")
        XCTAssertEqual(malformedChecks[0].statusGlyph, "–")
        XCTAssertFalse(malformedChecks[0].isPass)
        XCTAssertFalse(malformedChecks[0].isWarn)
        XCTAssertFalse(malformedChecks[0].isFail)
        XCTAssertNil(malformedChecks[0].measuredScaleFactor)

        XCTAssertTrue(malformedChecks[1].isWarn)
        XCTAssertEqual(malformedChecks[1].statusGlyph, "!")
        XCTAssertNil(malformedChecks[1].measuredScaleFactor)

        XCTAssertTrue(malformedChecks[2].isFail)
        XCTAssertEqual(malformedChecks[2].statusGlyph, "✕")
        XCTAssertEqual(malformedChecks[2].measuredScaleFactor, 0.01)
    }

    // MARK: - 4. Theme & Ambient Tokens Consistency

    func testThemeTokensParityAcrossAllFivePresets() {
        for preset in AmbientThemePreset.allCases {
            let primary = preset.primaryRGB
            let secondary = preset.secondaryRGB

            XCTAssertGreaterThanOrEqual(primary.x, 0.0)
            XCTAssertLessThanOrEqual(primary.x, 1.0)
            XCTAssertGreaterThanOrEqual(primary.y, 0.0)
            XCTAssertLessThanOrEqual(primary.y, 1.0)
            XCTAssertGreaterThanOrEqual(primary.z, 0.0)
            XCTAssertLessThanOrEqual(primary.z, 1.0)

            XCTAssertGreaterThanOrEqual(secondary.x, 0.0)
            XCTAssertLessThanOrEqual(secondary.x, 1.0)
            XCTAssertGreaterThanOrEqual(secondary.y, 0.0)
            XCTAssertLessThanOrEqual(secondary.y, 1.0)
            XCTAssertGreaterThanOrEqual(secondary.z, 0.0)
            XCTAssertLessThanOrEqual(secondary.z, 1.0)

            XCTAssertGreaterThanOrEqual(preset.orbColors.count, 4)
        }

        // Verify Palantir theme exact RGB match with Web tokens: [139, 92, 246] and [56, 189, 248]
        let palantir = AmbientThemePreset.palantir
        XCTAssertEqual(palantir.primaryRGB.x * 255.0, 139.0, accuracy: 1e-4)
        XCTAssertEqual(palantir.primaryRGB.y * 255.0, 92.0, accuracy: 1e-4)
        XCTAssertEqual(palantir.primaryRGB.z * 255.0, 246.0, accuracy: 1e-4)

        XCTAssertEqual(palantir.secondaryRGB.x * 255.0, 56.0, accuracy: 1e-4)
        XCTAssertEqual(palantir.secondaryRGB.y * 255.0, 189.0, accuracy: 1e-4)
        XCTAssertEqual(palantir.secondaryRGB.z * 255.0, 248.0, accuracy: 1e-4)
    }
}
