# User Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard Production inventory findings accordion with a user-scoped Inbox of cases that still need the signed-in roster user’s pending review.

**Architecture:** Pure client helpers filter existing case payloads by `finding.stakeholder_ids` + `reviewer_status === 'pending'`. Active user is a roster `ProductionMember` persisted in `localStorage`, defaulting to clearance (Jordan). Dashboard renders Inbox rows; Open desk navigates to `ScriptReview` with that member as actor. No new API.

**Tech Stack:** Next.js / React (`apps/web`), Vitest, Playwright e2e, existing `@rightsrader/api-client` `Case` / `Finding` / `ProductionMember` types.

## Global Constraints

- Roster members ARE users; no OAuth in this milestone.
- Default signed-in user = first roster member with `role === 'clearance'`, else first roster member.
- Persist active member id under key `rightsrader.activeMemberId`.
- Inbox case rule: ≥1 finding with `stakeholder_ids` containing active member id AND `reviewer_status === 'pending'`.
- Remove nested Research Findings / evidence cards from the production inventory accordion.
- Escalate/dismiss stays on the case desk only.
- Spec: `docs/superpowers/specs/2026-08-30-user-inbox-design.md`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `apps/web/lib/inbox.ts` | Pure helpers: default member, load/save active member, pending findings for member, inbox case list |
| `apps/web/tests/inbox.test.ts` | Unit tests for those helpers |
| `apps/web/components/dashboard.tsx` | Signed-in-as control, Inbox UI, All cases (no findings accordion), wire Open desk + active member into case view |
| `apps/web/components/script-review.tsx` | Accept optional `activeMemberId` prop; initialize `actingMemberId` from it |
| `tests/e2e/demo-mode.spec.ts` | Smoke: after walkthrough / self-serve path, Inbox visible for clearance; no `production-case-details` findings dump |

---

### Task 1: Inbox pure helpers (TDD)

**Files:**
- Create: `apps/web/lib/inbox.ts`
- Create: `apps/web/tests/inbox.test.ts`

**Interfaces:**
- Consumes: `Case`, `Finding`, `ProductionMember` from `@rightsrader/api-client`
- Produces:
  - `ACTIVE_MEMBER_STORAGE_KEY = 'rightsrader.activeMemberId'`
  - `defaultActiveMemberId(roster: readonly ProductionMember[]): string`
  - `readActiveMemberId(storage: Pick<Storage, 'getItem'>, roster: readonly ProductionMember[]): string`
  - `writeActiveMemberId(storage: Pick<Storage, 'setItem'>, memberId: string): void`
  - `pendingFindingsForMember(caseItem: Case, memberId: string): Finding[]`
  - `inboxCasesForMember(cases: readonly Case[], memberId: string): Case[]`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/inbox.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Case, Finding, ProductionMember } from '@rightsrader/api-client';
import {
  ACTIVE_MEMBER_STORAGE_KEY,
  defaultActiveMemberId,
  inboxCasesForMember,
  pendingFindingsForMember,
  readActiveMemberId,
  writeActiveMemberId
} from '../lib/inbox';

const jordan: ProductionMember = { id: 'm-clearance', name: 'Jordan', role: 'clearance' };
const alex: ProductionMember = { id: 'm-production', name: 'Alex', role: 'production' };
const maya: ProductionMember = { id: 'm-legal', name: 'Maya', role: 'legal' };

function finding(partial: Partial<Finding> & Pick<Finding, 'id' | 'detected_item'>): Finding {
  return {
    case_id: 'c1',
    category: 'brand_reference',
    explanation: 'x',
    confidence: 0.8,
    supporting_evidence: [],
    source_urls: [],
    retrieved_at: '2026-08-30T00:00:00Z',
    reviewer_status: 'pending',
    stakeholder_ids: [jordan.id],
    ...partial
  };
}

function caseWith(findings: Finding[], id = 'c1'): Case {
  return {
    id,
    production_id: 'p1',
    title: 'The Matrix rooftop homage',
    script_text: 'INT. GREENSCREEN…',
    created_at: '2026-08-30T00:00:00Z',
    findings,
    thread: [],
    tool_calls: []
  };
}

describe('defaultActiveMemberId', () => {
  it('prefers clearance over other roles', () => {
    expect(defaultActiveMemberId([alex, maya, jordan])).toBe(jordan.id);
  });

  it('falls back to first roster member when no clearance', () => {
    expect(defaultActiveMemberId([alex, maya])).toBe(alex.id);
  });

  it('returns empty string for empty roster', () => {
    expect(defaultActiveMemberId([])).toBe('');
  });
});

describe('active member storage', () => {
  it('reads a stored id when it is still on the roster', () => {
    const storage = {
      getItem: (key: string) => (key === ACTIVE_MEMBER_STORAGE_KEY ? maya.id : null),
      setItem: () => undefined
    };
    expect(readActiveMemberId(storage, [jordan, maya])).toBe(maya.id);
  });

  it('falls back to default when stored id is missing or unknown', () => {
    const storage = {
      getItem: () => 'ghost',
      setItem: () => undefined
    };
    expect(readActiveMemberId(storage, [jordan, alex])).toBe(jordan.id);
  });

  it('writes the active member id under the stable key', () => {
    const writes: Record<string, string> = {};
    writeActiveMemberId(
      { setItem: (key, value) => {
          writes[key] = value;
        } },
      jordan.id
    );
    expect(writes[ACTIVE_MEMBER_STORAGE_KEY]).toBe(jordan.id);
  });
});

describe('pendingFindingsForMember / inboxCasesForMember', () => {
  const matrix = caseWith([
    finding({
      id: 'f-matrix',
      detected_item: 'The Matrix',
      category: 'franchise_reference',
      stakeholder_ids: [jordan.id, alex.id]
    }),
    finding({
      id: 'f-spoon',
      detected_item: 'There is no spoon',
      category: 'quotation',
      stakeholder_ids: [jordan.id, maya.id]
    })
  ]);

  it('lists pending findings assigned to clearance (Jordan)', () => {
    expect(pendingFindingsForMember(matrix, jordan.id).map((f) => f.detected_item)).toEqual([
      'The Matrix',
      'There is no spoon'
    ]);
  });

  it('excludes findings that are not pending', () => {
    const escalated = caseWith([
      finding({
        id: 'f1',
        detected_item: 'The Matrix',
        reviewer_status: 'escalated',
        stakeholder_ids: [jordan.id]
      })
    ]);
    expect(pendingFindingsForMember(escalated, jordan.id)).toEqual([]);
    expect(inboxCasesForMember([escalated], jordan.id)).toEqual([]);
  });

  it('excludes findings that do not list the member', () => {
    expect(pendingFindingsForMember(matrix, 'nobody')).toEqual([]);
  });

  it('includes a case in Inbox when at least one pending assignment matches', () => {
    const onlyProductionPending = caseWith([
      finding({
        id: 'f1',
        detected_item: 'The Matrix',
        stakeholder_ids: [jordan.id, alex.id],
        reviewer_status: 'dismissed'
      }),
      finding({
        id: 'f2',
        detected_item: 'Nimbus Soda',
        stakeholder_ids: [alex.id],
        reviewer_status: 'pending'
      })
    ]);
    expect(inboxCasesForMember([matrix, onlyProductionPending], jordan.id).map((c) => c.id)).toEqual([
      'c1'
    ]);
    expect(inboxCasesForMember([matrix, onlyProductionPending], alex.id).map((c) => c.id)).toEqual([
      'c1',
      'c1'
    ]);
  });
});
```

Fix the last assertion: `onlyProductionPending` should use `id: 'c2'` so alex gets `['c1', 'c2']`. Update the fixture:

```ts
const onlyProductionPending = caseWith(
  [
    finding({
      id: 'f1',
      detected_item: 'The Matrix',
      stakeholder_ids: [jordan.id, alex.id],
      reviewer_status: 'dismissed'
    }),
    finding({
      id: 'f2',
      detected_item: 'Nimbus Soda',
      stakeholder_ids: [alex.id],
      reviewer_status: 'pending'
    })
  ],
  'c2'
);
expect(inboxCasesForMember([matrix, onlyProductionPending], alex.id).map((c) => c.id)).toEqual([
  'c1',
  'c2'
]);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rightsrader/web test -- tests/inbox.test.ts`  
Expected: FAIL (module `../lib/inbox` not found)

- [ ] **Step 3: Implement helpers**

Create `apps/web/lib/inbox.ts`:

```ts
import type { Case, Finding, ProductionMember } from '@rightsrader/api-client';

export const ACTIVE_MEMBER_STORAGE_KEY = 'rightsrader.activeMemberId';

export function defaultActiveMemberId(roster: readonly ProductionMember[]): string {
  const clearance = roster.find((member) => member.role === 'clearance');
  return clearance?.id ?? roster[0]?.id ?? '';
}

export function readActiveMemberId(
  storage: Pick<Storage, 'getItem'>,
  roster: readonly ProductionMember[]
): string {
  const stored = storage.getItem(ACTIVE_MEMBER_STORAGE_KEY);
  if (stored && roster.some((member) => member.id === stored)) {
    return stored;
  }
  return defaultActiveMemberId(roster);
}

export function writeActiveMemberId(
  storage: Pick<Storage, 'setItem'>,
  memberId: string
): void {
  storage.setItem(ACTIVE_MEMBER_STORAGE_KEY, memberId);
}

export function pendingFindingsForMember(caseItem: Case, memberId: string): Finding[] {
  if (!memberId) return [];
  return (caseItem.findings ?? []).filter(
    (finding) =>
      finding.reviewer_status === 'pending' &&
      (finding.stakeholder_ids ?? []).includes(memberId)
  );
}

export function inboxCasesForMember(cases: readonly Case[], memberId: string): Case[] {
  return cases.filter((caseItem) => pendingFindingsForMember(caseItem, memberId).length > 0);
}
```

Check `Case` fields against `packages/api-client/src/generated.ts` when writing tests — use only fields that exist on `Case` (adjust the fixture if `script_excerpt` / `thread` / `tool_calls` names differ).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rightsrader/web test -- tests/inbox.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/inbox.ts apps/web/tests/inbox.test.ts
git commit -m "$(cat <<'EOF'
feat: add user-scoped inbox filter helpers

EOF
)"
```

---

### Task 2: Pass active user into the case desk

**Files:**
- Modify: `apps/web/components/script-review.tsx` (ScriptReview props + `actingMemberId` init)
- Modify: `apps/web/components/dashboard.tsx` (active member state; pass into ScriptReview)

**Interfaces:**
- Consumes: `readActiveMemberId`, `writeActiveMemberId`, `defaultActiveMemberId` from `apps/web/lib/inbox.ts`
- Produces: Dashboard holds `activeMemberId: string`; ScriptReview accepts `activeMemberId?: string` and seeds Speak-as from it

- [ ] **Step 1: Extend ScriptReview props**

In `ScriptReview` props, add `activeMemberId?: string`. Initialize:

```ts
const [actingMemberId, setActingMemberId] = useState(
  activeMemberId || roster.find((m) => m.role === 'clearance')?.id || roster[0]?.id || ''
);
```

Add an effect when `activeMemberId` changes from the parent:

```ts
useEffect(() => {
  if (activeMemberId && roster.some((member) => member.id === activeMemberId)) {
    setActingMemberId(activeMemberId);
  }
}, [activeMemberId, roster]);
```

Keep the existing effect that resets when the current id is not on the roster.

- [ ] **Step 2: Hold active member on the dashboard**

Near other dashboard state:

```ts
const roster = activeProduction?.roster ?? [];
const [activeMemberId, setActiveMemberId] = useState('');

useEffect(() => {
  if (roster.length === 0) {
    setActiveMemberId('');
    return;
  }
  setActiveMemberId(readActiveMemberId(window.localStorage, roster));
}, [activeProduction?.id, roster]);
```

Note: depending on eslint exhaustive-deps, derive `roster` inside the effect from `activeProduction?.roster ?? []` keyed by `activeProduction?.id` to avoid unstable array identity.

When rendering ScriptReview:

```tsx
<ScriptReview
  key={openedCase?.id ?? `blank-${activeProduction?.id ?? 'none'}`}
  productionId={activeProduction?.id}
  roster={activeProduction?.roster ?? []}
  activeMemberId={activeMemberId}
  initialCase={openedCase}
  focusTour={coachOpen}
  onCaseCreated={() => {
    void refreshProductions();
    if (activeProductionId) void refreshProductionCases(activeProductionId);
  }}
/>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @rightsrader/web typecheck`  
Expected: PASS (or only pre-existing errors unrelated to these props)

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/script-review.tsx apps/web/components/dashboard.tsx
git commit -m "$(cat <<'EOF'
feat: sync case desk Speak-as with signed-in user

EOF
)"
```

---

### Task 3: Replace Production inventory accordion with Inbox UI

**Files:**
- Modify: `apps/web/components/dashboard.tsx` (overview section currently labeled `CASES & FINDINGS` / Production inventory — roughly the block with `data-testid="production-case-inventory"` and `production-case-details`)

**Interfaces:**
- Consumes: `inboxCasesForMember`, `pendingFindingsForMember`, `writeActiveMemberId`
- Produces: UI with `data-testid="user-inbox"`, `data-testid="inbox-case-row"`, `data-testid="signed-in-as"`, optional `data-testid="all-cases-list"`; rows open desk via existing `setOpenedCase` + `setView({ kind: 'case' })`

- [ ] **Step 1: Derive inbox rows**

Inside the overview branch (where `productionCases` is available):

```ts
const inboxCases = inboxCasesForMember(productionCases, activeMemberId);
```

- [ ] **Step 2: Replace the inventory header + list**

Remove the accordion that renders `PixelLabel>RESEARCH FINDINGS` and nested evidence cards (`data-testid="production-case-details"` findings list).

Render instead:

```tsx
<section aria-labelledby="user-inbox-heading" data-testid="user-inbox">
  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
    <div>
      <PixelLabel>INBOX</PixelLabel>
      <BungeeHeading id="user-inbox-heading" className="mt-1 text-xl">
        Needs your review
      </BungeeHeading>
      <p className="mt-1 text-[11px] text-lavender-soft">
        Cases with pending findings assigned to you.
      </p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-[11px] text-lavender-soft">
        <span className="font-pixel text-[7px] text-cyan-pop">SIGNED IN AS</span>
        <select
          data-testid="signed-in-as"
          value={activeMemberId}
          onChange={(event) => {
            const next = event.target.value;
            setActiveMemberId(next);
            writeActiveMemberId(window.localStorage, next);
          }}
          className="border-2 border-ink bg-white px-2 py-1.5 font-display text-[9px] text-ink"
        >
          {roster.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name} · {member.role}
            </option>
          ))}
        </select>
      </label>
      <span className="border border-ink bg-white px-2 py-1 font-pixel text-[7px] text-ink">
        {inboxCases.length} {inboxCases.length === 1 ? 'CASE' : 'CASES'}
      </span>
      <button
        type="button"
        onClick={() => {
          setOpenedCase(null);
          setView({ kind: 'case' });
        }}
        className="inline-flex items-center gap-1 border-2 border-ink bg-brand px-3 py-2 font-display text-[9px] text-ink shadow-press"
      >
        New case
      </button>
    </div>
  </div>

  {isLoadingProductionCases ? (
    <Panel glow={false}>
      <p className="flex items-center gap-2 text-[11px] text-lavender-soft">
        <Spinner className="size-3.5" /> Loading inbox…
      </p>
    </Panel>
  ) : inboxCases.length === 0 ? (
    <Panel glow={false}>
      <p className="text-[11.5px] leading-[17.83px] text-lavender-soft">
        Nothing assigned to you right now. New cases appear here when agents attach you as a
        stakeholder and a finding is still pending.
      </p>
    </Panel>
  ) : (
    <ul className="space-y-3">
      {inboxCases.map((inboxCase, index) => {
        const mine = pendingFindingsForMember(inboxCase, activeMemberId);
        return (
          <li
            key={inboxCase.id}
            data-testid="inbox-case-row"
            className="border-2 border-line bg-panel p-5 transition hover:border-cyan-pop"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-pixel text-[7px] text-cyan-pop">
                  CASE {String(inboxCases.length - index).padStart(2, '0')}
                </p>
                <h3 className="mt-2 font-display text-sm text-paper">
                  {inboxCase.title || 'Untitled script review'}
                </h3>
                <p className="mt-1 font-pixel text-[7px] text-lavender">
                  {new Date(inboxCase.created_at).toLocaleString()} · {mine.length} pending for you
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpenedCase(inboxCase);
                  setView({ kind: 'case' });
                }}
                className="inline-flex items-center gap-1 border-2 border-ink bg-brand px-3 py-2 font-display text-[9px] text-ink shadow-press"
              >
                Open desk
              </button>
            </div>
            <p className="mt-4 line-clamp-2 border-l-2 border-brand pl-3 text-[11px] leading-[17px] text-lavender-soft">
              {inboxCase.script_text}
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {mine.map((finding) => (
                <li
                  key={finding.id}
                  className="border border-cyan-pop px-2 py-1 font-pixel text-[7px] text-cyan-pop"
                >
                  {finding.detected_item}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                data-testid="delete-case"
                aria-label="Remove case"
                onClick={() =>
                  void removeCase(inboxCase.id, inboxCase.title || 'Untitled script review')
                }
                className="inline-flex items-center gap-1.5 px-2 py-1 font-display text-[9px] text-muted hover:text-accent"
              >
                Remove case
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  )}
</section>
```

- [ ] **Step 3: Optional compact All cases (no findings)**

Below Inbox, keep a slim list of all `productionCases` for navigation — title + Open desk + Remove only. Use `data-testid="all-cases-list"`. Do **not** expand script evidence cards.

```tsx
<section aria-labelledby="all-cases-heading" data-testid="all-cases-list" className="mt-8">
  <PixelLabel>ALL CASES</PixelLabel>
  <BungeeHeading id="all-cases-heading" className="mt-1 text-lg">
    Production cases
  </BungeeHeading>
  {/* map productionCases → row with title, finding count badge, Open desk, Remove — no accordion */}
</section>
```

Remove unused state `selectedProductionCaseId` / setter if nothing else references it.

- [ ] **Step 4: Manual sanity / typecheck**

Run: `pnpm --filter @rightsrader/web typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/dashboard.tsx
git commit -m "$(cat <<'EOF'
feat: replace case findings accordion with user Inbox

EOF
)"
```

---

### Task 4: E2E smoke for Inbox + Matrix clearance path

**Files:**
- Modify: `tests/e2e/demo-mode.spec.ts`

**Interfaces:**
- Consumes: existing demo gate walkthrough; new `user-inbox` / `signed-in-as` test ids
- Produces: coverage that nested production-case findings UI is gone and Inbox exists after returning to overview (or via self-serve)

- [ ] **Step 1: Clear active-member storage in beforeEach**

```ts
window.localStorage.removeItem('rightsrader.activeMemberId');
```

- [ ] **Step 2: Add test — self-serve overview shows Inbox, not findings dump**

```ts
test('production overview shows user Inbox instead of nested findings', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByTestId('demo-self-serve').click();
  // Open demo production if gate lands on home — follow existing UI:
  // click the Demo Desk / first production card if needed, expect overview.
  await expect(page.getByTestId('user-inbox')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('signed-in-as')).toBeVisible();
  await expect(page.getByTestId('production-case-details')).toHaveCount(0);
});
```

Adjust navigation selectors to match current `ProductionsHome` / demo production title (`RightsRadar Demo Desk` from `DEMO_PRODUCTION_TITLE`).

- [ ] **Step 3: Add assertion after walkthrough (optional second test)**

After Matrix walkthrough completes enough to have a case, navigate back to overview (sidebar / production home control already used in the app) and expect:

```ts
await expect(page.getByTestId('inbox-case-row').filter({ hasText: 'The Matrix' })).toBeVisible();
// or filter by title "The Matrix rooftop homage"
```

If walkthrough stays on desk-only UI, keep Task 4 focused on the self-serve overview test plus unit coverage for Matrix clearance from Task 1.

- [ ] **Step 4: Run e2e for the new test**

Run: `pnpm exec playwright test tests/e2e/demo-mode.spec.ts -g "user Inbox"`  
Expected: PASS (with API + web running per project README / existing e2e config)

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/demo-mode.spec.ts
git commit -m "$(cat <<'EOF'
test: cover user Inbox on production overview

EOF
)"
```

---

### Task 5: Spec coverage check + README one-liner

**Files:**
- Modify: `README.md` (demo walkthrough section — mention Inbox / Signed in as Jordan)
- Optionally leave design spec status as Approved

- [ ] **Step 1: Update README demo bullets**

In the Matrix / demo gate section, add that the production overview **Inbox** lists cases with pending findings assigned to the signed-in roster user (default Clearance / Jordan), and that nested findings no longer expand on the inventory list.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: mention user Inbox on the demo desk overview

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| Roster members are users; Signed in as | Tasks 2–3 |
| Default clearance (Jordan) | Task 1 `defaultActiveMemberId` + Task 2 |
| `localStorage` key `rightsrader.activeMemberId` | Task 1–2 |
| Inbox rule pending + stakeholder_ids | Task 1 |
| Replace accordion findings dump | Task 3 |
| Open desk as that user | Tasks 2–3 |
| All cases without inline findings | Task 3 |
| Matrix → Jordan Inbox | Task 1 unit + Task 4 e2e |
| No new inbox API | All tasks (client filter only) |
| Tests | Tasks 1, 4 |

## Placeholder / type notes for implementers

- Confirm `Case` required fields in `packages/api-client/src/generated.ts` when building fixtures; do not invent fields.
- `stakeholder_ids` is optional on `Finding` — always use `(finding.stakeholder_ids ?? [])`.
- Do not reintroduce `production-case-details` findings markup.
