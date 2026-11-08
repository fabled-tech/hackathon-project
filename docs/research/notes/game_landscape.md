# AI and Automation Tools for Video Game Development (state as of November 2026)

Research notes compiled 2026-11-08. Method and limits: WebSearch summaries plus a small number of direct fetches. In this session nearly every vendor and press host (docs.meshy.ai, platform.tripo3d.ai, hyper3d.ai, gdconf.com, businesswire.com, forums.unrealengine.com, 80.lv, pcgamer.com, huggingface.co, app.cinevva.com, wccftech.com, reddit mirrors) was outside the allowed network, so only github.com pages were read directly; everything else comes from search-engine result summaries of those pages. The per-turn web-search budget was also exhausted before the final round of verification queries. Pricing figures from third-party aggregators (CostBench, aitoolsatlas, Capterra, etc.) are marked as such and should be treated as unverified. Anything dated before 2026 carries its date.

---

## Key Question 1: 3D asset generation — which products ship APIs, what outputs look like, cost per generation, commercial terms

### Takeaway
By late 2026 the 3D-generation market has consolidated around four API-first commercial vendors (Meshy, Tripo, Hyper3D/Rodin, Tencent Hunyuan3D) that all now advertise PBR textures, quad-or-triangle retopology with a user-set face budget, and one-click rigging, priced via credits at roughly $0.40–$0.80 per textured generation through third-party resellers; open-weight alternatives (TRELLIS under MIT, Hunyuan3D 2.x, Roblox Cube) exist but need a 16 GB GPU and ship untextured-or-baked meshes without production UVs. Official pricing pages could not be fetched, so per-plan numbers below are second-hand.

### Cited Findings

**Meshy (Meshy AI)**
- Official docs (via search summary of docs.meshy.ai/pricing): Meshy 7 and Meshy 6 each cost 20 credits per generation, or 25 with Ultra Mode; Text-to-3D is 20 credits on Meshy 6 and "not supported on Meshy 7"; Image-to-3D is 25 on Meshy 7 and 20 on Meshy 6; AI Texturing is 10 credits per model; Remesh is 0 credits per model — [Meshy Pricing & Credits](https://docs.meshy.ai/pricing)
- Meshy API is "a pay-before-you-go product"; API usage must be purchased in advance; volume and custom pricing via sales — [docs.meshy.ai API pricing](https://docs.meshy.ai/api/pricing)
- Meshy's Remesh tool targets a polycount in Fixed or Adaptive mode with Quad or Triangle topology; the API range is 100 to 300,000 polygons; Meshy's docs say remeshing yields cleaner topology for Unwrap UV and Rigging — [Meshy Remesh docs](https://docs.meshy.ai/en/webapp/guides/3d-model/remesh)
- Meshy auto-rigging offers humanoid, quadruped and "smart-rig" presets; marketing page claims rigs typically finish in under 30 seconds — [Meshy AI Rigging](https://www.meshy.ai/features/ai-auto-rigging)
- Meshy's own retopology guide positions automatic retopology as suited to "props, environment assets, prototypes, and most game-ready characters," while hero characters may still need manual work — [Meshy AI retopology guide](https://www.meshy.ai/tutorials/ai-retopology-guide)
- A reseller (Summer Engine) lists "Meshy 7.1" as a September 2026 model offering triangle or quad topology, symmetry, a face count, PBR maps and optional auto-rigging, at 172 credits/model in that reseller's own studio (reseller pricing, not Meshy's) — [Summer Engine Meshy 7.1 listing](https://www.summerengine.com/models/meshy-7-1)
- Third-party plan prices conflict (Pro listed at $16–$20/month with 200 or 1,000 credits depending on site); unverified — [CostBench Meshy](https://costbench.com/software/ai-3d-generation/meshy/); [Meshy help center plans article](https://help.meshy.ai/en/articles/12062933-what-are-your-prices-and-plans-offered-and-do-you-have-monthly-annual-plans)

**Tripo (Tripo3D, VAST)**
- Tripo 3.0 announced 20 Aug 2025 as "available now," built on an enhanced TripoSF using a SparseFlex representation — [Business Wire, 2025-08-20](https://www.businesswire.com/news/home/20250820723593/en)
- Vendor claim: "more than 20 billion parameters — a 20x increase over previous versions" — [GamesBeat on Tripo 3.0](https://gamesbeat.com/tripo-3-0-makes-it-easy-to-generate-ai-3d-content/)
- Tripo 3.0 offers PBR map generation, quad-mesh optimization and adjustable Face Limits; "smart retopology" can remesh to quad or triangle geometry; a Rigging V1 & V2 section exists — [Scenario help: Tripo 3.0 Suite](https://help.scenario.com/en/articles/tripo-3-0-suite-the-essentials)
- Tripo "Smart Topology Mesh" is claimed to output geometry in roughly 2 seconds; auto-rigging "can generate complete skeletons and skin weights for characters and creatures with just one click" (press release) — [Barchart/Tripo texturing PR](https://www.barchart.com/story/news/1140646/tripo3d-introduces-intelligent-ai-texturing-tools-for-faster-and-smarter-3d-content-creation)
- Tripo's own blog: API is $1 per 100 credits, "includes commercial use for all generated assets," and a model-generation task costs about 40–50 credits (i.e. roughly $0.40–$0.50 per generation); API access is not included in the free tier; free-tier outputs are not licensed for commercial use; commercial license is tied to the API account — [Tripo blog: commercial use of AI 3D models](https://www.tripo3d.ai/blog/commercial-use-ai-3d-models)
- AWS Marketplace enterprise listing: 1,000,000-credit pack for $8,000 and 2,000,000-credit pack for $14,000, one-time purchases, subject to vendor EULA — [AWS Marketplace Tripo](https://aws.amazon.com/marketplace/pp/prodview-hwlbvx7vubh7c)
- Third-party plan listing: free (600 credits/month) up to $139.9/month for 25,000 credits with 20% annual discount; unverified — [StackSheriff Tripo review](https://stacksheriff.com/ai-tools/tripo3d-review/)

**Hyper3D Rodin (Deemos)**
- Rodin Gen-2 launched ~2 Oct 2025; described as a 10B-parameter model on the "BANG" architecture using recursive part-based generation — [Befores & Afters, 2025-10-02](https://beforesandafters.com/2025/10/02/deemos-launches-rodin-gen-2-a-groundbreaking-generative-ai-for-intuitive-3d-creation/); [Barchart PR](https://www.barchart.com/story/news/35175459/deemos-tech-launches-hyper3d-rodin-gen-2-next-generation-3d-model-generator)
- Default output is quad-dominant with PBR materials; `settings.meshMode` offers Quad (default, density tiers 4k/8k/18k/50k quads) or Triangle (up to 500k) — [Runware Rodin Gen-2 topology guide](https://runware.ai/docs/models/hyper3d-rodin-gen-2/guides/topology-and-polygon-budget)
- "Bang!" is a separate 3D-to-3D tool that decomposes a finished mesh into semantically meaningful parts and regenerates PBR materials per part — [Scenario help: Rodin Hyper3D Bang!](https://help.scenario.com/articles/7603337491-rodin-hyper3d-bang-the-essentials)
- The "4x improvement over Rodin 1.5" claim comes from Deemos' internal evaluation; no public benchmark — [aiwiki Rodin Gen-2](https://aiwiki.ai/wiki/rodin_gen_2)
- Rodin Gen-2.5 exists (80.lv coverage, "production-level control"); a March 31, 2026 press release also references it — [80.lv on Rodin Gen-2.5](https://80.lv/articles/how-hyper3d-rodin-gen-2-5-is-bringing-production-level-control-to-ai-3d-generation); [Hillsboro Banner PR, 2026-03-31](https://www.hillsborobanner.com/online_features/press_releases/article_921b3233-ed85-5666-85d9-c60594760dbe.html)
- Third-party reseller rates: $0.80/request for Gen-2 (EmpirioLabs); $0.40 standard / $0.80 "Gen-2.5-Extreme-High" per generation (WaveSpeed) — [EmpirioLabs Hyper3D Gen2](https://empiriolabs.ai/models/hyper3d-gen2); [WaveSpeed Rodin v2.5](https://wavespeed.ai/models/hyper3d/rodin-v2.5/image-to-3d)
- Official plans per an aggregator: Creator $30/month, Business $120/month, 20% off annual; Gen-2.5 generations from 0.5 credit, HighPack add-on +1 credit; unverified — [Aixploria Hyper3D](https://www.aixploria.com/?p=51918)
- Rodin Gen-2 is also resold inside Scenario, Layer.ai and Runware — [Scenario Rodin Gen-2 model page](https://www.scenario.com/models/rodin-gen-2); [Layer.ai Rodin Gen-2](https://www.layer.ai/models/hyper3d-rodin-gen-2); [Runware Hyper3D](https://runware.ai/creators/hyper3d)

**Tencent Hunyuan3D**
- Hunyuan3D-2 GitHub (read directly): 2.0 released 21 Jan 2025 (DiT-v2-0 shape, Paint-v2-0 texture, Delight-v2-0); 2mini (0.6B) and 2mv (1.1B multiview) 18 Mar 2025; 2.1 released 13 Jun 2025 with a "new PBR model" (Paint-v2-1, 1.3B); 2.5 only as a technical report (23 Jun 2025); HunyuanWorld-1.0 announced 26 Jul 2025; shape generation needs 6 GB VRAM, shape+texture 16 GB; output mesh is a trimesh object saveable to glb/obj; the repo ships a local API server (`python api_server.py --host 0.0.0.0 --port 8080`); README does not state the license text itself, only links to LICENSE — [github.com/Tencent-Hunyuan/Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)
- Hunyuan3D 3.0 launched September 2025 as a free-access model inside Tencent's Hunyuan 3D AI Creation Engine with a Tencent Cloud API; coverage says Tencent intended to open-source a separate "Hunyuan 3D Omni" multi-condition model; no source confirmed 3.0 weights were released — [Pandaily](https://pandaily.com/tencent-unveils-hunyuan-3d-3-0-ai-model-tripling-modeling-accuracy-with-free-access); [VOI](https://voi.id/en/amp/515585)
- Caution: "Tencent opens source Hunyuan 3.0 under Apache 2.0" headlines refer to the Hy3 295B language model, not Hunyuan3D 3.0 — [KuCoin news](https://www.kucoin.com/news/flash/tencent-opens-source-huanyuan-3-0-with-apache-2-0-license-halves-hallucination-rate)
- An older Hugging Face notice for an earlier Hunyuan3D release states Apache 2.0 — [HF notice](https://huggingface.co/spaces/LPDoctor/AIGC-3D/blob/main/Notice)

**Microsoft TRELLIS**
- GitHub (read directly): "TRELLIS models and the majority of the code are licensed under the MIT License" (some submodules differ); models up to 2B params (image-large 1.2B, text-base 342M, text-large 1.1B, text-xlarge 2.0B); outputs Radiance Fields, 3D Gaussians and meshes; GLB export with `texture_size=1024`; no mention of PBR or UV unwrapping; needs an NVIDIA GPU with ≥16 GB; Linux only tested; training code released 25 Mar 2025; TRELLIS.2 not mentioned on this page — [github.com/microsoft/TRELLIS](https://github.com/microsoft/TRELLIS)
- TRELLIS is also served as an NVIDIA NIM; NVIDIA lists it under the NVIDIA Community Model License alongside MIT — [NVIDIA NIM TRELLIS docs](https://docs.api.nvidia.com/nim/reference/microsoft-trellis); [NGC container](https://catalog.ngc.nvidia.com/orgs/nim/microsoft/containers/trellis/1)
- Secondary reports reference "TRELLIS 2" (a 4B model, Jan 2026 coverage); unverified here — [gentic.news](https://gentic.news/article/microsoft-s-trellis-2-4b-model); [CGWORLD Jan 2026](https://cgworld.jp/flashnews/01-202601-TRELLIS2.html)

**Stability AI**
- Stable Point Aware 3D (SPAR3D), released 8 Jan 2025, under the Stability Community License; companies above US$1M annual revenue need an Enterprise License for commercial use — [Hugging Face SPAR3D](https://huggingface.co/stabilityai/stable-point-aware-3d)

**Roblox Cube 3D**
- Open-sourced March 2025, on GitHub and Hugging Face; first feature is text-to-mesh; beta API inside Roblox Studio and as an in-experience Lua API; Roblox said more complex objects and scene generation would follow; no 2026-specific news surfaced — [Roblox newsroom](https://about.roblox.com/newsroom/2025/03/introducing-roblox-cube); [TechCrunch, 2025-03-17](https://techcrunch.com/2025/03/17/roblox-releases-its-open-source-model-that-can-create-3d-objects-using-ai/)

**Sloyd, CSM, Alpha3D, Spline AI, Kaedim, Luma Genie**
- Sloyd bills by subscription, not per generation; free guest tier is one generation/day (vendor blog) — [Sloyd pricing blog](https://www.sloyd.ai/blog/ai-3d-model-generator-pricing); aggregator lists $0–$50/month — [CostBench Sloyd](https://costbench.com/software/ai-3d-generation/sloyd/)
- CSM aggregator pricing: $0–$2,000/month across 6 plans, with a free tier; a $60/month tier is also listed; unverified — [CostBench CSM vs Sloyd](https://www.costbench.com/compare/csm-vs-sloyd/)
- Alpha3D aggregator pricing inconsistent (Free–$30/month vs $5–$162/month); 2026 status unclear — [CostBench AI 3D compare](https://costbench.com/software/ai-3d-generation/compare-all/)
- Spline AI: AI features only on paid plans; aggregator changelogs report a top-tier increase to $70/month (Aug–Sep 2026) — [CostBench Spline Aug 2026](https://costbench.com/changelog/spline-ai-price-increase-2026-08/)
- Kaedim: aggregator lists Starter $149/month, Studio $500/month, Enterprise on request; another source says custom per-asset pricing; unverified — [CostBench Kaedim](https://costbench.pages.dev/software/ai-3d-generation/kaedim/)
- Luma Genie: no primary source found on status, licensing or pricing; only third-party comparison pages — [Staquest Genie vs TRELLIS](https://staquest.com/compare/luma-genie-vs-trellis-3d)

### Inferences
- Across Meshy, Tripo and Rodin the per-generation "street price" clusters around $0.40–$0.80 for a textured PBR model via API; a solo developer generating 200 props a month would spend on the order of $100–$160 in API credits (inference from the resale rates above, not a quoted figure).
- The commercially important differentiator in 2025–26 shifted from "can it make a mesh" to controls over topology (quad vs tri), face budget and part decomposition — exactly the engine-readiness problem — which all four leaders now expose as API parameters.
- Open-weight models (TRELLIS, Hunyuan3D 2.x) are viable for teams with a 16 GB+ GPU and tolerance for Linux tooling, but their READMEs do not mention UV unwrapping or PBR map sets (TRELLIS) or ship PBR only from 2.1 onward (Hunyuan3D), so they lag the hosted products on engine-readiness.

### Gaps
- Official per-plan pricing for Meshy, Tripo, Hyper3D, CSM, Kaedim, Luma Genie and Spline could not be read (hosts blocked; search budget exhausted). Figures above from aggregators are unverified.
- Exact Meshy API USD price per credit, API endpoint names and output licensing text were not obtained.
- Hunyuan3D 2.1 license territory/MAU restrictions and whether Hunyuan3D 3.0 or Omni weights were ever released: unverified.
- Luma Genie's 2026 status (active, deprecated, folded into Dream Machine) is unknown; Kaedim's 2026 status is unknown.
- No independent, hands-on tri-count/UV-quality benchmarks across vendors were found; all quality claims above are vendor claims.

---

## Key Question 2: The "generated asset → engine-ready asset" problem (dense triangle soup, no clean UVs, inconsistent scale) and the tools that address it

### Takeaway
Vendors now bundle retopology (quad/tri with face limits), UV unwrap and auto-rig steps directly into their pipelines, and Unreal's Nanite lets static props skip retopology entirely; but developer discussion still holds that "prompt → production-ready Unreal asset" is not trustworthy for topology, UVs, materials, scale, collision, LODs and performance, so a Blender (or equivalent) cleanup pass remains the norm for anything that deforms or is a hero asset.

### Cited Findings
- A 2026 r/gamedev-style discussion (mirror snapshot dated 2026-05-08) argues current tools handle pieces of the AI 3D workflow but "prompt → production-ready Unreal asset" isn't trustworthy yet, specifically on topology, UVs, materials, scale, collisions, LODs and performance — [Reddit snapshot 1t5q2pj](https://reddit.sentinel-team.org/posts/1t5q2pj/snapshots/2026-05-08T22%3A27%3A28.91308Z)
- A separate post is titled "Tested a hybrid AI → game-ready workflow (1.5M → 664 tris)" (Feb 2026 snapshot; only the title was captured) — [Reddit snapshot 1r2y5tt](https://reddit.sentinel-team.org/posts/1r2y5tt/snapshots/2026-02-21T05%3A50%3A01.663559Z)
- Unreal shortcut: with Nanite, high-poly meshes can be used directly for static props, so for a non-deforming prop one can skip retopology and import a decimated AI mesh — [StraySpark Blender-to-engine pipeline 2026](https://strayspark.studio/blog/blender-to-game-engine-pipeline-2026)
- Standard Blender cleanup: fix scale and transforms first (1 Blender unit = 1 m for Unreal), apply transforms; retopology commonly via Voxel Remesh then QuadriFlow — [Neural4D Blender retopology guide](https://blog.neural4d.com/?p=3281)
- Meshy Remesh: Fixed/Adaptive target polycount, Quad or Triangle, API range 100–300,000 polys; remesh recommended before UV unwrap and rigging — [Meshy Remesh docs](https://docs.meshy.ai/en/webapp/guides/3d-model/remesh)
- Tripo "Smart Mesh"/smart retopology: quad- or triangle-based remesh with face limits; a step-by-step third-party guide exists — [TheToolNerd Tripo Smart Mesh guide](https://www.thetoolnerd.com/p/tripo-smart-mesh-p10-step-by-step-guide); [Scenario help on Tripo 3.0](https://help.scenario.com/en/articles/tripo-3-0-suite-the-essentials)
- Rodin Gen-2: quad-dominant default with explicit density tiers (4k/8k/18k/50k quads) or triangles to 500k; part decomposition via Bang! — [Runware topology guide](https://runware.ai/docs/models/hyper3d-rodin-gen-2/guides/topology-and-polygon-budget); [Scenario Bang! help](https://help.scenario.com/articles/7603337491-rodin-hyper3d-bang-the-essentials)
- Scenario offers "3D editing" features that wrap these vendor retopo/texture steps — [Scenario 3D editing](https://www.scenario.com/features/3d-editing)
- Blendswap "AI Retopology" tool exports GLB/FBX/OBJ for Blender, Unreal and Unity (vendor claim) — [Blendswap retopo studio](https://blendswap.com/studio/retopo)
- A Blender add-on ("Quadify Bridge – AI Mesh Importer", requires Quadify Ultra) exists specifically to import and quad-remesh AI-generated meshes — [Superhive Market listing](https://superhivemarket.com/products/quadify-bridge-ai-mesh-importer-for-blender)
- Sparseal announced a new AI-assisted retopology tool (80.lv article; page could not be fetched, so name/price/availability unverified) — [80.lv Sparseal article](https://80.lv/articles/sparseal-announces-new-ai-assisted-retopology-tool)
- A service market exists for manual cleanup: Fiverr gigs offer to "retopologize and optimize your AI generated 3D model" — [Fiverr listing](https://fiverr.com/lukakukhiani343/retopologize-and-optimize-your-ai-generated-3d-model)
- Tripo publishes a learning path on rigging and animating AI meshes, implying the pipeline from generation to rig is not yet one-click in practice — [Tripo education: rig/animate AI meshes](https://www.tripo3d.ai/education/rig-animate-ai-3d-meshes-learning-path)
- Blender Artists community thread on AI and retopology shows ongoing demand for a true AI retopo solution — [BlenderArtists thread](https://blenderartists.org/t/is-anyone-working-on-ai-and-retopology/1119808?page=2)

### Inferences
- For a small Unreal team the practical 2026 pipeline is: generate (Meshy/Tripo/Rodin) → use the vendor's quad remesh at a face budget → export GLB/FBX → import to UE 5.6+/5.7 with Nanite for static props (skip LODs) → Blender pass only for characters, modular kit pieces that must snap on a grid, or anything needing clean UV seams for trim sheets. The vendor remesh step converts the "dense triangle soup" problem into a "topology is clean but arbitrary" problem, which Nanite tolerates but skinned meshes and tiling materials do not.
- Scale normalization remains unaddressed by generators (no source showed a vendor exposing real-world scale); teams must standardize a unit convention at import (UE: centimeters) — this is an inference from the Blender guides, not a vendor statement.
- The existence of paid Blender add-ons and Fiverr services specifically for cleaning AI meshes is itself evidence that vendor output is not yet reliably engine-ready.

### Gaps
- No quantitative study comparing vendor remesh quality (edge-flow, pole count, UV distortion) was found.
- Could not read the actual Reddit/Polycount thread bodies (mirror host blocked); only one summary and one title.
- Sparseal tool details (name, price, platform, shipping vs announced) unverified.
- No source addressed automatic collision generation, lightmap UVs (UV1) or LOD chains for AI assets beyond the Nanite workaround.

---

## Key Question 3: Concept art and textures (Scenario, Layer.ai, Leonardo, Adobe Substance 3D AI, Polycam, Promethean AI)

### Takeaway
Image/texture generation is the most mature and least controversial layer: Scenario and Layer.ai have become aggregator platforms that resell 2D and 3D models (including Rodin and Tripo) with REST APIs and custom-model training, while Adobe's Firefly-based Text-to-Texture in Substance 3D Sampler (launched 2024) is the main incumbent-vendor offering. Official 2026 pricing for Scenario, Layer.ai and Leonardo could not be verified.

### Cited Findings
- Scenario is described as API-first, with a REST API studios use to batch-produce asset variants; when studios use their own custom-trained models, users retain ownership of generated assets — [tooldirectory.ai Scenario profile (reviewed June 2026)](https://tooldirectory.ai/tools/ai-generated-game-assets-scenario); [aitoolsatlas Scenario](https://aitoolsatlas.ai/tools/scenario)
- Scenario third-party pricing: Starter $15/mo, Pro $45/mo, Teams $75/mo (one record says Teams was renamed "Max" in Oct 2026), Enterprise custom; unverified — [CostBench Scenario changelog Oct 2026](https://costbench.com/changelog/scenario-gg-plan-added-2026-10/); [CostBench Scenario API](https://costbench.com/software/ai-media-apis/scenario-api/)
- Scenario hosts third-party 3D models (Rodin Gen-2, Tripo 3.0, Bang!) and 3D editing tools — [Scenario Rodin Gen-2](https://www.scenario.com/models/rodin-gen-2); [Scenario 3D editing](https://www.scenario.com/features/3d-editing)
- Layer.ai likewise lists Hyper3D Rodin Gen-2 and Gen-2.5 as hosted models — [Layer.ai Rodin Gen-2.5](https://layer.ai/models/hyper3d-rodin-gen-2-5.md)
- Layer.ai and Leonardo were listed in 2023 as free add-ons generating PBR textures inside the Unity Editor (dated 2023; does not establish 2026 pricing) — [CG Channel text-to-texture tag](https://www.cgchannel.com/tag/generate-texture-from-text-prompt/)
- Adobe Substance 3D Sampler Text to Texture launched 2024 (Sampler 4.4) in beta, built on Firefly; a prompt produces tileable texture variations; generative features require an Adobe account and are unavailable in the Steam version; Firefly usage is metered in credits — [Adobe Sampler generative workflows docs](https://experienceleague.adobe.com/en/docs/substance-3d-sampler/using/features-and-workflows/generative-workflows); [Adobe Sampler 4.4 release notes](https://experienceleague.adobe.com/en/docs/substance-3d-sampler/using/release-notes/version-4-4-substance-3d-sampler)
- Sampler has no standalone plan; it is in the Substance 3D Texturing plan (¥3,380/month) or Collection (¥8,180/month) per a Japanese guide updated July 2026 (regional, third-party) — [design-offset](https://design-offset.com/?p=578)
- Promethean AI pricing per aggregators: free tier (non-commercial), Indie ~$29–30/month (adds commercial use, full AI), Professional ~$89.99–90/month (Unreal integration placed in this tier), enterprise custom; one aggregator says last updated 4 Dec 2024; another claims only custom quotes — [SoftwareFinder Promethean](https://softwarefinder.com/artificial-intelligence/promethean-ai); [toolradar Promethean pricing](https://toolradar.com/tools/promethean-ai/pricing); [bestaitools Promethean](https://www.bestaitools.com/tool/promethean-ai/)
- Unity rolled out Unity AI (with texture generation) in Unity 6.2 — [CG Channel text-to-texture tag](https://www.cgchannel.com/tag/text-to-texture/)

### Inferences
- The platform play (Scenario, Layer.ai) is becoming the practical "one API key" route for small teams: a single account gives 2D concept generation, texture generation and resold 3D generation, trading higher per-unit cost for fewer integrations.
- Adobe's offering is the only one tied into a PBR-authoring tool that artists already use, which matters for teams that need trim sheets and tileables rather than hero textures.

### Gaps
- Official Scenario, Layer.ai, Leonardo and Polycam pricing/API terms were not read (budget exhausted before the Polycam query ran; no Polycam source at all).
- No 2026 primary source on Leonardo's game-specific features or output license.
- Promethean AI's current (2026) pricing and the status of its Unreal plugin are unverified.

---

## Key Question 4: Animation and rigging (Mixamo, Cascadeur, DeepMotion, Move.ai, Wonder Dynamics/Autodesk Flow Studio, Anything World, Meshy/Tripo rigging, MetaHuman Animator)

### Takeaway
Mixamo is still online but in de facto maintenance mode with no Adobe roadmap; auto-rigging has migrated into the 3D generators (Meshy, Tripo) and into Cascadeur's physics-assisted keyframing, while video mocap (Move.ai, DeepMotion, Autodesk Flow Studio) covers body animation at consumer prices. MetaHuman (including MetaHuman Animator) is free under the standard Unreal license below $1M revenue and left early access in 2025.

### Cited Findings
- Mixamo: 2026 guides say Adobe acquired Mixamo in 2015 and has shipped no meaningful updates since; it "has entered maintenance mode"; as of July 2026 the site was still accessible with a free Adobe account; no official discontinuation announcement found — [Cinevva Mixamo alternatives guide (2026)](https://app.cinevva.com/guides/free-character-animations-rigging); [Sorceress Mixamo alternative post](https://sorceress.games/blog/mixamo-alternative-auto-rig-3d-characters-in-the-browser)
- Mixamo license: characters and animations usable commercially without royalties; raw files may not be redistributed — [Cinevva guide](https://app.cinevva.com/guides/free-character-animations-rigging)
- Cascadeur: free tier is non-commercial; Indie plan ~$8/month adds FBX export (2026 third-party guide); Capterra lists a free version and "contact vendor"; the 2024.1 release introduced four subscription tiers — [Cinevva guide](https://app.cinevva.com/guides/free-character-animations-rigging); [Capterra Cascadeur](https://www.capterra.com/p/10015822/Cascadeur/); [Game World Observer on Cascadeur 2024.1](https://gameworldobserver.com/?p=23579)
- Move.ai: one source says Move One is $15/month and Move Pro is per-minute/per-project; another puts paid tiers at $30–$300/month; a free plan exists — [youngju.dev mocap deep dive, 2026-05-16](https://www.youngju.dev/blog/culture/2026-05-16-ai-motion-capture-animation-2026-move-ai-cascadeur-deepmotion-wonder-studio-rokoko-plask-animatediff-runway-deep-dive.en); [aitoolsatlas Move AI vs Wonder Dynamics](https://aitoolsatlas.ai/compare/move-ai-vs-wonder-dynamics)
- Wonder Studio is now Autodesk Flow Studio; pricing reports conflict ($49/mo starting; freemium with render credits; Pro bundled in the Autodesk M&E Collection; "$1K/month+" enterprise) — [aitoolsatlas comparison](https://aitoolsatlas.ai/compare/move-ai-vs-wonder-dynamics); [Digital Production, 2024-10-31](https://digitalproduction.com/2024/10/31/wonder-dynamics-brings-real-time-animation-to-vfx/)
- DeepMotion: single-video to 3D character animation (FBX, BVH, glTF); no concrete price tiers found — [fast.io AI animation tools 2026](https://www.fast.io/resources/best-ai-animation-tools-2026.md)
- Meshy auto-rigging: humanoid, quadruped and smart-rig; "under 30 seconds" claim — [Meshy AI Rigging](https://www.meshy.ai/features/ai-auto-rigging)
- Tripo auto-rigging: one-click skeleton and skin weights for characters and creatures (press release); Rigging V1 & V2 — [Barchart Tripo PR](https://www.barchart.com/story/news/1140646/tripo3d-introduces-intelligent-ai-texturing-tools-for-faster-and-smarter-3d-content-creation); [Scenario Tripo 3.0 help](https://help.scenario.com/en/articles/tripo-3-0-suite-the-essentials)
- MetaHuman: included in the standard Unreal Engine license and free for anyone making under $1M USD revenue — [MetaHuman license](https://www.metahuman.com/en-US/license)
- MetaHuman left early access with a "feature-packed" release (2025); MetaHuman 5.7 shipped alongside Unreal Engine 5.7 on November 12 (2025); MetaHuman for Houdini is available on Linux as well as Windows — [MetaHuman leaves early access](https://www.metahuman.com/news/metahuman-leaves-early-access-with-a-feature-packed-new-release); [MetaHuman 5.7 is now available](https://www.metahuman.com/releases/metahuman-5-7-is-now-available); [UE forum MetaHuman 5.7](https://forums.unrealengine.com/t/metahuman-5-7-released/2672724)
- A third-party blog says the MetaHuman Creator web app shuts down 5 Nov 2026 with in-editor tooling taking over (unconfirmed by Epic in sources read) — [StraySpark MetaHuman web app shutdown guide](https://www.strayspark.studio/blog/metahuman-2026-web-app-shutdown-migration-guide)

### Inferences
- For a solo Unreal developer, the cheapest viable character pipeline in 2026 is: generator auto-rig (Meshy/Tripo) or MetaHuman for humans → Mixamo library or Move.ai/DeepMotion video mocap for body motion → MetaHuman Animator for facial capture. The weak link is that generator rigs are not on the Epic/MetaHuman skeleton, so retargeting (IK Retargeter) is still a manual step (inference; no source covered retargeting of generator rigs).
- Mixamo's stagnation plus the lack of an official shutdown date is a planning risk: teams depend on it but Adobe has given no guarantee.

### Gaps
- Official Cascadeur, Move.ai, DeepMotion, Autodesk Flow Studio and Anything World pricing pages were not read; Anything World ("Animate Anything") returned no results before the budget ran out.
- Whether Epic confirmed the MetaHuman Creator web-app shutdown: unverified.
- No source compared rig quality (weight painting, joint placement) from Meshy vs Tripo vs Mixamo auto-rigger.

---

## Key Question 5: NPCs, dialogue and voice (Inworld, Convai, ElevenLabs, NVIDIA ACE, Ubisoft NEO NPC/Teammates) — have any shipped?

### Takeaway
As of 2026, NVIDIA ACE is the only stack with confirmed live, player-facing deployments (Krafton's inZOI "Smart Zoi" since the March 2025 early-access launch; PUBG Ally in a limited June 2026 beta); Inworld has pivoted toward B2B infrastructure, Convai remains the developer-facing option with a $29/month indie tier, ElevenLabs is the de facto TTS layer (used inside Ubisoft's prototype), and Ubisoft's NEO NPC/Teammates remains an unshipped research prototype.

### Cited Findings
- inZOI: Krafton's Smart Zoi is described as the first ACE character in a shipped game and the most mature example; inZOI launched on Steam 28 March (2025) in early access — [Digital Trends CES 2025](https://www.digitaltrends.com/gaming/inzoi-pubg-ai-cpc-characters-ces-2025/); [Gaming-st (Japan) 2026 roundup](https://gaming-st.com/news/nvidia-ace-ai-npc-games-2026/)
- PUBG Ally: announced CES 2025, shown again CES 2026; available in Duos as a two-week beta from 17 June 2026 (to ~30 June); whether it became permanent is unconfirmed — [Wccftech, 2026-06-17](https://wccftech.com/nvidia-ace-pubg-ally-ai-teammate-beta//amp/); [Windows Central](https://windowscentral.com/hardware/nvidia/pubg-adds-ai-squadmates-that-listen-loot-and-fight-like-real-players-powered-by-nvidias-ace-tech); [TweakTown](https://www.tweaktown.com/news/109532/nvidia-unlocks-next-gen-gameplay-with-on-device-ai-ai-teammates-and-improved-npcs/index.html)
- Other ACE adopters named: Naraka: Bladepoint, MIR5 — [80.lv NVIDIA autonomous AI characters](https://80.lv/articles/nvidia-s-autonomous-ai-characters-are-coming-to-popular-games)
- Ubisoft Teammates: grew out of NEO NPC (March 2024); a playable research prototype in closed playtest with "several hundred players"; stack at GDC 2026 described as ElevenLabs Flash v2 for TTS, NVIDIA Parakeet for ASR, Gemini 2.5 Flash Lite for LLM; an earlier demo used Gemini 2 with ElevenLabs and showed latency issues; a July 2026 article says no further updates but increased investment per Ubisoft's 2025–26 financial report; no shipped game — [Engadget](https://www.engadget.com/gaming/ubisoft-made-a-prototype-game-with-voice-controlled-ai-teammates-200834163.html); [GamesBeat Teammates demo](https://gamesbeat.com/ubisofts-teammates-demo-showcases-the-future-of-ai-npcs-with-some-growing-pains/); [Computer Weekly](https://www.computerweekly.com/news/366642940/In-video-games-of-the-future-your-AI-teammates-will-actually-listen); [Olhar Digital, 2026-07-28](https://olhardigital.com.br/2026/07/28/games-e-consoles/ubisoft-testa-npcs-que-pensam-com-ia-generativa/)
- Inworld: 2026 guide says Inworld has moved from plug-and-play NPC studio work toward B2B AI infrastructure; another version says it "still works but is heavier for solo web developers" — [Cinevva AI NPC guide (2026)](https://app.cinevva.com/guides/ai-npcs-dialogue)
- Convai: active, developer-focused, usage-based pricing with a free tier and a $29/month Indie plan; supports Unity, Unreal, three.js and web — [Cinevva AI NPC guide (2026)](https://app.cinevva.com/guides/ai-npcs-dialogue); earlier Convai + NVIDIA ACE integration — [GamesBeat](https://gamesbeat.com/convai-takes-ai-driven-npcs-to-next-level-with-nvidia-avatar-cloud-engine)
- A 2026 guide states no credible big-budget game has shipped AI-written main-quest dialogue; generative use is limited to side characters and chatter — [Cinevva AI NPC guide](https://app.cinevva.com/guides/ai-npcs-dialogue)
- ElevenLabs: AI dubbing translates speech into 29 languages while preserving the speaker's voice; gaming page pitches dubbing/localization for indies (vendor marketing) — [ElevenLabs gaming](https://elevenlabs.io/use-cases/gaming); [ElevenLabs game dubbing guide](https://elevenlabs.io/blog/a-definitive-guide-to-video-game-dubbing/)
- GDC 2026 survey: only 5% of generative-AI-using respondents use it for player-facing features — [GamesBeat GDC survey](https://gamesbeat.com/state-of-game-industry-survey-sheds-light-on-layoffs-genai-views-unionization-and-tariffs-gdc-survey/)

### Inferences
- "Shipped" AI NPCs in 2026 are almost exclusively NVIDIA-partnered live-service or life-sim titles where the AI is companion/ambient behavior, not authored narrative; for a small Unreal team, Convai's Unreal plugin plus ElevenLabs is the only off-the-shelf path, and runtime inference cost per player is the unaddressed economic question (no source gave per-player costs).
- Ubisoft's publicly described stack (ElevenLabs + Parakeet + Gemini Flash Lite) shows even AAA is assembling commodity cloud components rather than proprietary models, which lowers the barrier for indies but keeps latency as the gating problem.

### Gaps
- Inworld's and Convai's own 2026 pricing pages and case-study pages were not read; no named shipped title using Inworld or Convai could be confirmed.
- ElevenLabs per-character pricing and game-specific license terms were not obtained.
- No data on runtime cost per player-hour for cloud NPC inference.

---

## Key Question 6: Game-creation platforms and AI coding (Rosebud, Ludo, Roblox Cube/Assistant, Unity AI, UEFN/Verse and Epic's AI plans, Buildbox, GDevelop, Cursor/Claude-style coding for Unreal)

### Takeaway
Epic made generative AI the headline of Unreal Engine 6 at the June 2026 State of Unreal (UE5 + UEFN merge, Verse as core language, early access targeted by end of 2027, UE 5.8 released now), but as of late 2026 there is still no first-party in-editor AI assistant in UE5; the practical route for Unreal teams is community MCP servers (Unreal_mcp, UEBridgeMCP, UnrealMCP, runreal) that let Claude Code or Cursor drive the editor and Blueprints. Unity replaced Muse with Unity AI (Assistant + Generators) in Unity 6.2 with credit-based pricing; Roblox ships Cube 3D and an Assistant inside Studio.

### Cited Findings
- State of Unreal, 17 June 2026 (Unreal Fest Chicago): Epic shared its UE6 vision, released Unreal Engine 5.8, open-sourced its next-gen version control system "Lore", highlighted UEFN's developer ecosystem and previewed Epic Games Store improvements — [Unreal Engine events page](https://www.unrealengine.com/en-US/events); [MMOHuts](https://mmohuts.com/news/epic-unveils-unreal-engine-6-releases-unreal-engine-5-8-now)
- UE6 merges UE5 and UEFN into one platform; Verse becomes core to the engine's programming model; early access targeted by end of 2027 — [PC Gamer on UE6](https://pcgamer.com/software/it-is-going-to-change-a-lot-about-how-games-are-made-epic-merges-unreal-engine-5-with-unreal-engine-for-fortnite-to-give-game-devs-around-the-world-unreal-engine-6/); [GamesBeat exclusive on Verse, Lore, UE6](https://gamesbeat.com/?p=327276)
- Coverage characterizes UE6 as "AI-first" with generative AI at the center; a Spanish report's headline references MCP, Claude and Gemini integration (details unverified) — [TechBriefly, 2026-06-18](https://techbriefly.com/2026/06/18/epic-outlines-ai-first-vision-for-unreal-engine-6-at-unreal-fest/); [lavx news](https://news.lavx.hu/article/epic-puts-ai-models-at-the-center-of-unreal-engine-6); [wwwhatsnew, 2026-06-19](https://wwwhatsnew.com/2026/06/19/unreal-engine-6-fortnite-ia-verse-mcp-claude-gemini-2026/)
- Epic Developer Assistant launched in beta in 2025 to help UEFN creators with Verse (code from text, Q&A), expanded at Unreal Fest Stockholm — [4Gamer, 2025-06-04](https://www.4gamer.net/games/144/G014484/20250604002); a leak claiming a GPT-4.1-powered UEFN assistant is unconfirmed — [Sportskeeda rumor](https://www.sportskeeda.com/fortnite/rumor-fortnite-uefn-reportedly-set-receive-ai-assistant)
- Epic AI MegaJam 2026 runs 12–15 November: "team up with up to four other humans and as many AI agents as you want" to build a game in Unreal or UEFN — [Unreal Engine events](https://www.unrealengine.com/en-US/events)
- A May 2026 roundup states Epic had not shipped a first-party in-editor AI for UE 5.7 — [Sorceress "Best AI for Unreal" 2026](https://sorceress.games/blog/pair-the-best-ai-for-unreal-engine-honest-2026-pick)
- Community Unreal MCP servers: ChiR24/Unreal_mcp (Node.js; connects Claude, Cursor, VS Code; Blueprints, UI, materials; UE 5.0–5.8) — [Unreal_mcp wiki](https://github.com/ChiR24/Unreal_mcp/wiki/Home); UnrealMCP on PyPI (C++ plugin, TCP or MCP stdio; "280 commands: materials, blueprints, niagara, statetree, actors, data") — [PyPI unrealmcp](https://pypi.org/project/unrealmcp/); StraySpark Unreal MCP Server ("200+ AI tools for UE5 editor automation") — [UE forum post](https://forums.unrealengine.com/t/strayspark-unreal-mcp-server-200-ai-tools-for-ue5-editor-automation-via-mcp/2707474); runreal unreal-mcp (uses built-in Python remote execution, no plugin) — [Playbooks runreal](https://playbooks.com/mcp/runreal-unreal-engine); ue-mcp-for-all-versions (RemoteControl HTTP API, UE 4.25–5.8) — [ecosyste.ms listing](https://awesome.ecosyste.ms/projects/github.com%2Fwellingfeng%2Fue-mcp-for-all-versions); UEBridgeMCP (native C++ plugin, UE 5.6+, v1.19.0) and Monolith — [Sorceress roundup](https://sorceress.games/blog/pair-the-best-ai-for-unreal-engine-honest-2026-pick)
- Unity AI replaced Muse: Assistant replaces Muse Chat; Generators replace Muse texture/sprite tools; Muse ended after Unity 6.2; Sentis merged in; Unity promises "more flexible pricing" and model choice — [Unity AI activation page](https://activation.unity3d.com/ai); [aipicks Unity AI 2026 guide (JP)](https://aipicks.jp/mag/unity-ai-guide-2026); [CG Channel: Unity AI in 6.2](https://www.cgchannel.com/tag/text-to-texture/)
- Unity AI pricing: a Japanese guide says extra AI allowance is ~$10/month and Pro includes an allowance; Muse's 2023 launch price was $30/month; no official current price page read — [aipicks](https://aipicks.jp/mag/unity-ai-guide-2026); [Unity discussions Muse pricing](https://discussions.unity.com/t/muse-pricing/313338)
- Roblox Cube 3D: open-source (GitHub, HF), text-to-mesh in Studio and via in-experience Lua API; announced alongside other GDC 2025 dev tools — [Roblox newsroom](https://about.roblox.com/newsroom/2025/03/introducing-roblox-cube); [GamesBeat GDC 2025](https://gamesbeat.com/roblox-unveils-roblox-cube-genai-and-other-game-dev-tools-for-gdc/)
- Rosebud AI: free tier plus credit-based paid plans from $15/month ("Indie Dev"); a $50 tier where "Rosebud Pro buys you your game's code" (Ludo's comparison page) — [Summer Engine Rosebud pricing 2026](https://www.summerengine.com/blog/rosebud-ai-pricing); [Ludo vs Rosebud](https://ludo.ai/compare/ludo-vs-rosebud)
- Ludo.ai: a Studio tier at $600/yr listed; a JP site says no public free plan; unclear — [apppricinglab Ludo](https://saas.apppricinglab.com/product/ludo-ai/); [aipicks Ludo pricing](https://aipicks.jp/tool/ludo-ai/pricing)
- Unity's 2026 Game Development Report (secondary coverage): AI task-level use highest for coding assistance (62% of respondents) and NPC behavior (40%); report framed as "smaller teams making games in less time with AI handling back-end tasks" — [Wccftech on Unity 2026 report](https://wccftech.com/unity-2026-game-development-report-points-to-smaller-teams-making-games-in-less-time-with-ai/); [Digital Today](https://www.digitaltoday.co.kr/en/view/34682/unity-releases-2026-game-development-report)

### Inferences
- For Unreal specifically, "AI coding" in 2026 means an external agent (Claude Code, Cursor) editing C++ in the IDE plus an MCP bridge for editor/Blueprint operations; nothing first-party exists until UE6 early access (targeted end-2027), so small teams should plan around community plugins with version-lock risk.
- Rosebud/Ludo-style "AI game makers" target web/2D output and do not export to Unreal; they are useful for prototyping game loops, not as a UE production path (inference; no source showed Unreal export).

### Gaps
- Exact UE6 generative-AI feature list and which model providers Epic named (MCP/Claude/Gemini) were not read from Epic's own blog.
- Unity AI official credit prices, Roblox Assistant details, Buildbox AI and GDevelop AI features/pricing: searches did not run (budget exhausted).
- Whether any MCP server supports UE 5.8 beyond Unreal_mcp's claim: unverified.

---

## Key Question 7: Level design and PCG (Unreal PCG framework, Promethean AI, Houdini Engine, Ludo, ML level generators)

### Takeaway
Unreal's native PCG framework is the realistic automation path for small Unreal teams — 5.6 added GPU-driven spawning, multithreading and a 3D viewport, and 5.7 (Nov 2025) added further PCG work plus Nanite Foliage — while Promethean AI (Unreal integration in its ~$90/month Professional tier) and Houdini Engine remain the main third-party options; no ML-based level generator with a production Unreal integration surfaced.

### Cited Findings
- UE 5.6: PCG framework "enhanced to help you create worlds and manage complex scenes more efficiently with better GPU-driven performance" — [UE 5.6 release forum post](https://forums.unrealengine.com/t/unreal-engine-5-6-released); GPU-based spawning, multithreading and a new 3D viewport to preview elements — [Creative Bloq on UE 5.6](https://www.creativebloq.com/3d/video-game-design/unreal-engine-5-6-is-out-heres-what-impressed-me); multithreading distributes workloads across CPU cores — [New Game Network](https://www.newgamenetwork.com/?p=122023)
- UE 5.7 (Nov 2025) adds Procedural Content Generation updates, Nanite Foliage and MetaHuman updates — [AlternativeTo news, Nov 2025](https://alternativeto.net/news/2025/11/unreal-engine-5-7-adds-procedural-content-generation-nanite-foliage-and-metahuman-updates); [UE 5.7 released forum](https://forums.unrealengine.com/t/unreal-engine-5-7-released/2673913)
- Promethean AI: Unreal integration reported in the Professional tier (~$89.99–90/month); Indie ~$29–30/month adds commercial use; free tier non-commercial; one aggregator's data dated 4 Dec 2024 — [SoftwareFinder](https://softwarefinder.com/artificial-intelligence/promethean-ai); [toolradar](https://toolradar.com/tools/promethean-ai/pricing)
- Houdini Engine for UE 5.7 indie workflow is covered by a 2026 studio blog; it claims Houdini Indie costs "a few hundred USD a year" without citation — [StraySpark Houdini Engine UE 5.7](https://www.strayspark.studio/blog/houdini-engine-unreal-5-7-indie-workflow-2026)
- Archived (older) SideFX Houdini Indie page: $100K USD annual revenue cap; max three Houdini Indie and three Houdini Engine licenses; references UE4 so likely outdated — [SideFX Houdini Indie (old)](https://www.sidefx.com/products/houdini-indie_old/)
- A Packt book "Procedural Content Generation with Unreal Engine 5" exists (indicates maturity of the native framework) — [Packt](https://packt-plus-non-live.prod.packtpub.com/en-pl/product/procedural-content-generation-with-unreal-engine-5-9781801074469)
- GDC 2026: only 10% of gen-AI-using respondents use it for procedural generation — [GamesBeat GDC survey](https://gamesbeat.com/state-of-game-industry-survey-sheds-light-on-layoffs-genai-views-unionization-and-tariffs-gdc-survey/)

### Inferences
- "Automation" of level design for Unreal indies in 2026 is rule-based (PCG graphs, Houdini HDAs) rather than generative; LLM agents can author PCG graphs via MCP servers in principle, but no source documented that working in production.

### Gaps
- Current SideFX Houdini Indie / Houdini Engine pricing and revenue cap for 2026: unverified.
- Promethean AI's 2026 roadmap and whether its Unreal plugin supports UE 5.7/5.8: unknown.
- No sources on ML level generators (e.g., research like PCGML) with shipping Unreal integrations.

---

## Key Question 8: QA and playtesting automation (modl.ai, NVIDIA, AI playtesting bots, Unreal Automation framework)

### Takeaway
modl.ai is the only dedicated commercial AI-QA vendor surfaced, selling modl:test (autonomous bug/perf exploration) and modl:play (multiplayer bots) for Unity, Unreal and custom engines; evidence of 2026 traction is thin and comes from aggregators, and NVIDIA playtesting-agent material was not found before the search budget ran out.

### Cited Findings
- modl.ai offers two products: modl:test (automated QA testing) and modl:play (multiplayer player bots) — [Built In modl.ai](https://builtin.com/company/modl-ai)
- Its QA bots "autonomously explore game levels, interact with various elements, and detect bugs and performance issues"; cloud-based; works with Unity, Unreal and custom engines — [TechShark modl](https://techshark.io/tools/modl/); [G2 modl reviews](https://www.g2.com/products/modl/reviews)
- CEO interview: "Teams will leverage more of their skills now there are automation tools"; Unity first, then Unreal support — [AI Game Changers interview with Christoffer Holmgård](https://aigamechangers.substack.com/p/interview-christoffer-holmgard-on)
- modl.ai partnered with Side (Keywords) on video-game QA — [Expert Reviews](https://www.expertreviews.co.uk/technology/gaming/side-and-modl-ai-co-op-on-video-game-qa-quest)
- Funding reported at $10.1M–$10.8M total with a Series A (sources conflict) — [CB Insights modl.ai](https://www.cbinsights.com/company/modlai)
- Academic grounding: ITU Copenhagen project "Improving automated video game testing via machine learning" — [ITU project page](https://pure.itu.dk/da/projects/improving-automated-video-game-testing-via-machine-learning/)
- A claim that studios "cut launch bugs 40%" with modl.ai could not be traced to a primary source — [nexairi-mentis article](https://nexairi-mentis.pages.dev/article/Technology/ai-co-design-game-development-2026)

### Inferences
- For a small Unreal team, automated QA in 2026 realistically means Unreal's built-in Automation/Functional Testing plus LLM-written test scripts, with modl.ai as an enterprise add-on; nothing found suggests a turnkey "AI playtester gives design feedback" product has shipped.

### Gaps
- Unreal Automation framework / Gauntlet documentation, NVIDIA AI playtesting agents, and 2026 modl.ai announcements were not retrieved (search budget exhausted).
- No modl.ai pricing was found.

---

## Key Question 9: Market context — Steam release volume, asset marketplaces (Fab, Unity Asset Store), and surveys on gen-AI adoption and attitudes (GDC 2025/2026, Unity, a16z, others)

### Takeaway
Steam saw roughly 19,000–20,000 releases in 2025 (nearly half with under 10 reviews), one in five 2025 releases disclosed generative AI use (7,818 titles, 7% of the whole library by July 2025), Epic's Fab marketplace was flooded with AI-generated listings (one seller posted 41,000+) prompting mandatory AI tagging and automated detection, and the GDC 2026 survey of 2,300+ developers found 36% personally use gen-AI while 52% say it harms the industry — adoption is rising among indies at the same time professional sentiment is at its most negative.

### Cited Findings

**Steam release volume**
- SteamDB data: 19,112 games released on Steam in 2025 (Dec 2025 snapshot); 9,327 had fewer than 10 reviews — [Mein-MMO](https://mein-mmo.de/en/in-2025-more-than-19000-games-were-released-on-steam-but-almost-half-of-them-did-not-even-receive-10-reviews,1542361); [GamingOnLinux, Dec 2025](https://www.gamingonlinux.com/2025/12/over-19000-games-have-released-on-steam-in-2025-with-nearly-half-seeing-fewer-than-10-reviews); [PC Gamer](https://www.pcgamer.com/gaming-industry/more-than-19-000-games-launched-on-steam-this-year-but-almost-half-have-fewer-than-10-reviews)
- Alternative Dec snapshot: 19,008 in 2025 vs 18,558 in 2024 and 14,111 in 2023 — [KitGuru](https://www.kitguru.net/gaming/joao-silva/steam-data-shows-over-19000-games-released-in-2025/)
- A June 30, 2026 SteamDB pull shows ~20,008 for 2025 (about 1,400 retroactive additions); VG Insights lists 20,282; SteamDB cumulative total exceeded 130,000 games — [Steam Page Analyzer](https://www.steampageanalyzer.com/blog/how-many-games-release-on-steam)

**Gen-AI disclosure on Steam**
- Totally Human Media (July 2025): 7,818 of ~114,126 Steam games (≈7%) disclose gen-AI use as of 13 July 2025, up from 1.1% in April 2024; 1 in 5 games released in 2025 disclosed gen-AI; ~60% of disclosures involve visual elements; disclosure is voluntary so true usage is higher — [Tom's Hardware](https://www.tomshardware.com/video-games/pc-gaming/1-in-5-steam-games-released-in-2025-use-generative-ai-up-nearly-700-percent-year-on-year-7-818-titles-disclose-genai-asset-usage-7-percent-of-entire-steam-library); [PC Gamer](https://www.pcgamer.com/software/ai/the-boffin-behind-valves-steam-labs-says-the-number-of-steam-releases-featuring-genai-in-2025-is-1-in-5-with-7-percent-of-all-games-on-there-now-incorporating-it-weve-octupled-last-years-figure); [VGC](https://www.videogameschronicle.com/news/steam-games-disclosing-generative-ai-use-are-up-800-this-year/)
- A late-2025 Reddit analysis of 63,600 games released since Jan 2024 found 49.9% of October 2025 releases disclosed AI; disclosing games skew to lesser-known titles with lower average positive review scores (informal analysis) — [Mezha.ua](https://mezha.ua/en/news/ai-used-in-half-of-new-games-on-steam-316829/)

**Fab (Epic) and AI content**
- Epic's Fab policy requires a "CreatedWithAI" tag where "a material portion of the Content is generated with Generative AI Programs"; Epic commits not to use or license creators' content for training gen-AI — [UE forum: Announcing Fab](https://forums.unrealengine.com/t/announcing-fab-an-evolution-of-the-unreal-engine-marketplace/795198?page=4)
- After one creator published "over 41,000+ AI-generated assets in a short timeframe," Epic said it would make the AI question mandatory at publishing, add automated detection and update its reporting form — [80.lv: Epic addresses AI content plaguing Fab](https://80.lv/articles/epic-games-adresses-ai-generated-content-plaguing-fab); [UE forum: Update on products generated with AI](https://forums.unrealengine.com/t/update-on-products-generated-with-ai/2523501)
- A UE forum thread shows an Epic post about updating the Epic Content License Agreement and introducing product tags for generative-AI use, with April 2026 activity (not opened) — [UE Marketplace forum category](https://forums.unrealengine.com/c/community/marketplace/51)
- Buyer-side friction: a forum thread asks about refunds for assets generated with AI that are not labeled as such — [UE forum refund question](https://forums.unrealengine.com/t/what-is-the-refund-policy-for-assets-generated-with-ai-that-arent-listed-as-having-done-so/2399994)
- Fab launched October 2024 as the unified successor to the Unreal Engine Marketplace, Sketchfab Store, Quixel and ArtStation Marketplace — [Unreal Engine blog: Fab launches](https://www.unrealengine.com/blog/fab-epics-new-unified-content-marketplace-launches-today)

**GDC State of the Game Industry 2026 (published 29 Jan 2026; 2,300+ respondents)**
- 36% of game-industry professionals use gen-AI tools as part of their job (30% at studios); 52% say gen-AI has a negative impact on the industry, up from 30% in the 2025 report and 18% in 2024; ~7% see a positive impact (down from 13%) — [Business Wire press release, 2026-01-29](https://www.businesswire.com/news/home/20260129438528/en); [GDC article](https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/); [80.lv](https://80.lv/articles/gdc-survey-over-50-of-game-devs-say-generative-ai-harms-industry)
- Negative sentiment by discipline: visual/technical arts 64%, design/narrative 63%, programming 59% — [GamesBeat](https://gamesbeat.com/state-of-game-industry-survey-sheds-light-on-layoffs-genai-views-unionization-and-tariffs-gdc-survey/)
- Use cases among gen-AI users: research/brainstorming 81%, asset generation 19%, procedural generation 10%, player-facing features 5%; tools: ChatGPT 74%, Gemini 37%, Copilot 22% — [GamingOnLinux GDC 26](https://www.gamingonlinux.com/2026/01/gdc-26-report-36-of-devs-use-generative-ai-while-28-target-steam-deck-and-8-linux); [TechSpot](https://techspot.com/news/111128-more-than-50-game-developers-generative-ai-harming.html)
- Sampling caveat: just over half of respondents US-based, over-representing North America/Western Europe; GDC itself cautions against strict year-on-year comparison — [The Game Business](https://www.thegamebusiness.com/p/is-this-make-or-break-for-gdc)

**Other surveys**
- Game Developer Collective / Omdia (2026): gen-AI use among developers fell to 29% in early 2026 from 36% in the same period of 2025; 47% think gen-AI could negatively affect game quality, 11% say improve — [Outlook Respawn](https://respawn.outlookindia.com/gaming/gaming-news/survey-indicates-falling-generative-ai-use-among-game-developers)
- CESA (Japan, Sept 2026): 85.8% of surveyed Japanese developers use gen-AI for work (workplace use, not shipped-asset use) — [God is a Geek, 2026-09](https://godisageek.com/2026/09/game-developers-generative-ai-survey/)
- Unity 2025 Gaming Report claimed 79% of developers feel positive about gen-AI, contrasting with GDC's 13% positive that year — [Jikguard/Game Developer](https://www.jikguard.com/news/unity-claims-79-percent-of-developers-are-feeling-positive-about-generative-ai); Unity's 2024 report said 62% of devs use AI tools — [Gamasutra/Game Developer 2024](https://www.gamasutra.com/production/unity-2024-gaming-report-indicates-62-percent-of-devs-are-currently-using-ai-tools)
- Unity 2026 Game Development Report (secondary): coding assistance 62%, NPC behavior 40%; a "95% adopted AI" figure appears in one aggregator and is unverified — [Wccftech](https://wccftech.com/unity-2026-game-development-report-points-to-smaller-teams-making-games-in-less-time-with-ai/); [Mobile Marketing Reads](https://mobilemarketingreads.com/?p=50328)
- a16z: surveyed 243 game studios in a May (year not stated in result; likely 2024) survey; ChatGPT and Midjourney were the most popular tools, then Stable Diffusion; no 2026 a16z survey found — [The Decoder](https://the-decoder.com/?p=5667)
- Google Cloud "AI meets the games industry 2025" market report (updated Mar 2026) exists — [Game Industry Library](https://gameindustrylibrary.com/documents/ai-meets-the-games-industry-2025/read)

### Inferences
- The disclosure data (1 in 5 2025 releases; ~50% of Oct 2025 releases in an informal count) versus the GDC 36% personal-use figure implies gen-AI adoption is concentrated in the long tail of small/solo Steam releases rather than in studio production — the exact audience this research targets.
- Marketplaces are moving from "AI content welcome if tagged" to active detection and buyer filters; a small team selling kits on Fab should expect mandatory disclosure and possible demotion of AI-tagged products.
- Survey results diverge by sponsor: engine vendors (Unity, CESA) report high adoption/positivity; practitioner surveys (GDC, GDC/Omdia) report flat-to-falling use and rising hostility. Report both.

### Gaps
- Fab scale statistics (products, sellers, payouts) and Unity Asset Store AI policy/trends were not retrieved.
- Indie median revenue on Steam for 2025 (VG Insights / Chris Zukowski) not retrieved.
- Full GDC 2026 report (studio AI-policy %, layoffs %, engine share) not read; only press figures.
- Unity 2026 report primary source not read.

---

## Key Question 10: Pipeline-stage map — what a small Unreal team can realistically automate or assist in late 2026, and the gaps

### Takeaway
Realistic automation today is strongest at the ends of the pipeline (ideation/docs, concept art, textures, voice/dubbing, code assistance) and in static-prop 3D via generate → quad-remesh → Nanite; it is weakest exactly where Unreal projects spend most of their time — characters that deform, modular environments with clean UVs and consistent scale, hand-authored levels, gameplay systems, and QA — and no first-party Epic AI tooling exists before UE6 early access (targeted end of 2027).

### Cited Findings (cross-referenced from sections above)
- Concept/design docs and brainstorming: 81% of gen-AI-using developers use it for research/brainstorming; ChatGPT 74% share — [GamingOnLinux GDC 26](https://www.gamingonlinux.com/2026/01/gdc-26-report-36-of-devs-use-generative-ai-while-28-target-steam-deck-and-8-linux)
- Concept art and textures: Scenario (API-first, custom models) and Adobe Substance Text-to-Texture (Firefly credits) are shipping — [tooldirectory Scenario](https://tooldirectory.ai/tools/ai-generated-game-assets-scenario); [Adobe Sampler docs](https://experienceleague.adobe.com/en/docs/substance-3d-sampler/using/features-and-workflows/generative-workflows)
- 3D modeling/retopo/UV/texturing: all four leaders expose face-budget quad/tri remesh and PBR; Meshy API remesh range 100–300k polys; Rodin density tiers 4k–50k quads — [Meshy Remesh](https://docs.meshy.ai/en/webapp/guides/3d-model/remesh); [Runware Rodin](https://runware.ai/docs/models/hyper3d-rodin-gen-2/guides/topology-and-polygon-budget)
- LODs: Nanite lets static props skip retopo/LODs — [StraySpark pipeline](https://strayspark.studio/blog/blender-to-game-engine-pipeline-2026); community still finds LODs/collision/scale untrustworthy from generators — [Reddit snapshot](https://reddit.sentinel-team.org/posts/1t5q2pj/snapshots/2026-05-08T22%3A27%3A28.91308Z)
- Rigging/animation: Meshy/Tripo auto-rig; Mixamo in maintenance; MetaHuman free under $1M — [Meshy rigging](https://www.meshy.ai/features/ai-auto-rigging); [MetaHuman license](https://www.metahuman.com/en-US/license)
- Level design/PCG: native UE PCG (5.6 GPU spawning, 5.7 updates) — [UE 5.6 forum](https://forums.unrealengine.com/t/unreal-engine-5-6-released); [AlternativeTo UE 5.7](https://alternativeto.net/news/2025/11/unreal-engine-5-7-adds-procedural-content-generation-nanite-foliage-and-metahuman-updates)
- Audio/voice/localization: ElevenLabs dubbing in 29 languages; used in Ubisoft's prototype stack — [ElevenLabs gaming](https://elevenlabs.io/use-cases/gaming); [Computer Weekly](https://www.computerweekly.com/news/366642940/In-video-games-of-the-future-your-AI-teammates-will-actually-listen)
- Dialogue/NPCs: only NVIDIA ACE titles confirmed live; Convai $29/month indie tier for Unreal — [Gaming-st ACE roundup](https://gaming-st.com/news/nvidia-ace-ai-npc-games-2026/); [Cinevva NPC guide](https://app.cinevva.com/guides/ai-npcs-dialogue)
- Code/Blueprints: community MCP servers (280 commands in UnrealMCP; UE 5.0–5.8 in Unreal_mcp); no first-party in-editor AI in UE5 as of mid-2026 — [PyPI unrealmcp](https://pypi.org/project/unrealmcp/); [Unreal_mcp wiki](https://github.com/ChiR24/Unreal_mcp/wiki/Home); [Sorceress roundup](https://sorceress.games/blog/pair-the-best-ai-for-unreal-engine-honest-2026-pick)
- QA: modl:test for Unity/Unreal — [Built In modl.ai](https://builtin.com/company/modl-ai)
- Marketing/distribution: 19k+ Steam releases per year with ~half under 10 reviews; AI-disclosing games skew to lower review scores (informal) — [GamingOnLinux Dec 2025](https://www.gamingonlinux.com/2025/12/over-19000-games-have-released-on-steam-in-2025-with-nearly-half-seeing-fewer-than-10-reviews); [Mezha.ua](https://mezha.ua/en/news/ai-used-in-half-of-new-games-on-steam-316829/)
- Epic's direction: UE6 is "AI-first," merges UEFN, early access end-2027; Epic AI MegaJam Nov 12–15 2026 explicitly invites AI agents as teammates — [TechBriefly](https://techbriefly.com/2026/06/18/epic-outlines-ai-first-vision-for-unreal-engine-6-at-unreal-fest/); [Unreal Engine events](https://www.unrealengine.com/en-US/events)

### Inferences
- The single highest-leverage unsolved problem for collaborative small-team Unreal development is the hand-off between generated assets and the engine: a normalized import step (unit scale to centimeters, pivot at base, quad remesh at a face budget, UV0 for textures plus auto-generated UV1 lightmaps, simple collision, Nanite flag for statics, retarget to the Epic skeleton for characters) is something no vendor sells end-to-end, and the community MCP servers show the editor can be driven programmatically to do it.
- Collaboration tooling is the second gap: Epic's open-sourced "Lore" version control (June 2026) and UEFN's shared-editing model suggest Epic sees multi-user asset pipelines as the UE6 battleground, but nothing shipping in UE5 connects generative tools to a shared project with review/approval of AI assets (inference from the Fab tagging policy and Lore announcement).
- Given 52% negative sentiment among professionals and marketplace disclosure rules, a small team's workflow should keep provenance metadata per asset (which generator, prompt, license tier) to satisfy Steam's and Fab's disclosure requirements — a feature no surveyed tool offers (inference).

### Gaps
- No source quantified time savings per pipeline stage for indies (vendor claims only).
- Localization beyond voice (text translation QA, culturalization) and marketing automation (store-page copy, trailers) were not researched before the budget ran out.
- Epic's own UE6 generative-AI feature statements, Fab's current AI-tag enforcement status (April 2026 ECLA update), Unity AI credit prices, and official pricing for nearly all vendors remain unverified; a follow-up with network access to vendor domains (docs.meshy.ai, platform.tripo3d.ai, hyper3d.ai, scenario.com, inworld.ai, convai.com, unity.com, unrealengine.com, forums.unrealengine.com, gdconf.com) would close most of these.
