# SculptLine demo: script and storyboard (v1 draft)

**Length:** about 75 seconds (target range 60 to 90)
**Viewer:** a technical art director (TAD) at an AA studio that ships in Unreal and outsources character art
**Goal:** show one asset going from a raw high-poly sculpt to an Unreal-ready asset, and make the pre-import check the moment people remember
**Voiceover:** me, first person

> **Honesty note.** This is a script for a demo I still need to record. Every UI screen, poly count, and timing below is a placeholder until I capture it from the real prototype. Anything not captured from the prototype goes on screen with a "CONCEPT MOCKUP" tag. I won't put a "time saved" number on screen until a pilot measures one.

---

## Script (voiceover)

**[0:00 to 0:08] Hook**
"A vendor just sent this character over. It's a beautiful sculpt. It's also several million polygons, and Unreal isn't going to take it as is."

**[0:08 to 0:15] Problem**
"Normally this goes through retopo, UVs, textures, and LODs, usually across a few people, and I only find out what broke after import."

**[0:15 to 0:22] Drop in**
"With SculptLine, I drop the sculpt in and pick my studio's import profile: scale, skeleton, texel density, and LOD budget."

**[0:22 to 0:34] Retopology and UVs**
"SculptLine builds a clean, game-ready mesh from the sculpt and unwraps the UVs. The artist's sculpt stays the source. I can see the high and low versions side by side."

**[0:34 to 0:44] LODs and materials**
"It generates the LOD chain against my budget, bakes the detail down, and hooks the texture maps into an Unreal material, so nothing comes in grey."

**[0:44 to 0:58] Pre-import check (the key beat)**
"This is the part I actually care about. Before anything touches the engine, SculptLine checks it against my studio's rules. Here it flagged that the scale is off and one set of normals is flipped. I fix it here, not three days from now with a vendor in another time zone."

**[0:58 to 1:08] Import to Unreal**
"Now I import it. Right scale, on the skeleton, materials hooked up, LODs switching as I pull the camera back."

**[1:08 to 1:15] Close**
"From sculpt to screen, with problems caught before import. I'm Patrick, and I'm building SculptLine for Unreal studios. I'm looking for my first pilot studio."

---

## Storyboard / shot list

| # | Time | Shot | What's on screen | Source of footage | Notes |
|---|------|------|------------------|-------------------|-------|
| 1 | 0:00 to 0:08 | Slow orbit of a high-poly sculpt in a viewport | Dense wireframe overlay; caption "Raw sculpt: [poly count from real file]" | Real: any licensed or self-made sculpt in Blender | Use my own sculpt or one with a license that allows demo use. Fill in the real poly count; don't make one up. |
| 2 | 0:08 to 0:15 | Pipeline graphic, "today" row | Seven stages, six handoffs, red "found late" box at import | Mockup: `fabled_pipeline_before_after_CONCEPT_MOCKUP.png` (top row) | Keep the "CONCEPT MOCKUP" tag visible. |
| 3 | 0:15 to 0:22 | Screen capture: upload and import profile | Drag the .fbx/.obj in; profile panel with scale, skeleton, texel density, LOD budget | Prototype UI if it exists; otherwise a labeled Figma mockup | If the profile panel isn't built yet, say "planned" in the caption. |
| 4 | 0:22 to 0:34 | Split screen, high-poly vs. retopo mesh, then UV layout | Left: sculpt. Right: clean quads. Then the UV islands view | Real output from the prototype or the current scripted pipeline | Caption with real tri counts from the actual run. |
| 5 | 0:34 to 0:44 | LOD chain row, then material preview | LOD0 to LOD3 thumbnails with tri counts; baked normal map; material graph | Real output where possible | If materials are still manual, show that honestly or label the shot. |
| 6 | 0:44 to 0:58 | Pre-import check report (hero shot) | Checklist: scale, normals, skeleton binding, texture hookups. Two items flagged, then green after fix | Prototype if built; if not, a labeled mockup | Main beat of the demo. Hold for about 3 seconds on the flagged items so people can read them. |
| 7 | 0:58 to 1:08 | Unreal Editor | Import dialog, asset in level at correct scale next to a reference mannequin, camera pull-back showing LOD switches | Real capture in Unreal | Use the LOD coloration view mode so the LOD switching reads on screen. |
| 8 | 1:08 to 1:15 | End card | "SculptLine. From sculpt to screen." Contact line; "Prototype stage" tag | Deck title slide style | Match the deck's cream and brown palette. |

---

## Capture checklist before recording

- [ ] Pick one sculpt I have rights to use, and write down its real poly count
- [ ] Run it through whatever the prototype can do today, and save the real outputs (mesh, UVs, LODs, maps)
- [ ] Write down which steps are automated today and which are still manual. Label the manual ones in captions
- [ ] Record the Unreal import in one clean take (OBS, 1080p, 60 fps)
- [ ] Tag every mocked screen with "CONCEPT MOCKUP" in the corner
- [ ] Keep any "time saved" claim off screen until a pilot measures it

## How this ties to the Nov 2 deck

- Slide 3 (Today's Pipeline) can use the top row of the mockup image
- Slide 4 (The Solution) can use the bottom row, or the full image, as the visual for "From sculpt to engine-ready, in one place"
- Shot 6 (pre-import check) shows the edge I claim on slide 7: the check before handoff, plus each studio's import rules
