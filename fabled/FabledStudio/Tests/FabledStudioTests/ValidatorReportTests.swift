import XCTest
@testable import FabledStudio

final class ValidatorReportTests: XCTestCase {
    func testSchema020JSONReportDecoding() throws {
        let jsonString = """
        {
          "schema_version": "0.2.0",
          "tool": {"name": "fabled_validator", "version": "0.2.0"},
          "overall_status": "warn",
          "complete": true,
          "summary": {
            "pass": 10,
            "warn": 3,
            "fail": 0,
            "not_checked": 3,
            "total": 16,
            "flagged": 3
          },
          "checks": [
            {
              "id": "scale",
              "group": "Scale & Orientation",
              "title": "Bounding-box dimensions",
              "status": "warn",
              "message": "Height 5310.0 cm is 100x target. Mismatched units.",
              "fix_hint": "Apply 0.01 scale factor in Import Profile."
            },
            {
              "id": "normals",
              "group": "Normals & Winding",
              "title": "Face winding & normal orientation",
              "status": "pass",
              "message": "Consistent outward winding across 25,000 triangles.",
              "fix_hint": null
            }
          ]
        }
        """

        guard let data = jsonString.data(using: .utf8) else {
            XCTFail("Failed to convert json to Data")
            return
        }

        let service = ProcessValidatorService()
        let report = try service.parseReport(from: data)

        XCTAssertEqual(report.schema_version, "0.2.0")
        XCTAssertEqual(report.overall_status, "warn")
        XCTAssertTrue(report.isFlagged)
        XCTAssertFalse(report.isPassing)
        XCTAssertEqual(report.summary.pass, 10)
        XCTAssertEqual(report.summary.warn, 3)
        XCTAssertEqual(report.summary.fail, 0)
        XCTAssertEqual(report.summary.total, 16)
        XCTAssertEqual(report.summary.flagged, 3)

        XCTAssertEqual(report.checks.count, 2)
        XCTAssertEqual(report.checks[0].id, "scale")
        XCTAssertTrue(report.checks[0].isWarn)
        XCTAssertEqual(report.checks[0].measuredScaleFactor, 0.01)
        XCTAssertEqual(report.checks[0].statusGlyph, "!")

        XCTAssertEqual(report.checks[1].id, "normals")
        XCTAssertTrue(report.checks[1].isPass)
        XCTAssertEqual(report.checks[1].statusGlyph, "✓")
    }

    func testFallbackValidatorReportGeneration() {
        let service = ProcessValidatorService()
        let report = service.generateFallbackReport(assetName: "TestAsset")

        XCTAssertEqual(report.schema_version, "0.2.0")
        XCTAssertEqual(report.summary.total, 16, "Fallback report must cover all 16 standard checks")
        XCTAssertEqual(report.checks.count, 16)

        let checkIDs = report.checks.map { $0.id }
        for stdCheck in StandardValidatorCheckID.allCases {
            XCTAssertTrue(checkIDs.contains(stdCheck.rawValue), "Missing standard check: \(stdCheck.rawValue)")
        }
    }
}
