import SceneKit
import SwiftUI

struct SyncedSceneView: View {
    let positions: [SIMD3<Float>]
    let indices: [UInt32]
    let normals: [SIMD3<Float>]
    let texcoords: [SIMD2<Float>]
    let flippedTriangles: [Int]
    let showFlippedHighlight: Bool
    let showWireframe: Bool
    let showBakedMaps: Bool
    let normalMapURL: URL?
    let ormMapURL: URL?
    let syncEnabled: Bool
    @Binding var azimuth: Float
    @Binding var elevation: Float
    @Binding var distanceScale: Float

    var body: some View {
        PlatformSceneRepresentable(
            positions: positions,
            indices: indices,
            normals: normals,
            texcoords: texcoords,
            flippedTriangles: flippedTriangles,
            showFlippedHighlight: showFlippedHighlight,
            showWireframe: showWireframe,
            showBakedMaps: showBakedMaps,
            normalMapURL: normalMapURL,
            ormMapURL: ormMapURL,
            syncEnabled: syncEnabled,
            azimuth: $azimuth,
            elevation: $elevation,
            distanceScale: $distanceScale
        )
    }
}

#if os(macOS)
private struct PlatformSceneRepresentable: NSViewRepresentable {
    let positions: [SIMD3<Float>]
    let indices: [UInt32]
    let normals: [SIMD3<Float>]
    let texcoords: [SIMD2<Float>]
    let flippedTriangles: [Int]
    let showFlippedHighlight: Bool
    let showWireframe: Bool
    let showBakedMaps: Bool
    let normalMapURL: URL?
    let ormMapURL: URL?
    let syncEnabled: Bool
    @Binding var azimuth: Float
    @Binding var elevation: Float
    @Binding var distanceScale: Float

    func makeCoordinator() -> SceneOrbitCoordinator {
        SceneOrbitCoordinator(parent: self)
    }

    func makeNSView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero)
        context.coordinator.setupScene(in: view)
        let pan = NSPanGestureRecognizer(target: context.coordinator, action: #selector(SceneOrbitCoordinator.handlePan(_:)))
        view.addGestureRecognizer(pan)
        let mag = NSMagnificationGestureRecognizer(target: context.coordinator, action: #selector(SceneOrbitCoordinator.handleMagnify(_:)))
        view.addGestureRecognizer(mag)
        return view
    }

    func updateNSView(_ nsView: SCNView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.updateScene(in: nsView)
    }
}
#else
private struct PlatformSceneRepresentable: UIViewRepresentable {
    let positions: [SIMD3<Float>]
    let indices: [UInt32]
    let normals: [SIMD3<Float>]
    let texcoords: [SIMD2<Float>]
    let flippedTriangles: [Int]
    let showFlippedHighlight: Bool
    let showWireframe: Bool
    let showBakedMaps: Bool
    let normalMapURL: URL?
    let ormMapURL: URL?
    let syncEnabled: Bool
    @Binding var azimuth: Float
    @Binding var elevation: Float
    @Binding var distanceScale: Float

    func makeCoordinator() -> SceneOrbitCoordinator {
        SceneOrbitCoordinator(parent: self)
    }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero)
        context.coordinator.setupScene(in: view)
        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(SceneOrbitCoordinator.handlePan(_:)))
        view.addGestureRecognizer(pan)
        let pinch = UIPinchGestureRecognizer(target: context.coordinator, action: #selector(SceneOrbitCoordinator.handlePinch(_:)))
        view.addGestureRecognizer(pinch)
        return view
    }

    func updateUIView(_ uiView: SCNView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.updateScene(in: uiView)
    }
}
#endif

// MARK: - Shared Scene & Camera Coordinator

final class SceneOrbitCoordinator: NSObject {
    fileprivate var parent: PlatformSceneRepresentable
    private let scene = SCNScene()
    private let cameraNode = SCNNode()
    private let meshContainerNode = SCNNode()
    private var meshNode: SCNNode?
    private var flippedOverlayNode: SCNNode?

    private var lastVertexCount: Int = -1
    private var lastIndexCount: Int = -1
    private var lastFlippedCount: Int = -1
    private var lastShowMaps: Bool = false
    private var lastNormalURL: URL?
    private var meshRadius: Float = 1.0
    private var meshCenter: SIMD3<Float> = .zero

    private var localAzimuth: Float = 0.35
    private var localElevation: Float = 0.18
    private var localDistanceScale: Float = 1.0
    private var dragStartAzimuth: Float = 0.35
    private var dragStartElevation: Float = 0.18

    fileprivate init(parent: PlatformSceneRepresentable) {
        self.parent = parent
        super.init()
    }

    func setupScene(in view: SCNView) {
        view.scene = scene
        view.antialiasingMode = .multisampling4X
        view.allowsCameraControl = false
        view.autoenablesDefaultLighting = false
        #if os(macOS)
        view.backgroundColor = NSColor(calibratedRed: 0.04, green: 0.05, blue: 0.08, alpha: 1.0)
        #else
        view.backgroundColor = UIColor(red: 0.04, green: 0.05, blue: 0.08, alpha: 1.0)
        #endif

        let camera = SCNCamera()
        camera.fieldOfView = 36
        camera.zNear = 0.01
        camera.zFar = 10000
        cameraNode.camera = camera
        scene.rootNode.addChildNode(cameraNode)
        scene.rootNode.addChildNode(meshContainerNode)

        // Palantir dark studio 3-point lighting with violet rim & cyan fill
        let keyLight = SCNNode()
        keyLight.light = SCNLight()
        keyLight.light?.type = .directional
        keyLight.light?.intensity = 1050
        keyLight.eulerAngles = SCNVector3(-0.6, 0.5, 0)
        scene.rootNode.addChildNode(keyLight)

        let fillLight = SCNNode()
        fillLight.light = SCNLight()
        fillLight.light?.type = .directional
        fillLight.light?.intensity = 520
        #if os(macOS)
        fillLight.light?.color = NSColor(calibratedRed: 0.55, green: 0.36, blue: 0.96, alpha: 1.0)
        #else
        fillLight.light?.color = UIColor(red: 0.55, green: 0.36, blue: 0.96, alpha: 1.0)
        #endif
        fillLight.eulerAngles = SCNVector3(-0.2, -0.9, 0)
        scene.rootNode.addChildNode(fillLight)

        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        ambient.light?.intensity = 310
        scene.rootNode.addChildNode(ambient)

        updateScene(in: view)
    }

    func updateScene(in view: SCNView) {
        if parent.showWireframe {
            view.debugOptions = [.showWireframe]
        } else {
            view.debugOptions = []
        }

        let geometryChanged = (parent.positions.count != lastVertexCount)
            || (parent.indices.count != lastIndexCount)
            || (parent.flippedTriangles.count != lastFlippedCount)
            || (parent.showBakedMaps != lastShowMaps)
            || (parent.normalMapURL != lastNormalURL)

        if geometryChanged {
            rebuildGeometry()
            lastVertexCount = parent.positions.count
            lastIndexCount = parent.indices.count
            lastFlippedCount = parent.flippedTriangles.count
            lastShowMaps = parent.showBakedMaps
            lastNormalURL = parent.normalMapURL
        }

        flippedOverlayNode?.isHidden = !parent.showFlippedHighlight

        let az = parent.syncEnabled ? parent.azimuth : localAzimuth
        let el = parent.syncEnabled ? parent.elevation : localElevation
        let distScale = parent.syncEnabled ? parent.distanceScale : localDistanceScale
        applyCameraOrbit(azimuth: az, elevation: el, distanceScale: distScale)
    }

    private func rebuildGeometry() {
        meshNode?.removeFromParentNode()
        flippedOverlayNode?.removeFromParentNode()

        guard !parent.positions.isEmpty, !parent.indices.isEmpty else { return }

        var bmin = SIMD3<Float>(repeating: Float.greatestFiniteMagnitude)
        var bmax = SIMD3<Float>(repeating: -Float.greatestFiniteMagnitude)
        for p in parent.positions {
            bmin = simd_min(bmin, p)
            bmax = simd_max(bmax, p)
        }
        meshCenter = 0.5 * (bmin + bmax)
        let span = bmax - bmin
        meshRadius = max(0.05, 0.5 * simd_length(span))

        let geom = MeshAnalyzerAndLoader.makeSCNGeometry(
            positions: parent.positions,
            indices: parent.indices,
            normals: parent.normals,
            texcoords: parent.texcoords
        )

        let mat = SCNMaterial()
        mat.lightingModel = .physicallyBased
        #if os(macOS)
        mat.diffuse.contents = NSColor(calibratedRed: 0.78, green: 0.82, blue: 0.89, alpha: 1.0)
        #else
        mat.diffuse.contents = UIColor(red: 0.78, green: 0.82, blue: 0.89, alpha: 1.0)
        #endif
        mat.roughness.contents = 0.52
        mat.metalness.contents = 0.08
        mat.isDoubleSided = true

        if parent.showBakedMaps {
            if let nURL = parent.normalMapURL {
                #if os(macOS)
                if let img = NSImage(contentsOf: nURL) {
                    mat.normal.contents = img
                }
                #else
                if let img = UIImage(contentsOfFile: nURL.path) {
                    mat.normal.contents = img
                }
                #endif
            }
            if let ormURL = parent.ormMapURL {
                #if os(macOS)
                if let img = NSImage(contentsOf: ormURL) {
                    mat.ambientOcclusion.contents = img
                }
                #else
                if let img = UIImage(contentsOfFile: ormURL.path) {
                    mat.ambientOcclusion.contents = img
                }
                #endif
            }
        }

        geom.materials = [mat]
        let node = SCNNode(geometry: geom)
        meshContainerNode.addChildNode(node)
        meshNode = node

        if let flipGeom = MeshAnalyzerAndLoader.makeFlippedOverlayGeometry(
            positions: parent.positions,
            normals: parent.normals,
            indices: parent.indices,
            flippedTriangles: parent.flippedTriangles,
            offsetScale: meshRadius * 0.0025
        ) {
            let flipNode = SCNNode(geometry: flipGeom)
            meshContainerNode.addChildNode(flipNode)
            flippedOverlayNode = flipNode
        }
    }

    private func applyCameraOrbit(azimuth: Float, elevation: Float, distanceScale: Float) {
        let clampedEl = max(-1.35, min(1.35, elevation))
        let r = max(0.05, meshRadius * 2.25 * max(0.35, min(3.5, distanceScale)))
        let cx = meshCenter.x + r * cos(clampedEl) * sin(azimuth)
        let cy = meshCenter.y + r * sin(clampedEl)
        let cz = meshCenter.z + r * cos(clampedEl) * cos(azimuth)

        cameraNode.position = SCNVector3(cx, cy, cz)
        cameraNode.look(at: SCNVector3(meshCenter.x, meshCenter.y, meshCenter.z))
        cameraNode.camera?.zNear = Double(max(0.001, meshRadius * 0.02))
        cameraNode.camera?.zFar = Double(max(100.0, meshRadius * 25.0))
    }

    #if os(macOS)
    @objc func handlePan(_ gesture: NSPanGestureRecognizer) {
        let translation = gesture.translation(in: gesture.view)
        if gesture.state == .began {
            dragStartAzimuth = parent.syncEnabled ? parent.azimuth : localAzimuth
            dragStartElevation = parent.syncEnabled ? parent.elevation : localElevation
        }
        let nextAz = dragStartAzimuth - Float(translation.x) * 0.009
        let nextEl = max(-1.35, min(1.35, dragStartElevation - Float(translation.y) * 0.009))
        localAzimuth = nextAz
        localElevation = nextEl
        if parent.syncEnabled {
            parent.azimuth = nextAz
            parent.elevation = nextEl
        } else {
            applyCameraOrbit(azimuth: localAzimuth, elevation: localElevation, distanceScale: localDistanceScale)
        }
    }

    @objc func handleMagnify(_ gesture: NSMagnificationGestureRecognizer) {
        let current = parent.syncEnabled ? parent.distanceScale : localDistanceScale
        let next = max(0.35, min(3.5, current * Float(1.0 - gesture.magnification * 0.35)))
        gesture.magnification = 0
        localDistanceScale = next
        if parent.syncEnabled {
            parent.distanceScale = next
        } else {
            applyCameraOrbit(azimuth: localAzimuth, elevation: localElevation, distanceScale: localDistanceScale)
        }
    }
    #else
    @objc func handlePan(_ gesture: UIPanGestureRecognizer) {
        let translation = gesture.translation(in: gesture.view)
        if gesture.state == .began {
            dragStartAzimuth = parent.syncEnabled ? parent.azimuth : localAzimuth
            dragStartElevation = parent.syncEnabled ? parent.elevation : localElevation
        }
        let nextAz = dragStartAzimuth - Float(translation.x) * 0.009
        let nextEl = max(-1.35, min(1.35, dragStartElevation + Float(translation.y) * 0.009))
        localAzimuth = nextAz
        localElevation = nextEl
        if parent.syncEnabled {
            parent.azimuth = nextAz
            parent.elevation = nextEl
        } else {
            applyCameraOrbit(azimuth: localAzimuth, elevation: localElevation, distanceScale: localDistanceScale)
        }
    }

    @objc func handlePinch(_ gesture: UIPinchGestureRecognizer) {
        guard gesture.scale > 0 else { return }
        let current = parent.syncEnabled ? parent.distanceScale : localDistanceScale
        let next = max(0.35, min(3.5, current / Float(gesture.scale)))
        gesture.scale = 1.0
        localDistanceScale = next
        if parent.syncEnabled {
            parent.distanceScale = next
        } else {
            applyCameraOrbit(azimuth: localAzimuth, elevation: localElevation, distanceScale: localDistanceScale)
        }
    }
    #endif
}
