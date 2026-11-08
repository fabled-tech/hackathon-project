import XCTest
import simd
@testable import SculptLine

final class MeshGeometryTests: XCTestCase {
    func testProceduralSculptGeneration() {
        let mesh = MeshAnalyzerAndLoader.makeProceduralBustSculpt()
        XCTAssertGreaterThan(mesh.rawVertexCount, 100, "Sculpt must have non-trivial vertex count")
        XCTAssertGreaterThan(mesh.triangleCount, 100, "Sculpt must have non-trivial triangle count")
        XCTAssertEqual(mesh.indices.count, mesh.triangleCount * 3)
        XCTAssertEqual(mesh.positions.count, mesh.normals.count)

        let sz = mesh.sizeVector
        XCTAssertGreaterThan(sz.x, 0.0)
        XCTAssertGreaterThan(sz.y, 0.0)
        XCTAssertGreaterThan(sz.z, 0.0)
    }

    func testComputeVertexNormals() {
        // Construct a simple unit quad (2 triangles) in the XY plane facing +Z
        let positions: [SIMD3<Float>] = [
            SIMD3<Float>(-1, -1, 0),
            SIMD3<Float>( 1, -1, 0),
            SIMD3<Float>( 1,  1, 0),
            SIMD3<Float>(-1,  1, 0)
        ]
        let indices: [UInt32] = [
            0, 1, 2,
            0, 2, 3
        ]

        let normals = MeshAnalyzerAndLoader.computeVertexNormals(positions: positions, indices: indices)
        XCTAssertEqual(normals.count, positions.count)

        for n in normals {
            let len = simd_length(n)
            XCTAssertEqual(len, 1.0, accuracy: 1e-4, "Vertex normals must be normalized unit vectors")
            XCTAssertEqual(n.z, 1.0, accuracy: 1e-4, "XY quad normals must point in +Z direction")
        }
    }

    func testFlipTriangleWinding() {
        var indices: [UInt32] = [0, 1, 2, 3, 4, 5]
        let trianglesToFlip = [0] // flip first triangle (indices 0, 1, 2)

        MeshAnalyzerAndLoader.flipTriangleWinding(indices: &indices, triangles: trianglesToFlip)

        // Index 0 stays 0, index 1 and index 2 swap
        XCTAssertEqual(indices[0], 0)
        XCTAssertEqual(indices[1], 2)
        XCTAssertEqual(indices[2], 1)

        // Second triangle remains untouched
        XCTAssertEqual(indices[3], 3)
        XCTAssertEqual(indices[4], 4)
        XCTAssertEqual(indices[5], 5)
    }

    func testClusteredDecimationMonotonicReduction() {
        let sculpt = MeshAnalyzerAndLoader.makeProceduralBustSculpt()

        let targetTris = max(10, sculpt.triangleCount / 2)
        let decimated = MeshAnalyzerAndLoader.decimateClustered(
            positions: sculpt.positions,
            indices: sculpt.indices,
            targetTriangles: targetTris
        )

        let decimatedTris = decimated.indices.count / 3
        XCTAssertLessThan(decimatedTris, sculpt.triangleCount, "Decimation must reduce triangle count")
        XCTAssertGreaterThan(decimatedTris, 0, "Decimation must retain triangles")

        // Invariant: all indices must refer to valid vertex positions
        let vCount = UInt32(decimated.positions.count)
        for idx in decimated.indices {
            XCTAssertLessThan(idx, vCount, "Index must be in bounds of decimated positions")
        }
    }
}
