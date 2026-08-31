# User Inbox for assigned pending cases

**Date:** 2026-08-30  
**Status:** Approved for planning  
**Branch context:** `feat/case-desk-demo-walkthrough` (case desk + Matrix walkthrough)

## Problem

The dashboard **Production inventory** expands a case into a nested **Research Findings** dump (evidence cards, mock extracts, confidence). That competes with the case desk, looks worse than the case menu, and does not answer the real product question: **what needs my review?**

RightsRadar already attaches roster people to findings via `stakeholder_ids`. The missing link is a **user-scoped Inbox**.

## Goals

1. Replace the inventory accordion’s nested findings with a clean **Inbox** of cases that need the signed-in user’s review.
2. Treat **roster members as users** (Jordan / Alex / Maya). No separate auth service for the hackathon; “Signed in as” is identity.
3. Default demo identity to **Clearance (Jordan)** so The Matrix homage (franchise + quote) both appear in that user’s Inbox.
4. Open a case from Inbox into the **case desk** for escalate/dismiss; do not re-implement finding detail on the dashboard.

## Non-goals

- Real OAuth / multi-tenant auth.
- New inbox API endpoint (can follow later).
- Finding-level queue rows (one row per finding).
- Changing how `stakeholders_for_lead` assigns roles.
- Judge/dev tool-call rail changes.

## Users model

| Concept | Hackathon reality |
| --- | --- |
| User | A `ProductionMember` on the production roster |
| Signed in as | Active `member_id`, persisted in `localStorage` (`rightsrader.activeMemberId`) |
| Default user | First roster member with role `clearance`, else first roster member |
| Speak-as on desk | Same `member_id` when opening a case from Inbox (stay consistent) |

Roster people are not a temporary “act as” costume for demos only — they **are** the users of the app in this build.

## Inbox membership rule

A **case** appears in the signed-in user’s Inbox when:

- the case belongs to the current production, and
- at least one finding has `stakeholder_ids` containing the active `member_id`, and
- that finding’s `reviewer_status` is `pending`.

When the user escalates or dismisses their last pending assigned finding on a case, that case leaves their Inbox (other users may still see it).

## UI

### Dashboard (replaces “CASES & FINDINGS” / Production inventory accordion)

- Section title: **Inbox**
- Control: **Signed in as** `<select>` of roster members (show name + role). Default Jordan / clearance.
- Badge: `N` cases need your review.
- **Row** (case-menu quality, no expand-in-place findings):
  - Title (or “Untitled script review”)
  - Filed timestamp
  - Pending-for-you count
  - Short script excerpt (line-clamp)
  - Chips for pending leads assigned to you (e.g. `The Matrix`, `There is no spoon`)
- Primary action: **Open desk** → existing case workspace with that user as actor
- Empty state: “Nothing assigned to you right now” + **New case**
- Optional compact **All cases** under Inbox: title + open desk only — **never** inline Research Findings / evidence cards
- Remove case remains available (existing delete), without embedding findings

### Removed

- Accordion `RESEARCH FINDINGS` block under production case details (evidence archive cards, raw Parallel extract, etc. on the dashboard list)

### Case desk

Unchanged as the place for full findings, thread, escalate/dismiss, and stakeholders. Agent pipeline placement (under user input) is out of scope for this spec unless already in flight separately.

## Data & flow

**Approach:** Client filter over existing `listProductionCases` / case payloads (Approach A).

1. Load production + roster + cases as today.
2. Resolve active user from `localStorage` or default clearance.
3. Derive Inbox rows with a pure helper, e.g. `inboxCasesForMember(cases, memberId)`.
4. Opening a case sets `actingMemberId` / signed-in user and navigates to the case view.
5. Matrix walkthrough: file `DEMO_MATRIX_SCRIPT` → after analyze, Jordan’s Inbox shows that case (both leads attach clearance).

No new backend routes required for v1.

## Testing

- Unit: `inboxCasesForMember` — includes case with pending stakeholder match; excludes dismissed/escalated-only; excludes other members’ assignments; clearance sees Matrix franchise + quote.
- UI / e2e smoke: production inventory no longer renders nested finding evidence cards; Inbox shows a row for the Matrix case when signed in as clearance; Open desk reaches case workspace.

## Success criteria

- Judges can answer “what’s assigned to me?” from the dashboard without reading a findings dump.
- Switching Signed in as changes the Inbox list.
- Nested Research Findings accordion is gone from the cases list.
- Demo path (Walk The Matrix homage → Jordan Inbox → Open desk) is obvious.
