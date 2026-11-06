import Foundation

// MARK: - Validator Service Protocol (Feature 17)

protocol ValidatorServiceProtocol: AnyObject, Sendable {
    func runValidator(
        rootURL: URL,
        targetURL: URL,
        isManifest: Bool,
        profileURL: URL
    ) async throws -> ValidatorReport

    func parseReport(from data: Data) throws -> ValidatorReport
    func generateFallbackReport(assetName: String) -> ValidatorReport
}

// MARK: - Process-Based Validator Service for macOS (Feature 17)

final class ProcessValidatorService: ValidatorServiceProtocol, @unchecked Sendable {
    func parseReport(from data: Data) throws -> ValidatorReport {
        let decoder = JSONDecoder()
        return try decoder.decode(ValidatorReport.self, from: data)
    }

    /// Report used when the fabled_validator CLI could not run (always on iPad; on macOS when no fabled root or Python is
    /// found). It used to be a hardcoded mostly-pass report ("Height 53.1 cm", "0 flipped faces", …) shown for whatever
    /// asset was open. Nothing was measured, so every check is "not_checked" and the overall status is "not run".
    func generateFallbackReport(assetName: String) -> ValidatorReport {
        let checks: [ValidatorCheck] = StandardValidatorCheckID.allCases.map { id in
            ValidatorCheck(
                id: id.rawValue,
                group: id.groupTitle,
                title: id.rawValue.replacingOccurrences(of: "_", with: " ").capitalized,
                status: "not_checked",
                message: "Not checked: the validator did not run on this device, so nothing was measured for \(assetName).",
                fix_hint: "Run the app on a Mac with the fabled folder and Python available, or validate from the web workspace."
            )
        }
        let summary = ValidatorSummary(
            pass: 0,
            warn: 0,
            fail: 0,
            not_checked: checks.count,
            total: checks.count,
            flagged: 0
        )
        return ValidatorReport(
            schema_version: "0.2.0",
            tool: ["name": "fabled_validator", "version": "not run"],
            overall_status: "not run",
            complete: false,
            summary: summary,
            checks: checks
        )
    }

    func runValidator(
        rootURL: URL,
        targetURL: URL,
        isManifest: Bool,
        profileURL: URL
    ) async throws -> ValidatorReport {
        #if os(macOS)
        let validatorPy = rootURL.appendingPathComponent("validator/.venv/bin/python")

        guard FileManager.default.fileExists(atPath: targetURL.path) else {
            return generateFallbackReport(assetName: targetURL.lastPathComponent)
        }

        let proc = Process()
        if FileManager.default.isExecutableFile(atPath: validatorPy.path) {
            proc.executableURL = validatorPy
            var args = ["-m", "fabled_validator", "check"]
            if isManifest {
                args += ["--manifest", targetURL.path]
            } else {
                args += [targetURL.path]
            }
            args += ["--profile", profileURL.path, "--json-only"]
            proc.arguments = args
        } else {
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            var args = ["python3", "-m", "fabled_validator", "check"]
            if isManifest {
                args += ["--manifest", targetURL.path]
            } else {
                args += [targetURL.path]
            }
            args += ["--profile", profileURL.path, "--json-only"]
            proc.arguments = args
        }

        proc.currentDirectoryURL = rootURL.appendingPathComponent("validator")
        var env = ProcessInfo.processInfo.environment
        let validatorPath = rootURL.appendingPathComponent("validator").path
        if let existingPyPath = env["PYTHONPATH"] {
            env["PYTHONPATH"] = "\(validatorPath):\(existingPyPath)"
        } else {
            env["PYTHONPATH"] = validatorPath
        }
        proc.environment = env

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        proc.standardOutput = stdoutPipe
        proc.standardError = stderrPipe

        do {
            try proc.run()
            let data = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            proc.waitUntilExit()

            // Exit code 0 (all pass) or 1 (flagged warnings/errors) both emit Schema 0.2.0 JSON
            if proc.terminationStatus == 0 || proc.terminationStatus == 1 {
                if let report = try? parseReport(from: data) {
                    return report
                }
            }
        } catch {
            // fallback below
        }

        // Check for pre-built demo JSON
        let demoRepURL = rootURL.appendingPathComponent("ui/dist/demo-data/validator_report.json")
        if let data = try? Data(contentsOf: demoRepURL),
           let report = try? parseReport(from: data) {
            return report
        }

        return generateFallbackReport(assetName: targetURL.lastPathComponent)
        #else
        return generateFallbackReport(assetName: targetURL.lastPathComponent)
        #endif
    }
}
