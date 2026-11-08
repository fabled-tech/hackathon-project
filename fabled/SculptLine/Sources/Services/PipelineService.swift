import Foundation

// MARK: - SculptLine CLI locations (new names first, pre-rename names as fallbacks)

/// Where the SculptLine command-line tools live inside a project root. The renamed tools come first; the old
/// `fabled_*` names are fallbacks for checkouts made before the rename (in current checkouts they are thin shims).
enum SculptLineCLI {
    /// Pipeline driver scripts, relative to the project root, in the order they are tried.
    static let pipelineScriptPaths: [String] = ["pipeline/sculptline_pipeline.py", "pipeline/fabled_pipeline.py"]
    /// Validator Python packages (`python -m <name>`), in the order they are tried.
    static let validatorModules: [String] = ["sculptline_validator", "fabled_validator"]
    /// Environment variables naming the project root, in the order they are read.
    static let rootEnvironmentKeys: [String] = ["SCULPTLINE_ROOT", "FABLED_ROOT"]
    /// UserDefaults keys naming the project root, in the order they are read.
    static let rootDefaultsKeys: [String] = ["sculptlineRootPath", "fabledRootPath"]

    /// The first pipeline driver script that exists under `root`, or nil.
    static func pipelineScript(in root: URL, fileExists: (String) -> Bool) -> URL? {
        for relative in pipelineScriptPaths {
            let url: URL = root.appendingPathComponent(relative)
            if fileExists(url.path) { return url }
        }
        return nil
    }

    static func pipelineScript(in root: URL) -> URL? {
        return pipelineScript(in: root, fileExists: { FileManager.default.fileExists(atPath: $0) })
    }

    /// The validator package to run with `python -m`: the first one whose folder exists under `root/validator`,
    /// else the new name.
    static func validatorModule(in root: URL, fileExists: (String) -> Bool) -> String {
        for module in validatorModules {
            let initFile: URL = root.appendingPathComponent("validator")
                .appendingPathComponent(module)
                .appendingPathComponent("__init__.py")
            if fileExists(initFile.path) { return module }
        }
        return validatorModules[0]
    }

    static func validatorModule(in root: URL) -> String {
        return validatorModule(in: root, fileExists: { FileManager.default.fileExists(atPath: $0) })
    }

    /// The first non-empty project-root path stored under `rootDefaultsKeys` (new key first), or nil.
    static func rootDefaultsPath(_ defaults: UserDefaults) -> String? {
        for key in rootDefaultsKeys {
            if let value = defaults.string(forKey: key)?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
                return value
            }
        }
        return nil
    }
}

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
        guard let pipelineScript = SculptLineCLI.pipelineScript(in: rootURL) else {
            let expected: String = rootURL.appendingPathComponent(SculptLineCLI.pipelineScriptPaths[0]).path
            throw NSError(
                domain: "SculptLinePipeline",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Pipeline script not found at \(expected) (or the older pipeline/fabled_pipeline.py)"]
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
                domain: "SculptLinePipeline",
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
