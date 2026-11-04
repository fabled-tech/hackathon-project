// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FabledStudio",
    platforms: [
        .macOS(.v14),
        .iOS(.v17)
    ],
    products: [
        .executable(name: "FabledStudio", targets: ["FabledStudio"])
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "FabledStudio",
            path: "Sources"
        ),
        .testTarget(
            name: "FabledStudioTests",
            dependencies: ["FabledStudio"],
            path: "Tests"
        )
    ]
)
