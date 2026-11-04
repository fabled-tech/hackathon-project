import XCTest
@testable import FabledStudio

final class PipelineAndTelemetryTests: XCTestCase {
    func testProgressJSONDecoding() throws {
        let jsonString = """
        {
          "step": 3,
          "total": 8,
          "name": "uv_unwrap",
          "label": "UV unwrap + pack",
          "done": false,
          "status": "running",
          "updated_at": "2026-11-04T05:00:00+00:00"
        }
        """

        guard let data = jsonString.data(using: .utf8) else {
            XCTFail("Failed to convert jsonString to Data")
            return
        }

        let decoder = JSONDecoder()
        let progress = try decoder.decode(PipelineProgress.self, from: data)

        XCTAssertEqual(progress.step, 3)
        XCTAssertEqual(progress.total, 8)
        XCTAssertEqual(progress.name, "uv_unwrap")
        XCTAssertEqual(progress.label, "UV unwrap + pack")
        XCTAssertFalse(progress.done)
        XCTAssertEqual(progress.status, "running")
        XCTAssertEqual(progress.updated_at, "2026-11-04T05:00:00+00:00")

        // In-progress fraction check
        XCTAssertGreaterThan(progress.progressFraction, 0.25)
        XCTAssertLessThan(progress.progressFraction, 0.50)
    }

    func testPipelineEngineCLIArgumentGeneration() {
        let nativeEngine = PipelineEngine.native
        XCTAssertEqual(nativeEngine.cliArgument(blenderPath: "/opt/homebrew/bin/blender"), "none")

        let blenderEngine = PipelineEngine.blender
        let customPath = "/custom/path/to/blender"
        let fallbackPath = blenderEngine.cliArgument(blenderPath: customPath)
        XCTAssertFalse(fallbackPath.isEmpty)
        XCTAssertNotEqual(fallbackPath, "none")
    }

    func testHostBlenderDetection() {
        let detection = BlenderDetection.detectHostBlender()
        // If Blender is installed at /opt/homebrew/bin/blender on this machine, test should report availability
        if FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/blender") {
            XCTAssertTrue(detection.isAvailable)
            XCTAssertNotNil(detection.path)
        }
    }

    func testStandardPipelineStagesPlan() {
        let stages = PipelineStageInfo.allStages
        XCTAssertEqual(stages.count, 8, "Pipeline must comprise 8 discrete stages")

        XCTAssertEqual(stages[0].key, "01")
        XCTAssertEqual(stages[0].name, "import_measure")

        XCTAssertEqual(stages[1].key, "02")
        XCTAssertEqual(stages[1].name, "retopology")

        XCTAssertEqual(stages[2].key, "03")
        XCTAssertEqual(stages[2].name, "uv_unwrap")

        XCTAssertEqual(stages[3].key, "04")
        XCTAssertEqual(stages[3].name, "lod_generation")

        XCTAssertEqual(stages[4].key, "05")
        XCTAssertEqual(stages[4].name, "texture_bake")

        XCTAssertEqual(stages[5].key, "06")
        XCTAssertEqual(stages[5].name, "fbx_export")

        XCTAssertEqual(stages[6].key, "07")
        XCTAssertEqual(stages[6].name, "previews")

        XCTAssertEqual(stages[7].key, "08")
        XCTAssertEqual(stages[7].name, "preview_composites")
    }
}
