// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SculptLine",
    platforms: [
        .macOS(.v14),
        .iOS(.v17)
    ],
    products: [
        .executable(name: "SculptLine", targets: ["SculptLine"])
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "SculptLine",
            path: "Sources"
        ),
        .testTarget(
            name: "SculptLineTests",
            dependencies: ["SculptLine"],
            path: "Tests",
            resources: [.copy("SculptLineTests/Fixtures")]
        )
    ]
)
