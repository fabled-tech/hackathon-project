import { describe, expect, it } from 'vitest';
import {
  DEMO_CHOICE_KEY,
  DEMO_MATRIX_SCRIPT,
  DEMO_SCRIPTS,
  DEMO_SESSION_KEY,
  DEMO_TWO_LEAD_SCRIPT,
  FEATURED_DEMO_SCRIPTS,
  duplicateCaseIdsToRemove,
  markFreshDemoLaunch,
  missingFeaturedDemoScripts,
  pickSampleScript,
  recordUsedScriptIds
} from '../lib/demo-mode';

describe('demo sample-script picker', () => {
  it('keeps The Matrix homage on the featured desk so it is not lost in rotation', () => {
    expect(DEMO_MATRIX_SCRIPT.script).toMatch(/The Matrix/);
    expect(DEMO_MATRIX_SCRIPT.script).toMatch(/There is no spoon/);
    expect(FEATURED_DEMO_SCRIPTS.map((script) => script.id)).toEqual([
      DEMO_TWO_LEAD_SCRIPT.id,
      DEMO_MATRIX_SCRIPT.id
    ]);
    expect(DEMO_SCRIPTS.some((script) => script.id === DEMO_MATRIX_SCRIPT.id)).toBe(true);
    expect(
      missingFeaturedDemoScripts([{ script_text: DEMO_TWO_LEAD_SCRIPT.script }]).map(
        (script) => script.id
      )
    ).toEqual([DEMO_MATRIX_SCRIPT.id]);
    expect(
      missingFeaturedDemoScripts([
        { script_text: DEMO_MATRIX_SCRIPT.script.replaceAll('\u2014', '-') }
      ]).map((script) => script.id)
    ).toEqual([DEMO_TWO_LEAD_SCRIPT.id]);
  });

  it('seeds a two-lane script with a brand lead and a quote lead', () => {
    expect(DEMO_TWO_LEAD_SCRIPT.script).toMatch(/Nimbus Soda/);
    expect(DEMO_TWO_LEAD_SCRIPT.script).toMatch(/Time keeps the reel turning/);
    expect(DEMO_SCRIPTS.some((script) => script.id === DEMO_TWO_LEAD_SCRIPT.id)).toBe(true);
  });

  it('has at least five scenes across multiple lead categories', () => {
    const categories = new Set(DEMO_SCRIPTS.map((script) => script.category));
    expect(DEMO_SCRIPTS.length).toBeGreaterThanOrEqual(5);
    expect(categories.size).toBeGreaterThanOrEqual(4);
    expect([...categories]).toEqual(
      expect.arrayContaining(['brand', 'likeness', 'quotation', 'franchise'])
    );
  });

  it('does not repeat the same id on consecutive picks when the pool has 5+ items', () => {
    expect(DEMO_SCRIPTS.length).toBeGreaterThanOrEqual(5);
    let lastId: string | undefined;
    let usedIds: string[] = [];
    const picks: string[] = [];

    for (let index = 0; index < 20; index += 1) {
      const picked = pickSampleScript(DEMO_SCRIPTS, lastId, usedIds, () => 0);
      expect(picked.id).not.toBe(lastId);
      picks.push(picked.id);
      usedIds = recordUsedScriptIds(DEMO_SCRIPTS, usedIds, picked.id);
      lastId = picked.id;
    }

    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it('keeps the newest case per identical script and drops the rest', () => {
    expect(
      duplicateCaseIdsToRemove([
        {
          id: 'old-nimbus',
          script_text: DEMO_TWO_LEAD_SCRIPT.script,
          created_at: '2026-08-01T00:00:00Z'
        },
        {
          id: 'new-nimbus',
          script_text: DEMO_TWO_LEAD_SCRIPT.script,
          created_at: '2026-08-30T00:00:00Z'
        },
        {
          id: 'kyoto',
          script_text: 'EXT. NEO-KYOTO',
          created_at: '2026-08-15T00:00:00Z'
        }
      ])
    ).toEqual(['old-nimbus']);
  });

  it('treats the first tab load as a fresh shared-desk launch', () => {
    const session = new Map<string, string>();
    const local = new Map<string, string>([[DEMO_CHOICE_KEY, 'self-serve']]);
    const sessionStore = {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => {
        session.set(key, value);
      }
    };
    const localStore = {
      removeItem: (key: string) => {
        local.delete(key);
      }
    };

    expect(markFreshDemoLaunch(sessionStore, localStore)).toBe(true);
    expect(session.get(DEMO_SESSION_KEY)).toBe('1');
    expect(local.has(DEMO_CHOICE_KEY)).toBe(false);
    expect(markFreshDemoLaunch(sessionStore, localStore)).toBe(false);
  });

  it('avoids the last used id even after the unused pool is exhausted', () => {
    const usedIds = DEMO_SCRIPTS.map((script) => script.id);
    const lastId = DEMO_SCRIPTS[0].id;
    const picked = pickSampleScript(DEMO_SCRIPTS, lastId, usedIds, () => 0);
    expect(picked.id).not.toBe(lastId);
  });
});
