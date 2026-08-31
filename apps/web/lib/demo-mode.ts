import type { ProductionMemberInput } from '@rightsrader/api-client';

export const DEMO_CHOICE_KEY = 'rightsrader.demo.choice';
export const DEMO_LAST_SCRIPT_KEY = 'rightsrader.demo.lastScriptId';
export const DEMO_USED_SCRIPTS_KEY = 'rightsrader.demo.usedScriptIds';
export const DEMO_PRODUCTION_TITLE = 'RightsRadar Demo Desk';

export type DemoChoice = 'walkthrough' | 'self-serve';

export type DemoScriptCategory =
  | 'brand'
  | 'likeness'
  | 'quotation'
  | 'music'
  | 'location'
  | 'franchise'
  | 'character';

export type DemoScript = {
  id: string;
  category: DemoScriptCategory;
  title: string;
  script: string;
};

export const DEMO_ROSTER: ProductionMemberInput[] = [
  { name: 'Jordan', role: 'clearance' },
  { name: 'Alex', role: 'production' },
  { name: 'Maya', role: 'legal' }
];

/** Official two-lane demo: one brand lead and one quote lead so two Research lanes fire. */
export const DEMO_TWO_LEAD_SCRIPT: DemoScript = {
  id: 'nimbus-reel-two-lane',
  category: 'brand',
  title: 'Brand and quote on the skywalk',
  script:
    'EXT. NEON SKYWALK — MIDNIGHT\n\nMARA skates through the rain, kicks a Nimbus Soda can into her palm, and smirks. "Time keeps the reel turning," she says as a drone camera dives past.'
};

/** Franchise + quote homage: the classic layered-IP sample judges expect on the desk. */
export const DEMO_MATRIX_SCRIPT: DemoScript = {
  id: 'matrix-rooftop-homage',
  category: 'franchise',
  title: 'The Matrix rooftop homage',
  script:
    'INT. GREENSCREEN STAGE — NIGHT\n\nSecond unit hangs a forty-foot The Matrix one-sheet behind the coat-and-shades hero. The AD marks the rooftop dodge. "There is no spoon," she says. "Just hit it like the movie."'
};

export const FEATURED_DEMO_SCRIPTS: readonly DemoScript[] = [
  DEMO_TWO_LEAD_SCRIPT,
  DEMO_MATRIX_SCRIPT
];

export const DEMO_SCRIPTS: readonly DemoScript[] = [
  DEMO_TWO_LEAD_SCRIPT,
  DEMO_MATRIX_SCRIPT,
  {
    id: 'nimbus-kiosk',
    category: 'brand',
    title: 'Brand placement at the kiosk',
    script:
      'INT. CORNER KIOSK — DUSK\n\nA refrigerated case hums. JUNO grabs a Nimbus Soda, thumbs the frost off the logo, and slides it across the counter without looking up.'
  },
  {
    id: 'rowan-casting',
    category: 'likeness',
    title: 'Likeness board in casting',
    script:
      'INT. CASTING OFFICE — DAY\n\nThe mood board is one face, tiled twelve times: Rowan Voss. The director taps the center photo. "We need that exact look. Same jaw. Same walk."'
  },
  {
    id: 'reel-turning-edit',
    category: 'quotation',
    title: 'Quote on the edit-bay glass',
    script:
      'INT. EDIT BAY — NIGHT\n\nThe cutter freezes on a title card. In yellow marker across the glass: "Time keeps the reel turning." She does not know who said it first.'
  },
  {
    id: 'arcade-anthem',
    category: 'music',
    title: 'Needle-drop in the arcade',
    script:
      'INT. MIDNIGHT ARCADE — NIGHT\n\nCabinets stutter in pink neon. The house speakers drop a needle on Midnight Arcade Anthem — and the lyric that cuts through is "Time keeps the reel turning." Picture locks to the downbeat.'
  },
  {
    id: 'neo-kyoto-lot',
    category: 'location',
    title: 'Location shoot on the franchise lot',
    script:
      'EXT. NEO-KYOTO ARCADE DISTRICT — DAY\n\nSecond unit owns the block. A forty-foot banner for The Copper Comet Chronicles wraps the escalator while extras in rental capes pose for tourists.'
  },
  {
    id: 'copper-comet-hall',
    category: 'franchise',
    title: 'Franchise banner on the hall',
    script:
      'EXT. COMIC-CON HALL — DAY\n\nLegal watches from the mezzanine as the crew lights a hero shot under The Copper Comet Chronicles logo. Nobody has the park-use memo.'
  },
  {
    id: 'aurelia-ward',
    category: 'character',
    title: 'Character standee on the ward',
    script:
      "INT. CHILDREN'S WARD — AFTERNOON\n\nA nurse wheels in a standee of Captain Aurelia. The kids cheer. Wardrobe wants the same chest insignia on the hero's jacket."
  }
];

export function pickSampleScript(
  pool: readonly DemoScript[],
  lastId: string | undefined,
  usedIds: readonly string[],
  random: () => number = Math.random
): DemoScript {
  if (pool.length === 0) {
    throw new Error('Demo script pool is empty');
  }

  const used = new Set(usedIds);
  let candidates = pool.filter((script) => !used.has(script.id));
  if (candidates.length === 0) {
    candidates = [...pool];
  }
  if (lastId && candidates.length > 1) {
    candidates = candidates.filter((script) => script.id !== lastId);
  }

  const rawIndex = Math.floor(random() * candidates.length);
  const index = Math.min(Math.max(rawIndex, 0), candidates.length - 1);
  return candidates[index]!;
}

export function normalizeDemoScript(text: string): string {
  return text.replace(/\u2013|\u2014/g, '-').replace(/\r\n/g, '\n').trim();
}

export function missingFeaturedDemoScripts(
  cases: readonly { script_text: string }[],
  featured: readonly DemoScript[] = FEATURED_DEMO_SCRIPTS
): DemoScript[] {
  const existing = new Set(cases.map((item) => normalizeDemoScript(item.script_text)));
  return featured.filter((sample) => !existing.has(normalizeDemoScript(sample.script)));
}

export function duplicateCaseIdsToRemove(
  cases: readonly { id: string; script_text: string; created_at: string }[]
): string[] {
  const newestFirst = [...cases].sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)
  );
  const seenScripts = new Set<string>();
  const extras: string[] = [];
  for (const item of newestFirst) {
    const key = normalizeDemoScript(item.script_text);
    if (seenScripts.has(key)) {
      extras.push(item.id);
      continue;
    }
    seenScripts.add(key);
  }
  return extras;
}

export function recordUsedScriptIds(
  pool: readonly DemoScript[],
  usedIds: readonly string[],
  pickedId: string
): string[] {
  const poolIds = new Set(pool.map((script) => script.id));
  const next = [...usedIds.filter((id) => poolIds.has(id))];
  if (!next.includes(pickedId) && poolIds.has(pickedId)) {
    next.push(pickedId);
  }
  if (next.length >= pool.length) {
    return [pickedId];
  }
  return next;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readDemoChoice(): DemoChoice | null {
  if (!canUseStorage()) return null;
  const value = window.localStorage.getItem(DEMO_CHOICE_KEY);
  return value === 'walkthrough' || value === 'self-serve' ? value : null;
}

export function writeDemoChoice(choice: DemoChoice): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(DEMO_CHOICE_KEY, choice);
}

export function readLastScriptId(): string | undefined {
  if (!canUseStorage()) return undefined;
  return window.localStorage.getItem(DEMO_LAST_SCRIPT_KEY) ?? undefined;
}

export function writeLastScriptId(id: string): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(DEMO_LAST_SCRIPT_KEY, id);
}

export function readUsedScriptIds(): string[] {
  if (!canUseStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DEMO_USED_SCRIPTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function writeUsedScriptIds(ids: readonly string[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(DEMO_USED_SCRIPTS_KEY, JSON.stringify(ids));
}
