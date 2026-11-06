# AI provider plugins (entertainment / generative media)

Status as of 2026-11-06. The plugin layer is in `providers/`. Each adapter is **off until its API key is set in the
server's environment**. Keys stay on the local server: they are never sent to the browser, written to disk or logged.
The browser only sees env var *names* and a `configured` flag (`GET /api/providers`).

## Where providers fit in Fabled

```
 text / reference image ──► 3D generator (Meshy, Tripo, …) ──► Import as sculpt ──► pipeline (retopo, LODs, bake)
                                                                                    └─► pre-import validator ──► Unreal
 pipeline preview render ──► video generator (Higgsfield, Runway, …) ──► clip on the generation page (previs, turntable, pitch)
```

Generated meshes are where Fabled adds value. Text- and image-to-3D output is usually dense, triangulated and
inconsistent in scale and axis, which is what the pipeline and the validator are for. (The Mochi test in `ROADMAP.md` was
already a generated mesh: Hunyuan output.) Video providers are the other half of an "entertainment workspace": they turn an
approved asset's preview render into a moving shot without leaving the workspace.

## Adapters in this repo

| id | Provider | Modes | Env var | API verified? |
|---|---|---|---|---|
| `meshy` | Meshy | text→3D, image→3D | `MESHY_API_KEY` | **Partly.** Image-to-3D path, Bearer auth, task id in `result` and SUCCEEDED/FAILED were confirmed from search results quoting docs.meshy.ai. Text-to-3D path (`/v2/text-to-3d`, `mode: "preview"`) and output fields (`model_urls.glb`, `progress`, `thumbnail_url`, `task_error`) were not re-read. |
| `tripo` | Tripo | text→3D, image→3D (public image URL only) | `TRIPO_API_KEY` | **No.** `POST /v2/openapi/task` and `GET /v2/openapi/task/{id}` were seen in third-party integrations. The host, field names and image upload flow are unverified. |
| `higgsfield` | Higgsfield | image→video | `HIGGSFIELD_API_KEY` (+ optional `HIGGSFIELD_API_SECRET`) | **No.** One endpoint path (`platform.higgsfield.ai/minimax/hailuo-2.3/standard/image-to-video`, fields `prompt`, `image_url`, async status) came from a connector page. Auth header, scheme, status path and output field are configurable guesses; see the header of `providers/higgsfield.mjs`. |
| `runway` | Runway | image→video | `RUNWAYML_API_SECRET` | **Partly.** `POST /v1/image_to_video`, Bearer auth and `X-Runway-Version: 2024-11-06` were confirmed from mirrors of the API reference. Task polling (`GET /v1/tasks/{id}`), model name and output fields are unverified. |
| `mock` | Offline mock | text→3D, image→3D | none (`FABLED_PROVIDER_MOCK=off` disables it) | n/a. **CONCEPT MOCKUP**: returns one of three procedural models (knight helmet, mushroom cottage, potion flask; picked from prompt keywords, else from a hash of the prompt) so the loop can be demoed offline. Everything it produces is labeled. |

Why "unverified": every vendor docs host (docs.meshy.ai, platform.tripo3d.ai, docs.higgsfield.ai, docs.dev.runwayml.com)
was outside the network allow-list of the session that wrote these adapters. The adapters are therefore defensive: they
pull output URLs from anywhere in the response when the field name is unsure, map unknown statuses to "running" rather than
failing, and Higgsfield only follows a returned status URL on its own host, so a response cannot redirect the API key.
**Before relying on any adapter, run one real request against it and fix field names** (tests in
`tools/test_connected_workspace.mjs` pin the shapes assumed here).

## Trying a real provider

```bash
cd fabled/ui
MESHY_API_KEY=... npm start          # or TRIPO_API_KEY / HIGGSFIELD_API_KEY / RUNWAYML_API_SECRET
```
Then **✦ Generate** in the Workspace card (or "Generate from this asset…" on an asset's page). Image modes can use any
preview render of the open pipeline run, or an uploaded PNG/JPEG/WebP of 10 MB or less. 3D results get an **Import as
sculpt → pipeline** button. Video results play on the generation's page. Overrides for unverified details:
`MESHY_BASE_URL`, `TRIPO_BASE_URL`, `RUNWAY_BASE_URL`, `RUNWAY_MODEL`, `RUNWAY_RATIO`, `RUNWAY_DURATION`, `RUNWAY_VERSION`,
`HIGGSFIELD_BASE_URL`, `HIGGSFIELD_I2V_PATH`, `HIGGSFIELD_AUTH_HEADER`, `HIGGSFIELD_AUTH_SCHEME`, `HIGGSFIELD_STATUS_PATH`,
`FABLED_PROVIDER_TIMEOUT_MS`.

## Adding a provider

Write `providers/<id>.mjs` exporting `{ id, name, category, kinds, env, docs, verification, verification_note, feeds,
configured(env), create({kind, prompt, image}, ctx), poll(task, ctx) }`, use `requestJson` from `providers/http.mjs`, and
add it to `PROVIDERS` in `providers/index.mjs`. `poll` returns `{ status: queued|running|succeeded|failed, progress,
outputs: [{ type: model|video|image, format, url }], error }`. Add fake-fetch tests next to the others.

## Other candidates (not implemented, APIs not checked)

These are leads to evaluate, not claims about their APIs:

- **3D generation:** Hyper3D Rodin, CSM, Luma Genie, Stability AI 3D models, Tencent Hunyuan3D (open weights; could be
  self-hosted next to the pipeline).
- **Video:** Luma Dream Machine, Kling, Pika, Google Veo (Vertex AI), MiniMax Hailuo direct.
- **Aggregators:** fal.ai and Replicate host many of the models above behind one API style. One adapter there might replace
  several direct ones, at the cost of a middleman.

Questions to settle per provider before production use: commercial license of outputs, data retention of uploaded
references, rate limits and price per generation, and whether output meshes carry UVs or PBR textures the pipeline can bake from.
