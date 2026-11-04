import Foundation

// MARK: - Pipeline Service Protocol (Feature 14 & 15)

protocol PipelineServiceProtocol: AnyObject, Sendable {
    func runPipeline(
        rootURL: URL,
        inputURL: URL,
        outDir: URL,
        configURL: URL,
        validatorProfileURL: URL,
        engine: PipelineEngine,
        blenderPath: String?,
        assetName: String,
        onProgress: @escaping @Sendable (PipelineProgress) -> Void
    ) async throws -> URL

    func cancelCurrentRun()
    var isRunning: Bool { get }
}

// MARK: - Process-Based Pipeline Service for macOS (Feature 14 & 15)

final class ProcessPipelineService: PipelineServiceProtocol, @unchecked Sendable {
    private let lock = NSLock()
    #if os(macOS)
    private var activeProcess: Process?
    #endif
    private var _isRunning: Bool = false

    var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return _isRunning
    }

    func cancelCurrentRun() {
        lock.lock()
        defer { lock.unlock() }
        #if os(macOS)
        if let proc = activeProcess, proc.isRunning {
            proc.terminate()
        }
        activeProcess = nil
        #endif
        _isRunning = false
    }

    #if os(macOS)
    private func registerProcess(_ proc: Process) {
        lock.lock()
        defer { lock.unlock() }
        activeProcess = proc
        _isRunning = true
    }

    private func clearProcess() {
        lock.lock()
        defer { lock.unlock() }
        activeProcess = nil
        _isRunning = false
    }
    #endif

    func runPipeline(
        rootURL: URL,
        inputURL: URL,
        outDir: URL,
        configURL: URL,
        validatorProfileURL: URL,
        engine: PipelineEngine,
        blenderPath: String?,
        assetName: String,
        onProgress: @escaping @Sendable (PipelineProgress) -> Void
    ) async throws -> URL {
        #if os(macOS)
        let pipelineScript = rootURL.appendingPathComponent("pipeline/fabled_pipeline.py")
        guard FileManager.default.fileExists(atPath: pipelineScript.path) else {
            throw NSError(
                domain: "FabledPipeline",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Pipeline script not found at \(pipelineScript.path)"]
            )
        }

        // Clean output directory and ensure progress.json can be written fresh
        try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        let progressJSONURL = outDir.appendingPathComponent("progress.json")
        try? FileManager.default.removeItem(at: progressJSONURL)

        let blenderArg = engine.cliArgument(blenderPath: blenderPath)

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        proc.arguments = [
            "python3",
            pipelineScript.path,
            "--input", inputURL.path,
            "--out", outDir.path,
            "--config", configURL.path,
            "--asset-name", assetName,
            "--validator-profile", validatorProfileURL.path,
            "--blender", blenderArg
        ]
        proc.currentDirectoryURL = rootURL

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

        registerProcess(proc)
        defer {
            clearProcess()
        }

        try proc.run()

        // Asynchronously drain stdout and stderr to avoid pipe buffer deadlocks
        let outDrainTask = Task.detached { () -> String in
            let data = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8) ?? ""
        }
        let errDrainTask = Task.detached { () -> String in
            let data = stderrPipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8) ?? ""
        }

        // Polling loop: Poll progress.json every 250ms (Feature 14)
        var lastUpdatedTimestamp: String? = nil
        while proc.isRunning {
            try? await Task.sleep(nanoseconds: 250_000_000) // 250ms
            if let data = try? Data(contentsOf: progressJSONURL),
               let prog = try? JSONDecoder().decode(PipelineProgress.self, from: data) {
                if prog.updated_at != lastUpdatedTimestamp {
                    lastUpdatedTimestamp = prog.updated_at
                    onProgress(prog)
                }
            }
        }

        proc.waitUntilExit()

        _ = await outDrainTask.value
        let errOutput = await errDrainTask.value

        // Final poll after termination
        if let data = try? Data(contentsOf: progressJSONURL),
           let prog = try? JSONDecoder().decode(PipelineProgress.self, from: data) {
            onProgress(prog)
        }

        guard proc.terminationStatus == 0 else {
            let msg = errOutput.trimmingCharacters(in: .whitespacesAndNewlines)
            throw NSError(
                domain: "FabledPipeline",
                code: Int(proc.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: msg.isEmpty ? "Pipeline failed with exit code \(proc.terminationStatus)" : msg]
            )
        }

        return outDir
        #else
        // iOS / iPadOS fallback (pure in-memory simulation)
        for stage in PipelineStageInfo.allStages {
            try? await Task.sleep(nanoseconds: 100_000_000)
            onProgress(
                PipelineProgress(
                    step: stage.id,
                    total: 8,
                    name: stage.name,
                    label: stage.label,
                    done: stage.id == 8,
                    status: "ok"
                )
            )
        }
        return outDir
        #endif
    }
}
