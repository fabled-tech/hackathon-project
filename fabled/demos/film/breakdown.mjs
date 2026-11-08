// Fabled Shots: screenplay → scene breakdown → proposed shot list → animatic timing → Unreal Sequencer plan.
//
// This is a deterministic, rule-based breakdown (no LLM, no network). It reads Fountain-style / screenplay-style
// text: scene headings (INT./EXT.), action paragraphs, CHARACTER cues, dialogue and (parentheticals). From that it
// proposes coverage per scene the way a first-pass previs artist would: an establishing wide, alternating
// over-the-shoulder / medium coverage for dialogue, and tracking or insert shots for action beats. Every number it
// produces (durations, lenses) is a planning estimate and is labeled as such in the UI. An LLM "director pass" can
// replace proposeShots() later; the shot-list schema (fabled.shotlist/0.1) is what the exporters depend on.

export const SHOTLIST_SCHEMA = 'fabled.shotlist/0.1';

const HEADING_RE = /^\s*(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?)\s+(.+?)(?:\s+[-–—]\s+(.+))?\s*$/i;
const CUE_RE = /^\s*([A-Z][A-Z0-9 .'\-]{1,40}?)(\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D|cont'd)\))?\s*$/;
const PAREN_RE = /^\s*\(.*\)\s*$/;
const TRANSITION_RE = /^\s*(CUT TO|FADE (IN|OUT)|DISSOLVE TO|SMASH CUT|MATCH CUT)[:.]?\s*$/i;
const TITLE_PAGE_RE = /^\s*(Title|Credit|Author|Authors|Source|Draft date|Contact|Copyright|Notes|Format)\s*:/i;

// Keyword → camera language. Order matters: the first match wins.
const ACTION_RULES = [
  { re: /\b(runs?|running|sprints?|chas(e|ing)|flee|dash(es)?)\b/i, size: 'Medium wide', move: 'Tracking (handheld)', lens: 24, preset: 'tracking_handheld', energy: 'high' },
  { re: /\b(explo(des?|sion)|crash(es)?|collaps(es?|ing)|shatters?|blast)\b/i, size: 'Wide', move: 'Crash zoom', lens: 18, preset: 'crash_zoom', energy: 'high' },
  { re: /\b(fights?|punch(es)?|kicks?|swings?|strikes?|duel)\b/i, size: 'Medium', move: 'Handheld orbit', lens: 35, preset: 'orbit_handheld', energy: 'high' },
  { re: /\b(falls?|drops?|tumbles?|plunges?)\b/i, size: 'Wide', move: 'Crane down', lens: 24, preset: 'crane_down', energy: 'medium' },
  { re: /\b(looks? (up|out|down)|stares?|gazes?|watch(es)?)\b/i, size: 'Close-up', move: 'Slow push-in', lens: 85, preset: 'push_in', energy: 'low' },
  { re: /\b(walks?|enters?|steps?|approach(es)?|crosses)\b/i, size: 'Medium wide', move: 'Dolly follow', lens: 35, preset: 'dolly_follow', energy: 'medium' },
  { re: /\b(picks? up|holds?|grabs?|opens?|reads?|types?|presses|hands?)\b/i, size: 'Insert', move: 'Static (locked off)', lens: 100, preset: 'static', energy: 'low' },
  { re: /\b(sits?|waits?|sleeps?|lies|breathes?)\b/i, size: 'Medium', move: 'Static (locked off)', lens: 50, preset: 'static', energy: 'low' },
  { re: /\b(city|skyline|landscape|horizon|ocean|mountain|forest|desert|valley|rooftops?)\b/i, size: 'Extreme wide', move: 'Aerial drift', lens: 14, preset: 'aerial_drift', energy: 'low' },
];

const TIME_WORDS = /\b(DAWN|DAY|DUSK|NIGHT|MORNING|EVENING|CONTINUOUS|LATER|MOMENTS LATER|SAME)\b/i;
const WORDS_PER_SECOND = 2.6; // conversational dialogue pace used for the animatic estimate
const ACTION_SECONDS_PER_SENTENCE = 2.5;

export function parseScreenplay(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const scenes = [];
  let scene = null;
  let pendingCue = null;
  let dialogueBuf = null;

  const flushDialogue = () => {
    if (dialogueBuf && dialogueBuf.text.trim()) scene.elements.push(dialogueBuf);
    dialogueBuf = null;
  };
  const ensureScene = () => {
    if (!scene) { scene = { number: scenes.length + 1, heading: 'UNTITLED SCENE', int_ext: null, location: 'Unknown', time: null, elements: [] }; scenes.push(scene); }
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');
    const trimmed = line.trim();
    if (!trimmed) { flushDialogue(); pendingCue = null; if (scene) { const l = scene.elements[scene.elements.length - 1]; if (l && l.type === 'action') l.closed = true; } continue; }
    if (TRANSITION_RE.test(trimmed)) { flushDialogue(); pendingCue = null; continue; }
    if (!scene && TITLE_PAGE_RE.test(trimmed)) continue; // Fountain title page
    const h = trimmed.match(HEADING_RE);
    if (h && !pendingCue) {
      flushDialogue();
      const rest = `${h[2]}${h[3] ? ' - ' + h[3] : ''}`;
      const time = (rest.match(TIME_WORDS) || [])[0] || null;
      const location = rest.replace(/\([^)]*\)/g, '').replace(TIME_WORDS, '').replace(/\s*[-–—]\s*$/, '').replace(/\s+/g, ' ').trim() || h[2].trim();
      scene = { number: scenes.length + 1, heading: trimmed.toUpperCase(), int_ext: h[1].toUpperCase().replace(/\.$/, ''), location, time: time ? time.toUpperCase() : null, elements: [] };
      scenes.push(scene);
      continue;
    }
    ensureScene();
    if (dialogueBuf) {
      if (PAREN_RE.test(trimmed)) { dialogueBuf.parentheticals.push(trimmed.slice(1, -1)); continue; }
      dialogueBuf.text += (dialogueBuf.text ? ' ' : '') + trimmed;
      continue;
    }
    if (pendingCue) {
      if (PAREN_RE.test(trimmed)) { dialogueBuf = { type: 'dialogue', character: pendingCue, text: '', parentheticals: [trimmed.slice(1, -1)] }; pendingCue = null; continue; }
      dialogueBuf = { type: 'dialogue', character: pendingCue, text: trimmed, parentheticals: [] };
      pendingCue = null;
      continue;
    }
    const cue = trimmed.match(CUE_RE);
    if (cue && trimmed === trimmed.toUpperCase() && !/^(INT|EXT)\b/.test(trimmed) && trimmed.split(/\s+/).length <= 4) {
      pendingCue = cue[1].trim();
      continue;
    }
    const last = scene.elements[scene.elements.length - 1];
    if (last && last.type === 'action' && !last.closed) last.text += ' ' + trimmed;
    else scene.elements.push({ type: 'action', text: trimmed });
  }
  flushDialogue();
  for (const s of scenes) for (const e of s.elements) delete e.closed;
  return { scenes, characters: collectCharacters(scenes), locations: [...new Set(scenes.map((s) => s.location))] };
}

function collectCharacters(scenes) {
  const counts = new Map();
  for (const s of scenes) for (const e of s.elements) if (e.type === 'dialogue') counts.set(e.character, (counts.get(e.character) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, lines]) => ({ name, lines }));
}

const sentences = (t) => String(t).split(/(?<=[.!?])\s+/).filter(Boolean);
const estimateDialogueSeconds = (text) => Math.max(1.5, Math.round((text.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND) * 10) / 10);

export function proposeShots(parsed) {
  const shots = [];
  let n = 0;
  const push = (scene, shot) => {
    n += 1;
    shots.push({ id: `S${String(scene.number).padStart(2, '0')}-${String(n).padStart(3, '0')}`, scene: scene.number, scene_heading: scene.heading, status: 'proposed', ...shot });
  };
  for (const scene of parsed.scenes) {
    const isExt = /EXT/.test(scene.int_ext || '');
    push(scene, {
      size: isExt ? 'Extreme wide' : 'Wide', move: isExt ? 'Aerial drift' : 'Slow push-in', lens_mm: isExt ? 18 : 24, preset: isExt ? 'aerial_drift' : 'push_in',
      duration_s: 3, subject: scene.location, description: `Establishing: ${scene.heading}`, energy: 'low', source: 'scene_heading', prompt: '',
    });
    let side = 0; // alternate OTS sides for dialogue
    for (const el of scene.elements) {
      if (el.type === 'action') {
        const sents = sentences(el.text);
        for (const sentence of sents) {
          const rule = ACTION_RULES.find((r) => r.re.test(sentence)) || { size: 'Medium', move: 'Static (locked off)', lens: 35, preset: 'static', energy: 'low' };
          push(scene, { size: rule.size, move: rule.move, lens_mm: rule.lens, preset: rule.preset, duration_s: ACTION_SECONDS_PER_SENTENCE, subject: subjectOf(sentence, parsed.characters), description: sentence.trim(), energy: rule.energy, source: 'action', prompt: '' });
        }
      } else if (el.type === 'dialogue') {
        side ^= 1;
        const quiet = el.parentheticals.some((p) => /whisper|quiet|soft|beat/i.test(p));
        push(scene, {
          size: quiet ? 'Close-up' : 'Medium (over-the-shoulder)', move: 'Static (locked off)', lens_mm: quiet ? 85 : 50, preset: 'static',
          duration_s: estimateDialogueSeconds(el.text), subject: el.character, description: `${el.character}: "${el.text.length > 90 ? el.text.slice(0, 87) + '…' : el.text}"`,
          energy: 'low', source: 'dialogue', ots_side: side ? 'camera left' : 'camera right', prompt: '',
        });
      }
    }
  }
  for (const s of shots) s.prompt = promptFor(s);
  return shots;
}

function subjectOf(sentence, characters) {
  const hit = characters.find((c) => new RegExp(`\\b${escapeRe(c.name)}\\b`, 'i').test(sentence));
  if (hit) return hit.name;
  const caps = sentence.match(/\b[A-Z][A-Z]{2,}\b/);
  return caps ? caps[0] : 'Scene';
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A prompt in the style video models expect: subject + action, shot size, camera move, lens, lighting cue.
export function promptFor(shot) {
  const light = /NIGHT|DUSK/.test(shot.scene_heading) ? 'low-key night lighting' : /DAWN|MORNING/.test(shot.scene_heading) ? 'soft golden-hour light' : 'natural daylight';
  return `${shot.description.replace(/^Establishing: /, '').replace(/[.!?]+$/, '')}. ${shot.size} shot, ${shot.move.toLowerCase()}, ${shot.lens_mm}mm lens, ${light}, cinematic, 24fps.`;
}

export function breakdown(text, { title = 'Untitled' } = {}) {
  const parsed = parseScreenplay(text);
  const shots = proposeShots(parsed);
  const props = extractProps(parsed);
  const total = Math.round(shots.reduce((a, s) => a + s.duration_s, 0) * 10) / 10;
  return {
    schema: SHOTLIST_SCHEMA, title, created_at: new Date().toISOString(), method: 'rule-based (no LLM)',
    estimate_note: 'Durations and lenses are first-pass previs estimates from the text, not measurements.',
    scenes: parsed.scenes.map((s) => ({ number: s.number, heading: s.heading, int_ext: s.int_ext, location: s.location, time: s.time, elements: s.elements.length, shots: shots.filter((x) => x.scene === s.number).length })),
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

// CSV in the column order most shot-list templates use (one row per shot). RFC 4180 quoting.
export function shotlistCsv(bd) {
  const cols = ['id', 'scene', 'scene_heading', 'size', 'move', 'lens_mm', 'duration_s', 'subject', 'description', 'status', 'prompt'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...bd.shots.map((s) => cols.map((c) => q(s[c])).join(','))].join('\n') + '\n';
}

// Blocking plan for the Unreal Sequencer builder: a camera per shot on a 10 m stage, distance from lens/size,
// orbiting around the subject mark. Pure geometry so the Python script stays dumb and testable.
const SIZE_DISTANCE_CM = { 'Extreme wide': 2500, 'Wide': 1200, 'Medium wide': 600, 'Medium': 350, 'Medium (over-the-shoulder)': 300, 'Close-up': 150, 'Insert': 90 };
export function sequencerPlan(bd, { fps = 24 } = {}) {
  let frame = 0;
  const shots = bd.shots.map((s, i) => {
    const frames = Math.max(1, Math.round(s.duration_s * fps));
    const angle = ((i * 47) % 360) * Math.PI / 180; // spread cameras around the subject so cuts read as coverage
    const dist = SIZE_DISTANCE_CM[s.size] || 400;
    const side = s.ots_side === 'camera left' ? -1 : 1;
    const start = { x: Math.round(Math.cos(angle) * dist), y: Math.round(Math.sin(angle) * dist * side), z: s.size === 'Extreme wide' ? 900 : 160 };
    const end = moveEnd(start, s.preset);
    const out = { id: s.id, start_frame: frame, end_frame: frame + frames, focal_length_mm: s.lens_mm, camera_start: start, camera_end: end, look_at: { x: 0, y: 0, z: 150 }, label: s.description };
    frame += frames;
    return out;
  });
  return { schema: 'fabled.sequencer_plan/0.1', fps, total_frames: frame, subject_mark: { x: 0, y: 0, z: 0 }, shots };
}
function moveEnd(start, preset) {
  const f = (k) => ({ ...start, ...k });
  switch (preset) {
    case 'push_in': return f({ x: Math.round(start.x * 0.75), y: Math.round(start.y * 0.75) });
    case 'dolly_follow': case 'tracking_handheld': return f({ y: start.y + 300 });
    case 'crane_down': return f({ z: start.z + 400 });
    case 'aerial_drift': return f({ x: start.x + 400, y: start.y - 400 });
    case 'orbit_handheld': { const a = Math.atan2(start.y, start.x) + 0.6; const r = Math.hypot(start.x, start.y); return f({ x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) }); }
    case 'crash_zoom': return f({ x: Math.round(start.x * 0.4), y: Math.round(start.y * 0.4) });
    default: return { ...start };
  }
}
