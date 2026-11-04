import Foundation
import SceneKit
import simd

enum MeshLoaderError: Error {
    case invalidFile
    case unsupportedFormat(String)
}

enum MeshAnalyzerAndLoader {

    // MARK: - Load .glb or .obj

    static func loadMesh(from url: URL) throws -> LoadedMeshData {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "glb":
            return try parseGLB(url: url)
        case "obj":
            return try parseOBJ(url: url)
        default:
            throw MeshLoaderError.unsupportedFormat(ext)
        }
    }

    // MARK: - Binary GLB 2.0 Parser

    private static func parseGLB(url: URL) throws -> LoadedMeshData {
        let data = try Data(contentsOf: url)
        guard data.count >= 20 else { throw MeshLoaderError.invalidFile }

        let magic = data.withUnsafeBytes { $0.load(fromByteOffset: 0, as: UInt32.self) }
        guard magic == 0x46546C67 else { throw MeshLoaderError.invalidFile } // "glTF"

        let jsonChunkLen = Int(data.withUnsafeBytes { $0.load(fromByteOffset: 12, as: UInt32.self) })
        let jsonData = data.subdata(in: 20 ..< (20 + jsonChunkLen))
        let binChunkHeaderOffset = 20 + jsonChunkLen
        guard data.count >= binChunkHeaderOffset + 8 else { throw MeshLoaderError.invalidFile }
        let binStart = binChunkHeaderOffset + 8

        guard let gltf = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let accessors = gltf["accessors"] as? [[String: Any]],
              let bufferViews = gltf["bufferViews"] as? [[String: Any]],
              let meshes = gltf["meshes"] as? [[String: Any]] else {
            throw MeshLoaderError.invalidFile
        }

        func readFloatVec3(accessorIdx: Int) -> [SIMD3<Float>] {
            guard accessorIdx < accessors.count else { return [] }
            let acc = accessors[accessorIdx]
            guard let bvIdx = acc["bufferView"] as? Int, bvIdx < bufferViews.count else { return [] }
            let bv = bufferViews[bvIdx]
            let count = (acc["count"] as? Int) ?? 0
            let byteOffset = binStart + ((bv["byteOffset"] as? Int) ?? 0) + ((acc["byteOffset"] as? Int) ?? 0)
            let stride = (bv["byteStride"] as? Int) ?? 12
            var out: [SIMD3<Float>] = []
            out.reserveCapacity(count)
            data.withUnsafeBytes { raw in
                for i in 0 ..< count {
                    let off = byteOffset + i * stride
                    if off + 12 <= data.count {
                        let x = raw.loadUnaligned(fromByteOffset: off, as: Float.self)
                        let y = raw.loadUnaligned(fromByteOffset: off + 4, as: Float.self)
                        let z = raw.loadUnaligned(fromByteOffset: off + 8, as: Float.self)
                        out.append(SIMD3<Float>(x, y, z))
                    }
                }
            }
            return out
        }

        func readFloatVec2(accessorIdx: Int) -> [SIMD2<Float>] {
            guard accessorIdx < accessors.count else { return [] }
            let acc = accessors[accessorIdx]
            guard let bvIdx = acc["bufferView"] as? Int, bvIdx < bufferViews.count else { return [] }
            let bv = bufferViews[bvIdx]
            let count = (acc["count"] as? Int) ?? 0
            let byteOffset = binStart + ((bv["byteOffset"] as? Int) ?? 0) + ((acc["byteOffset"] as? Int) ?? 0)
            let stride = (bv["byteStride"] as? Int) ?? 8
            var out: [SIMD2<Float>] = []
            out.reserveCapacity(count)
            data.withUnsafeBytes { raw in
                for i in 0 ..< count {
                    let off = byteOffset + i * stride
                    if off + 8 <= data.count {
                        let u = raw.loadUnaligned(fromByteOffset: off, as: Float.self)
                        let v = raw.loadUnaligned(fromByteOffset: off + 4, as: Float.self)
                        out.append(SIMD2<Float>(u, v))
                    }
                }
            }
            return out
        }

        func readIndices(accessorIdx: Int) -> [UInt32] {
            guard accessorIdx < accessors.count else { return [] }
            let acc = accessors[accessorIdx]
            guard let bvIdx = acc["bufferView"] as? Int, bvIdx < bufferViews.count else { return [] }
            let bv = bufferViews[bvIdx]
            let count = (acc["count"] as? Int) ?? 0
            let componentType = (acc["componentType"] as? Int) ?? 5125
            let byteOffset = binStart + ((bv["byteOffset"] as? Int) ?? 0) + ((acc["byteOffset"] as? Int) ?? 0)
            var out: [UInt32] = []
            out.reserveCapacity(count)
            data.withUnsafeBytes { raw in
                for i in 0 ..< count {
                    switch componentType {
                    case 5123: // UNSIGNED_SHORT
                        let off = byteOffset + i * 2
                        if off + 2 <= data.count {
                            let v = raw.loadUnaligned(fromByteOffset: off, as: UInt16.self)
                            out.append(UInt32(v))
                        }
                    case 5121: // UNSIGNED_BYTE
                        let off = byteOffset + i
                        if off + 1 <= data.count {
                            let v = raw.loadUnaligned(fromByteOffset: off, as: UInt8.self)
                            out.append(UInt32(v))
                        }
                    default: // 5125 UNSIGNED_INT
                        let off = byteOffset + i * 4
                        if off + 4 <= data.count {
                            let v = raw.loadUnaligned(fromByteOffset: off, as: UInt32.self)
                            out.append(v)
                        }
                    }
                }
            }
            return out
        }

        var allPositions: [SIMD3<Float>] = []
        var allNormals: [SIMD3<Float>] = []
        var allUVs: [SIMD2<Float>] = []
        var allIndices: [UInt32] = []

        for mesh in meshes {
            guard let primitives = mesh["primitives"] as? [[String: Any]] else { continue }
            for prim in primitives {
                guard let attrs = prim["attributes"] as? [String: Any],
                      let posAcc = attrs["POSITION"] as? Int else { continue }
                let baseVertex = UInt32(allPositions.count)
                let pos = readFloatVec3(accessorIdx: posAcc)
                allPositions.append(contentsOf: pos)

                if let normAcc = attrs["NORMAL"] as? Int {
                    let nrm = readFloatVec3(accessorIdx: normAcc)
                    allNormals.append(contentsOf: nrm)
                }
                if let uvAcc = attrs["TEXCOORD_0"] as? Int {
                    let uvs = readFloatVec2(accessorIdx: uvAcc)
                    allUVs.append(contentsOf: uvs)
                }
                if let idxAcc = prim["indices"] as? Int {
                    let idx = readIndices(accessorIdx: idxAcc)
                    allIndices.append(contentsOf: idx.map { $0 + baseVertex })
                } else {
                    allIndices.append(contentsOf: (0 ..< UInt32(pos.count)).map { $0 + baseVertex })
                }
            }
        }

        return buildLoadedMeshData(
            fileName: url.lastPathComponent,
            format: "glb",
            positions: allPositions,
            indices: allIndices,
            normals: allNormals,
            texcoords: allUVs
        )
    }

    // MARK: - Wavefront OBJ Parser

    private static func parseOBJ(url: URL) throws -> LoadedMeshData {
        let text = try String(contentsOf: url, encoding: .utf8)
        var positions: [SIMD3<Float>] = []
        var indices: [UInt32] = []

        for line in text.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("v ") {
                let parts = trimmed.split(separator: " ", omittingEmptySubsequences: true)
                if parts.count >= 4,
                   let x = Float(parts[1]),
                   let y = Float(parts[2]),
                   let z = Float(parts[3]) {
                    positions.append(SIMD3<Float>(x, y, z))
                }
            } else if trimmed.hasPrefix("f ") {
                let parts = trimmed.split(separator: " ", omittingEmptySubsequences: true)
                if parts.count >= 4 {
                    var faceVerts: [UInt32] = []
                    for tok in parts.dropFirst() {
                        let firstNum = tok.split(separator: "/").first ?? tok
                        if let idx = Int(firstNum) {
                            let resolved = idx > 0 ? idx - 1 : positions.count + idx
                            if resolved >= 0 && resolved < positions.count {
                                faceVerts.append(UInt32(resolved))
                            }
                        }
                    }
                    if faceVerts.count >= 3 {
                        for k in 1 ..< (faceVerts.count - 1) {
                            indices.append(faceVerts[0])
                            indices.append(faceVerts[k])
                            indices.append(faceVerts[k + 1])
                        }
                    }
                }
            }
        }

        return buildLoadedMeshData(
            fileName: url.lastPathComponent,
            format: "obj",
            positions: positions,
            indices: indices,
            normals: [],
            texcoords: []
        )
    }

    // MARK: - Topology Analysis & Normals Winding Check

    private static func buildLoadedMeshData(
        fileName: String,
        format: String,
        positions: [SIMD3<Float>],
        indices: [UInt32],
        normals: [SIMD3<Float>],
        texcoords: [SIMD2<Float>]
    ) -> LoadedMeshData {
        var bmin = SIMD3<Float>(repeating: Float.greatestFiniteMagnitude)
        var bmax = SIMD3<Float>(repeating: -Float.greatestFiniteMagnitude)
        for p in positions {
            bmin = simd_min(bmin, p)
            bmax = simd_max(bmax, p)
        }
        if positions.isEmpty {
            bmin = .zero
            bmax = .zero
        }

        // Compute smooth vertex normals if absent or incomplete
        let computedNormals: [SIMD3<Float>] = (normals.count == positions.count)
            ? normals
            : computeVertexNormals(positions: positions, indices: indices)

        // Weld vertices by quantized coordinates to inspect manifold topology & winding
        let diff = bmax - bmin
        let extent = max(Float(1e-6), max(diff.x, max(diff.y, diff.z)))
        let scale = 100_000.0 / extent
        struct QuantKey: Hashable {
            let x: Int32
            let y: Int32
            let z: Int32
        }
        var weldMap: [QuantKey: UInt32] = [:]
        weldMap.reserveCapacity(positions.count / 2)
        var weldedPositions: [SIMD3<Float>] = []
        var remap = [UInt32](repeating: 0, count: positions.count)

        for (i, p) in positions.enumerated() {
            let key = QuantKey(
                x: Int32((p.x - bmin.x) * scale),
                y: Int32((p.y - bmin.y) * scale),
                z: Int32((p.z - bmin.z) * scale)
            )
            if let existing = weldMap[key] {
                remap[i] = existing
            } else {
                let nextIdx = UInt32(weldedPositions.count)
                weldMap[key] = nextIdx
                weldedPositions.append(p)
                remap[i] = nextIdx
            }
        }

        let triCount = indices.count / 3
        struct UndirectedEdge: Hashable {
            let a: UInt32
            let b: UInt32
            init(_ u: UInt32, _ v: UInt32) {
                if u < v { a = u; b = v } else { a = v; b = u }
            }
        }

        // Fast edge table and normal/winding orientation check
        var edgeUseCount: [UndirectedEdge: Int] = [:]
        edgeUseCount.reserveCapacity(triCount * 2)
        var degenerateCount = 0
        var flippedTriangles: [Int] = []

        let hasAuthorNormals = (normals.count == positions.count)

        for t in 0 ..< triCount {
            let i0 = Int(indices[t * 3])
            let i1 = Int(indices[t * 3 + 1])
            let i2 = Int(indices[t * 3 + 2])
            let w0 = remap[i0]
            let w1 = remap[i1]
            let w2 = remap[i2]
            if w0 == w1 || w1 == w2 || w2 == w0 {
                degenerateCount += 1
                continue
            }
            edgeUseCount[UndirectedEdge(w0, w1), default: 0] += 1
            edgeUseCount[UndirectedEdge(w1, w2), default: 0] += 1
            edgeUseCount[UndirectedEdge(w2, w0), default: 0] += 1

            if hasAuthorNormals {
                let p0 = positions[i0], p1 = positions[i1], p2 = positions[i2]
                let fn = simd_cross(p1 - p0, p2 - p0)
                let vn = normals[i0] + normals[i1] + normals[i2]
                if simd_dot(fn, vn) < 0 {
                    flippedTriangles.append(t)
                }
            }
        }

        var boundaryEdges = 0
        var nonManifoldEdges = 0
        for (_, count) in edgeUseCount {
            if count == 1 { boundaryEdges += 1 }
            else if count > 2 { nonManifoldEdges += 1 }
        }

        return LoadedMeshData(
            fileName: fileName,
            displayName: fileName,
            format: format,
            positions: positions,
            indices: indices,
            normals: computedNormals,
            texcoords: texcoords,
            rawVertexCount: positions.count,
            weldedVertexCount: weldedPositions.count,
            triangleCount: triCount,
            bboxMin: bmin,
            bboxMax: bmax,
            boundaryEdges: boundaryEdges,
            nonManifoldEdges: nonManifoldEdges,
            degenerateTriangles: degenerateCount,
            flippedTriangles: flippedTriangles,
            connectedComponents: 1
        )
    }

    static func computeVertexNormals(positions: [SIMD3<Float>], indices: [UInt32]) -> [SIMD3<Float>] {
        var acc = [SIMD3<Float>](repeating: .zero, count: positions.count)
        let triCount = indices.count / 3
        for t in 0 ..< triCount {
            let i0 = Int(indices[t * 3])
            let i1 = Int(indices[t * 3 + 1])
            let i2 = Int(indices[t * 3 + 2])
            let fn = simd_cross(positions[i1] - positions[i0], positions[i2] - positions[i0])
            acc[i0] += fn
            acc[i1] += fn
            acc[i2] += fn
        }
        return acc.map { n in
            let len = simd_length(n)
            return len > 1e-8 ? (n / len) : SIMD3<Float>(0, 1, 0)
        }
    }

    static func flipTriangleWinding(indices: inout [UInt32], triangles: [Int]) {
        for t in triangles {
            let base = t * 3
            if base + 2 < indices.count {
                indices.swapAt(base + 1, base + 2)
            }
        }
    }

    // MARK: - Fast Spatial Vertex-Cluster Decimator (for in-app LOD previews)

    static func decimateClustered(
        positions: [SIMD3<Float>],
        indices: [UInt32],
        targetTriangles: Int
    ) -> (positions: [SIMD3<Float>], indices: [UInt32], normals: [SIMD3<Float>]) {
        let currentTris = indices.count / 3
        if currentTris <= targetTriangles || positions.isEmpty {
            return (positions, indices, computeVertexNormals(positions: positions, indices: indices))
        }

        var bmin = SIMD3<Float>(repeating: Float.greatestFiniteMagnitude)
        var bmax = SIMD3<Float>(repeating: -Float.greatestFiniteMagnitude)
        for p in positions {
            bmin = simd_min(bmin, p)
            bmax = simd_max(bmax, p)
        }
        let span = simd_max(bmax - bmin, SIMD3<Float>(repeating: 1e-5))
        let gridRes = max(8, Int(pow(Double(targetTriangles) * 1.4, 1.0 / 3.0)))
        let invStep = Float(gridRes) / span

        struct CellKey: Hashable {
            let x: Int32
            let y: Int32
            let z: Int32
        }

        var cellMap: [CellKey: UInt32] = [:]
        var sums: [SIMD3<Float>] = []
        var counts: [Float] = []
        var remap = [UInt32](repeating: 0, count: positions.count)

        for (i, p) in positions.enumerated() {
            let rel = (p - bmin) * invStep
            let key = CellKey(x: Int32(rel.x), y: Int32(rel.y), z: Int32(rel.z))
            if let cid = cellMap[key] {
                sums[Int(cid)] += p
                counts[Int(cid)] += 1
                remap[i] = cid
            } else {
                let cid = UInt32(sums.count)
                cellMap[key] = cid
                sums.append(p)
                counts.append(1)
                remap[i] = cid
            }
        }

        let newPositions = zip(sums, counts).map { $0 / $1 }
        var newIndices: [UInt32] = []
        newIndices.reserveCapacity(min(indices.count, targetTriangles * 3))

        for t in 0 ..< currentTris {
            let a = remap[Int(indices[t * 3])]
            let b = remap[Int(indices[t * 3 + 1])]
            let c = remap[Int(indices[t * 3 + 2])]
            if a != b && b != c && c != a {
                newIndices.append(a)
                newIndices.append(b)
                newIndices.append(c)
                if newIndices.count / 3 >= targetTriangles {
                    break
                }
            }
        }

        let newNormals = computeVertexNormals(positions: newPositions, indices: newIndices)
        return (newPositions, newIndices, newNormals)
    }

    // MARK: - Procedural Fallback Sculpt

    static func makeProceduralBustSculpt() -> LoadedMeshData {
        var positions: [SIMD3<Float>] = []
        var normals: [SIMD3<Float>] = []
        var indices: [UInt32] = []
        let rings = 48
        let slices = 64

        for r in 0 ... rings {
            let v = Float(r) / Float(rings)
            let phi = v * .pi
            for s in 0 ... slices {
                let u = Float(s) / Float(slices)
                let theta = u * 2.0 * .pi
                let radius: Float = 2.6 * (1.0 - 0.18 * cos(2.0 * phi))
                let x = radius * sin(phi) * cos(theta) * 0.85
                let y = radius * cos(phi) * 1.05
                let z = radius * sin(phi) * sin(theta) * 0.92
                let p = SIMD3<Float>(x, y, z)
                positions.append(p)
                normals.append(simd_normalize(p))
            }
        }

        for r in 0 ..< rings {
            for s in 0 ..< slices {
                let a = UInt32(r * (slices + 1) + s)
                let b = a + UInt32(slices + 1)
                indices.append(contentsOf: [a, b, a + 1, b, b + 1, a + 1])
            }
        }

        return buildLoadedMeshData(
            fileName: "fabled_sample_head.glb",
            format: "glb",
            positions: positions,
            indices: indices,
            normals: normals,
            texcoords: []
        )
    }

    // MARK: - SceneKit Geometry Builders

    static func makeSCNGeometry(
        positions: [SIMD3<Float>],
        indices: [UInt32],
        normals: [SIMD3<Float>],
        texcoords: [SIMD2<Float>]
    ) -> SCNGeometry {
        let vertexData = positions.withUnsafeBufferPointer { Data(buffer: $0) }
        let vertexSource = SCNGeometrySource(
            data: vertexData,
            semantic: .vertex,
            vectorCount: positions.count,
            usesFloatComponents: true,
            componentsPerVector: 3,
            bytesPerComponent: MemoryLayout<Float>.size,
            dataOffset: 0,
            dataStride: MemoryLayout<SIMD3<Float>>.stride
        )

        var sources: [SCNGeometrySource] = [vertexSource]

        if normals.count == positions.count {
            let normalData = normals.withUnsafeBufferPointer { Data(buffer: $0) }
            let normalSource = SCNGeometrySource(
                data: normalData,
                semantic: .normal,
                vectorCount: normals.count,
                usesFloatComponents: true,
                componentsPerVector: 3,
                bytesPerComponent: MemoryLayout<Float>.size,
                dataOffset: 0,
                dataStride: MemoryLayout<SIMD3<Float>>.stride
            )
            sources.append(normalSource)
        }

        if texcoords.count == positions.count {
            let uvData = texcoords.withUnsafeBufferPointer { Data(buffer: $0) }
            let uvSource = SCNGeometrySource(
                data: uvData,
                semantic: .texcoord,
                vectorCount: texcoords.count,
                usesFloatComponents: true,
                componentsPerVector: 2,
                bytesPerComponent: MemoryLayout<Float>.size,
                dataOffset: 0,
                dataStride: MemoryLayout<SIMD2<Float>>.stride
            )
            sources.append(uvSource)
        }

        let indexData = indices.withUnsafeBufferPointer { Data(buffer: $0) }
        let element = SCNGeometryElement(
            data: indexData,
            primitiveType: .triangles,
            primitiveCount: indices.count / 3,
            bytesPerIndex: MemoryLayout<UInt32>.size
        )

        return SCNGeometry(sources: sources, elements: [element])
    }

    static func makeFlippedOverlayGeometry(
        positions: [SIMD3<Float>],
        normals: [SIMD3<Float>],
        indices: [UInt32],
        flippedTriangles: [Int],
        offsetScale: Float
    ) -> SCNGeometry? {
        guard !flippedTriangles.isEmpty else { return nil }
        var overlayPositions: [SIMD3<Float>] = []
        var overlayIndices: [UInt32] = []
        overlayPositions.reserveCapacity(flippedTriangles.count * 3)
        overlayIndices.reserveCapacity(flippedTriangles.count * 3)

        for tri in flippedTriangles {
            let base = tri * 3
            guard base + 2 < indices.count else { continue }
            for k in 0 ..< 3 {
                let vi = Int(indices[base + k])
                let p = positions[vi]
                let n = vi < normals.count ? normals[vi] : SIMD3<Float>(0, 1, 0)
                let newIdx = UInt32(overlayPositions.count)
                overlayPositions.append(p + n * offsetScale)
                overlayIndices.append(newIdx)
            }
        }

        let vData = overlayPositions.withUnsafeBufferPointer { Data(buffer: $0) }
        let vSource = SCNGeometrySource(
            data: vData,
            semantic: .vertex,
            vectorCount: overlayPositions.count,
            usesFloatComponents: true,
            componentsPerVector: 3,
            bytesPerComponent: MemoryLayout<Float>.size,
            dataOffset: 0,
            dataStride: MemoryLayout<SIMD3<Float>>.stride
        )
        let iData = overlayIndices.withUnsafeBufferPointer { Data(buffer: $0) }
        let elem = SCNGeometryElement(
            data: iData,
            primitiveType: .triangles,
            primitiveCount: overlayIndices.count / 3,
            bytesPerIndex: MemoryLayout<UInt32>.size
        )
        let geom = SCNGeometry(sources: [vSource], elements: [elem])
        let mat = SCNMaterial()
        mat.lightingModel = .constant
        #if os(macOS)
        mat.diffuse.contents = NSColor(calibratedRed: 0.85, green: 0.18, blue: 0.12, alpha: 0.92)
        #else
        mat.diffuse.contents = UIColor(red: 0.85, green: 0.18, blue: 0.12, alpha: 0.92)
        #endif
        mat.isDoubleSided = true
        geom.materials = [mat]
        return geom
    }
}
