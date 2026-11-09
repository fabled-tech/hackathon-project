#!/usr/bin/env node
// Engine-only tests for the Fabled industry demos: film/breakdown.mjs and game/kit.mjs. Pure functions, no server,
// no network, no keys. Run: node tools/test_engines.mjs   (tools/test_demos.mjs covers the exporters + HTTP API)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  breakdown, parseScreenplay, proposeShots, shotlistCsv, sequencerPlan, promptFor,
  MOVE_PRESETS, presetForMove, SHOT_STATUSES, SHOT_SIZES, STAGE_SPACING_CM,
} from '../film/breakdown.mjs';
import {
  buildKit, starterLayout, place, blockoutPlan, summarize, categorize, nextStatus, STATUS_FLOW,
  CATEGORY_DEFAULTS, CATEGORIES, applyCategory, sanitizeLayoutItem, sanitizeLayoutItems, sanitizeSpawn, renameAsset, assetNameFor,
} from '../game/kit.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0; const failures = [];
async function test(name, fn) { try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; failures.push(name); console.error(`  ✗ ${name}\n    ${e.message}`); } }
const script = fs.readFileSync(path.join(DIR, 'samples', 'the_lantern_keeper.fountain'), 'utf8');
const pitch = fs.readFileSync(path.join(DIR, 'samples', 'mossgate_pitch.txt'), 'utf8');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dialogue = (p) => p.scenes.flatMap((s) => s.elements).filter((e) => e.type === 'dialogue');
const action = (p) => p.scenes.flatMap((s) => s.elements).filter((e) => e.type === 'action').map((e) => e.text);

console.log('Film 1: move ↔ preset has one source of truth');
await test('MOVE_PRESETS, SHOT_STATUSES and SHOT_SIZES carry the documented vocabulary', () => {
  assert.deepEqual({ ...MOVE_PRESETS }, {
    static: 'Static (locked off)', push_in: 'Slow push-in', dolly_follow: 'Dolly follow', tracking_handheld: 'Tracking (handheld)',
    crane_down: 'Crane down', aerial_drift: 'Aerial drift', orbit_handheld: 'Handheld orbit', crash_zoom: 'Crash zoom',
  });
  assert.deepEqual([...SHOT_STATUSES], ['proposed', 'approved', 'redo']);
  assert.deepEqual([...SHOT_SIZES], ['Extreme wide', 'Wide', 'Medium wide', 'Medium', 'Medium (over-the-shoulder)', 'Close-up', 'Insert']);
});
await test('presetForMove maps every label back to its id, case-insensitively, and unknown labels to static', () => {
  for (const [id, label] of Object.entries(MOVE_PRESETS)) {
    assert.equal(presetForMove(label), id); assert.equal(presetForMove(label.toUpperCase()), id); assert.equal(presetForMove(`  ${label.toLowerCase()} `), id);
  }
  assert.equal(presetForMove('crane down'), 'crane_down'); assert.equal(presetForMove('CRANE_DOWN'), 'crane_down');
  for (const bad of ['Whip pan', '', null, undefined, 42, {}, 'constructor', '__proto__']) assert.equal(presetForMove(bad), 'static');
});
await test('every proposed shot uses the shared vocabulary and preset === presetForMove(move)', () => {
  const bd = breakdown(script);
  const labels = Object.values(MOVE_PRESETS);
  for (const s of bd.shots) {
    assert.ok(labels.includes(s.move), `move label ${s.move}`); assert.equal(s.preset, presetForMove(s.move), s.id);
    assert.ok(SHOT_SIZES.includes(s.size), `size ${s.size}`); assert.equal(s.status, 'proposed'); assert.ok(SHOT_STATUSES.includes(s.status));
  }
  // every rule-reachable preset shows up somewhere across these lines, each with its own label
  const all = breakdown('EXT. FIELD - DAY\n\nShe runs. It explodes. He punches the wall. She falls. He stares. She walks in. He grabs it. She waits. The skyline glows.\n');
  assert.deepEqual([...new Set(all.shots.map((s) => s.preset))].sort(), Object.keys(MOVE_PRESETS).sort());
  for (const s of all.shots) assert.equal(MOVE_PRESETS[s.preset], s.move);
});
await test('sequencerPlan follows the edited move, not a stale preset', () => {
  const bd = breakdown(script);
  const a = bd.shots.find((s) => s.preset === 'static'); const b = bd.shots.find((s) => s.preset === 'crane_down');
  a.move = 'Crane down';          // reviewer changed the label; preset still says "static"
  b.move = 'slow PUSH-in';        // and here the stale preset says "crane_down"
  const plan = sequencerPlan(bd);
  const pa = plan.shots.find((s) => s.id === a.id); const pb = plan.shots.find((s) => s.id === b.id);
  assert.equal(pa.preset, 'crane_down'); assert.equal(pa.move, 'Crane down'); assert.ok(pa.camera_start.z > pa.camera_end.z, 'a crane down descends');
  assert.equal(pb.preset, 'push_in'); assert.equal(pb.camera_start.z, pb.camera_end.z); assert.ok(dist(pb.camera_end, pb.look_at) < dist(pb.camera_start, pb.look_at));
  const c = bd.shots.find((s) => s.preset === 'aerial_drift'); c.move = 'Something custom';
  const pc = sequencerPlan(bd).shots.find((s) => s.id === c.id); assert.equal(pc.preset, 'static'); assert.deepEqual(pc.camera_start, pc.camera_end);
  const legacy = sequencerPlan({ shots: [{ id: 'x', duration_s: 1, lens_mm: 35, size: 'Wide', preset: 'push_in', description: 'no move field' }] }).shots[0];
  assert.equal(legacy.preset, 'push_in', 'a shot with no move at all still honours its preset');
});

console.log('Film 2: all-caps action lines are not character cues');
await test('"SILENCE." / "BANG!" stay action (the reviewed failing input)', () => {
  const src = 'INT. ROOM - DAY\n\nSILENCE.\nA door opens slowly.\n\nBANG!\n\nJOHN\nHello.\n';
  const p = parseScreenplay(src);
  assert.deepEqual(p.scenes[0].elements, [
    { type: 'action', text: 'SILENCE. A door opens slowly.' }, { type: 'action', text: 'BANG!' },
    { type: 'dialogue', character: 'JOHN', text: 'Hello.', parentheticals: [] },
  ]);
  assert.deepEqual(p.characters, [{ name: 'JOHN', lines: 1 }]);
  const bd = breakdown(src);
  assert.deepEqual(bd.shots.map((s) => s.description), ['Establishing: INT. ROOM - DAY', 'SILENCE.', 'A door opens slowly.', 'BANG!', 'JOHN: "Hello."']);
  assert.ok(!bd.shots.some((s) => /^SILENCE\.:/.test(s.description)));
  assert.deepEqual(bd.shots.filter((s) => s.source === 'dialogue').map((s) => s.subject), ['JOHN']);
});
await test('slug lines (LATER, SUPER:, MONTAGE, BACK TO SCENE, THE END, INTERCUT …) are action even with text right under them', () => {
  for (const slug of ['LATER', 'MOMENTS LATER', 'SUPER: THREE YEARS LATER', 'MONTAGE', 'MONTAGE - TRAINING', 'END MONTAGE', 'BACK TO SCENE', 'BACK TO PRESENT', 'THE END', 'INTERCUT', 'INTERCUT PHONE CALL', 'SERIES OF SHOTS', 'FLASHBACK', 'TITLE CARD', 'CONTINUOUS', 'SILENCE', 'WHAT?', 'STOP!', 'A GUNSHOT.']) {
    const p = parseScreenplay(`INT. ROOM - DAY\n\n${slug}\nThe room is empty now.\n`);
    assert.deepEqual(p.characters, [], `"${slug}" must not become a character`);
    assert.equal(dialogue(p).length, 0, slug);
    assert.ok(action(p).join(' ').includes('The room is empty now.'), `text under "${slug}" is kept as action`);
    assert.ok(action(p).join(' ').includes(slug), `"${slug}" itself is kept as action`);
  }
});
await test('an upper-case line with nothing under it is action, not a dropped cue', () => {
  const p = parseScreenplay('INT. ROOM - DAY\n\nBANG\n\nJOHN\nHello.\n\nKABOOM\n\nINT. HALL - DAY\n\nJANE\nCUT TO:\n');
  assert.deepEqual(action(p), ['BANG', 'KABOOM', 'JANE']); assert.deepEqual(p.characters.map((c) => c.name), ['JOHN']);
});
await test('real cues still work: extensions, titles, apostrophes, digits, forced @cue', () => {
  const p = parseScreenplay([
    'INT. ROOM - DAY', '', 'TOMAS (V.O.)', 'One.', '', "MARA (CONT'D)", 'Two.', '', 'DR. SMITH', 'Three.', '', "MR. O'NEIL", 'Four.', '',
    '@McCLANE', 'Yippee.', '', 'GUARD #2', 'Halt.', '', 'MARA (O.S.) (CONT’D)', 'Five.', '', 'JOSÉ', 'Seis.', '', 'JOHN SMITH JR.', 'Seven.', '',
    'TOMAS (20s, soaked)', 'is not a cue because the bracket is a description.', '',
  ].join('\n'));
  assert.deepEqual(dialogue(p).map((d) => [d.character, d.text]), [['TOMAS', 'One.'], ['MARA', 'Two.'], ['DR. SMITH', 'Three.'], ["MR. O'NEIL", 'Four.'], ['McCLANE', 'Yippee.'], ['GUARD #2', 'Halt.'], ['MARA', 'Five.'], ['JOSÉ', 'Seis.'], ['JOHN SMITH JR.', 'Seven.']]);
  assert.deepEqual(action(p), ['TOMAS (20s, soaked) is not a cue because the bracket is a description.']);
  assert.deepEqual(p.characters.find((c) => c.name === 'MARA'), { name: 'MARA', lines: 2 });
});

console.log('Film 3: voice-over / off-screen dialogue');
await test('the extension is recorded on the dialogue element (V.O., O.S., O.C.), not for CONT\'D', () => {
  const p = parseScreenplay("INT. ROOM - DAY\n\nTOMAS (V.O.)\nA.\n\nMARA (O.S.)\nB.\n\nJOHN (O.C.)\nC.\n\nMARA (CONT'D)\nD.\n\nTOMAS (V.O., CONT'D)\nE.\n\nJANE (OFF SCREEN)\nF.\n\nJOHN (ON PHONE)\nG.\n");
  assert.deepEqual(dialogue(p).map((d) => d.extension ?? null), ['V.O.', 'O.S.', 'O.C.', null, 'V.O.', 'O.S.', null]);
  assert.ok(!('extension' in dialogue(p)[3]));
});
await test('off-screen lines keep the camera on the scene: Medium, no ots_side, subject is not an off-screen speaker', () => {
  const bd = breakdown(script);
  assert.equal(bd.shots.length, 29, 'the sample still yields 29 shots');
  const vo = bd.shots.find((s) => /Mara! The last one!/.test(s.description));
  assert.equal(vo.description, 'TOMAS (V.O.): "Mara! The last one!"'); assert.equal(vo.size, 'Medium'); assert.equal(vo.move, 'Static (locked off)'); assert.equal(vo.preset, 'static');
  assert.ok(!('ots_side' in vo)); assert.equal(vo.subject, 'MARA', 'last on-screen subject in that scene'); assert.equal(vo.speaker, 'TOMAS');
  assert.equal(vo.extension, 'V.O.'); assert.equal(vo.off_screen, true); assert.equal(vo.source, 'dialogue');
  assert.ok(/^MARA on screen, speaker not on camera\. TOMAS \(V\.O\.\)/.test(vo.prompt)); assert.ok(!/\.\./.test(vo.prompt));
  assert.equal(promptFor(vo), vo.prompt, 'the server can regenerate the same prompt from the shot');
  assert.deepEqual(bd.characters.map((c) => c.name), ['MARA', 'TOMAS']);

  const os = breakdown('INT. KITCHEN - DAY\n\nMARA\nWho is there?\n\nTOMAS (O.S.)\nOnly me.\n\nMARA\nCome in.\n\nTOMAS\nThanks.\n\nTOMAS (O.S.)\nI am gone again.\n').shots.filter((s) => s.source === 'dialogue');
  assert.deepEqual(os.map((s) => s.ots_side ?? null), ['camera left', null, 'camera right', 'camera left', null], 'the off-screen line does not flip the OTS side');
  assert.deepEqual(os.map((s) => s.subject), ['MARA', 'MARA', 'MARA', 'TOMAS', 'MARA'], 'O.S. speaker is never the subject, even right after speaking on camera');
  assert.deepEqual(os.map((s) => s.size), ['Medium (over-the-shoulder)', 'Medium', 'Medium (over-the-shoulder)', 'Medium (over-the-shoulder)', 'Medium']);

  const alone = breakdown('EXT. DESERT - DAY\n\nNARRATOR (V.O.)\n(whispering)\nIt began here.\n').shots.at(-1);
  assert.equal(alone.subject, 'DESERT', 'falls back to the location when nobody is on screen'); assert.equal(alone.size, 'Medium', 'no close-up of an unseen speaker'); assert.ok(!('ots_side' in alone));
});

console.log('Film 4: one stage per location in the Sequencer plan');
await test('each location gets its own stage; coordinates are absolute and include the stage origin', () => {
  const bd = breakdown(script); const plan = sequencerPlan(bd);
  assert.equal(plan.schema, 'fabled.sequencer_plan/0.1'); assert.equal(plan.plan_version, 2); assert.equal(plan.fps, 24); assert.equal(STAGE_SPACING_CM, 5000);
  assert.deepEqual(plan.stages, [
    { location: 'HARBOR TOWN', origin: { x: 0, y: 0, z: 0 } }, { location: 'LIGHTHOUSE - KITCHEN', origin: { x: 5000, y: 0, z: 0 } }, { location: 'CLIFF PATH', origin: { x: 10000, y: 0, z: 0 } },
  ]);
  assert.equal(plan.shots.length, bd.shots.length);
  let f = 0;
  plan.shots.forEach((s, i) => {
    const src = bd.shots[i]; const stage = plan.stages.find((st) => st.location === s.location);
    assert.equal(s.id, src.id); assert.equal(s.location, bd.scenes.find((sc) => sc.number === src.scene).location); assert.deepEqual(s.stage_origin, stage.origin);
    assert.deepEqual(s.look_at, { x: stage.origin.x, y: stage.origin.y, z: stage.origin.z + 150 });
    assert.equal(s.start_frame, f); assert.ok(s.end_frame > s.start_frame); f = s.end_frame;
    assert.equal(s.focal_length_mm, src.lens_mm); assert.equal(s.label, src.description);
    for (const p of [s.camera_start, s.camera_end, s.look_at]) for (const k of ['x', 'y', 'z']) assert.ok(Number.isInteger(p[k]), `${s.id} ${k}`);
    for (const p of [s.camera_start, s.camera_end]) assert.ok(Math.hypot(p.x - stage.origin.x, p.y - stage.origin.y) <= 3100, `${s.id} camera stays on its own stage`);
    if (s.preset === 'push_in' || s.preset === 'crash_zoom') assert.ok(dist(s.camera_end, s.look_at) < dist(s.camera_start, s.look_at), `${s.id} moves toward its look-at mark`);
  });
  assert.equal(plan.total_frames, f);
  assert.deepEqual(plan.shots[0].stage_origin, plan.shots.at(-1).stage_origin, 'scene 4 returns to the HARBOR TOWN stage');
  const kitchen = plan.shots.find((s) => s.location === 'LIGHTHOUSE - KITCHEN'); const cliff = plan.shots.find((s) => s.location === 'CLIFF PATH');
  assert.ok(kitchen.camera_start.x > 3000 && cliff.camera_start.x > 7000, 'cameras are offset with their stage');
  assert.equal(new Set(plan.shots.map((s) => `${s.look_at.x},${s.look_at.y}`)).size, 3, 'three look-at marks, not one at the origin');
});
await test('plan is deterministic and robust: same stages on re-run, no scenes[], bad numbers', () => {
  const bd = breakdown(script);
  assert.deepEqual(sequencerPlan(bd), sequencerPlan(bd));
  const noScenes = sequencerPlan({ shots: bd.shots }); // location falls back to the shot's scene_heading
  assert.deepEqual(noScenes.stages.map((s) => s.location), ['HARBOR TOWN', 'LIGHTHOUSE - KITCHEN', 'CLIFF PATH']);
  const odd = sequencerPlan({ shots: [{ id: 'a', duration_s: 'abc', lens_mm: null, size: 'bogus', move: 'Dolly follow' }, { id: 'b', duration_s: -4, lens_mm: 50, size: 'close-up', scene_heading: 'UNTITLED SCENE' }] }, { fps: 'x' });
  assert.equal(odd.fps, 24); assert.deepEqual(odd.shots.map((s) => [s.start_frame, s.end_frame, s.focal_length_mm]), [[0, 1, 35], [1, 2, 50]]); assert.equal(odd.total_frames, 2);
  assert.deepEqual(odd.stages, [{ location: 'Unknown', origin: { x: 0, y: 0, z: 0 } }]);
  for (const s of odd.shots) for (const p of [s.camera_start, s.camera_end]) assert.ok(Number.isFinite(p.x + p.y + p.z));
  assert.deepEqual(sequencerPlan({}).shots, []); assert.equal(sequencerPlan(breakdown('')).total_frames, 0);
});

console.log('Film 5: other parser and exporter fixes');
await test('headings: INT./EXT., I/E, scene numbers, forced ".HEADING", time of day from the last segment', () => {
  const p = parseScreenplay([
    'INT./EXT. CAR - MOVING - DAY #12A#', '', 'A.', '', 'I/E. TRUCK - NIGHT', '', 'B.', '', '.BINOCULARS POV', '', 'C.', '',
    'INT. NIGHT CLUB - DAY', '', 'D.', '', 'EXT. BEACH NIGHT', '', 'E.', '', 'INT. HOUSE - DAY - LATER', '', 'F.', '', 'ext. harbor town – dawn (continuous)', '', 'G.', '',
  ].join('\n'));
  assert.deepEqual(p.scenes.map((s) => [s.int_ext, s.location, s.time]), [
    ['INT/EXT', 'CAR - MOVING', 'DAY'], ['INT/EXT', 'TRUCK', 'NIGHT'], [null, 'BINOCULARS POV', null], ['INT', 'NIGHT CLUB', 'DAY'], ['EXT', 'BEACH', 'NIGHT'], ['INT', 'HOUSE', 'DAY - LATER'], ['EXT', 'harbor town', 'DAWN'],
  ]);
  assert.equal(p.scenes[0].scene_number, '12A'); assert.equal(p.scenes[0].heading, 'INT./EXT. CAR - MOVING - DAY'); assert.equal(p.scenes[2].heading, 'BINOCULARS POV');
  assert.ok(!('scene_number' in p.scenes[1]));
  const bd = breakdown('INT./EXT. CAR - DAY #7#\n\nShe waits.\n');
  assert.equal(bd.scenes[0].scene_number, '7'); assert.equal(bd.shots[0].size, 'Extreme wide', 'INT./EXT. is covered as an exterior'); assert.equal(bd.shots[0].scene_heading, 'INT./EXT. CAR - DAY');
});
await test('lighting cue reads the time of day on word boundaries', () => {
  const light = (h) => promptFor({ description: 'x', size: 'Wide', move: 'Static (locked off)', lens_mm: 35, scene_heading: h });
  assert.ok(/natural daylight/.test(light("INT. KNIGHT'S HALL - DAY"))); assert.ok(/natural daylight/.test(light('INT. NIGHT CLUB - DAY')));
  assert.ok(/low-key night/.test(light('EXT. CLIFF PATH - NIGHT'))); assert.ok(/golden-hour/.test(light('EXT. HARBOR TOWN - DAWN (CONTINUOUS)'))); assert.ok(/natural daylight/.test(light('')));
});
await test('dialogue block details: dual-dialogue caret, (MORE)/(CONT\'D), lyrics ~, emphasis, heading right after dialogue', () => {
  const p = parseScreenplay([
    'INT. BAR - NIGHT', '', 'MARA', 'I said *no*.', '(MORE)', '', "MARA (CONT'D)", '(beat)', 'And I meant it.', '', 'TOMAS ^', 'Fine!', '', 'SINGER', '~Oh the fog rolls in', '~and the lamps go out', '',
    'MARA', 'Int. means interior.', 'INT. HALL - DAY', '', '~A lyric as action.', '', '!FORCED ACTION', 'Second line.', '', '> THE END <', '',
  ].join('\n'));
  const d = dialogue(p);
  assert.deepEqual(d.map((x) => [x.character, x.text]), [['MARA', 'I said no.'], ['MARA', 'And I meant it.'], ['TOMAS', 'Fine!'], ['SINGER', 'Oh the fog rolls in and the lamps go out'], ['MARA', 'Int. means interior.']]);
  assert.deepEqual(d[0].parentheticals, [], '(MORE) is a page-break artifact, not a parenthetical'); assert.deepEqual(d[1].parentheticals, ['beat']);
  assert.equal(d[2].dual, true); assert.ok(!('dual' in d[0]));
  assert.equal(p.scenes.length, 2); assert.equal(p.scenes[1].location, 'HALL');
  assert.deepEqual(p.scenes[1].elements.map((e) => e.text), ['A lyric as action.', 'FORCED ACTION Second line.', 'THE END']);
  assert.deepEqual(p.characters.map((c) => c.name), ['MARA', 'TOMAS', 'SINGER']);
});
await test('Fountain non-story text is skipped: multi-line title page, boneyard, notes, sections, synopses, transitions', () => {
  const p = parseScreenplay([
    'Title:', '    _**BRICK & STEEL**_', '    FULL RETIRED', 'Credit: Written by', 'Author: Someone', '', '# Act One', '', '= The setup.', '',
    'INT. ROOM - DAY', '', 'A man sits. [[check this]]', '/* cut this', 'whole thing */', '', 'BURN TO:', '', '> FADE TO WHITE.', '', 'JOHN', 'Hello. /* aside */', '', '===', '',
  ].join('\n'));
  assert.equal(p.scenes.length, 1); assert.deepEqual(p.scenes[0].elements, [{ type: 'action', text: 'A man sits.' }, { type: 'dialogue', character: 'JOHN', text: 'Hello.', parentheticals: [] }]);
  assert.equal(parseScreenplay('﻿Title: X\r\n\r\nINT. ROOM - DAY\r\n\r\nShe waits.\r\n').scenes[0].heading, 'INT. ROOM - DAY');
});
await test('title page ends at a heading even without a blank line; ".38" mid-paragraph is not a forced heading', () => {
  const p = parseScreenplay('Title: X\nAuthor: Y\nINT. ROOM - DAY\n\nA gun lies there:\n.38 on the table.\n\n.CLOSE ON THE GUN\n\nIt gleams.\n');
  assert.deepEqual(p.scenes.map((s) => s.heading), ['INT. ROOM - DAY', 'CLOSE ON THE GUN']);
  assert.deepEqual(action(p), ['A gun lies there: .38 on the table.', 'It gleams.']);
});
await test('hostile input stays fast (no quadratic regex): 300k-character lines finish well under 5 s each', () => {
  const n = 300000;
  const cases = { stars: '*a '.repeat(n / 3), underscores: '_a _'.repeat(n / 4), boneyard: '/*'.repeat(n / 2), notes: '[['.repeat(n / 2), parens: 'MARA ' + '('.repeat(n), titles: 'Dr. '.repeat(n / 4), dashes: 'INT. ' + 'A - '.repeat(n / 4), caps: 'A '.repeat(n / 2) + 'LATER' };
  for (const [name, text] of Object.entries(cases)) { const t = Date.now(); const bd = breakdown(text); sequencerPlan(bd); shotlistCsv(bd); assert.ok(Date.now() - t < 5000, `${name} took ${Date.now() - t} ms`); }
});
await test('sentence split keeps "Dr. Smith" and "waits... then" together and drops punctuation-only pieces', () => {
  const d = (t) => breakdown(`INT. ROOM - DAY\n\n${t}\n`).shots.slice(1).map((s) => s.description);
  assert.deepEqual(d('Dr. Smith walks in. Mrs. Lee looks up.'), ['Dr. Smith walks in.', 'Mrs. Lee looks up.']);
  assert.deepEqual(d('He waits... then runs. She follows.'), ['He waits... then runs.', 'She follows.']);
  assert.deepEqual(d('... Wind. Rain!'), ['Wind.', 'Rain!']);
  assert.equal(breakdown('INT. ROOM - DAY\n\nTHE END\n').shots.at(-1).subject, 'Scene', '"THE" is not a subject');
});
await test('CSV neutralises spreadsheet formulas and survives a project with no shots', () => {
  const bd = breakdown('INT. ROOM - DAY\n\nShe waits.\n');
  Object.assign(bd.shots[1], { description: '=HYPERLINK("http://x","y")', subject: '@SUM(1)', duration_s: 2.5, lens_mm: 50 });
  const row = shotlistCsv(bd).split('\n')[2];
  assert.ok(row.includes(`"'=HYPERLINK(""http://x"",""y"")"`)); assert.ok(row.includes(`"'@SUM(1)"`)); assert.ok(row.includes('"50","2.5"'), 'numbers are untouched');
  assert.equal(shotlistCsv({}).trim(), 'id,scene,scene_heading,size,move,lens_mm,duration_s,subject,description,status,prompt');
});
await test('existing contract holds: 4 scenes / 29 shots, contiguous ids, empty input, proposeShots is exported', () => {
  const p = parseScreenplay(script); assert.equal(p.scenes.length, 4); assert.deepEqual(p.scenes.map((s) => s.time), ['DAWN', 'MORNING', 'NIGHT', 'DAWN']);
  const shots = proposeShots(p); assert.equal(shots.length, 29); assert.deepEqual(shots.map((s) => Number(s.id.slice(-3))), shots.map((_, i) => i + 1));
  assert.equal(breakdown('').shots.length, 0); assert.equal(breakdown(null).scenes.length, 0); assert.equal(breakdown(undefined).total_duration_s, 0);
});

console.log('Game 6: category changes go through applyCategory');
await test('CATEGORIES lists the keys; unknown categories throw a clear error', () => {
  assert.deepEqual(CATEGORIES, ['character', 'creature', 'prop', 'environment', 'vehicle']); assert.deepEqual(CATEGORIES, Object.keys(CATEGORY_DEFAULTS));
  const a = buildKit(pitch).assets[0]; const before = JSON.stringify(a);
  for (const bad of ['weapon', '', null, undefined, 7, 'Character', '__proto__', 'constructor', 'toString']) assert.throws(() => applyCategory(a, bad), /Unknown category .*must be one of character, creature, prop, environment, vehicle/, String(bad));
  assert.equal(JSON.stringify(a), before, 'a rejected category leaves the asset untouched');
  assert.throws(() => applyCategory(null, 'prop'), /asset must be an object/);
});
await test('changing category rewrites profile, budget, footprint and default assignee exactly as buildKit would', () => {
  const kit = buildKit(pitch);
  const knight = kit.assets.find((a) => a.asset_name === 'SM_Knight'); const sword = kit.assets.find((a) => a.asset_name === 'SM_Sword'); const tavern = kit.assets.find((a) => a.asset_name === 'SM_Tavern');
  assert.deepEqual(knight.budget.lods_triangles, [60000, 30000, 15000, 5000]); assert.equal(knight.assignee, 'character artist'); assert.equal(sword.assignee, 'vendor');
  assert.equal(applyCategory(knight, 'prop'), knight, 'returns the asset');
  for (const k of ['category', 'import_profile', 'budget', 'footprint_cm', 'assignee']) assert.deepEqual(knight[k], sword[k], `knight.${k} now matches a prop built by buildKit`);
  assert.deepEqual(knight.budget, { lods_triangles: [20000, 10000, 5000, 2000], height_cm: [20, 80], texel_density_px_per_cm: 5.12, texture_px: 2048, up_axis: 'Z', rig: 'none' });
  applyCategory(sword, 'environment');
  for (const k of ['category', 'import_profile', 'budget', 'footprint_cm', 'assignee']) assert.deepEqual(sword[k], tavern[k], `sword.${k} now matches an environment piece`);
  applyCategory(sword, 'creature'); assert.equal(sword.assignee, 'character artist'); assert.equal(sword.import_profile, 'demo_placeholder_mochi_character'); assert.equal(sword.budget.rig, 'required');
  tavern.assignee = 'tech art director'; applyCategory(tavern, 'character'); assert.equal(tavern.assignee, 'tech art director', 'a hand-picked assignee survives'); assert.deepEqual(tavern.footprint_cm, [60, 60]);
  assert.equal(applyCategory({ id: 'X' }, 'vehicle').assignee, 'vendor'); assert.equal(applyCategory({ id: 'X', assignee: '' }, 'creature').assignee, 'character artist');
  assert.equal(summarize(kit.assets).lod0_triangles_total, kit.assets.reduce((n, a) => n + a.budget.lods_triangles[0], 0));
});
await test('budgets and footprints are copies: editing one asset never leaks into the defaults or another asset', () => {
  const snapshot = JSON.stringify(CATEGORY_DEFAULTS);
  const kit = buildKit('Props: sword, shield'); const [a, b] = kit.assets;
  a.budget.lods_triangles[0] = 1; a.budget.height_cm[1] = 9999; a.footprint_cm[0] = 7;
  assert.equal(JSON.stringify(CATEGORY_DEFAULTS), snapshot); assert.deepEqual(b.budget.lods_triangles, [20000, 10000, 5000, 2000]); assert.deepEqual(b.footprint_cm, [60, 60]);
  assert.deepEqual(buildKit('Props: axe').assets[0].budget.lods_triangles, [20000, 10000, 5000, 2000]);
});

console.log('Game 7: layout items are sanitized');
await test('sanitizeLayoutItem takes identity from the asset and only a clamped transform from raw', () => {
  const kit = buildKit(pitch); const tavern = kit.assets.find((a) => a.asset_name === 'SM_Tavern');
  const it = sanitizeLayoutItem({ id: 'keep-me_01', asset_id: 'A999', asset_name: '../../Engine/Evil', category: 'boss', footprint_cm: [1e9, 'x'], x: '120.6', y: -80.4, z: 1e12, yaw: -90, scale: 250, extra: '<script>' }, tavern);
  assert.deepEqual(it, { id: 'keep-me_01', asset_id: tavern.id, asset_name: 'SM_Tavern', category: 'environment', x: 121, y: -80, z: 100000, yaw: 270, scale: 10, footprint_cm: [400, 400] });
  assert.notEqual(it.footprint_cm, tavern.footprint_cm, 'footprint is a copy');
  const junk = sanitizeLayoutItem({ id: { $ne: 1 }, x: 'abc', y: null, z: undefined, yaw: NaN, scale: 'big' }, tavern);
  assert.deepEqual({ ...junk, id: 0 }, { id: 0, asset_id: tavern.id, asset_name: 'SM_Tavern', category: 'environment', x: 0, y: 0, z: 0, yaw: 0, scale: 1, footprint_cm: [400, 400] });
  assert.match(junk.id, /^[A-Za-z0-9_-]{1,40}$/); assert.ok(junk.id.startsWith(`${tavern.id}-`));
  for (const bad of ['', 'has space', 'a/b', '../x', 'x'.repeat(41), 12, null, '<b>']) assert.notEqual(sanitizeLayoutItem({ id: bad }, tavern).id, bad);
  for (const [yaw, want] of [[725, 5], [-1, 359], [360, 0], [359.6, 0], [-0.2, 0], ['45', 45], [Infinity, 0]]) assert.equal(sanitizeLayoutItem({ yaw }, tavern).yaw, want, `yaw ${yaw}`);
  for (const [scale, want] of [[0, 0.1], [-3, 0.1], [0.05, 0.1], [2.5, 2.5], [11, 10], [undefined, 1], ['2', 2], [NaN, 1], [1.23456, 1.235]]) assert.equal(sanitizeLayoutItem({ scale }, tavern).scale, want, `scale ${scale}`);
  for (const [x, want] of [[-1e9, -100000], [1e9, 100000], [-0.4, 0], [99999.6, 100000], [[5], 0], [true, 0]]) assert.ok(Object.is(sanitizeLayoutItem({ x }, tavern).x, want), `x ${x}`);
  for (const raw of [null, undefined, 'str', 5, []]) assert.equal(sanitizeLayoutItem(raw, tavern).asset_name, 'SM_Tavern');
  assert.equal(sanitizeLayoutItem({ x: 1 }, null), null); assert.equal(sanitizeLayoutItem({ x: 1 }, undefined), null);
});
await test('place() and starterLayout() only ever produce sanitized items', () => {
  const kit = buildKit(pitch); const lay = starterLayout(kit); const byId = new Map(kit.assets.map((a) => [a.id, a]));
  assert.equal(lay.items.length, kit.assets.length); assert.equal(new Set(lay.items.map((i) => i.id)).size, lay.items.length);
  for (const it of lay.items) {
    const a = byId.get(it.asset_id);
    assert.deepEqual(it, sanitizeLayoutItem(it, a), 'sanitizing again changes nothing');
    assert.ok(Number.isInteger(it.x) && Number.isInteger(it.y) && it.z === 0); assert.ok(Number.isInteger(it.yaw) && it.yaw >= 0 && it.yaw <= 359); assert.equal(it.scale, 1);
    assert.equal(it.asset_name, a.asset_name); assert.equal(it.category, a.category); assert.deepEqual(it.footprint_cm, a.footprint_cm);
  }
  const p = place(kit.assets[0], 120.7, '-80', -45, 99);
  assert.deepEqual([p.x, p.y, p.z, p.yaw, p.scale], [121, -80, 0, 315, 10]); assert.deepEqual(Object.keys(p), ['id', 'asset_id', 'asset_name', 'category', 'x', 'y', 'z', 'yaw', 'scale', 'footprint_cm']);
  assert.equal(place(kit.assets[0], 5, 5).yaw, 0); assert.equal(place(kit.assets[0], 5, 5).scale, 1);
  assert.equal(new Set(lay.items.map((i) => `${i.x},${i.y}`)).size, lay.items.length, 'no two starter placements share a position');
  const big = buildKit('Characters: a1, a2, a3\nProps: p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14'); const bl = starterLayout(big);
  assert.equal(new Set(bl.items.map((i) => `${i.x},${i.y}`)).size, 17, 'the cast row does not land on the third prop row');
  assert.deepEqual(starterLayout({ title: 'empty' }).items, []);
});
await test('sanitizeLayoutItems drops unknown assets and junk, re-issues duplicate ids, caps the count; sanitizeSpawn clamps', () => {
  const kit = buildKit(pitch); const a = kit.assets[0];
  const out = sanitizeLayoutItems(kit, [{ id: 'dup', asset_id: a.id, x: 1 }, { id: 'dup', asset_id: a.id, x: 2 }, { asset_id: 'nope' }, null, 'x', 7, { asset_id: a.id, footprint_cm: 'nope' }]);
  assert.equal(out.length, 3); assert.equal(out[0].id, 'dup'); assert.notEqual(out[1].id, 'dup'); assert.equal(new Set(out.map((i) => i.id)).size, 3); assert.deepEqual(out.map((i) => i.x), [1, 2, 0]);
  assert.equal(sanitizeLayoutItems(kit, Array.from({ length: 50 }, () => ({ asset_id: a.id })), { max: 10 }).length, 10);
  assert.deepEqual(sanitizeLayoutItems(kit, 'not an array'), []); assert.deepEqual(sanitizeLayoutItems(null, [{ asset_id: a.id }]), []);
  assert.deepEqual(sanitizeSpawn({ x: '10', y: 1e9, yaw: -90 }), { x: 10, y: 100000, z: 0, yaw: 270 }); assert.deepEqual(sanitizeSpawn(null), { x: 0, y: -1200, z: 0, yaw: 90 }); assert.deepEqual(sanitizeSpawn('x', { x: 5, y: 6, z: 7, yaw: 8 }), { x: 5, y: 6, z: 7, yaw: 8 });
});
await test('blockoutPlan never throws: missing footprint, missing asset, junk items, missing layout', () => {
  const kit = buildKit(pitch); const lay = starterLayout(kit);
  const tavernItem = lay.items.find((i) => i.asset_name === 'SM_Tavern'); const knight = kit.assets.find((a) => a.asset_name === 'SM_Knight');
  const plan = blockoutPlan(kit, lay);
  assert.equal(plan.schema, 'fabled.blockout_plan/0.1'); assert.equal(plan.actors.length, lay.items.length); assert.equal(plan.skipped_items, 0);
  const t = plan.actors.find((x) => x.label.startsWith('SM_Tavern_'));
  assert.equal(t.label, `SM_Tavern_${tavernItem.id.slice(-4)}`); assert.equal(t.mesh_path, '/Game/Fabled/SM_Tavern/SM_Tavern'); assert.deepEqual(t.placeholder_box_cm, { x: 400, y: 400, z: 500 }); assert.equal(t.imported, false);
  assert.deepEqual(plan.spawn, { x: 0, y: -1200, z: 0, yaw: 90 }); assert.equal(plan.grid_cm, 100);

  const hostile = { spawn: { x: 'a', yaw: 800 }, grid_cm: 'x', items: [
    { id: 'no-footprint', asset_id: knight.id, asset_name: 'SM_Knight', x: 10, y: 20, z: 0, yaw: 0, scale: 1 },             // the old code threw here
    { id: 'gone', asset_id: 'A999', asset_name: 'SM_Deleted', x: 0, y: 0, z: 0, yaw: 0, scale: 1, footprint_cm: [60, 60] }, // asset no longer exists
    { asset_id: knight.id, asset_name: '../../Evil', category: 'nope', footprint_cm: ['a'], x: 'x', yaw: -90, scale: 1e6 },
    { id: 'same-tail', asset_id: knight.id }, { id: 'also-same-tail', asset_id: knight.id }, null, 'junk', 42, {},
  ] };
  const hp = blockoutPlan(kit, hostile);
  assert.equal(hp.actors.length, 4); assert.equal(hp.skipped_items, 5);
  for (const a of hp.actors) { assert.equal(a.mesh_path, '/Game/Fabled/SM_Knight/SM_Knight'); assert.deepEqual(a.placeholder_box_cm, { x: 60, y: 60, z: 185 }); assert.equal(a.category, 'character'); for (const v of [a.location.x, a.location.y, a.location.z, a.rotation.yaw, a.scale]) assert.ok(Number.isFinite(v)); }
  assert.deepEqual(hp.actors[0].location, { x: 10, y: 20, z: 0 }); assert.deepEqual([hp.actors[1].rotation.yaw, hp.actors[1].scale, hp.actors[1].location.x], [270, 10, 0]);
  assert.equal(new Set(hp.actors.map((a) => a.label)).size, 4, 'labels stay unique even when id tails collide'); assert.deepEqual(hp.actors.slice(2).map((a) => a.label), ['SM_Knight_tail', 'SM_Knight_tail_2']);
  assert.deepEqual(hp.spawn, { x: 0, y: -1200, z: 0, yaw: 80 }); assert.equal(hp.grid_cm, 100);
  JSON.stringify(hp);

  for (const bad of [undefined, null, {}, { items: 'x' }]) assert.deepEqual(blockoutPlan(kit, bad).actors, []);
  assert.deepEqual(blockoutPlan({}, lay).actors, []); assert.equal(blockoutPlan({}, lay).skipped_items, lay.items.length);
  delete knight.budget; delete knight.footprint_cm; // an asset damaged on disk still exports, from its category defaults
  assert.deepEqual(blockoutPlan(kit, { items: [{ asset_id: knight.id }] }).actors[0].placeholder_box_cm, { x: 60, y: 60, z: 185 });
  assert.equal(summarize(kit.assets).total, 23);
});
await test('a category change or rename shows up in the blockout even though the stored item is stale', () => {
  const kit = buildKit(pitch); kit.layout = starterLayout(kit);
  const sword = kit.assets.find((a) => a.asset_name === 'SM_Sword'); const item = kit.layout.items.find((i) => i.asset_id === sword.id);
  applyCategory(sword, 'environment'); sword.status = 'imported';
  assert.deepEqual(item.footprint_cm, [60, 60], 'the stored item is stale on purpose here');
  const actor = blockoutPlan(kit, kit.layout).actors.find((a) => a.label.startsWith('SM_Sword_'));
  assert.deepEqual(actor.placeholder_box_cm, { x: 400, y: 400, z: 500 }); assert.equal(actor.category, 'environment'); assert.equal(actor.imported, true);
  const fresh = sanitizeLayoutItems(kit, kit.layout.items).find((i) => i.asset_id === sword.id);
  assert.deepEqual([fresh.id, fresh.category, fresh.footprint_cm], [item.id, 'environment', [400, 400]]);
});

console.log('Game 8: asset_name stays unique; renameAsset');
await test('names that collapse to the same asset_name get a numeric suffix; every kit has unique names', () => {
  const kit = buildKit('Characters: fog knight, fogknight, FOG-KNIGHT, R2 D2, R2D2\nProps: 日本刀, 手裏剣, épée');
  assert.deepEqual(kit.assets.map((a) => [a.name, a.asset_name]).sort((a, b) => a[1].localeCompare(b[1])), [
    ['日本刀', 'SM_Asset'], ['手裏剣', 'SM_Asset_2'], ['épée', 'SM_Epee'], ['fog knight', 'SM_FogKnight'], ['fogknight', 'SM_Fogknight_2'], ['R2 D2', 'SM_R2D2'], ['R2D2', 'SM_R2d2_2'],
  ].sort((a, b) => a[1].localeCompare(b[1])));
  for (const k of [kit, buildKit(pitch)]) { const names = k.assets.map((a) => a.asset_name.toLowerCase()); assert.equal(new Set(names).size, names.length); for (const n of k.assets) assert.match(n.asset_name, /^SM_[A-Za-z0-9]+(_\d+)?$/); }
  assert.equal(buildKit(pitch).assets.length, 23); assert.equal(assetNameFor('potion flask'), 'SM_PotionFlask'); assert.equal(assetNameFor('!!!'), 'SM_Asset');
});
await test('renameAsset updates name + asset_name, keeps it unique, follows through to layout items, validates input', () => {
  const kit = buildKit(pitch); kit.layout = starterLayout(kit);
  const sword = kit.assets.find((a) => a.asset_name === 'SM_Sword'); const shield = kit.assets.find((a) => a.asset_name === 'SM_Shield');
  assert.equal(renameAsset(kit, sword.id, '  rusty   long sword '), sword); assert.equal(sword.name, 'rusty long sword'); assert.equal(sword.asset_name, 'SM_RustyLongSword');
  assert.equal(kit.layout.items.find((i) => i.asset_id === sword.id).asset_name, 'SM_RustyLongSword');
  assert.ok(blockoutPlan(kit, kit.layout).actors.some((a) => a.mesh_path === '/Game/Fabled/SM_RustyLongSword/SM_RustyLongSword'));
  renameAsset(kit, shield.id, 'Rusty-Long SWORD'); assert.equal(shield.asset_name, 'SM_RustyLongSword_2', 'collision with another asset gets a suffix');
  renameAsset(kit, shield.id, 'rusty long sword!'); assert.equal(shield.asset_name, 'SM_RustyLongSword_2', 'stable when renamed to the same thing again');
  renameAsset(kit, sword.id, 'RUSTY LONG SWORD'); assert.equal(sword.asset_name, 'SM_RustyLongSword', 'renaming to its own name does not collide with itself');
  renameAsset(kit, shield.id, 'tower shield'); assert.equal(shield.asset_name, 'SM_TowerShield'); assert.equal(shield.category, 'prop', 'rename does not touch category or budget');
  const names = kit.assets.map((a) => a.asset_name.toLowerCase()); assert.equal(new Set(names).size, names.length);
  for (const bad of ['', '   ', null, undefined, {}, ['x']]) assert.throws(() => renameAsset(kit, sword.id, bad), /non-empty/);
  assert.equal(sword.name, 'RUSTY LONG SWORD', 'a rejected rename changes nothing');
  assert.throws(() => renameAsset(kit, 'A999', 'x'), /no asset with id "A999"/); assert.throws(() => renameAsset(null, 'A001', 'x'), /no asset/);
  assert.equal(renameAsset(kit, sword.id, 'x'.repeat(500)).name.length, 80); assert.ok(sword.asset_name.length <= 66);
  assert.equal(renameAsset(kit, sword.id, 'bad\u0000\nname').name, 'bad name');
});

console.log('Game 9: other pitch-parser fixes');
await test('Creatures:/Vehicles: lines are read, repeated lines merge, trailing punctuation is dropped', () => {
  const kit = buildKit('Title: T\nCreatures: moss fox, bog wolf.\nVehicles: river boat\nProps: sword, shield\nProps: lantern; sword\n');
  assert.deepEqual(kit.assets.map((a) => [a.asset_name, a.category]), [['SM_BogWolf', 'creature'], ['SM_MossFox', 'creature'], ['SM_RiverBoat', 'vehicle'], ['SM_Lantern', 'prop'], ['SM_Shield', 'prop'], ['SM_Sword', 'prop']]);
  assert.equal(kit.assets[0].name, 'bog wolf'); assert.equal(kit.assets[0].import_profile, 'demo_placeholder_mochi_character'); assert.ok(kit.assets.every((a) => a.source === 'pitch (explicit)'));
});
await test('only known field lines are structured; other "label: prose" lines still feed inference; Title is not mined', () => {
  const kit = buildKit('Title: Dragon Castle\nGenre: Puzzle\nReferences: wolf among us\nThe hero has three goals: find the key, light the torches and cross the bridge.\nWeapons: a sword and two axes\n');
  assert.deepEqual(kit.assets.map((a) => a.asset_name).sort(), ['SM_Axe', 'SM_Bridge', 'SM_Hero', 'SM_Key', 'SM_Sword', 'SM_Torch']);
  assert.equal(kit.title, 'Dragon Castle'); assert.equal(kit.genre, 'Puzzle');
});
await test('categorize matches whole words and compound endings, not substrings', () => {
  for (const [name, want] of [['catapult', 'prop'], ['carpet', 'prop'], ['rocket', 'prop'], ['wallet', 'prop'], ['heron statue', 'prop'], ['monkey idol', 'prop'], ['scarecrow', 'prop'],
    ['old boat', 'vehicle'], ['mysterious thing', 'prop'], ['watchtower', 'environment'], ['farmhouse', 'environment'], ['two witches', 'character'], ['stray cats', 'creature'], ['werewolf', 'creature'],
    ['fog knight', 'character'], ['mushroom cottage', 'environment'], ['enemy grunt', 'character'], ['wall module', 'environment'], ['', 'prop']]) assert.equal(categorize(name), want, name);
  assert.equal(categorize(null), 'prop'); assert.equal(categorize(undefined), 'prop');
});
await test('thousands of clashing names stay fast and unique', () => {
  const t = Date.now();
  const kit = buildKit('Props: ' + Array.from({ length: 20000 }, (_, i) => '日' + String.fromCharCode(0x4e00 + i)).join(', '));
  assert.equal(kit.assets.length, 20000); assert.equal(new Set(kit.assets.map((a) => a.asset_name)).size, 20000);
  assert.equal(blockoutPlan(kit, starterLayout(kit)).actors.length, 20000); assert.ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
});
await test('existing contract holds: sample kit, ordering, status flow, summarize on odd input', () => {
  const kit = buildKit(pitch);
  assert.equal(kit.assets.length, 23); assert.equal(kit.title, 'Mossgate'); assert.equal(kit.genre, 'Cozy action RPG');
  assert.deepEqual(kit.assets.map((a) => a.id), kit.assets.map((_, i) => `A${String(i + 1).padStart(3, '0')}`));
  assert.deepEqual(Object.keys(kit.assets[0]), ['id', 'name', 'asset_name', 'category', 'source', 'status', 'assignee', 'import_profile', 'budget', 'footprint_cm', 'generation', 'validator', 'comments']);
  assert.deepEqual(kit.summary.by_category, { character: 6, creature: 3, environment: 7, prop: 7 });
  assert.equal(nextStatus('requested'), 'generating'); assert.equal(STATUS_FLOW.length, 6);
  assert.deepEqual(summarize([{ category: 'prop', status: 'requested' }, { category: 'prop', status: 'requested', budget: {} }]), { total: 2, by_category: { prop: 2 }, by_status: { requested: 2 }, lod0_triangles_total: 0 });
  assert.deepEqual(summarize(undefined), { total: 0, by_category: {}, by_status: {}, lod0_triangles_total: 0 });
  assert.equal(buildKit('').assets.length, 0); assert.equal(buildKit(null).title, 'Untitled game');
});

console.log(`\n Engines summary: ${pass}/${pass + fail} passed (${fail} failed)${fail ? '\n  failed: ' + failures.join(', ') : ''}`);
process.exit(fail ? 1 : 0);
