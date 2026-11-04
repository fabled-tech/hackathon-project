# ROADMAP.md

## Status (as of 2026-11-03)
- **Pipeline v0.1:** works end-to-end on one real CC0 sculpt (frozen run `runs/20261025-224413`, which isn't in the kit). Its validator report is **pass** with 12 pass / 0 warn / 0 fail / 3 not_checked across 15 checks. Linux and Blender 4.5.15 only.
- **Validator v0:** 15 + 1 checks, report schema 0.2.0. The test suite passes 95/95 here. It has only been tested on synthetic fixtures plus the pipeline's own Blender FBX.
- **UI:** local prototype with stub mode. The upload→pipeline path has only been tested against a mock CLI. The static demo build is prepped for Vercel and **not deployed**.
- **Unreal import script:** draft only, never run.
- **Security foundation:** separate private Origin repo `fabled-firm/sculptline-demos`, with open PRs that are not merged: [#1](https://cursor.com/codebase/fabled-firm/sculptline-demos/pull/1) iPad/Mac prototypes, [#2](https://cursor.com/codebase/fabled-firm/sculptline-demos/pull/2) `platform/` Next.js + Supabase + Stripe test mode, auth/RLS, [#4](https://cursor.com/codebase/fabled-firm/sculptline-demos/pull/4) storage, data handling and CCPA, [#3](https://cursor.com/codebase/fabled-firm/sculptline-demos/pull/3) Stripe test mode, [#5](https://cursor.com/codebase/fabled-firm/sculptline-demos/pull/5) integration check (**do not merge**). #5 reports 102 tests passing. Its SECURITY_CHECKLIST has 36 items: 29 PASS, 1 FAIL (dev-only ESLint minimatch audit), 6 OPEN (CI not run on Origin; no malware/zip scan; hosted storage delete and session revocation unverified; retention purge not scheduled; encryption at rest unverified; Stripe Link/portal config). If Patrick approves, merge #2, then #4, then #3. (These PR facts come from the brief and weren't re-verified here.)

## Known gaps
- Unreal import never tested. It needs UE 5.4/5.5 on Windows or Mac. LodGroup pickup, scale, and ORM split are all unverified.
- The UI upload path hasn't been run with real Blender.
- The bust has no base colour (the scan has none). Roughness and metallic are constants, and LOD1–3 reuse LOD0's maps.
- FBX absolute-path leak: per the brief, it's fixed in the Mochi runs but not in the frozen run. A grep for `/home/box` found none in either set of FBXs, so the exact leaked string wasn't confirmed.
- Mochi test: the source is low-poly Hunyuan output, not real high-poly input. The brief gives WARN with 12 pass / 1 warn / 0 fail / 3 not_checked. The kit's `runs/mochi-test-20261025-231636/validator_report.json` reads **fail** with 10/1/2/3, so the WARN result must come from a later run that isn't in this folder. Open issues: height 28.9 cm vs the 30 cm target, rump cavity, paw spike, ear sliver, whiskers only on LOD0, 28 UV-flipped faces, no rig.
- USDZ export test drops AO and LOD grouping and hasn't been tested in Quick Look or visionOS. No USDZ code exists in this source tree.
- Vendored `fast_simplification` is a linux x86_64 binary. Nothing has run on macOS.
- Retopo is QuadriFlow, not artist-quality (fine for static props, not for animated characters). There's no collision, no lightmap UV, and no skinning.
- Source units for the bust are inferred (inches). A human needs to confirm them.
- Remaining CONCEPT MOCKUP labels in UI code (intentional; they mark stubs and previews): `public/index.html` global badge and right-viewer badge; `public/app.js` (stub status, browser decimation preview, test-fixture/mockup manifest badges, stub report pill); `server.mjs` stub fallbacks; `stub/*.CONCEPT_MOCKUP.json`; `landing-mockup/index.html` banner.

## Tickets
1. **Run the pipeline on macOS arm64.** Scope: make `--blender`/`FABLED_BLENDER` work on a Mac Blender 4.5 build, and replace or rebuild vendored `fast_simplification` for Blender's Python. AC: the bust run completes with `status:"ok"`, and the validator passes with the bust profile. Record Mac wall-clock times as measured.
2. **Unreal import test.** Scope: run `import_fabled_asset.py` on the frozen bust manifest in UE 5.4/5.5 and fix the API calls. AC: 4 LODs land in one StaticMesh, UE tri counts match the manifest, height reads ~53 cm, normal and ORM are hooked up, screenshots and fixes are committed, and the script header no longer says UNTESTED.
3. **Real-Blender upload path in the UI.** AC: upload of the sample head → Build → live progress → manifest → validator report, all with the real CLIs. A failed run shows its error.
4. **Strip absolute paths from the frozen run.** AC: no absolute paths in any FBX or JSON of the demo bundle, and `build:demo` and `check:demo` both pass.
5. **Fix Mochi geometry issues.** Scope: scale axis bug, rump cavity, paw spike, ear sliver, flipped UV faces, degenerate and reversed triangles. AC: the Mochi profile reports 0 fail, and height is within ±1 cm of 30 cm.
6. **Base colour support.** AC: when the source has colour, `T_<Asset>_BC.png` is baked and listed in the manifest, and the validator `texture_slots` passes with BaseColor required.
7. **Validator on real-world FBX.** AC: at least 3 non-synthetic FBX files (Maya, Max, Blender) have been checked, any reader bugs are fixed with tests, and the suite stays green.
8. **USDZ export, if pursued.** AC: AO and LOD handling are documented, and the file opens in Quick Look with screenshots, or the limitation is stated.
9. **Security PR merge (Patrick's OK required).** AC: #2, #4, #3 merged in that order, #5 closed unmerged, CI run on Origin, and the 6 OPEN checklist items resolved or ticketed.
