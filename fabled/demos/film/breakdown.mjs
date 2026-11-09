// Fabled Shots: screenplay → scene breakdown → proposed shot list → animatic timing → Unreal Sequencer plan.
//
// This is a deterministic, rule-based breakdown (no LLM, no network). It reads Fountain-style / screenplay-style
// text: scene headings (INT./EXT.), action paragraphs, CHARACTER cues, dialogue and (parentheticals). From that it
// proposes coverage per scene the way a first-pass previs artist would: an establishing wide, alternating
// over-the-shoulder / medium coverage for dialogue, and tracking or insert shots for action beats. Every number it
// produces (durations, lenses) is a planning estimate and is labeled as such in the UI. An LLM "director pass" can
// replace proposeShots() later; the shot-list schema (fabled.shotlist/0.1) is what the exporters depend on.

export const SHOTLIST_SCHEMA = 'fabled.shotlist/0.1';
export const SEQUENCER_PLAN_SCHEMA = 'fabled.sequencer_plan/0.1';
export const SEQUENCER_PLAN_VERSION = 2; // 2 = per-location stages; camera/look-at coordinates are absolute world cm

// ---- shot vocabulary (single source of truth) ----------------------------------------------------------------------
// preset id → move label. `shot.move` (the label the reviewer edits) is authoritative; `shot.preset` is derived from
// it with presetForMove(). Nothing else in this file spells a move label out.
export const MOVE_PRESETS = Object.freeze({
  static: 'Static (locked off)',
  push_in: 'Slow push-in',
  dolly_follow: 'Dolly follow',
  tracking_handheld: 'Tracking (handheld)',
  crane_down: 'Crane down',
  aerial_drift: 'Aerial drift',
  orbit_handheld: 'Handheld orbit',
  crash_zoom: 'Crash zoom',
});
export const SHOT_STATUSES = Object.freeze(['proposed', 'approved', 'redo']);

// Camera distance from the subject mark per shot size (cm). The keys are the size vocabulary.
const SIZE_DISTANCE_CM = Object.freeze({ 'Extreme wide': 2500, 'Wide': 1200, 'Medium wide': 600, 'Medium': 350, 'Medium (over-the-shoulder)': 300, 'Close-up': 150, 'Insert': 90 });
export const SHOT_SIZES = Object.freeze(Object.keys(SIZE_DISTANCE_CM));

const normLabel = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const PRESET_BY_MOVE = new Map();
for (const [id, label] of Object.entries(MOVE_PRESETS)) {
  PRESET_BY_MOVE.set(normLabel(label), id);                              // "Crane down"
  PRESET_BY_MOVE.set(normLabel(label.replace(/\s*\([^)]*\)\s*$/, '')), id); // "Static" for "Static (locked off)"
  PRESET_BY_MOVE.set(id, id);                                            // "crane_down"
}
// Move label → preset id. Case-insensitive; also accepts a preset id. Unknown labels are a locked-off camera.
export function presetForMove(move) { return PRESET_BY_MOVE.get(normLabel(move)) || 'static'; }
const DISTANCE_BY_SIZE = new Map(Object.entries(SIZE_DISTANCE_CM).map(([k, v]) => [normLabel(k), v]));

// ---- parser ---------------------------------------------------------------------------------------------------------
const HEADING_PREFIX_RE = /^(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|INT\.?|EXT\.?|I\.?\/E\.?)\s+(\S.*)$/i;
const SCENE_NUMBER_RE = /\s*#([A-Za-z0-9][A-Za-z0-9.\-]{0,9})#\s*$/; // Fountain scene number: "INT. HOUSE - DAY #12A#"
const PAREN_RE = /^\s*\(.*\)\s*$/;
const PAGE_BREAK_PAREN_RE = /^\((?:MORE|CONT(?:'|’)?D|CONTINUED)\)$/i; // page-break artifacts inside dialogue
const TRANSITION_RE = /^\s*(CUT TO|FADE (IN|OUT)|FADE TO (BLACK|WHITE)|DISSOLVE TO|SMASH CUT|MATCH CUT|CUT TO BLACK|SMASH TO BLACK)[:.]?\s*$/i;
const TRANSITION_TO_RE = /^[A-Z][A-Z ]* TO:$/; // Fountain: any upper-case line ending in "TO:"
const TITLE_PAGE_RE = /^\s*(Title|Credit|Author|Authors|Source|Draft date|Date|Revision|Contact|Copyright|Notes|Format)\s*:/i;
const TIME_ALT = 'DAWN|DAY|DUSK|NIGHT|MORNING|AFTERNOON|EVENING|NOON|MIDNIGHT|SUNRISE|SUNSET|TWILIGHT|CONTINUOUS|MOMENTS LATER|LATER|SAME';
const TIME_WORDS = new RegExp(`\\b(${TIME_ALT})\\b`, 'i');
const TIME_ONLY_RE = new RegExp(`^(?:${TIME_ALT})$`, 'i');
const TIME_TRAILING_RE = new RegExp(`^(.*\\S)\\s+(${TIME_ALT})$`, 'i');

// A cue is an upper-case name. These upper-case lines are slugs / secondary headings, never a speaking character.
const CUE_NAME_RE = /^[\p{Lu}0-9][\p{Lu}0-9 .'’\-&#]{1,39}$/u;
const NON_CUE_RE = new RegExp('^(?:'
  + '(?:[A-Z0-9]+ ){0,3}LATER|LATER(?: [A-Z0-9]+){1,3}|CONTINUOUS|CONTINUED|SAME TIME|TIME CUT'
  + '|(?:BEGIN |START |END (?:OF )?)?(?:MONTAGE|FLASHBACK|INTERCUT|DREAM SEQUENCE|SERIES OF SHOTS|TITLES|CREDITS)(?: [A-Z0-9 \'\\-]+)?'
  + '|INTERCUT(?:TING)?(?: [A-Z0-9 \'\\-]+)?|BACK TO [A-Z0-9 \'\\-]+|THE END|END|END OF [A-Z0-9 ]+'
  + '|TITLE CARD|TITLE|SUPER|SUBTITLE|CHYRON|INSERT|FREEZE FRAME|SPLIT SCREEN|OMITTED|MORE'
  + '|BLACKNESS|DARKNESS|SILENCE|(?:CLOSE|ANGLE|TIGHT|WIDE) ON [A-Z0-9 \'\\-]+|[A-Z0-9\' ]+ POV|POV [A-Z0-9\' ]+'
  + ')$');
const OFF_SCREEN_RE = /(?:^|[^A-Za-z])(V\.?\s?O|O\.?\s?S|O\.?\s?C)\.?(?![A-Za-z])/i;
const OFF_SCREEN_WORDS = [[/\bVOICE[\s-]?OVER\b/i, 'V.O.'], [/\bOFF[\s-]?SCREEN\b/i, 'O.S.'], [/\bOFF[\s-]?CAMERA\b/i, 'O.C.']];
export const OFF_SCREEN_EXTENSIONS = Object.freeze(['V.O.', 'O.S.', 'O.C.']);

const WORDS_PER_SECOND = 2.6; // conversational dialogue pace used for the animatic estimate
const ACTION_SECONDS_PER_SENTENCE = 2.5;

// Fountain markup that is not story text: boneyard /* … */, notes [[ … ]], and emphasis markers.
// Linear scan (indexOf), so a 2 MB paste full of unclosed "/*" cannot stall the server.
function removeDelimited(text, open, close) {
  let out = '';
  for (let i = 0; ;) {
    const a = text.indexOf(open, i);
    const b = a < 0 ? -1 : text.indexOf(close, a + open.length);
    if (b < 0) return out + text.slice(i); // no (more) closed pairs: keep the rest as written
    out += text.slice(i, a);
    i = b + close.length;
  }
}
const stripComments = (text) => removeDelimited(removeDelimited(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), '/*', '*/'), '[[', ']]');
const stripEmphasis = (s) => {
  let out = s;
  // Spans are capped at 200 characters so the lazy match stays linear on hostile input ("*a *a *a …").
  for (let i = 0; i < 2; i++) out = out.replace(/(\*{1,3})(?=\S)(.{1,200}?)(?<=\S)\1/g, '$2').replace(/(?<![A-Za-z0-9])_(?=\S)(.{1,200}?)(?<=\S)_(?![A-Za-z0-9])/g, '$1');
  return out;
};

// "INT. LIGHTHOUSE - KITCHEN - MORNING (CONTINUOUS) #12#" → { int_ext, location, time, scene_number, heading }.
// `forced` is Fountain's leading "." (".BINOCULARS POV"), which needs no INT./EXT. prefix.
function parseHeading(trimmed) {
  let line = trimmed;
  const forced = /^\.[A-Za-z0-9]/.test(line);
  if (forced) line = line.slice(1).trim();
  let sceneNumber = null;
  const num = line.match(SCENE_NUMBER_RE);
  if (num) { sceneNumber = num[1]; line = line.slice(0, num.index).trim(); }
  const h = line.match(HEADING_PREFIX_RE);
  if (!h && !forced) return null;
  const intExt = h ? h[1].toUpperCase().replace(/[.\s]/g, '').replace(/^I\/E$/, 'INT/EXT') : null;
  const rest = h ? h[2] : line;
  const parens = [...rest.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  const segs = rest.replace(/\([^)]*\)/g, ' ').split(/\s+[-–—]\s+|\s+[-–—]$/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const times = [];
  // The time of day is the last dash-separated segment ("NIGHT CLUB - DAY" is a club, by day).
  if (segs.length > 1 && TIME_WORDS.test(segs[segs.length - 1])) {
    times.unshift(segs.pop());
    while (segs.length > 1 && TIME_ONLY_RE.test(segs[segs.length - 1])) times.unshift(segs.pop()); // "HOUSE - DAY - LATER"
  } else if (segs.length === 1) {
    const m = segs[0].match(TIME_TRAILING_RE); // "EXT. BEACH NIGHT"
    if (m) { segs[0] = m[1].trim(); times.push(m[2]); }
  }
  if (!times.length) { const p = parens.find((x) => TIME_WORDS.test(x)); if (p) times.push(p); }
  return {
    heading: line.toUpperCase(), int_ext: intExt, location: segs.join(' - ') || 'Unknown',
    time: times.length ? times.join(' - ').toUpperCase() : null, scene_number: sceneNumber,
  };
}

// "TOMAS (V.O.)", "MARA (CONT'D)", "DR. SMITH", "@McCLANE", "TOMAS ^" → { name, extension, dual } or null.
function parseCue(trimmed) {
  let s = trimmed;
  const forced = s.startsWith('@');
  if (forced) s = s.slice(1).trim();
  let dual = false;
  if (/\^$/.test(s)) { dual = true; s = s.replace(/\s*\^$/, ''); } // Fountain dual dialogue
  const exts = [];
  for (let m = s.match(/\s*\(([^()]{1,40})\)$/); m; m = s.match(/\s*\(([^()]{1,40})\)$/)) { exts.unshift(m[1].trim()); s = s.slice(0, m.index); }
  const name = s.trim();
  if (!name) return null;
  if (!forced) {
    if (!CUE_NAME_RE.test(name) || !/\p{Lu}/u.test(name)) return null;
    if (/[.!?]$/.test(name) && !/\b(?:JR|SR)\.$/.test(name)) return null; // "SILENCE.", "BANG!" are action
    if (name.split(/\s+/).length > 4) return null;
    if (/^(?:INT|EXT)\b/.test(name) || NON_CUE_RE.test(name)) return null;
    if (exts.some((e) => e !== e.toUpperCase() && !/^cont(?:'|’)?d$/i.test(e))) return null; // "(20s, soaked)" is description
  }
  let extension = null;
  for (const e of exts) {
    const m = e.match(OFF_SCREEN_RE);
    if (m) { const k = m[1].toUpperCase().replace(/[^A-Z]/g, ''); extension = `${k[0]}.${k[1]}.`; break; }
    const w = OFF_SCREEN_WORDS.find(([re]) => re.test(e));
    if (w) { extension = w[1]; break; }
  }
  return { name, extension, dual };
}

export function parseScreenplay(text) {
  const lines = stripComments(String(text || '')).split('\n').map((l) => l.replace(/\t/g, '    ').trim());
  const scenes = [];
  let scene = null;
  let dialogueBuf = null;
  let openAction = null; // action paragraph still being continued by the next line
  let titlePage = null;  // null = not decided yet, true = inside the Fountain title page, false = past it

  const flushDialogue = () => {
    if (dialogueBuf && dialogueBuf.text.trim()) scene.elements.push(dialogueBuf);
    dialogueBuf = null;
  };
  const ensureScene = () => {
    if (!scene) { scene = { number: scenes.length + 1, heading: 'UNTITLED SCENE', int_ext: null, location: 'Unknown', time: null, elements: [] }; scenes.push(scene); }
  };
  const addAction = (raw) => {
    const t = stripEmphasis(raw).trim();
    if (!t) return;
    ensureScene();
    if (openAction) openAction.text += ' ' + t;
    else { openAction = { type: 'action', text: t }; scene.elements.push(openAction); }
  };
  const isTransition = (s) => TRANSITION_RE.test(s) || TRANSITION_TO_RE.test(s) || (s.startsWith('>') && !s.endsWith('<'));
  // Directly under a cue only an upper-case heading counts; "Int. means interior." there is a line of dialogue.
  const isHeadingInDialogue = (s) => s === s.toUpperCase() && !s.startsWith('.') && !!parseHeading(s);
  const isStructuralLine = (s) => isHeadingInDialogue(s) || isTransition(s) || PAGE_BREAK_PAREN_RE.test(s) || /^[#=]/.test(s);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i];
    if (!trimmed) { flushDialogue(); openAction = null; if (titlePage) titlePage = false; continue; }
    if (titlePage === null) titlePage = !scene && TITLE_PAGE_RE.test(trimmed);
    // Title page: key: value lines and their indented continuation lines, up to the first blank line or heading.
    if (titlePage) { if (isHeadingInDialogue(trimmed)) titlePage = false; else continue; }
    if (!scene && TITLE_PAGE_RE.test(trimmed)) continue;
    if (/^[#=]/.test(trimmed)) { flushDialogue(); openAction = null; continue; } // sections, synopses, page breaks
    if (isTransition(trimmed)) { flushDialogue(); openAction = null; continue; }

    // Scene heading. Inside a dialogue block only an upper-case line counts, so "Int. means interior." stays a line.
    // A forced ".HEADING" needs a blank line above it, so ".38 on the table" inside a paragraph stays action.
    const forcedMidParagraph = trimmed.startsWith('.') && i > 0 && !!lines[i - 1];
    const h = !forcedMidParagraph && (!dialogueBuf || isHeadingInDialogue(trimmed)) ? parseHeading(trimmed) : null;
    if (h) {
      flushDialogue(); openAction = null;
      scene = { number: scenes.length + 1, heading: h.heading, int_ext: h.int_ext, location: h.location, time: h.time, elements: [] };
      if (h.scene_number) scene.scene_number = h.scene_number;
      scenes.push(scene);
      continue;
    }

    if (dialogueBuf) {
      if (PAGE_BREAK_PAREN_RE.test(trimmed)) continue;
      if (PAREN_RE.test(trimmed)) { dialogueBuf.parentheticals.push(trimmed.slice(1, -1).trim()); continue; }
      const t = stripEmphasis(trimmed.replace(/^~\s*/, '')).trim(); // "~" marks a lyric line
      if (t) dialogueBuf.text += (dialogueBuf.text ? ' ' : '') + t;
      continue;
    }

    if (trimmed.startsWith('!')) { addAction(trimmed.slice(1)); continue; } // Fountain forced action
    if (trimmed.startsWith('>') && trimmed.endsWith('<')) { addAction(trimmed.slice(1, -1)); continue; } // centered text

    // Character cue: an upper-case name with dialogue on the very next line. A cue with nothing under it is action.
    const next = lines[i + 1] || '';
    const cue = next && !isStructuralLine(next) ? parseCue(trimmed) : null;
    if (cue) {
      ensureScene(); openAction = null;
      dialogueBuf = { type: 'dialogue', character: cue.name, text: '', parentheticals: [] };
      if (cue.extension) dialogueBuf.extension = cue.extension;
      if (cue.dual) dialogueBuf.dual = true;
      continue;
    }
    addAction(trimmed.replace(/^~\s*/, ''));
  }
  flushDialogue();
  return { scenes, characters: collectCharacters(scenes), locations: [...new Set(scenes.map((s) => s.location))] };
}

function collectCharacters(scenes) {
  const counts = new Map();
  for (const s of scenes) for (const e of s.elements) if (e.type === 'dialogue') counts.set(e.character, (counts.get(e.character) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, lines]) => ({ name, lines }));
}

// Sentence split that keeps "Dr. Smith" and "He waits... then runs." in one piece.
const TITLE_ABBREVS = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'sgt', 'cpl', 'capt', 'lt', 'col', 'gen', 'det', 'rev', 'sen', 'gov', 'st', 'mt']);
const endsWithTitle = (s) => { const m = s.slice(-6).match(/(?:^|[\s("'])([A-Z][A-Za-z]{1,3})\.$/); return !!m && TITLE_ABBREVS.has(m[1].toLowerCase()); };
function sentences(t) {
  const groups = []; // pieces are joined once at the end, so a hostile "Dr. Dr. Dr. …" line stays linear
  let prev = '';
  for (const part of String(t).split(/(?<=[.!?])\s+(?![a-z])/).filter(Boolean)) {
    if (groups.length && endsWithTitle(prev)) groups[groups.length - 1].push(part);
    else groups.push([part]);
    prev = part;
  }
  return groups.map((g) => g.join(' ')).filter((s) => /[\p{L}\p{N}]/u.test(s));
}
const estimateDialogueSeconds = (text) => Math.max(1.5, Math.round((text.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND) * 10) / 10);

// ---- coverage rules ----------------------------------------------------------------------------------------------
// Keyword → camera language. Order matters: the first match wins. Move labels come from MOVE_PRESETS[preset].
const ACTION_RULES = [
  { re: /\b(runs?|running|sprints?|chas(e|ing)|flee|dash(es)?)\b/i, size: 'Medium wide', lens: 24, preset: 'tracking_handheld', energy: 'high' },
  { re: /\b(explo(des?|sion)|crash(es)?|collaps(es?|ing)|shatters?|blast)\b/i, size: 'Wide', lens: 18, preset: 'crash_zoom', energy: 'high' },
  { re: /\b(fights?|punch(es)?|kicks?|swings?|strikes?|duel)\b/i, size: 'Medium', lens: 35, preset: 'orbit_handheld', energy: 'high' },
  { re: /\b(falls?|drops?|tumbles?|plunges?)\b/i, size: 'Wide', lens: 24, preset: 'crane_down', energy: 'medium' },
  { re: /\b(looks? (up|out|down)|stares?|gazes?|watch(es)?)\b/i, size: 'Close-up', lens: 85, preset: 'push_in', energy: 'low' },
  { re: /\b(walks?|enters?|steps?|approach(es)?|crosses)\b/i, size: 'Medium wide', lens: 35, preset: 'dolly_follow', energy: 'medium' },
  { re: /\b(picks? up|holds?|grabs?|opens?|reads?|types?|presses|hands?)\b/i, size: 'Insert', lens: 100, preset: 'static', energy: 'low' },
  { re: /\b(sits?|waits?|sleeps?|lies|breathes?)\b/i, size: 'Medium', lens: 50, preset: 'static', energy: 'low' },
  { re: /\b(city|skyline|landscape|horizon|ocean|mountain|forest|desert|valley|rooftops?)\b/i, size: 'Extreme wide', lens: 14, preset: 'aerial_drift', energy: 'low' },
];
const DEFAULT_ACTION_RULE = { size: 'Medium', lens: 35, preset: 'static', energy: 'low' };
const camera = (preset) => ({ move: MOVE_PRESETS[preset], preset });
const clip = (t, n = 90) => (t.length > n ? t.slice(0, n - 3) + '…' : t);
const NO_SUBJECT = 'Scene';

export function proposeShots(parsed) {
  const shots = [];
  let n = 0;
  const push = (scene, shot) => {
    n += 1;
    shots.push({ id: `S${String(scene.number).padStart(2, '0')}-${String(n).padStart(3, '0')}`, scene: scene.number, scene_heading: scene.heading, status: SHOT_STATUSES[0], ...shot });
  };
  for (const scene of parsed.scenes) {
    const isExt = /EXT/.test(scene.int_ext || '');
    push(scene, {
      size: isExt ? 'Extreme wide' : 'Wide', ...camera(isExt ? 'aerial_drift' : 'push_in'), lens_mm: isExt ? 18 : 24,
      duration_s: 3, subject: scene.location, description: `Establishing: ${scene.heading}`, energy: 'low', source: 'scene_heading', prompt: '',
    });
    let side = 0; // alternate OTS sides for on-camera dialogue
    const onScreen = []; // subjects seen so far in this scene, most recent last
    for (const el of scene.elements) {
      if (el.type === 'action') {
        for (const sentence of sentences(el.text)) {
          const rule = ACTION_RULES.find((r) => r.re.test(sentence)) || DEFAULT_ACTION_RULE;
          const subject = subjectOf(sentence, parsed.characters);
          if (subject !== NO_SUBJECT) onScreen.push(subject);
          push(scene, { size: rule.size, ...camera(rule.preset), lens_mm: rule.lens, duration_s: ACTION_SECONDS_PER_SENTENCE, subject, description: sentence.trim(), energy: rule.energy, source: 'action', prompt: '' });
        }
      } else if (el.type === 'dialogue' && OFF_SCREEN_EXTENSIONS.includes(el.extension)) {
        // Voice-over / off-screen line: the speaker is not on camera, so stay on whoever (or whatever) is.
        // A narrator (V.O.) may be the person we are looking at; an O.S./O.C. speaker is by definition not.
        const seen = el.extension === 'V.O.' ? onScreen : onScreen.filter((s) => s !== el.character);
        push(scene, {
          size: 'Medium', ...camera('static'), lens_mm: 50, duration_s: estimateDialogueSeconds(el.text),
          subject: seen.length ? seen[seen.length - 1] : scene.location, speaker: el.character, extension: el.extension, off_screen: true,
          description: `${el.character} (${el.extension}): "${clip(el.text)}"`, energy: 'low', source: 'dialogue', prompt: '',
        });
      } else if (el.type === 'dialogue') {
        side ^= 1;
        const quiet = el.parentheticals.some((p) => /whisper|quiet|soft|beat/i.test(p));
        onScreen.push(el.character);
        push(scene, {
          size: quiet ? 'Close-up' : 'Medium (over-the-shoulder)', ...camera('static'), lens_mm: quiet ? 85 : 50,
          duration_s: estimateDialogueSeconds(el.text), subject: el.character, speaker: el.character, description: `${el.character}: "${clip(el.text)}"`,
          energy: 'low', source: 'dialogue', ots_side: side ? 'camera left' : 'camera right', prompt: '',
        });
      }
    }
  }
  for (const s of shots) s.prompt = promptFor(s);
  return shots;
}

const CAPS_STOPWORDS = new Set(['THE', 'AND', 'BUT', 'FOR', 'WITH', 'INT', 'EXT', 'END', 'CUT', 'FADE', 'SUPER', 'LATER', 'BACK', 'SCENE', 'TITLE', 'MONTAGE', 'INTERCUT', 'CONTINUOUS', 'POV']);
function subjectOf(sentence, characters) {
  const hit = characters.find((c) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(c.name)}(?![\\p{L}\\p{N}])`, 'iu').test(sentence));
  if (hit) return hit.name;
  const caps = (sentence.match(/\b[A-Z][A-Z]{2,}\b/g) || []).find((w) => !CAPS_STOPWORDS.has(w));
  return caps || NO_SUBJECT;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Lighting cue from the time-of-day part of a heading (the last dash segment), matched on whole words so that
// "KNIGHT'S HALL - DAY" and "NIGHT CLUB - DAY" are not lit as night.
function lightFor(heading) {
  const h = String(heading || '').toUpperCase();
  const tail = h.split(/\s[-–—]\s/).pop();
  const src = TIME_WORDS.test(tail) ? tail : h;
  if (/\b(NIGHT|MIDNIGHT|DUSK|TWILIGHT)\b/.test(src)) return 'low-key night lighting';
  if (/\b(DAWN|MORNING|SUNRISE|SUNSET)\b/.test(src)) return 'soft golden-hour light';
  return 'natural daylight';
}

// A prompt in the style video models expect: subject + action, shot size, camera move, lens, lighting cue.
export function promptFor(shot) {
  const desc = String(shot.description ?? '').replace(/^Establishing: /, '').replace(/[.!?]+$/, '');
  // An off-screen line must not put the speaker in frame: lead with who is actually on camera.
  const lead = shot.off_screen && shot.subject ? `${shot.subject} on screen, speaker not on camera. ${desc}` : desc;
  return `${lead}. ${shot.size} shot, ${String(shot.move || MOVE_PRESETS.static).toLowerCase()}, ${shot.lens_mm}mm lens, ${lightFor(shot.scene_heading)}, cinematic, 24fps.`;
}

export function breakdown(text, { title = 'Untitled' } = {}) {
  const parsed = parseScreenplay(text);
  const shots = proposeShots(parsed);
  const props = extractProps(parsed);
  const total = Math.round(shots.reduce((a, s) => a + s.duration_s, 0) * 10) / 10;
  return {
    schema: SHOTLIST_SCHEMA, title, created_at: new Date().toISOString(), method: 'rule-based (no LLM)',
    estimate_note: 'Durations and lenses are first-pass previs estimates from the text, not measurements.',
    scenes: parsed.scenes.map((s) => ({ number: s.number, heading: s.heading, int_ext: s.int_ext, location: s.location, time: s.time, ...(s.scene_number ? { scene_number: s.scene_number } : {}), elements: s.elements.length, shots: shots.filter((x) => x.scene === s.number).length })),
    characters: parsed.characters, locations: parsed.locations, props, shots, total_duration_s: total,
  };
}

const PROP_WORDS = /\b(gun|pistol|rifle|sword|knife|phone|letter|key|keys|map|book|lantern|torch|lamp|car|truck|bike|motorcycle|helmet|flask|bottle|potion|cup|glass|bag|backpack|suitcase|camera|laptop|computer|radio|badge|coin|ring|photograph|photo|umbrella|cigarette|watch|box|crate|door|window|table|chair)\b/gi;
function extractProps(parsed) {
  const counts = new Map();
  for (const s of parsed.scenes) for (const e of s.elements) if (e.type === 'action') for (const m of e.text.matchAll(PROP_WORDS)) {
    const k = m[0].toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, mentions]) => ({ name, mentions }));
}

// CSV in the column order most shot-list templates use (one row per shot). RFC 4180 quoting. Text cells that a
// spreadsheet would run as a formula (leading = + - @, tab or CR) get a leading apostrophe.
export function shotlistCsv(bd) {
  const cols = ['id', 'scene', 'scene_heading', 'size', 'move', 'lens_mm', 'duration_s', 'subject', 'description', 'status', 'prompt'];
  const q = (v) => {
    const s = String(v ?? '');
    return `"${(typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  return [cols.join(','), ...(bd.shots || []).map((s) => cols.map((c) => q(s[c])).join(','))].join('\n') + '\n';
}

// ---- Sequencer plan --------------------------------------------------------------------------------------------------
// Blocking plan for the Unreal Sequencer builder: a camera per shot, distance from the shot size, spread around the
// subject mark of that shot's location. Every distinct scene location gets its own stage, STAGE_SPACING_CM apart
// along +X in order of first appearance, so sets do not sit on top of each other in the level. camera_start,
// camera_end and look_at are absolute world coordinates (stage origin already added). Pure geometry so the Python
// script stays dumb and testable.
export const STAGE_SPACING_CM = 5000;
const LOOK_AT_HEIGHT_CM = 150;
const CRANE_TRAVEL_CM = 400;

const locationKey = (s) => String(s || 'Unknown').trim().toUpperCase().replace(/\s+/g, ' ') || 'UNKNOWN';
const posNum = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fallback; };

export function sequencerPlan(bd, { fps = 24 } = {}) {
  const rate = posNum(fps, 24);
  const sceneLocation = new Map((bd.scenes || []).map((s) => [s.number, s.location]));
  const locationOf = (shot) => sceneLocation.get(shot.scene) || parseHeading(String(shot.scene_heading || ''))?.location || 'Unknown';
  const stages = [];
  const stageByKey = new Map();
  const stageFor = (location) => {
    const key = locationKey(location);
    if (!stageByKey.has(key)) { const st = { location, origin: { x: stages.length * STAGE_SPACING_CM, y: 0, z: 0 } }; stageByKey.set(key, st); stages.push(st); }
    return stageByKey.get(key);
  };
  let frame = 0;
  const shots = (bd.shots || []).map((s, i) => {
    const stage = stageFor(locationOf(s));
    const o = stage.origin;
    const frames = Math.max(1, Math.round(posNum(s.duration_s, 0) * rate));
    const angle = ((i * 47) % 360) * Math.PI / 180; // spread cameras around the subject so cuts read as coverage
    const dist = DISTANCE_BY_SIZE.get(normLabel(s.size)) || 400;
    const side = s.ots_side === 'camera left' ? -1 : 1;
    // `move` is what the reviewer edits, so the camera path follows it; a stored `preset` can be stale.
    const preset = s.move ? presetForMove(s.move) : (Object.hasOwn(MOVE_PRESETS, s.preset) ? s.preset : 'static');
    const { start, end } = cameraPath({ x: Math.round(Math.cos(angle) * dist), y: Math.round(Math.sin(angle) * dist * side), z: normLabel(s.size) === 'extreme wide' ? 900 : 160 }, preset);
    const world = (p) => ({ x: p.x + o.x, y: p.y + o.y, z: p.z + o.z });
    const out = {
      id: s.id, start_frame: frame, end_frame: frame + frames, focal_length_mm: posNum(s.lens_mm, 35),
      camera_start: world(start), camera_end: world(end), look_at: world({ x: 0, y: 0, z: LOOK_AT_HEIGHT_CM }),
      label: String(s.description ?? ''), location: stage.location, stage_origin: { ...o }, move: MOVE_PRESETS[preset], preset,
    };
    frame += frames;
    return out;
  });
  return {
    schema: SEQUENCER_PLAN_SCHEMA, plan_version: SEQUENCER_PLAN_VERSION, fps: rate, total_frames: frame,
    coordinates: 'absolute world cm; each shot is blocked around stage_origin for its location',
    subject_mark: { x: 0, y: 0, z: 0 }, // first stage's mark, kept for plan_version 1 readers; use shots[].stage_origin
    stage_spacing_cm: STAGE_SPACING_CM, stages: stages.map((st) => ({ location: st.location, origin: { ...st.origin } })), shots,
  };
}

// Camera start/end relative to the subject mark of the stage (the mark is at 0,0).
function cameraPath(base, preset) {
  const f = (k) => ({ ...base, ...k });
  switch (preset) {
    case 'push_in': return { start: base, end: f({ x: Math.round(base.x * 0.75), y: Math.round(base.y * 0.75) }) };
    case 'dolly_follow': case 'tracking_handheld': return { start: base, end: f({ y: base.y + 300 }) };
    case 'crane_down': return { start: f({ z: base.z + CRANE_TRAVEL_CM }), end: base }; // starts high, descends
    case 'aerial_drift': return { start: base, end: f({ x: base.x + 400, y: base.y - 400 }) };
    case 'orbit_handheld': { const a = Math.atan2(base.y, base.x) + 0.6; const r = Math.hypot(base.x, base.y); return { start: base, end: f({ x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) }) }; }
    case 'crash_zoom': return { start: base, end: f({ x: Math.round(base.x * 0.4), y: Math.round(base.y * 0.4) }) };
    default: return { start: base, end: { ...base } };
  }
}
