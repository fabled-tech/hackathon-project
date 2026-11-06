import Combine
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Live state of the "connected workspace" (the native counterpart of ui/public/workspace.js): the asset index, server
// status, AI providers and generation tasks, plus the selected asset's note and activity. Everything shown comes from
// the local Fabled server (ui/server.mjs, `npm start`); nothing here invents assets, numbers or names.
//
// All server errors end up in `connection` (unreachable) or `lastError` / `noteStatus` / `generateMessage` text; nothing
// here force-unwraps server data.

enum WorkspaceConnection: Equatable {
    case unknown
    case connected
    case unreachable(String)
}

/// One row of the asset page's properties grid.
struct AssetPageProperty: Identifiable, Equatable {
    let key: String
    let value: String
    /// Tooltip text (e.g. where a saved report came from).
    var help: String? = nil
    /// When set, tapping the value selects this asset ("From asset").
    var gotoAssetId: String? = nil

    var id: String { key }
}

@MainActor
final class WorkspaceStore: ObservableObject {
    @Published private(set) var client: FabledServerClient
    @Published var index: WorkspaceIndex?
    @Published var connection: WorkspaceConnection = .unknown
    @Published var serverStatus: ServerStatus?
    @Published var query: String = ""
    @Published private(set) var selectedAssetId: String?
    @Published var providers: [ProviderInfo] = []
    /// Generation kind → label from /api/providers ("text-to-3d" → "Text → 3D mesh").
    @Published var kindLabels: [String: String] = [:]
    /// Known generation tasks, newest first.
    @Published private(set) var generations: [Generation] = []
    /// Activity for the selected asset (plus its `gen:<task_id>` events), or recent workspace activity when nothing is
    /// selected. Newest first.
    @Published private(set) var activity: [ActivityEvent] = []
    @Published private(set) var activityStatus: String = ""
    @Published private(set) var noteText: String = ""
    @Published private(set) var noteStatus: String = ""
    /// The asset whose note is loaded into `noteText` (editing is only allowed once it matches the selection).
    @Published private(set) var noteLoadedFor: String?
    @Published var lastError: String?
    @Published private(set) var isRefreshing: Bool = false

    // Generate sheet state.
    @Published var showGenerateSheet: Bool = false
    @Published var generateSourceAssetId: String?
    @Published var generateMessage: String = ""
    @Published private(set) var importingGenerationIds: Set<String> = []
    /// Per-generation import failure text, shown on its card.
    @Published private(set) var importErrors: [String: String] = [:]
    /// generation id → job id for imports done in this session (the generation snapshot may predate the import).
    @Published private(set) var importedJobIds: [String: String] = [:]
    /// asset id → has a note, from note saves in this session (cleared when a fresh index arrives).
    @Published private(set) var noteFlags: [String: Bool] = [:]

    let noteDebounceNanoseconds: UInt64
    let pollIntervalNanoseconds: UInt64

    /// The pending debounced note save (internal so tests can await it).
    private(set) var noteSaveTask: Task<Void, Never>?
    /// The save of an unsaved edit flushed when the selection changed.
    private(set) var noteFlushTask: Task<Void, Never>?
    /// Loads the selected asset's note and activity.
    private(set) var pageLoadTask: Task<Void, Never>?
    /// The single generation polling loop (nil when no generation is active).
    private(set) var pollTask: Task<Void, Never>?
    private var pollLoopId: Int = 0
    private var pendingNote: (assetId: String, text: String)?
    private var backgroundRefreshTask: Task<Void, Never>?

    init(client: FabledServerClient = FabledServerClient(),
         noteDebounce: TimeInterval = 0.6,
         pollInterval: TimeInterval = 1.5) {
        self.client = client
        self.noteDebounceNanoseconds = WorkspaceStore.nanoseconds(noteDebounce)
        self.pollIntervalNanoseconds = WorkspaceStore.nanoseconds(pollInterval)
    }

    nonisolated private static func nanoseconds(_ seconds: TimeInterval) -> UInt64 {
        let clamped: Double = min(max(seconds, 0.0), 3600.0)
        return UInt64(clamped * 1_000_000_000)
    }

    // MARK: - Derived values

    var serverURLString: String {
        return client.baseURL.absoluteString
    }

    var unreachableMessage: String? {
        if case .unreachable(let message) = connection {
            return message
        }
        return nil
    }

    var isConnected: Bool {
        return connection == .connected
    }

    var filteredGroups: [WorkspaceGroup] {
        return WorkspaceModel.filterWorkspace(index, query: query).groups
    }

    var filteredTotal: Int {
        return WorkspaceModel.filterWorkspace(index, query: query).total
    }

    var hasQuery: Bool {
        return !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var selectedAsset: WorkspaceAsset? {
        guard let id = selectedAssetId else { return nil }
        return index?.asset(id: id)
    }

    var noteEditable: Bool {
        guard let id = selectedAssetId else { return false }
        return noteLoadedFor == id
    }

    var activeGenerationCount: Int {
        return generations.filter { !$0.isTerminal }.count
    }

    func kindLabel(forGenerationKind kind: String) -> String {
        return kindLabels[kind] ?? kind
    }

    func asset(id: String) -> WorkspaceAsset? {
        return index?.asset(id: id)
    }

    /// The freshest copy of a generation asset's task (polled copy when we have one, else the index snapshot).
    func liveGeneration(for asset: WorkspaceAsset) -> Generation? {
        guard let snapshot = asset.generation else { return nil }
        return generations.first(where: { $0.id == snapshot.id }) ?? snapshot
    }

    func importedJobId(for generation: Generation) -> String? {
        if let jobId = generation.importedJobId, !jobId.isEmpty {
            return jobId
        }
        return importedJobIds[generation.id]
    }

    /// A link for a generation output: the remote https URL, or the server-local file served by the Fabled server.
    func outputURL(_ output: GenerationOutput) -> URL? {
        if let raw = output.url, let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
           scheme == "https" || scheme == "http" {
            return url
        }
        if let local = output.local, !local.isEmpty, !local.contains("..") {
            let parts: [String] = local.split(separator: "/").map { FabledServerClient.percentEncode(String($0)) }
            if parts.isEmpty { return nil }
            return try? client.makeURL(path: "/" + parts.joined(separator: "/"), query: [])
        }
        return nil
    }

    func videoURL(for generation: Generation) -> URL? {
        guard let output = generation.outputs.first(where: { $0.type == "video" }) else { return nil }
        return outputURL(output)
    }

    // MARK: - Refresh

    /// GET /api/status, /api/workspace and /api/providers. Sets `connection`; never throws.
    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        var problems: [String] = []

        do {
            serverStatus = try await client.status()
        } catch {
            if let message = WorkspaceStore.unreachableMessage(error) {
                markUnreachable(message)
                return
            }
            problems.append("status: " + WorkspaceStore.describe(error))
        }

        do {
            let fresh: WorkspaceIndex = try await client.workspace()
            applyIndex(fresh)
        } catch {
            if let message = WorkspaceStore.unreachableMessage(error) {
                markUnreachable(message)
                return
            }
            problems.append("workspace: " + WorkspaceStore.describe(error))
        }

        do {
            let response: ProvidersResponse = try await client.providers()
            providers = response.providers
            kindLabels = response.kinds
            for generation in response.generations {
                upsertGeneration(generation)
            }
        } catch {
            if let message = WorkspaceStore.unreachableMessage(error) {
                markUnreachable(message)
                return
            }
            problems.append("providers: " + WorkspaceStore.describe(error))
        }

        connection = .connected
        lastError = problems.isEmpty ? nil : problems.joined(separator: "; ")
        if let id = selectedAssetId {
            if noteLoadedFor != id {
                await loadNote(for: id)
            }
            await loadActivity(for: id)
        } else {
            await loadActivity(for: nil)
        }
        ensurePolling()
    }

    /// Re-reads only the asset index (after an import, a generation status change, a pipeline run).
    func refreshIndex() async {
        do {
            let fresh: WorkspaceIndex = try await client.workspace()
            applyIndex(fresh)
            if connection != .connected {
                connection = .connected
            }
        } catch {
            if let message = WorkspaceStore.unreachableMessage(error) {
                markUnreachable(message)
            } else {
                lastError = "workspace: " + WorkspaceStore.describe(error)
            }
        }
    }

    /// Fire-and-forget index refresh used after local pipeline / validator runs. Only when the server was reachable
    /// before (so a closed server does not cost a request per check), and coalesced to one request at a time.
    func scheduleRefreshIfConnected() {
        guard connection == .connected, backgroundRefreshTask == nil else { return }
        backgroundRefreshTask = Task { [weak self] in
            guard let self = self else { return }
            await self.refreshIndex()
            if let id = self.selectedAssetId {
                await self.loadActivity(for: id)
            }
            self.backgroundRefreshTask = nil
        }
    }

    private func applyIndex(_ fresh: WorkspaceIndex) {
        index = fresh
        noteFlags = [:]
        // Not-yet-imported generations carry their task; poll the ones we do not know yet.
        for group in fresh.groups {
            for asset in group.assets {
                if let generation = asset.generation, !generations.contains(where: { $0.id == generation.id }) {
                    upsertGeneration(generation)
                }
            }
        }
    }

    private func markUnreachable(_ message: String) {
        connection = .unreachable(message)
        lastError = "Fabled server unreachable at \(serverURLString): \(message)"
    }

    // MARK: - Server URL

    /// Validates and stores the server URL (UserDefaults `fabledServerURL`), rebuilds the client and refreshes.
    /// Returns false (and changes nothing) for anything that is not an http(s) URL with a host.
    @discardableResult
    func setServerURL(_ raw: String, defaults: UserDefaults = .standard) async -> Bool {
        guard let url = FabledServerClient.validatedServerURL(raw) else {
            lastError = "Not a valid server URL: use http://host:port, e.g. http://192.168.1.20:5178"
            return false
        }
        defaults.set(url.absoluteString, forKey: FabledServerClient.defaultsKey)
        noteSaveTask?.cancel()
        noteSaveTask = nil
        pendingNote = nil
        pageLoadTask?.cancel()
        stopPolling()
        client = FabledServerClient(baseURL: url, transport: client.transport, timeout: client.timeout)
        index = nil
        serverStatus = nil
        providers = []
        generations = []
        importedJobIds = [:]
        importErrors = [:]
        activity = []
        selectedAssetId = nil
        noteLoadedFor = nil
        noteText = ""
        noteStatus = ""
        connection = .unknown
        await refresh()
        return true
    }

    // MARK: - Selection, note, activity

    /// Selects an asset (or clears the selection) and starts loading its note and activity. An unsaved note edit for
    /// the previous asset is saved to THAT asset right away; nothing is ever written to the newly selected one.
    func select(_ id: String?) {
        if id == selectedAssetId, id != nil {
            return
        }
        flushPendingNote()
        pageLoadTask?.cancel()
        selectedAssetId = id
        noteLoadedFor = nil
        noteText = ""
        noteStatus = ""
        activity = []
        activityStatus = ""
        pageLoadTask = Task { [weak self] in
            guard let self = self else { return }
            await self.loadPage(for: id)
        }
    }

    /// `select` and wait for the note and activity to load (tests, and callers that need the page ready).
    func selectAndWait(_ id: String?) async {
        select(id)
        await pageLoadTask?.value
    }

    private func loadPage(for id: String?) async {
        guard let id = id else {
            await loadActivity(for: nil)
            return
        }
        await loadNote(for: id)
        await loadActivity(for: id)
    }

    private func loadNote(for id: String) async {
        do {
            let note: AssetNote? = try await client.note(assetId: id)
            guard selectedAssetId == id else { return }
            noteText = note?.text ?? ""
            if let note = note {
                let ago: String = WorkspaceModel.timeAgo(note.updatedAt) ?? ""
                noteStatus = ago.isEmpty ? "saved" : "saved " + ago
            } else {
                noteStatus = ""
            }
            noteLoadedFor = id
        } catch {
            guard selectedAssetId == id else { return }
            noteStatus = "notes unavailable: " + WorkspaceStore.describe(error)
            if let message = WorkspaceStore.unreachableMessage(error) {
                markUnreachable(message)
            }
        }
    }

    /// Called by the notes editor on every change. Saves ~0.6 s after the last keystroke, to the asset being edited.
    func editNote(_ text: String) {
        guard let assetId = selectedAssetId, noteLoadedFor == assetId else { return }
        if text == noteText && pendingNote == nil {
            return
        }
        noteText = text
        noteStatus = "editing…"
        pendingNote = (assetId: assetId, text: text)
        noteSaveTask?.cancel()
        let delay: UInt64 = noteDebounceNanoseconds
        noteSaveTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: delay)
            } catch {
                return
            }
            guard let self = self else { return }
            await self.savePendingNote(assetId: assetId, text: text)
        }
    }

    private func savePendingNote(assetId: String, text: String) async {
        // The selection changed while waiting: the flush in `select` already saved this edit to its own asset.
        guard selectedAssetId == assetId else { return }
        guard let pending = pendingNote, pending.assetId == assetId, pending.text == text else { return }
        pendingNote = nil
        do {
            let saved: AssetNote? = try await client.saveNote(assetId: assetId, text: text)
            setHasNote(assetId: assetId, saved != nil)
            if selectedAssetId == assetId && pendingNote == nil {
                noteStatus = "saved"
            }
        } catch {
            if selectedAssetId == assetId {
                noteStatus = "not saved: " + WorkspaceStore.describe(error)
            }
        }
    }

    private func flushPendingNote() {
        noteSaveTask?.cancel()
        noteSaveTask = nil
        guard let pending = pendingNote else { return }
        pendingNote = nil
        let client: FabledServerClient = self.client
        noteFlushTask = Task { [weak self] in
            do {
                let saved: AssetNote? = try await client.saveNote(assetId: pending.assetId, text: pending.text)
                self?.setHasNote(assetId: pending.assetId, saved != nil)
            } catch {
                self?.lastError = "Note for \(pending.assetId) not saved: " + WorkspaceStore.describe(error)
            }
        }
    }

    /// Keeps the tree's note indicator in step without a full refresh (the index models are immutable).
    private func setHasNote(assetId: String, _ hasNote: Bool) {
        noteFlags[assetId] = hasNote
    }

    /// Whether the asset has a page note: this session's saves first, else what the index said.
    func hasNote(_ asset: WorkspaceAsset) -> Bool {
        if let flag = noteFlags[asset.id] {
            return flag
        }
        return asset.hasNote ?? false
    }

    /// Activity for an asset plus its generation task (`gen:<task_id>`), merged and de-duplicated, newest first.
    /// With nil: the most recent workspace activity.
    func loadActivity(for id: String?) async {
        var ids: [String?] = [id]
        if let id = id, let taskId = index?.asset(id: id)?.provenance?.taskId, !taskId.isEmpty {
            ids.append("gen:" + taskId)
        }
        var merged: [ActivityEvent] = []
        var seen: Set<String> = []
        do {
            for assetId in ids {
                let events: [ActivityEvent] = try await client.activity(assetId: assetId, limit: id == nil ? 12 : 25)
                for event in events where !seen.contains(event.id) {
                    seen.insert(event.id)
                    merged.append(event)
                }
            }
        } catch {
            guard selectedAssetId == id else { return }
            activityStatus = "Activity unavailable: " + WorkspaceStore.describe(error)
            return
        }
        guard selectedAssetId == id else { return }
        merged.sort { (a: ActivityEvent, b: ActivityEvent) -> Bool in
            let da: Date? = WorkspaceModel.parseISODate(a.at)
            let db: Date? = WorkspaceModel.parseISODate(b.at)
            if let da = da, let db = db, da != db {
                return da > db
            }
            return a.at > b.at
        }
        activity = merged
        activityStatus = ""
    }

    // MARK: - Asset page properties

    /// The properties grid for an asset page. Only facts the server sent; nothing derived beyond formatting.
    func pageProperties(for asset: WorkspaceAsset) -> [AssetPageProperty] {
        var rows: [AssetPageProperty] = []
        if let pipeline = asset.pipelineStatus, !pipeline.isEmpty {
            rows.append(AssetPageProperty(key: "Pipeline", value: pipeline))
        }
        if let validator = asset.validator, let overall = validator.overall, !overall.isEmpty {
            var value: String = overall.uppercased()
            if let s = validator.summary, s.total != nil {
                value += " · \(s.pass ?? 0) pass / \(s.warn ?? 0) warn / \(s.fail ?? 0) fail / \(s.notChecked ?? 0) not checked"
            }
            if validator.conceptMockup == true {
                value += " · CONCEPT MOCKUP"
            }
            let owner: String = (asset.kind == "upload" || asset.kind == "generated") ? "job" : "run"
            var help: String = "validator_report.json stored with this \(owner)"
            if let generated = validator.generatedAt, !generated.isEmpty {
                help += ", generated \(generated)"
            }
            help += ". A live Re-check may use a different profile; its result is in Activity and the Validator tab."
            rows.append(AssetPageProperty(key: "Saved report", value: value, help: help))
        }
        if let input = asset.triangles?.input {
            rows.append(AssetPageProperty(key: "Input tris", value: WorkspaceStore.fullNumber(input)))
        }
        if let lod0 = asset.triangles?.lod0Triangles {
            var value: String = WorkspaceStore.fullNumber(lod0)
            if let count = asset.triangles?.lodCount, count != 0 {
                value += " · \(count) LODs"
            }
            rows.append(AssetPageProperty(key: "LOD0 tris", value: value))
        }
        if let engine = asset.engine, !engine.isEmpty {
            rows.append(AssetPageProperty(key: "Engine", value: engine == "native" ? "Native Python/NumPy" : "Headless Blender"))
        }
        if let provenance = asset.provenance, let providerName = provenance.providerName, !providerName.isEmpty {
            var value: String = providerName
            if let kind = provenance.kind, !kind.isEmpty {
                value += " · " + kindLabel(forGenerationKind: kind)
            }
            rows.append(AssetPageProperty(key: "Generated by", value: value))
            if let prompt = provenance.prompt, !prompt.isEmpty {
                rows.append(AssetPageProperty(key: "Prompt", value: prompt))
            }
            if let imageLabel = provenance.imageLabel, !imageLabel.isEmpty {
                rows.append(AssetPageProperty(key: "Input image", value: imageLabel))
            }
            if let sourceId = provenance.sourceAssetId, !sourceId.isEmpty {
                let name: String = index?.asset(id: sourceId)?.name ?? sourceId
                rows.append(AssetPageProperty(key: "From asset", value: name, help: sourceId, gotoAssetId: sourceId))
            }
        }
        if let source = asset.source, let name = source.name, !name.isEmpty {
            var value: String = name
            if let license = source.license, !license.isEmpty {
                value += " · " + license
            }
            rows.append(AssetPageProperty(key: "Source", value: value, help: source.url))
        }
        if let created = asset.createdAt, !created.isEmpty {
            rows.append(AssetPageProperty(key: "Created", value: WorkspaceStore.whenLabel(created), help: created))
        }
        if let folder = asset.folder, !folder.isEmpty {
            rows.append(AssetPageProperty(key: "Folder", value: folder))
        }
        return rows
    }

    nonisolated static func fullNumber(_ n: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: n)) ?? String(n)
    }

    /// "Nov 3, 2026 at 8:44 PM (2d ago)" in the viewer's time zone; the raw string when it cannot be parsed.
    nonisolated static func whenLabel(_ iso: String, now: Date = Date()) -> String {
        guard let date = WorkspaceModel.parseISODate(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        let ago: String = WorkspaceModel.timeAgo(iso, now: now) ?? ""
        return formatter.string(from: date) + (ago.isEmpty ? "" : " (" + ago + ")")
    }

    // MARK: - Generations

    func openGenerateSheet(sourceAssetId: String? = nil) {
        generateSourceAssetId = sourceAssetId ?? selectedAssetId
        generateMessage = ""
        showGenerateSheet = true
    }

    /// POST /api/providers/<provider>/generations. Returns the new task, or nil (with `generateMessage` saying why).
    @discardableResult
    func startGeneration(provider: String, kind: String, prompt: String, image: GenerationImage = .none,
                         sourceAssetId: String? = nil) async -> Generation? {
        generateMessage = "Submitting…"
        do {
            let generation: Generation = try await client.startGeneration(provider: provider, kind: kind, prompt: prompt,
                                                                          image: image, sourceAssetId: sourceAssetId)
            upsertGeneration(generation)
            generateMessage = "Started. It appears under AI generations in the tree."
            ensurePolling()
            await refreshIndex()
            return generation
        } catch {
            generateMessage = "Not started: " + WorkspaceStore.describe(error)
            if let message = WorkspaceStore.unreachableMessage(error) {
                markUnreachable(message)
            }
            return nil
        }
    }

    /// Inserts or replaces a generation, keeping the list newest first.
    func upsertGeneration(_ generation: Generation) {
        var list: [Generation] = generations
        if let existing = list.firstIndex(where: { $0.id == generation.id }) {
            list[existing] = generation
        } else {
            list.append(generation)
        }
        list.sort { (a: Generation, b: Generation) -> Bool in
            if a.createdAt != b.createdAt {
                return a.createdAt > b.createdAt
            }
            return a.id > b.id
        }
        generations = list
    }

    /// Starts the polling loop when a generation is still running. One loop at most; it ends when none are active.
    func ensurePolling() {
        guard pollTask == nil, generations.contains(where: { !$0.isTerminal }) else { return }
        pollLoopId += 1
        let loopId: Int = pollLoopId
        let interval: UInt64 = pollIntervalNanoseconds
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: interval)
                } catch {
                    break
                }
                guard let store = self else { return }
                let stillActive: Bool = await store.pollOnce()
                if !stillActive {
                    break
                }
            }
            self?.pollingEnded(loopId: loopId)
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func pollingEnded(loopId: Int) {
        if pollLoopId == loopId {
            pollTask = nil
        }
    }

    /// Polls every non-terminal generation once. Refreshes the index when a status changed. Returns whether any
    /// generation is still active afterwards.
    @discardableResult
    func pollOnce() async -> Bool {
        let active: [Generation] = generations.filter { !$0.isTerminal }
        var changed: Bool = false
        for generation in active {
            do {
                let fresh: Generation = try await client.generation(id: generation.id)
                if fresh.status != generation.status {
                    changed = true
                }
                upsertGeneration(fresh)
            } catch {
                // Try again on the next tick; the server keeps the task.
                if let message = WorkspaceStore.unreachableMessage(error) {
                    lastError = "Generation poll failed: " + message
                }
            }
        }
        if changed {
            await refreshIndex()
            if let id = selectedAssetId {
                await loadActivity(for: id)
            }
        }
        return generations.contains(where: { !$0.isTerminal })
    }

    /// POST /api/generations/<id>/import: the model becomes a new upload job. Returns nil (with the reason on the
    /// generation's card and in `lastError`) when it fails.
    func importGeneration(id: String) async -> (jobId: String, assetId: String, filename: String)? {
        importingGenerationIds.insert(id)
        importErrors[id] = nil
        defer { importingGenerationIds.remove(id) }
        do {
            let result: GenerationImportResult = try await client.importGeneration(id: id)
            importedJobIds[id] = result.jobId
            await refreshIndex()
            return (jobId: result.jobId, assetId: result.assetId, filename: result.filename)
        } catch {
            let message: String = "Import failed: " + WorkspaceStore.describe(error)
            importErrors[id] = message
            lastError = message
            return nil
        }
    }

    // MARK: - Files

    /// GET /api/jobs/<id>/input, written to a temp folder under the original file name so the mesh loader can sniff
    /// the extension.
    func jobInputFile(jobId: String, filename: String) async throws -> URL {
        let data: Data = try await client.jobInput(jobId: jobId)
        return try WorkspaceStore.writeTemporaryFile(data, folder: "jobs/" + WorkspaceStore.safeFileName(jobId, fallback: "job"),
                                                     filename: filename)
    }

    /// GET <server>/samples/<file> (or the asset's server-relative `open.url`), written to a temp folder.
    func sampleFile(urlPath: String?, filename: String) async throws -> URL {
        let path: String
        if let given = urlPath, given.hasPrefix("/"), !given.hasPrefix("//"), !given.contains("..") {
            path = given
        } else {
            path = "/samples/" + FabledServerClient.percentEncode(filename)
        }
        var request = URLRequest(url: try client.makeURL(path: path, query: []))
        request.httpMethod = "GET"
        request.timeoutInterval = max(client.timeout, 120)
        let response: (Data, HTTPURLResponse)
        do {
            response = try await client.transport.send(request)
        } catch let error as FabledServerError {
            throw error
        } catch {
            throw FabledServerError.unreachable(error.localizedDescription)
        }
        let status: Int = response.1.statusCode
        guard status >= 200 && status <= 299 else {
            let message: String = FabledServerClient.errorMessage(in: response.0) ?? "HTTP \(status)"
            throw FabledServerError.http(status, message)
        }
        return try WorkspaceStore.writeTemporaryFile(response.0, folder: "samples", filename: filename)
    }

    nonisolated static func safeFileName(_ raw: String, fallback: String) -> String {
        let last: String = (raw as NSString).lastPathComponent
        let allowed: Set<Character> = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._- ")
        var cleaned: String = String(last.filter { allowed.contains($0) })
        while cleaned.hasPrefix(".") {
            cleaned.removeFirst()
        }
        cleaned = cleaned.trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? fallback : cleaned
    }

    nonisolated static func writeTemporaryFile(_ data: Data, folder: String, filename: String) throws -> URL {
        let base: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent("FabledStudio", isDirectory: true)
            .appendingPathComponent(folder, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
            let url: URL = base.appendingPathComponent(safeFileName(filename, fallback: "input.bin"))
            try data.write(to: url, options: [.atomic])
            return url
        } catch {
            throw FabledServerError.invalidRequest("could not write a temporary file: \(error.localizedDescription)")
        }
    }

    // MARK: - Errors

    nonisolated static func describe(_ error: Error) -> String {
        if let localized = error as? LocalizedError, let text = localized.errorDescription, !text.isEmpty {
            return text
        }
        return error.localizedDescription
    }

    nonisolated static func unreachableMessage(_ error: Error) -> String? {
        if let serverError = error as? FabledServerError, case .unreachable(let message) = serverError {
            return message
        }
        return nil
    }
}
