import XCTest
@testable import FabledStudio

final class PipelineAdversarialStressTests: XCTestCase {

    // MARK: - 1. Engine Argument Construction Adversarial Matrix

    func testEngineCLIArgumentAdversarialMatrix() throws {
        // Native engine must ALWAYS return "none", regardless of any input
        let native = PipelineEngine.native
        XCTAssertEqual(native.cliArgument(blenderPath: nil), "none")
        XCTAssertEqual(native.cliArgument(blenderPath: ""), "none")
        XCTAssertEqual(native.cliArgument(blenderPath: "   "), "none")
        XCTAssertEqual(native.cliArgument(blenderPath: "/opt/homebrew/bin/blender"), "none")
        XCTAssertEqual(native.cliArgument(blenderPath: "/nonexistent/path/blender"), "none")
        XCTAssertEqual(native.cliArgument(blenderPath: "/tmp"), "none")

        // Blender engine argument resolution
        let blender = PipelineEngine.blender

        // Case 1: Valid executable binary
        let shPath = "/bin/sh"
        if FileManager.default.isExecutableFile(atPath: shPath) {
            XCTAssertEqual(blender.cliArgument(blenderPath: shPath), shPath)
        }

        // Case 2: Nil, empty string, or whitespace should fall back to default
        XCTAssertEqual(blender.cliArgument(blenderPath: nil), "/opt/homebrew/bin/blender")
        XCTAssertEqual(blender.cliArgument(blenderPath: ""), "/opt/homebrew/bin/blender")

        // Case 3: Non-existent path falls back to default
        XCTAssertEqual(blender.cliArgument(blenderPath: "/nonexistent/path/to/blender_xyz"), "/opt/homebrew/bin/blender")

        // Case 4: Non-executable file falls back to default
        let tempDir = FileManager.default.temporaryDirectory
        let nonExecFile = tempDir.appendingPathComponent("non_exec_test_\(UUID().uuidString).txt")
        try "not executable".write(to: nonExecFile, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: nonExecFile) }

        // Ensure non-executable permissions
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: nonExecFile.path)
        XCTAssertFalse(FileManager.default.isExecutableFile(atPath: nonExecFile.path))
        XCTAssertEqual(blender.cliArgument(blenderPath: nonExecFile.path), "/opt/homebrew/bin/blender")

        // Case 5: Directory path behavior observation
        // On POSIX systems, directory search permissions (+x) make isExecutableFile return true
        let isTmpExec = FileManager.default.isExecutableFile(atPath: "/tmp")
        XCTAssertTrue(isTmpExec, "POSIX directories with search bits report isExecutableFile == true")
        let argForTmp = blender.cliArgument(blenderPath: "/tmp")
        XCTAssertEqual(argForTmp, "/tmp", "Documents current behavior when directory is passed as blenderPath")
    }

    // MARK: - 2. Host Blender Detection Adversarial Scenarios

    func testBlenderDetectionAdversarialScenarios() {
        // Standard detection run
        let detection = BlenderDetection.detectHostBlender()
        if detection.isAvailable {
            XCTAssertNotNil(detection.path)
            XCTAssertNotNil(detection.version)
            XCTAssertTrue(FileManager.default.isExecutableFile(atPath: detection.path!))
        } else {
            XCTAssertNil(detection.path)
            XCTAssertNil(detection.version)
        }
    }

    // MARK: - 3. Progress JSON Decoding Resilience

    func testProgressDecodingCorruptAndTruncatedData() throws {
        let decoder = JSONDecoder()

        // 1. Empty data
        let emptyData = Data()
        XCTAssertThrowsError(try decoder.decode(PipelineProgress.self, from: emptyData))

        // 2. Random garbage bytes
        var garbageBytes = [UInt8](repeating: 0, count: 128)
        for i in 0..<garbageBytes.count { garbageBytes[i] = UInt8(i % 256) }
        let garbageData = Data(garbageBytes)
        XCTAssertThrowsError(try decoder.decode(PipelineProgress.self, from: garbageData))

        // 3. Truncated JSON
        let truncatedJSON = "{\"step\": 3, \"total\": 8, \"name\": \"uv_unwrap\", \"label\": \"UV unwrap\""
        let truncatedData = truncatedJSON.data(using: .utf8)!
        XCTAssertThrowsError(try decoder.decode(PipelineProgress.self, from: truncatedData))

        // 4. Corrupted field type (step is string instead of int)
        let corruptTypeJSON = """
        {
          "step": "three",
          "total": 8,
          "name": "uv_unwrap",
          "label": "UV unwrap",
          "done": false,
          "status": "running"
        }
        """
        XCTAssertThrowsError(try decoder.decode(PipelineProgress.self, from: corruptTypeJSON.data(using: .utf8)!))

        // 5. Corrupted field type (done is string instead of bool)
        let corruptBoolJSON = """
        {
          "step": 3,
          "total": 8,
          "name": "uv_unwrap",
          "label": "UV unwrap",
          "done": "yes",
          "status": "running"
        }
        """
        XCTAssertThrowsError(try decoder.decode(PipelineProgress.self, from: corruptBoolJSON.data(using: .utf8)!))

        // 6. Missing required fields (status missing)
        let missingFieldJSON = """
        {
          "step": 3,
          "total": 8,
          "name": "uv_unwrap",
          "label": "UV unwrap",
          "done": false
        }
        """
        XCTAssertThrowsError(try decoder.decode(PipelineProgress.self, from: missingFieldJSON.data(using: .utf8)!))

        // 7. Extra unexpected fields (should succeed and ignore extra fields)
        let extraFieldsJSON = """
        {
          "step": 3,
          "total": 8,
          "name": "uv_unwrap",
          "label": "UV unwrap + pack",
          "done": false,
          "status": "running",
          "unexpected_metric": 42.5,
          "nested_unknown": {"foo": "bar"}
        }
        """
        let validExtra = try decoder.decode(PipelineProgress.self, from: extraFieldsJSON.data(using: .utf8)!)
        XCTAssertEqual(validExtra.step, 3)
        XCTAssertEqual(validExtra.status, "running")

        // 8. Omitted optional updated_at (should decode with updated_at == nil)
        let noUpdatedAtJSON = """
        {
          "step": 4,
          "total": 8,
          "name": "lod_generation",
          "label": "LOD chain",
          "done": false,
          "status": "running"
        }
        """
        let noUpdated = try decoder.decode(PipelineProgress.self, from: noUpdatedAtJSON.data(using: .utf8)!)
        XCTAssertNil(noUpdated.updated_at)
        XCTAssertEqual(noUpdated.step, 4)
    }

    // MARK: - 4. Progress Fraction Numerical Stability

    func testProgressFractionNumericalBoundaries() {
        // total == 0 guard against division by zero
        let zeroTotal = PipelineProgress(step: 1, total: 0, name: "step1", label: "Step 1", done: false, status: "running")
        XCTAssertEqual(zeroTotal.progressFraction, 0.0, "total == 0 must return 0.0 without division by zero")

        // negative total guard
        let negativeTotal = PipelineProgress(step: 1, total: -4, name: "step1", label: "Step 1", done: false, status: "running")
        XCTAssertEqual(negativeTotal.progressFraction, 0.0)

        // step 0 (before step 1 starts)
        let stepZero = PipelineProgress(step: 0, total: 8, name: "init", label: "Init", done: false, status: "running")
        XCTAssertGreaterThanOrEqual(stepZero.progressFraction, 0.0)

        // step 8 completed (done: true)
        let doneFinal = PipelineProgress(step: 8, total: 8, name: "previews", label: "Previews", done: true, status: "ok")
        XCTAssertEqual(doneFinal.progressFraction, 1.0, accuracy: 1e-6)

        // step 8 in-progress (done: false)
        let runningFinal = PipelineProgress(step: 8, total: 8, name: "previews", label: "Previews", done: false, status: "running")
        XCTAssertGreaterThan(runningFinal.progressFraction, 0.875)
        XCTAssertLessThan(runningFinal.progressFraction, 1.0)
    }

    // MARK: - 5. Simulated Asynchronous Progress Polling Resilience

    func testSimulatedProgressPollingUnderAdversarialFilesystemStates() async throws {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("progress_test_\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let progressFile = tempDir.appendingPathComponent("progress.json")
        var receivedProgress: [PipelineProgress] = []

        // Simulating the exact decoding block from PipelineService:
        // if let data = try? Data(contentsOf: progressJSONURL),
        //    let prog = try? JSONDecoder().decode(PipelineProgress.self, from: data)
        let poll = { (fileURL: URL) -> PipelineProgress? in
            guard let data = try? Data(contentsOf: fileURL),
                  let prog = try? JSONDecoder().decode(PipelineProgress.self, from: data) else {
                return nil
            }
            return prog
        }

        // State A: File does not exist
        XCTAssertNil(poll(progressFile), "Missing file must return nil safely")

        // State B: File is empty (0 bytes)
        try Data().write(to: progressFile)
        XCTAssertNil(poll(progressFile), "0-byte file must return nil safely")

        // State C: File contains partial/truncated JSON
        try "{\"step\": 1, \"tot".write(to: progressFile, atomically: true, encoding: .utf8)
        XCTAssertNil(poll(progressFile), "Truncated JSON must return nil safely")

        // State D: File contains valid Stage 1 progress
        let validStage1 = """
        {
          "step": 1,
          "total": 8,
          "name": "import_measure",
          "label": "Import + measure",
          "done": false,
          "status": "running",
          "updated_at": "2026-11-04T05:00:01Z"
        }
        """
        try validStage1.write(to: progressFile, atomically: true, encoding: .utf8)
        if let p = poll(progressFile) {
            receivedProgress.append(p)
        }
        XCTAssertEqual(receivedProgress.count, 1)
        XCTAssertEqual(receivedProgress.last?.step, 1)

        // State E: File temporarily corrupted mid-flight
        try "{ corrupt".write(to: progressFile, atomically: true, encoding: .utf8)
        XCTAssertNil(poll(progressFile), "Mid-flight corrupted file returns nil without crashing")

        // State F: File updated to Stage 2 with atomic replace simulation
        let validStage2 = """
        {
          "step": 2,
          "total": 8,
          "name": "retopology",
          "label": "Retopology",
          "done": false,
          "status": "running",
          "updated_at": "2026-11-04T05:00:02Z"
        }
        """
        let tmpFile = tempDir.appendingPathComponent("progress.json.tmp")
        try validStage2.write(to: tmpFile, atomically: true, encoding: .utf8)
        _ = try FileManager.default.replaceItemAt(progressFile, withItemAt: tmpFile)
        if let p = poll(progressFile) {
            receivedProgress.append(p)
        }
        XCTAssertEqual(receivedProgress.count, 2)
        XCTAssertEqual(receivedProgress.last?.step, 2)

        // State G: File deleted
        try FileManager.default.removeItem(at: progressFile)
        XCTAssertNil(poll(progressFile), "Deleted file returns nil safely")
    }

    func testProgressPollingNullUpdatedAtBehavior() {
        // Finding documentation:
        // In ProcessPipelineService:
        //   var lastUpdatedTimestamp: String? = nil
        //   if prog.updated_at != lastUpdatedTimestamp { ... }
        // If progress JSON does not specify updated_at (i.e. prog.updated_at == nil),
        // on the first poll: nil != nil evaluates to false, so onProgress is not dispatched!
        let lastUpdatedTimestamp: String? = nil
        let progWithoutTimestamp = PipelineProgress(
            step: 1,
            total: 8,
            name: "import_measure",
            label: "Import",
            done: false,
            status: "running",
            updated_at: nil
        )

        let initialCondition = (progWithoutTimestamp.updated_at != lastUpdatedTimestamp)
        XCTAssertFalse(initialCondition, "When updated_at is nil, initial comparison against nil timestamp evaluates to false")
        // Only when lastUpdatedTimestamp is updated or non-nil would it differ.
    }

    func testRapidConcurrentProgressWritesSimulation() async throws {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("concurrent_prog_\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let progressURL = tempDir.appendingPathComponent("progress.json")

        // Writer task rapidly overwrites progress.json 200 times
        let writerTask = Task {
            for i in 1...200 {
                let json = """
                {
                  "step": \(i % 8 + 1),
                  "total": 8,
                  "name": "stage_\(i % 8 + 1)",
                  "label": "Stage \(i % 8 + 1)",
                  "done": false,
                  "status": "running",
                  "updated_at": "2026-11-04T05:00:\(String(format: "%02d", i % 60))Z"
                }
                """
                let tmp = tempDir.appendingPathComponent("progress.json.tmp")
                try? json.write(to: tmp, atomically: true, encoding: .utf8)
                _ = try? FileManager.default.replaceItemAt(progressURL, withItemAt: tmp)
                try? await Task.sleep(nanoseconds: 1_000_000) // 1ms
            }
        }

        // Reader task rapidly polls progress.json 50 times concurrently
        var readSuccessCount = 0
        for _ in 0..<50 {
            try? await Task.sleep(nanoseconds: 3_000_000) // 3ms
            if let data = try? Data(contentsOf: progressURL),
               let prog = try? JSONDecoder().decode(PipelineProgress.self, from: data) {
                XCTAssertGreaterThanOrEqual(prog.step, 1)
                XCTAssertLessThanOrEqual(prog.step, 8)
                readSuccessCount += 1
            }
        }

        await writerTask.value
        XCTAssertGreaterThan(readSuccessCount, 0, "Concurrent poller should successfully read multiple atomic snapshots")
    }

    // MARK: - 6. Concurrent Cancellation and Process Lifecycle Stress

    func testProcessPipelineServiceCancellationStress() async {
        let service = ProcessPipelineService()

        // 1. Idle cancellation should be safe no-op
        XCTAssertFalse(service.isRunning)
        service.cancelCurrentRun()
        XCTAssertFalse(service.isRunning)

        // 2. Massive concurrent cancel calls (50 concurrent tasks)
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<50 {
                group.addTask {
                    service.cancelCurrentRun()
                }
            }
        }
        XCTAssertFalse(service.isRunning)
    }

    func testRapidStartCancelPipelineServiceLifecycle() async throws {
        let service = ProcessPipelineService()
        // Same discovery the app uses (FABLED_ROOT, the "fabledRootPath" default, then a walk up), starting from the
        // working directory and from this test file's own folder inside the repo.
        let rootOpt = FabledStudioViewModel.discoverFabledRoot(
            environment: ProcessInfo.processInfo.environment,
            defaultsPath: UserDefaults.standard.string(forKey: "fabledRootPath"),
            startDirectories: [
                URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
                URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            ],
            fileExists: { FileManager.default.fileExists(atPath: $0) }
        )
        guard let root = rootOpt else {
            XCTFail("fabled root directory containing pipeline/fabled_pipeline.py must be discovered")
            return
        }

        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("stress_run_\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let sampleInput = root.appendingPathComponent("ui/samples/fabled_sample_head.glb")
        let configFile = root.appendingPathComponent("pipeline/config/default.json")
        let valProfile = root.appendingPathComponent("pipeline/config/validator_profile_bust.json")

        // Rapid start then immediate cancel sequence (3 iterations)
        for i in 0..<3 {
            let outDir = tempDir.appendingPathComponent("run_\(i)")
            let runTask = Task { () -> Bool in
                do {
                    _ = try await service.runPipeline(
                        rootURL: root,
                        inputURL: sampleInput,
                        outDir: outDir,
                        configURL: configFile,
                        validatorProfileURL: valProfile,
                        engine: .native,
                        blenderPath: nil,
                        assetName: "StressTest_\(i)"
                    ) { _ in }
                    return true
                } catch {
                    return false
                }
            }

            // Immediately cancel within 20 milliseconds
            try await Task.sleep(nanoseconds: 20_000_000)
            service.cancelCurrentRun()

            let completed = await runTask.value
            XCTAssertFalse(completed, "Run \(i) should have terminated on cancellation")
            XCTAssertFalse(service.isRunning, "Service isRunning must be false after cancel")
        }
    }
}
