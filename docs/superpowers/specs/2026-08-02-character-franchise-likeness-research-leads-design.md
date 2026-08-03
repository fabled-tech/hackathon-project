# Character, Franchise, and Likeness Research Leads Design

**Date:** 2026-08-02  
**Issue:** FAB-10  
**Status:** Approved for specification review

## Goal

Extend RightsRadar's deterministic structured findings beyond brands and quotations so a human
reviewer can also research potential character, franchise, and likeness references. RightsRadar
remains research assistance only: it does not provide legal advice or make infringement or
clearance determinations.

## Scope

- Add deterministic mock detection for fictional character, franchise, and likeness fixture
  references.
- Give every new fixture lead a neutral explanation, bounded confidence score, retrieval timestamp,
  mock evidence excerpt, and traceable source URL.
- Update reviewer-facing scope copy to include all five lead types: brands, quotations, characters,
  franchises, and likenesses.
- Preserve the existing category-agnostic finding, evidence, citation, persistence, and reviewer
  status behavior.
- Preserve all existing Nimbus Soda brand and `Time keeps the reel turning` quotation behavior.

## Non-goals

- Detecting, identifying, or making claims about real people, real characters, or real franchises.
- Adding legal conclusions, ownership assertions, infringement findings, or clearance decisions.
- Changing the finding API schema, reviewer workflow, evidence transport, or generated TypeScript
  client.
- Replacing deterministic mock behavior with live entity recognition.

## Detection and evidence flow

The existing `GeminiSignal` and `Finding` models already carry a generic category, detected item,
explanation, confidence, evidence, source URLs, and retrieval time. FAB-10 will use those existing
fields rather than introduce a new model or API contract.

`MockGeminiClient` will add case-insensitive fixture checks for the following fictional references:

| Fixture text | Finding category | Research framing |
| --- | --- | --- |
| `Captain Aurelia` | `character_reference` | A reviewer should research whether the fictional character reference needs follow-up. |
| `The Copper Comet Chronicles` | `franchise_reference` | A reviewer should research whether the fictional franchise-style reference needs follow-up. |
| `Rowan Voss` | `likeness_reference` | A reviewer should research whether the described or named likeness reference needs follow-up. |

Each generated explanation must be neutral and must not say that the subject is protected, owned,
infringing, or requires clearance. Each confidence value remains between zero and one, expressing
only the detector's uncertainty about whether a reference merits human research.

`MockParallelSearchClient` will add one deterministic source per fixture. The agent service will
continue to translate each search result into `Evidence`, retain the source URL in `source_urls`,
and save the shared retrieval timestamp. That preserves traceability without implying that a source
resolves a legal question.

## Reviewer presentation and guardrail

The header copy will describe the result as potential research leads for brands, quotations,
characters, franchises, and likenesses. Finding cards retain their existing generic category label,
confidence label, evidence excerpt, citation link, and human-review actions.

The existing legal disclaimer remains unchanged and prominent: RightsRadar provides research
assistance only, not legal advice or final infringement or clearance determinations. Empty-state and
finding text continue to make clear that outputs are not clearance conclusions.

## Compatibility

The API contract stays unchanged because categories are already strings. Existing persisted cases
remain readable, and the generated API client does not need regeneration for this issue. Existing
brand and quotation detection uses its current trigger texts, confidence values, explanations, and
mock citations unchanged.

## Verification

- Add a focused API test with one excerpt containing all five fixtures, asserting category, detected
  item, neutral explanation, confidence, citation, source URL, retrieval time, and pending reviewer
  status for the three new leads.
- Keep and extend the existing brand/quotation API test so it explicitly proves both legacy findings
  are still returned alongside the new leads.
- Add an end-to-end assertion that the expanded research-lead scope copy is visible and that a
  character fixture renders with a citation.
- Run targeted API and browser tests, followed by the repository's lint, typecheck, test,
  generated-client freshness, build, and mocked end-to-end checks as applicable.
