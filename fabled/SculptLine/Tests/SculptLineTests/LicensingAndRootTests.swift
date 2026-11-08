import XCTest
@testable import SculptLine

@MainActor
final class LicensingAndRootTests: XCTestCase {

    // MARK: - Licensed samples (must equal ui/public/licensed.js character for character)

    func testLicensedSampleStringsMatchWebApp() throws {
        XCTAssertEqual(LicensedSamples.all.count, 1)
        let sample = try XCTUnwrap(LicensedSamples.all.first)
        XCTAssertEqual(sample.displayName, "Sample asset: historical bust scan (CC0)")
        XCTAssertEqual(sample.shortName, "Historical bust scan (CC0)")
        XCTAssertEqual(sample.credit, "Helen Adams Keller by Onorio Ruotolo, 1916. National Portrait Gallery, Smithsonian Institution (NPG.75.16). 3D model via Smithsonian 3D, CC0.")
        XCTAssertEqual(sample.creditURL, "https://3d.si.edu/object/3d/helen-adams-keller:d8c64ccc-4ebc-11ea-b77f-2e728ce88125")
        XCTAssertEqual(sample.disclaimer, "Fabled is not affiliated with or endorsed by the Smithsonian Institution.")
        XCTAssertEqual(sample.heightNote, "source units inferred")
        XCTAssertEqual(sample.matchPattern, "NPG[._ ]?75[._ ]?16|d8c64ccc-4ebc-11ea-b77f-2e728ce88125|HelenKeller")
        XCTAssertNotNil(sample.creditLink)
        XCTAssertFalse(sample.credit.contains("Davidson"))
    }

    func testLicensedSampleMatchRule() {
        XCTAssertNotNil(LicensedSamples.match(asset: "HelenKellerBust", sourceJSON: nil))
        XCTAssertNotNil(LicensedSamples.match(asset: "helenkellerbust_lod0", sourceJSON: nil), "match is case-insensitive")
        XCTAssertNotNil(LicensedSamples.match(asset: nil, sourceJSON: "{\"name\":\"Bust, National Portrait Gallery NPG.75.16\",\"license\":\"CC0\"}"))
        XCTAssertNotNil(LicensedSamples.match(asset: "HK_NPG_75_16-full_resolution-obj", sourceJSON: nil))
        XCTAssertNotNil(LicensedSamples.match(asset: "upload", sourceJSON: "https://3d-api.si.edu/voyager/3d_package:d8c64ccc-4ebc-11ea-b77f-2e728ce88125"))

        XCTAssertNil(LicensedSamples.match(asset: "mushroom_cottage", sourceJSON: nil))
        XCTAssertNil(LicensedSamples.match(asset: "mushroom_cottage", sourceJSON: "{\"name\":\"Mushroom cottage\",\"license\":\"CC-BY\"}"))
        XCTAssertNil(LicensedSamples.match(asset: nil, sourceJSON: nil))
        XCTAssertNil(LicensedSamples.match(asset: "", sourceJSON: ""))
    }

    func testLicensedSampleMatchFromManifest() {
        // Shape of pipeline/output/manifest.json: the asset name alone carries the match.
        let realShape: [String: Any] = [
            "asset": "HelenKellerBust",
            "source": ["name": NSNull(), "url": NSNull(), "license": NSNull()] as [String: Any],
            "input": ["sculpt_path": "../../ui/samples/fabled_sample_head.glb", "source_url": NSNull()] as [String: Any]
        ]
        XCTAssertNotNil(LicensedSamples.match(manifest: realShape))

        let renamedButSourced: [String: Any] = [
            "asset": "MyBust",
            "source": ["name": "Bust (NPG.75.16)", "license": "CC0"] as [String: Any]
        ]
        XCTAssertNotNil(LicensedSamples.match(manifest: renamedButSourced))

        let inputSourced: [String: Any] = [
            "asset": "MyBust",
            "input": ["source": "https://3d.si.edu/object/3d/d8c64ccc-4ebc-11ea-b77f-2e728ce88125"] as [String: Any]
        ]
        XCTAssertNotNil(LicensedSamples.match(manifest: inputSourced))

        let unrelated: [String: Any] = ["asset": "mushroom_cottage", "source": NSNull()]
        XCTAssertNil(LicensedSamples.match(manifest: unrelated))
        XCTAssertNil(LicensedSamples.match(manifest: [:]))
    }

    func testActiveLicensedSampleFollowsWhatIsOnScreen() {
        let vm = SculptLineViewModel()
        XCTAssertNil(vm.activeLicensedSample, "no mesh, no credit")

        // The procedural sample head is self-made: no museum credit even though it is flagged as the sample bust.
        var procedural = MeshAnalyzerAndLoader.makeProceduralBustSculpt()
        procedural.isSampleBust = true
        vm.sourceMesh = procedural
        XCTAssertNil(vm.activeLicensedSample)

        // A scan-like file name alone is not provenance (the bundled SM_HelenKellerBust_LOD0.glb is a procedural-head export).
        var named = procedural
        named.fileName = "SM_HelenKellerBust_LOD0.glb"
        vm.sourceMesh = named
        XCTAssertNil(vm.activeLicensedSample)

        // Pipeline output is credited from its manifest, unless its input was the procedural head.
        vm.sourceMesh = procedural
        vm.isReadOnlyPipelineOutput = true
        vm.pipelineOutputLicensedSample = LicensedSamples.match(manifest: ["asset": "HelenKellerBust", "input": ["sculpt_path": "scan/raw.obj"] as [String: Any]])
        XCTAssertEqual(vm.activeLicensedSample, LicensedSamples.all.first)
    }

    func testProceduralSampleRunsAreNotTheScan() {
        // Shape of the committed pipeline/output manifest: scan's asset name, procedural input, null sources.
        let run: [String: Any] = ["asset": "HelenKellerBust", "source": NSNull(),
                                  "input": ["sculpt_path": "../../ui/samples/fabled_sample_head.glb", "triangles": 327680] as [String: Any]]
        XCTAssertTrue(LicensedSamples.isProceduralSampleRun(manifest: run))
        XCTAssertNil(LicensedSamples.match(manifest: run))
        XCTAssertEqual(LicensedSamples.displayName(manifest: run), "Procedural sample head (self-made)")
        XCTAssertEqual(LicensedSamples.displayName(manifest: ["asset": "HelenKellerBust", "input": ["sculpt_path": "scan/raw.obj"] as [String: Any]], short: true),
                       "Historical bust scan (CC0)")
        XCTAssertEqual(LicensedSamples.displayName(manifest: ["asset": "Shield"]), "Shield")
        XCTAssertFalse(LicensedSamples.isProceduralSampleRun(manifest: ["input": ["sculpt_path": "my_fabled_sample_head.glb"] as [String: Any]]))
    }

    func testWorkspaceTreeVisibleStringsDoNotUseHerName() throws {
        // The tree shows the server-provided names (licensed / procedural naming is applied by the server), group
        // labels and status labels; `file_asset_name` (the exported mesh name) is never displayed.
        let index = try WorkspaceFixtures.workspaceIndex()
        for group in index.groups {
            XCTAssertFalse(group.label.localizedCaseInsensitiveContains("Keller"))
            for asset in group.assets {
                let visible: [String] = [asset.name, asset.status.label, WorkspaceModel.trisLabel(asset) ?? ""]
                for text in visible {
                    XCTAssertFalse(text.localizedCaseInsensitiveContains("Keller"), "asset \(asset.id) shows \"\(text)\"")
                }
            }
        }
    }

    // MARK: - SculptLine root discovery (fake tree, no real filesystem)

    private func exists(_ paths: Set<String>) -> (String) -> Bool {
        return { paths.contains($0) }
    }

    func testRootDiscoveryEnvironmentWins() {
        let tree: Set<String> = [
            "/fake/env/pipeline/sculptline_pipeline.py",
            "/fake/defaults/pipeline/sculptline_pipeline.py",
            "/fake/repo/pipeline/sculptline_pipeline.py"
        ]
        let root = SculptLineViewModel.discoverSculptLineRoot(
            environment: ["SCULPTLINE_ROOT": "/fake/env"],
            defaultsPath: "/fake/defaults",
            startDirectories: [URL(fileURLWithPath: "/fake/repo/SculptLine")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(root?.path, "/fake/env")
    }

    func testRootDiscoveryNewEnvironmentBeatsOldEnvironment() {
        let tree: Set<String> = [
            "/fake/new/pipeline/sculptline_pipeline.py",
            "/fake/old/pipeline/fabled_pipeline.py"
        ]
        let both = SculptLineViewModel.discoverSculptLineRoot(
            environment: ["SCULPTLINE_ROOT": "/fake/new", "FABLED_ROOT": "/fake/old"],
            defaultsPath: nil,
            startDirectories: [],
            fileExists: exists(tree)
        )
        XCTAssertEqual(both?.path, "/fake/new")

        // The old variable is still honoured, and before the defaults path.
        let oldOnly = SculptLineViewModel.discoverSculptLineRoot(
            environment: ["FABLED_ROOT": "/fake/old"],
            defaultsPath: "/fake/new",
            startDirectories: [],
            fileExists: exists(tree)
        )
        XCTAssertEqual(oldOnly?.path, "/fake/old")

        // A new variable that points nowhere falls through to the old one.
        let newMissing = SculptLineViewModel.discoverSculptLineRoot(
            environment: ["SCULPTLINE_ROOT": "/fake/missing", "FABLED_ROOT": "/fake/old"],
            defaultsPath: nil,
            startDirectories: [],
            fileExists: exists(tree)
        )
        XCTAssertEqual(newMissing?.path, "/fake/old")
    }

    func testRootDiscoveryDefaultsNext() {
        let tree: Set<String> = [
            "/fake/defaults/pipeline/sculptline_pipeline.py",
            "/fake/repo/pipeline/sculptline_pipeline.py"
        ]
        // An env path that does not contain the pipeline is skipped.
        let root = SculptLineViewModel.discoverSculptLineRoot(
            environment: ["SCULPTLINE_ROOT": "/fake/missing", "FABLED_ROOT": "/fake/missing2"],
            defaultsPath: "/fake/defaults",
            startDirectories: [URL(fileURLWithPath: "/fake/repo/SculptLine")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(root?.path, "/fake/defaults")
    }

    func testRootDefaultsPathPrefersNewKey() throws {
        let suite = "LicensingAndRootTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        XCTAssertNil(SculptLineCLI.rootDefaultsPath(defaults))
        defaults.set("/old/root", forKey: "fabledRootPath")
        XCTAssertEqual(SculptLineCLI.rootDefaultsPath(defaults), "/old/root")
        defaults.set("  ", forKey: "sculptlineRootPath")
        XCTAssertEqual(SculptLineCLI.rootDefaultsPath(defaults), "/old/root", "a blank new key falls back to the old one")
        defaults.set("/new/root", forKey: "sculptlineRootPath")
        XCTAssertEqual(SculptLineCLI.rootDefaultsPath(defaults), "/new/root")
    }

    func testRootDiscoveryAcceptsPreRenamePipelineScript() {
        // A checkout from before the rename only has pipeline/fabled_pipeline.py.
        let tree: Set<String> = ["/fake/oldrepo/pipeline/fabled_pipeline.py"]
        let root = SculptLineViewModel.discoverSculptLineRoot(
            environment: [:],
            defaultsPath: nil,
            startDirectories: [URL(fileURLWithPath: "/fake/oldrepo/FabledStudio")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(root?.path, "/fake/oldrepo")
    }

    func testCLIPrefersNewNamesAndFallsBackToOldOnes() {
        let root = URL(fileURLWithPath: "/fake/repo")
        let both: Set<String> = [
            "/fake/repo/pipeline/sculptline_pipeline.py", "/fake/repo/pipeline/fabled_pipeline.py",
            "/fake/repo/validator/sculptline_validator/__init__.py", "/fake/repo/validator/fabled_validator/__init__.py"
        ]
        XCTAssertEqual(SculptLineCLI.pipelineScript(in: root, fileExists: exists(both))?.path,
                       "/fake/repo/pipeline/sculptline_pipeline.py")
        XCTAssertEqual(SculptLineCLI.validatorModule(in: root, fileExists: exists(both)), "sculptline_validator")

        let oldOnly: Set<String> = [
            "/fake/repo/pipeline/fabled_pipeline.py", "/fake/repo/validator/fabled_validator/__init__.py"
        ]
        XCTAssertEqual(SculptLineCLI.pipelineScript(in: root, fileExists: exists(oldOnly))?.path,
                       "/fake/repo/pipeline/fabled_pipeline.py")
        XCTAssertEqual(SculptLineCLI.validatorModule(in: root, fileExists: exists(oldOnly)), "fabled_validator")

        XCTAssertNil(SculptLineCLI.pipelineScript(in: root, fileExists: exists([])))
        XCTAssertEqual(SculptLineCLI.validatorModule(in: root, fileExists: exists([])), "sculptline_validator")
    }

    func testRootDiscoveryWalksUpFromStartDirectory() {
        let tree: Set<String> = ["/fake/repo/pipeline/sculptline_pipeline.py"]
        let root = SculptLineViewModel.discoverSculptLineRoot(
            environment: [:],
            defaultsPath: nil,
            startDirectories: [URL(fileURLWithPath: "/fake/repo/SculptLine/.build/debug")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(root?.path, "/fake/repo")
    }

    func testRootDiscoveryAcceptsFabledFolderChild() {
        // In the monorepo the project lives in a folder named `fabled`.
        let tree: Set<String> = ["/fake/work/fabled/pipeline/sculptline_pipeline.py"]
        let root = SculptLineViewModel.discoverSculptLineRoot(
            environment: [:],
            defaultsPath: nil,
            startDirectories: [URL(fileURLWithPath: "/elsewhere/a"), URL(fileURLWithPath: "/fake/work/tools")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(root?.path, "/fake/work/fabled")
    }

    func testRootDiscoveryStopsAfterEightLevels() {
        let tree: Set<String> = ["/r/pipeline/sculptline_pipeline.py"]
        let tooDeep = SculptLineViewModel.discoverSculptLineRoot(
            environment: [:],
            defaultsPath: nil,
            startDirectories: [URL(fileURLWithPath: "/r/1/2/3/4/5/6/7/8/9")],
            fileExists: exists(tree)
        )
        XCTAssertNil(tooDeep)
        let withinLimit = SculptLineViewModel.discoverSculptLineRoot(
            environment: [:],
            defaultsPath: nil,
            startDirectories: [URL(fileURLWithPath: "/r/1/2/3/4/5/6/7")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(withinLimit?.path, "/r")
    }

    func testRootDiscoveryReturnsNilWhenNothingMatches() {
        let root = SculptLineViewModel.discoverSculptLineRoot(
            environment: ["SCULPTLINE_ROOT": "/fake/env", "FABLED_ROOT": "/fake/env2"],
            defaultsPath: "/fake/defaults",
            startDirectories: [URL(fileURLWithPath: "/fake/repo/SculptLine")],
            fileExists: exists(["/fake/unrelated/pipeline/sculptline_pipeline.py", "/fake/unrelated/pipeline/fabled_pipeline.py"])
        )
        XCTAssertNil(root)
    }

    // MARK: - Manifest LODs (top-level lods merged with outputs.lods, as the web app's normalizeLods)

    func testManifestLODsPreferGLBFromOutputsLods() throws {
        // Shape of pipeline/output/manifest.json: top-level `lods` carry only the .fbx export paths; the loadable
        // .glb copies (and vertex counts) are only in `outputs.lods`. Parsed the way the app parses it.
        let manifestJSON = """
        {"schema": "fabled.pipeline.manifest/0.1", "asset": "HelenKellerBust",
         "lods": [
          {"level": 0, "path": "export/SM_HelenKellerBust_LOD0.fbx", "triangles": 18636, "budget_triangles": 20000},
          {"level": 1, "path": "export/SM_HelenKellerBust_LOD1.fbx", "triangles": 9334, "budget_triangles": 10000},
          {"level": 2, "path": "export/SM_HelenKellerBust_LOD2.fbx", "triangles": 4493, "budget_triangles": 5000},
          {"level": 3, "path": "export/SM_HelenKellerBust_LOD3.fbx", "triangles": 1836, "budget_triangles": 2000}
         ],
         "outputs": {
          "combined_fbx": "export/SM_HelenKellerBust.fbx",
          "lods": [
           {"level": 3, "name": "LOD3", "path": "export/SM_HelenKellerBust_LOD3.fbx", "format": "fbx",
            "glb": "export/SM_HelenKellerBust_LOD3.glb", "triangles": 1836, "vertices": 928, "budget_triangles": 2000,
            "screen_size": 0.125, "has_uvs": true},
           {"level": 0, "name": "LOD0", "path": "export/SM_HelenKellerBust_LOD0.fbx", "format": "fbx",
            "glb": "export/SM_HelenKellerBust_LOD0.glb", "triangles": 18636, "vertices": 9329, "budget_triangles": 20000,
            "screen_size": 1.0, "has_uvs": true},
           {"level": 1, "name": "LOD1", "path": "export/SM_HelenKellerBust_LOD1.fbx", "format": "fbx",
            "glb": "export/SM_HelenKellerBust_LOD1.glb", "triangles": 9334, "vertices": 4681, "budget_triangles": 10000,
            "screen_size": 0.5, "has_uvs": true},
           {"level": 2, "name": "LOD2", "path": "export/SM_HelenKellerBust_LOD2.fbx", "format": "fbx",
            "glb": "export/SM_HelenKellerBust_LOD2.glb", "triangles": 4493, "vertices": 2270, "budget_triangles": 5000,
            "screen_size": 0.25, "has_uvs": true}
          ]
         }}
        """
        let manifest = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(manifestJSON.utf8)) as? [String: Any])

        let lods = PipelineManifestLODs.normalize(manifest)
        XCTAssertEqual(lods.map { $0.level }, [0, 1, 2, 3])
        XCTAssertEqual(lods.map { $0.viewerPath }, [
            "export/SM_HelenKellerBust_LOD0.glb",
            "export/SM_HelenKellerBust_LOD1.glb",
            "export/SM_HelenKellerBust_LOD2.glb",
            "export/SM_HelenKellerBust_LOD3.glb"
        ])
        // Top-level values win; fields only the outputs duplicate has come through.
        XCTAssertEqual(lods[0].path, "export/SM_HelenKellerBust_LOD0.fbx")
        XCTAssertEqual(lods[0].triangles, 18636)
        XCTAssertEqual(lods[0].budgetTriangles, 20000)
        XCTAssertEqual(lods[0].vertices, 9329)
        XCTAssertEqual(lods[3].vertices, 928)
        XCTAssertEqual(lods[1].hasUVs, true)
        XCTAssertEqual(lods[2].screenSize, 0.25)
        XCTAssertEqual(lods[3].name, "LOD3")
    }

    func testManifestLODsFallbacks() {
        // No top-level lods: outputs.lods is the list.
        let outputsOnly: [String: Any] = [
            "outputs": ["lods": [["name": "LOD1", "path": "export/A_LOD1.fbx", "glb": "export/A_LOD1.glb"] as [String: Any],
                                 ["name": "LOD0", "path": "export/A_LOD0.obj"] as [String: Any]]] as [String: Any]
        ]
        let fromOutputs = PipelineManifestLODs.normalize(outputsOnly)
        XCTAssertEqual(fromOutputs.map { $0.level }, [0, 1], "levels come from the LOD<n> names")
        XCTAssertEqual(fromOutputs.map { $0.viewerPath }, ["export/A_LOD0.obj", "export/A_LOD1.glb"])

        // An .fbx-only LOD has nothing the native viewer can load.
        let fbxOnly: [String: Any] = ["lods": [["level": 0, "path": "export/B_LOD0.fbx"] as [String: Any]]]
        let fbx = PipelineManifestLODs.normalize(fbxOnly)
        XCTAssertEqual(fbx.count, 1)
        XCTAssertNil(fbx[0].viewerPath)

        XCTAssertTrue(PipelineManifestLODs.normalize([:]).isEmpty)
        XCTAssertTrue(PipelineManifestLODs.normalize(["lods": NSNull()]).isEmpty)
    }

    // MARK: - Manifest texture paths

    func testManifestTexturePathsArrayDictAndFallback() {
        let arrayForm: [String: Any] = [
            "textures": [["material": "M_X", "base_color": NSNull(), "normal": "export/T_X_N.png", "orm": "export/T_X_ORM.png"] as [String: Any]]
        ]
        let fromArray = PipelineManifestTextures.paths(in: arrayForm)
        XCTAssertEqual(fromArray.normal, "export/T_X_N.png")
        XCTAssertEqual(fromArray.orm, "export/T_X_ORM.png")

        let dictForm: [String: Any] = ["textures": ["normal": "export/T_Y_N.png", "orm": "export/T_Y_ORM.png"]]
        XCTAssertEqual(PipelineManifestTextures.paths(in: dictForm).normal, "export/T_Y_N.png")

        let outputsOnly: [String: Any] = ["textures": NSNull(), "outputs": ["textures": ["normal": "export/T_Z_N.png", "orm": NSNull()] as [String: Any]] as [String: Any]]
        let fromOutputs = PipelineManifestTextures.paths(in: outputsOnly)
        XCTAssertEqual(fromOutputs.normal, "export/T_Z_N.png")
        XCTAssertNil(fromOutputs.orm)

        let none = PipelineManifestTextures.paths(in: [:])
        XCTAssertNil(none.normal)
        XCTAssertNil(none.orm)
    }

    // MARK: - Profile rows for an opened run

    func testProfileRowsComeFromTheRunFilesOnly() throws {
        // Shapes of pipeline/output/validator_profile.json and manifest.json (parsed the way the app parses them).
        let profileJSON = """
        {"profile_name": "Smoke test (example values)", "profile_version": "0.1",
         "units": {"assumed_source_units": "cm", "trust_file_units": true, "expected_height_cm": {"min": 20, "max": 80}},
         "axes": {"up": "Z"}, "lods": {"triangle_budgets": [20000, 10000, 5000, 2000]},
         "materials": {"required_texture_slots": ["Normal", "ORM"]},
         "texel_density": {"target_px_per_cm": 25.6, "tolerance_pct": 25}, "normals": {"max_flipped_faces": 0}}
        """
        let manifestJSON = """
        {"export_up_axis": "Z", "units": {"unreal_units": "cm"}, "exported_size": {"fbx_height_cm": 53.089},
         "stages": {"uv": {"texel_density_px_per_cm_at_bake_res": 10.24}, "bake": {"resolution": 2048}}}
        """
        let profile = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(profileJSON.utf8)) as? [String: Any])
        let manifest = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(manifestJSON.utf8)) as? [String: Any])

        let rows = PipelineProfileRows.rows(manifest: manifest, profile: profile)
        let byKey: [String: String] = Dictionary(rows.map { ($0.0, $0.1) }, uniquingKeysWith: { first, _ in first })
        XCTAssertEqual(rows.count, byKey.count, "row keys are unique (the view uses them as ids)")
        XCTAssertEqual(byKey["Validator profile"], "Smoke test (example values) v0.1")
        XCTAssertEqual(byKey["Height"], "20–80 cm · measured 53.1 cm")
        XCTAssertEqual(byKey["LOD budgets"], "LOD0 20,000 · LOD1 10,000 · LOD2 5,000 · LOD3 2,000")
        XCTAssertEqual(byKey["Texel density"], "target 25.6 px/cm ±25% · measured 10.24 px/cm")
        XCTAssertEqual(byKey["Up axis"], "profile Z up · FBX Z up")
        XCTAssertEqual(byKey["Textures"], "Normal + ORM required · baked at 2048 px")
        XCTAssertEqual(byKey["Max flipped faces"], "0")

        // No profile file and a bare manifest: nothing is invented.
        XCTAssertTrue(PipelineProfileRows.rows(manifest: [:], profile: nil).isEmpty)
        let measuredOnly = PipelineProfileRows.rows(manifest: manifest, profile: nil)
        XCTAssertNil(measuredOnly.first(where: { $0.0 == "Validator profile" }))
        XCTAssertNil(measuredOnly.first(where: { $0.0 == "LOD budgets" }))
        XCTAssertEqual(measuredOnly.first(where: { $0.0 == "Height" })?.1, "measured 53.1 cm")
    }
}
