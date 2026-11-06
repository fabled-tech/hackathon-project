import XCTest
@testable import FabledStudio

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
        let vm = FabledStudioViewModel()
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

    func testCatalogUserVisibleStringsDoNotUseHerName() {
        for category in FabledStudioViewModel.standardCatalog {
            XCTAssertFalse(category.category.localizedCaseInsensitiveContains("Keller"))
            for asset in category.assets {
                let visible = [asset.name, asset.category, asset.tag, asset.status, asset.triangles, asset.timestamp]
                for text in visible {
                    XCTAssertFalse(text.localizedCaseInsensitiveContains("Keller"), "asset \(asset.id) shows \"\(text)\"")
                }
            }
        }
        let vm = FabledStudioViewModel()
        for (id, note) in vm.assetNotes {
            XCTAssertFalse(note.localizedCaseInsensitiveContains("Keller"), "note for \(id) uses her name")
            XCTAssertFalse(note.contains("Davidson"))
        }
    }

    // MARK: - Fabled root discovery (fake tree, no real filesystem)

    private func exists(_ paths: Set<String>) -> (String) -> Bool {
        return { paths.contains($0) }
    }

    func testRootDiscoveryEnvironmentWins() {
        let tree: Set<String> = [
            "/fake/env/pipeline/fabled_pipeline.py",
            "/fake/defaults/pipeline/fabled_pipeline.py",
            "/fake/repo/pipeline/fabled_pipeline.py"
        ]
        let root = FabledStudioViewModel.discoverFabledRoot(
            environment: ["FABLED_ROOT": "/fake/env"],
            defaultsPath: "/fake/defaults",
            startDirectories: [URL(fileURLWithPath: "/fake/repo/FabledStudio")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(root?.path, "/fake/env")
    }

    func testRootDiscoveryDefaultsNext() {
        let tree: Set<String> = [
            "/fake/defaults/pipeline/fabled_pipeline.py",
            "/fake/repo/pipeline/fabled_pipeline.py"
        ]
        // An env path that does not contain the pipeline is skipped.
        let root = FabledStudioViewModel.discoverFabledRoot(
            environment: ["FABLED_ROOT": "/fake/missing"],
            defaultsPath: "/fake/defaults",
            startDirectories: [URL(fileURLWithPath: "/fake/repo/FabledStudio")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(root?.path, "/fake/defaults")
    }

    func testRootDiscoveryWalksUpFromStartDirectory() {
        let tree: Set<String> = ["/fake/repo/pipeline/fabled_pipeline.py"]
        let root = FabledStudioViewModel.discoverFabledRoot(
            environment: [:],
            defaultsPath: nil,
            startDirectories: [URL(fileURLWithPath: "/fake/repo/FabledStudio/.build/debug")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(root?.path, "/fake/repo")
    }

    func testRootDiscoveryAcceptsFabledChild() {
        let tree: Set<String> = ["/fake/work/fabled/pipeline/fabled_pipeline.py"]
        let root = FabledStudioViewModel.discoverFabledRoot(
            environment: [:],
            defaultsPath: nil,
            startDirectories: [URL(fileURLWithPath: "/elsewhere/a"), URL(fileURLWithPath: "/fake/work/tools")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(root?.path, "/fake/work/fabled")
    }

    func testRootDiscoveryStopsAfterEightLevels() {
        let tree: Set<String> = ["/r/pipeline/fabled_pipeline.py"]
        let tooDeep = FabledStudioViewModel.discoverFabledRoot(
            environment: [:],
            defaultsPath: nil,
            startDirectories: [URL(fileURLWithPath: "/r/1/2/3/4/5/6/7/8/9")],
            fileExists: exists(tree)
        )
        XCTAssertNil(tooDeep)
        let withinLimit = FabledStudioViewModel.discoverFabledRoot(
            environment: [:],
            defaultsPath: nil,
            startDirectories: [URL(fileURLWithPath: "/r/1/2/3/4/5/6/7")],
            fileExists: exists(tree)
        )
        XCTAssertEqual(withinLimit?.path, "/r")
    }

    func testRootDiscoveryReturnsNilWhenNothingMatches() {
        let root = FabledStudioViewModel.discoverFabledRoot(
            environment: ["FABLED_ROOT": "/fake/env"],
            defaultsPath: "/fake/defaults",
            startDirectories: [URL(fileURLWithPath: "/fake/repo/FabledStudio")],
            fileExists: exists(["/fake/unrelated/pipeline/fabled_pipeline.py"])
        )
        XCTAssertNil(root)
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
}
