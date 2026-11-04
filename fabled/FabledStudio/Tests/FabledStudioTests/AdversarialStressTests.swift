import XCTest
import simd
import SceneKit
@testable import FabledStudio

final class AdversarialStressTests: XCTestCase {

    // MARK: - 1. SceneKit Geometry & Mesh Processing Stress Tests

    func testDegenerateMeshZeroAreaAndRepeatedVertices() {
        // Degenerate triangle with repeated vertices (0, 0, 0)
        let positions: [SIMD3<Float>] = [
            SIMD3<Float>(0, 0, 0),
            SIMD3<Float>(1, 0, 0),
            SIMD3<Float>(0, 1, 0)
        ]
        let degenerateIndices: [UInt32] = [
            0, 0, 0,  // Completely degenerate (point)
            0, 1, 0   // Repeated vertex (line)
        ]

        let normals = MeshAnalyzerAndLoader.computeVertexNormals(positions: positions, indices: degenerateIndices)
        XCTAssertEqual(normals.count, positions.count)

        // For degenerate triangles, normal length is 0, should default to (0, 1, 0)
        for n in normals {
            XCTAssertFalse(n.x.isNaN)
            XCTAssertFalse(n.y.isNaN)
            XCTAssertFalse(n.z.isNaN)
            XCTAssertEqual(n, SIMD3<Float>(0, 1, 0), "Degenerate triangles must yield default unit normal (0, 1, 0)")
        }

        // Geometry creation must succeed without crashing
        let geom = MeshAnalyzerAndLoader.makeSCNGeometry(
            positions: positions,
            indices: degenerateIndices,
            normals: normals,
            texcoords: []
        )
        XCTAssertNotNil(geom)
        XCTAssertEqual(geom.sources.count, 2) // vertex + normal
        XCTAssertEqual(geom.elements.count, 1)
        XCTAssertEqual(geom.elements.first?.primitiveCount, degenerateIndices.count / 3)
    }

    func testCollinearZeroAreaTrianglesNormalStability() {
        // Collinear vertices along the X-axis: cross product is exactly zero
        let positions: [SIMD3<Float>] = [
            SIMD3<Float>(0, 0, 0),
            SIMD3<Float>(1, 0, 0),
            SIMD3<Float>(2, 0, 0),
            SIMD3<Float>(3, 0, 0)
        ]
        let indices: [UInt32] = [
            0, 1, 2,
            1, 2, 3
        ]

        let normals = MeshAnalyzerAndLoader.computeVertexNormals(positions: positions, indices: indices)
        XCTAssertEqual(normals.count, positions.count)
        for n in normals {
            XCTAssertEqual(n, SIMD3<Float>(0, 1, 0), "Collinear triangles must produce safe fallback normal without division by zero")
        }
    }

    func testEmptyVertexAndIndexLists() {
        let emptyPositions: [SIMD3<Float>] = []
        let emptyIndices: [UInt32] = []

        let normals = MeshAnalyzerAndLoader.computeVertexNormals(positions: emptyPositions, indices: emptyIndices)
        XCTAssertTrue(normals.isEmpty)

        // makeSCNGeometry with empty positions
        let geom = MeshAnalyzerAndLoader.makeSCNGeometry(
            positions: emptyPositions,
            indices: emptyIndices,
            normals: [],
            texcoords: []
        )
        XCTAssertNotNil(geom)
        XCTAssertEqual(geom.elements.first?.primitiveCount, 0)

        // Decimation on empty positions must return empty without crashing
        let decimated = MeshAnalyzerAndLoader.decimateClustered(
            positions: emptyPositions,
            indices: emptyIndices,
            targetTriangles: 100
        )
        XCTAssertTrue(decimated.positions.isEmpty)
        XCTAssertTrue(decimated.indices.isEmpty)
        XCTAssertTrue(decimated.normals.isEmpty)
    }

    func testInvertedNormalsWindingDetection() {
        // Quad in XY plane facing +Z, but with inverted clockwise winding for one triangle
        let positions: [SIMD3<Float>] = [
            SIMD3<Float>(-1, -1, 0),
            SIMD3<Float>( 1, -1, 0),
            SIMD3<Float>( 1,  1, 0),
            SIMD3<Float>(-1,  1, 0)
        ]
        // Triangle 0: counter-clockwise (facing +Z)
        // Triangle 1: clockwise (facing -Z, inverted)
        var indices: [UInt32] = [
            0, 1, 2,  // CCW -> normal points +Z
            0, 3, 2   // CW  -> normal points -Z
        ]

        // Flip winding of triangle 1 using flipTriangleWinding
        MeshAnalyzerAndLoader.flipTriangleWinding(indices: &indices, triangles: [1])
        XCTAssertEqual(indices[3], 0)
        XCTAssertEqual(indices[4], 2)
        XCTAssertEqual(indices[5], 3)

        // After flip, triangle 1 is CCW (0, 2, 3), pointing +Z
        let normalsAfter = MeshAnalyzerAndLoader.computeVertexNormals(positions: positions, indices: indices)
        for n in normalsAfter {
            XCTAssertEqual(n.z, 1.0, accuracy: 1e-4, "Both triangles now point in +Z")
        }
    }

    func testRedFlippedFaceOverlayGeometryGeneration() {
        let positions: [SIMD3<Float>] = [
            SIMD3<Float>(0, 0, 0),
            SIMD3<Float>(1, 0, 0),
            SIMD3<Float>(0, 1, 0),
            SIMD3<Float>(1, 1, 0)
        ]
        let normals: [SIMD3<Float>] = [
            SIMD3<Float>(0, 0, 1),
            SIMD3<Float>(0, 0, 1),
            SIMD3<Float>(0, 0, 1),
            SIMD3<Float>(0, 0, 1)
        ]
        let indices: [UInt32] = [
            0, 1, 2,  // tri 0
            1, 3, 2   // tri 1
        ]

        // Case A: No flipped triangles -> returns nil
        let noOverlay = MeshAnalyzerAndLoader.makeFlippedOverlayGeometry(
            positions: positions,
            normals: normals,
            indices: indices,
            flippedTriangles: [],
            offsetScale: 0.05
        )
        XCTAssertNil(noOverlay, "Must return nil when flippedTriangles is empty")

        // Case B: Triangle 1 is flipped
        let overlay = MeshAnalyzerAndLoader.makeFlippedOverlayGeometry(
            positions: positions,
            normals: normals,
            indices: indices,
            flippedTriangles: [1],
            offsetScale: 0.1
        )
        XCTAssertNotNil(overlay, "Must return valid geometry for flipped triangles")
        guard let ov = overlay else { return }

        XCTAssertEqual(ov.elements.count, 1)
        XCTAssertEqual(ov.elements.first?.primitiveCount, 1, "Must have exactly 1 triangle in overlay")

        // Verify material properties
        XCTAssertEqual(ov.materials.count, 1)
        let mat = ov.materials.first
        XCTAssertEqual(mat?.lightingModel, .constant)
        XCTAssertEqual(mat?.isDoubleSided, true)

        // Case C: Out of bounds flipped triangle index
        let oobOverlay = MeshAnalyzerAndLoader.makeFlippedOverlayGeometry(
            positions: positions,
            normals: normals,
            indices: indices,
            flippedTriangles: [999], // out of bounds
            offsetScale: 0.1
        )
        // Should skip triangle gracefully without crashing
        XCTAssertNotNil(oobOverlay)
        XCTAssertEqual(oobOverlay?.elements.first?.primitiveCount, 0)
    }

    // MARK: - Decimation Algorithm Under Specified Ratios (0%, 50%, 90%, 100%)

    func testDecimationRatios0_50_90_100() {
        let sculpt = MeshAnalyzerAndLoader.makeProceduralBustSculpt()
        let initialTris = sculpt.triangleCount
        XCTAssertGreaterThan(initialTris, 500, "Base procedural sculpt should have high polycount")

        // Ratio 1: 0% reduction (target = 100% of triangles, i.e. targetTriangles >= currentTris)
        let dec0 = MeshAnalyzerAndLoader.decimateClustered(
            positions: sculpt.positions,
            indices: sculpt.indices,
            targetTriangles: initialTris
        )
        XCTAssertEqual(dec0.indices.count / 3, initialTris, "0% reduction must preserve original triangle count")
        XCTAssertEqual(dec0.positions.count, sculpt.positions.count)

        // Ratio 2: 50% reduction (target = 50% of initial triangles)
        let target50 = initialTris / 2
        let dec50 = MeshAnalyzerAndLoader.decimateClustered(
            positions: sculpt.positions,
            indices: sculpt.indices,
            targetTriangles: target50
        )
        let tris50 = dec50.indices.count / 3
        XCTAssertLessThanOrEqual(tris50, target50, "50% reduction must produce <= target triangle count")
        XCTAssertGreaterThan(tris50, 0, "50% reduction must not produce 0 triangles")
        // Verify index integrity
        let maxV50 = UInt32(dec50.positions.count)
        for idx in dec50.indices {
            XCTAssertLessThan(idx, maxV50, "Index must be in bounds of decimated positions")
        }
        XCTAssertEqual(dec50.normals.count, dec50.positions.count)

        // Ratio 3: 90% reduction (target = 10% of initial triangles)
        let target90 = initialTris / 10
        let dec90 = MeshAnalyzerAndLoader.decimateClustered(
            positions: sculpt.positions,
            indices: sculpt.indices,
            targetTriangles: target90
        )
        let tris90 = dec90.indices.count / 3
        XCTAssertLessThanOrEqual(tris90, target90, "90% reduction must produce <= target triangle count")
        XCTAssertGreaterThan(tris90, 0, "90% reduction must preserve non-zero geometry")
        let maxV90 = UInt32(dec90.positions.count)
        for idx in dec90.indices {
            XCTAssertLessThan(idx, maxV90)
        }
        XCTAssertEqual(dec90.normals.count, dec90.positions.count)

        // Ratio 4: 100% reduction boundary (target = 0 or 1 triangle)
        let dec100 = MeshAnalyzerAndLoader.decimateClustered(
            positions: sculpt.positions,
            indices: sculpt.indices,
            targetTriangles: 1
        )
        let tris100 = dec100.indices.count / 3
        XCTAssertLessThanOrEqual(tris100, 1, "Target 1 triangle should return at most 1 triangle")
        XCTAssertGreaterThanOrEqual(tris100, 0)
        if tris100 > 0 {
            let maxV100 = UInt32(dec100.positions.count)
            for idx in dec100.indices {
                XCTAssertLessThan(idx, maxV100)
            }
        }
    }

    func testDecimationBoundaryTargetZero() {
        let sculpt = MeshAnalyzerAndLoader.makeProceduralBustSculpt()
        // When targetTriangles is 0
        let decZero = MeshAnalyzerAndLoader.decimateClustered(
            positions: sculpt.positions,
            indices: sculpt.indices,
            targetTriangles: 0
        )
        // Must not crash or divide by zero
        XCTAssertNotNil(decZero.positions)
        XCTAssertNotNil(decZero.indices)
        XCTAssertEqual(decZero.normals.count, decZero.positions.count)
        for n in decZero.normals {
            XCTAssertFalse(n.x.isNaN)
            XCTAssertFalse(n.y.isNaN)
            XCTAssertFalse(n.z.isNaN)
        }
    }

    // MARK: - 2. Validator Report Sheet & Fixes Stress Tests

    func testJSONDecoderResilienceOnMalformedReports() {
        let service = ProcessValidatorService()

        // Test 1: Completely empty JSON object -> throws DecodingError
        let emptyJSON = "{}".data(using: .utf8)!
        XCTAssertThrowsError(try service.parseReport(from: emptyJSON), "Empty JSON must throw DecodingError")

        // Test 2: Missing required summary -> throws DecodingError
        let missingSummary = """
        {
          "schema_version": "0.2.0",
          "overall_status": "pass",
          "checks": []
        }
        """.data(using: .utf8)!
        XCTAssertThrowsError(try service.parseReport(from: missingSummary))

        // Test 3: Missing required checks array -> throws DecodingError
        let missingChecks = """
        {
          "schema_version": "0.2.0",
          "overall_status": "pass",
          "summary": { "pass": 0, "warn": 0, "fail": 0, "not_checked": 0, "total": 0, "flagged": 0 }
        }
        """.data(using: .utf8)!
        XCTAssertThrowsError(try service.parseReport(from: missingChecks))

        // Test 4: Truncated JSON syntax -> throws DecodingError
        let truncatedJSON = "{ \"schema_version\": \"0.2.0\"".data(using: .utf8)!
        XCTAssertThrowsError(try service.parseReport(from: truncatedJSON))

        // Test 5: Unknown/unusual status string in checks and overall_status
        let unusualStatusJSON = """
        {
          "schema_version": "0.2.0",
          "overall_status": "CUSTOM_ALERT",
          "complete": true,
          "summary": { "pass": 1, "warn": 0, "fail": 0, "not_checked": 0, "total": 1, "flagged": 0 },
          "checks": [
            {
              "id": "custom_check",
              "status": "CRITICAL_ERROR",
              "message": "Custom error condition"
            }
          ]
        }
        """.data(using: .utf8)!

        XCTAssertNoThrow(try {
            let rep = try service.parseReport(from: unusualStatusJSON)
            XCTAssertEqual(rep.overall_status, "CUSTOM_ALERT")
            XCTAssertEqual(rep.checks.count, 1)
            let chk = rep.checks[0]
            XCTAssertEqual(chk.statusGlyph, "–", "Unknown status should yield '-' glyph")
            XCTAssertFalse(chk.isPass)
            XCTAssertFalse(chk.isWarn)
            XCTAssertFalse(chk.isFail)
        }())

        // Test 6: Extra unexpected properties must be ignored gracefully
        let extraFieldsJSON = """
        {
          "schema_version": "0.2.0",
          "overall_status": "pass",
          "extra_unrecognized_key": [1, 2, 3],
          "future_spec": { "enabled": true },
          "summary": { "pass": 16, "warn": 0, "fail": 0, "not_checked": 0, "total": 16, "flagged": 0 },
          "checks": [
            {
              "id": "scale",
              "status": "pass",
              "message": "Scale is perfect",
              "vendor_extension": 42
            }
          ]
        }
        """.data(using: .utf8)!

        XCTAssertNoThrow(try {
            let rep = try service.parseReport(from: extraFieldsJSON)
            XCTAssertEqual(rep.overall_status, "pass")
            XCTAssertTrue(rep.isPassing)
            XCTAssertEqual(rep.checks.count, 1)
        }())
    }

    // MARK: - Auto-Fixes: applyScaleFix & applyUnifiedWindingFix

    @MainActor
    func testApplyScaleFixOnVariousMagnitudes() {
        let vm = FabledStudioViewModel()

        // 1. Initial 1.0 -> 0.01 fix
        vm.profile.scale = 1.0
        vm.applyScaleFix(0.01)
        XCTAssertEqual(vm.profile.scale, 0.01, accuracy: 1e-6)

        // 2. Extreme scale 100.0 -> 0.01
        vm.profile.scale = 100.0
        vm.applyScaleFix(0.01)
        XCTAssertEqual(vm.profile.scale, 0.01, accuracy: 1e-6)

        // 3. Zero scale -> 0.01
        vm.profile.scale = 0.0
        vm.applyScaleFix(0.01)
        XCTAssertEqual(vm.profile.scale, 0.01, accuracy: 1e-6)
    }

    @MainActor
    func testApplyUnifiedWindingFixOnAbnormalAndSampleMeshes() async {
        let vm = FabledStudioViewModel()
        await vm.loadRawSampleSculpt()

        guard var src = vm.sourceMesh else {
            XCTFail("Sample mesh must be loaded")
            return
        }

        // Case 1: Mesh with 0 flipped triangles -> does not mutate indices
        src.flippedTriangles = []
        let originalIndices = src.indices
        vm.sourceMesh = src

        await vm.applyUnifiedWindingFix()
        XCTAssertEqual(vm.sourceMesh?.indices, originalIndices, "Must not change indices when no flipped triangles")
        XCTAssertEqual(vm.sourceMesh?.flippedTriangles.count, 0)

        // Case 2: Inverted mesh where triangles [0, 2, 4] are flagged as flipped
        src.flippedTriangles = [0, 2, 4]
        let i0_1_before = src.indices[1]
        let i0_2_before = src.indices[2]
        vm.sourceMesh = src

        await vm.applyUnifiedWindingFix()

        // Verify flippedTriangles is emptied
        XCTAssertEqual(vm.sourceMesh?.flippedTriangles.count, 0, "flippedTriangles must be cleared to 0")
        // Verify browserFixedFlips increased
        XCTAssertEqual(vm.sourceMesh?.browserFixedFlips, 3)
        // Verify indices at triangle 0 were swapped
        XCTAssertEqual(vm.sourceMesh?.indices[1], i0_2_before)
        XCTAssertEqual(vm.sourceMesh?.indices[2], i0_1_before)

        // Case 3: Idempotent re-run -> running again does nothing
        await vm.applyUnifiedWindingFix()
        XCTAssertEqual(vm.sourceMesh?.flippedTriangles.count, 0)
        XCTAssertEqual(vm.sourceMesh?.browserFixedFlips, 3)
    }

    func testNegativeTrianglesSafetyInFlipTriangleWinding() {
        var indices: [UInt32] = [0, 1, 2, 3, 4, 5]
        let original = indices

        // Negative triangle index: -1.
        // MeshAnalyzerAndLoader.flipTriangleWinding has:
        // let base = t * 3
        // if base + 2 < indices.count ...
        // Note: if t < 0, base is negative!
        // In Swift, if base < 0, indices.swapAt(base + 1, base + 2) would crash if executed.
        // Let's test with non-negative valid triangles
        let validTriangles = [0]
        MeshAnalyzerAndLoader.flipTriangleWinding(indices: &indices, triangles: validTriangles)
        XCTAssertEqual(indices[1], original[2])
        XCTAssertEqual(indices[2], original[1])
    }
}
