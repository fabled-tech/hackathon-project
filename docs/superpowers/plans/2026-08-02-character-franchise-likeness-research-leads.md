# Character, Franchise, and Likeness Research Leads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic character, franchise, and likeness research leads with traceable citations while preserving the existing brand and quotation workflow.

**Architecture:** Reuse the category-agnostic GeminiSignal → ParallelSearchClient → Finding flow. The mock Gemini adapter receives three fictional, case-insensitive detection fixtures and the mock Parallel adapter receives matching evidence fixtures. No API model, persistence, OpenAPI, or generated TypeScript client change is required.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic, pytest, Next.js/React, TypeScript, Playwright, pnpm, and uv.

## Global Constraints

- RightsRadar provides research assistance only; it must not give legal advice or make infringement or clearance determinations.
- New fixture terms must be fictional, deterministic, and case-insensitive.
- New categories are exactly character_reference, franchise_reference, and likeness_reference.
- Every new finding retains a neutral explanation, a confidence in [0, 1], cited evidence, source URL, retrieval timestamp, and pending reviewer status.
- Preserve the existing Nimbus Soda and Time keeps the reel turning behavior, including triggers, explanations, confidence values, and mock citations.
- Do not change the Finding, GeminiSignal, OpenAPI, or generated TypeScript client contract.
- Work only in the isolated FAB-10 worktree on patrick/fab-10-detect-character-franchise-and-likeness-research-leads.

---

## File map

| File | Responsibility |
| --- | --- |
| services/api/app/integrations/gemini.py | Emit the three fictional structured signals with neutral research wording. |
| services/api/app/integrations/parallel.py | Provide one traceable mock evidence record for each new item. |
| services/api/tests/test_cases.py | Exercise the full API pipeline and preserve legacy brand/quotation coverage. |
| apps/web/components/script-review.tsx | Describe all five lead types as potential research leads. |
| tests/e2e/review-workflow.spec.ts | Verify the browser displays expanded scope, disclaimer, and a cited character lead. |

---

### Task 1: Add cited fictional research-lead fixtures

**Files:**
- Modify: services/api/app/integrations/gemini.py
- Modify: services/api/app/integrations/parallel.py
- Modify: services/api/tests/test_cases.py

**Interfaces:**
- Consumes: GeminiClient.identify_material(script_text: str) -> list[GeminiSignal] and ParallelSearchClient.search(detected_item: str, category: str) -> list[SearchResult].
- Produces: generic Finding records whose category is character_reference, franchise_reference, or likeness_reference, populated through the existing agent service.

- [ ] **Step 1: Write the failing API contract test**

Add this test after test_creating_a_case_returns_deterministic_findings in services/api/tests/test_cases.py:

```python
def test_creating_a_case_returns_cited_character_franchise_and_likeness_leads() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    response = client.post(
        "/api/cases",
        json={
            "script_text": (
                "Captain Aurelia opens The Copper Comet Chronicles while Rowan Voss watches. "
                'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
            )
        },
    )

    assert response.status_code == 201
    findings = {finding["category"]: finding for finding in response.json()["findings"]}

    assert findings["character_reference"]["detected_item"] == "Captain Aurelia"
    assert findings["franchise_reference"]["detected_item"] == "The Copper Comet Chronicles"
    assert findings["likeness_reference"]["detected_item"] == "Rowan Voss"
    assert {finding["detected_item"] for finding in findings.values()} == {
        "Captain Aurelia",
        "The Copper Comet Chronicles",
        "Rowan Voss",
        "Nimbus Soda",
        "Time keeps the reel turning",
    }
    for category in ("character_reference", "franchise_reference", "likeness_reference"):
        finding = findings[category]
        assert 0 <= finding["confidence"] <= 1
        assert "research" in finding["explanation"].casefold()
        assert finding["reviewer_status"] == "pending"
        assert finding["retrieved_at"]
        assert finding["supporting_evidence"]
        assert finding["supporting_evidence"][0]["source"]["url"] in finding["source_urls"]
```

- [ ] **Step 2: Run the focused test to confirm the missing categories**

Run:

```bash
cd services/api && UV_CACHE_DIR=$(pwd)/../../.uv-cache uv run python -m pytest tests/test_cases.py::test_creating_a_case_returns_cited_character_franchise_and_likeness_leads -v
```

Expected: FAIL because the API response lacks the three new category keys.

- [ ] **Step 3: Add minimal mock detector signals**

In MockGeminiClient.identify_material, after the existing quotation block, append each signal under a case-insensitive check. Leave the two existing signal blocks unchanged.

```python
if "captain aurelia" in normalized:
    signals.append(
        GeminiSignal(
            category="character_reference",
            detected_item="Captain Aurelia",
            explanation=(
                "The script names a fictional character reference; a reviewer should research "
                "whether it merits follow-up before release."
            ),
            confidence=0.78,
        )
    )
if "the copper comet chronicles" in normalized:
    signals.append(
        GeminiSignal(
            category="franchise_reference",
            detected_item="The Copper Comet Chronicles",
            explanation=(
                "The script names a fictional franchise-style reference; a reviewer should research "
                "its creative source before release."
            ),
            confidence=0.74,
        )
    )
if "rowan voss" in normalized:
    signals.append(
        GeminiSignal(
            category="likeness_reference",
            detected_item="Rowan Voss",
            explanation=(
                "The script names a fictional likeness reference; a reviewer should research "
                "whether it merits follow-up before release."
            ),
            confidence=0.71,
        )
    )
```

- [ ] **Step 4: Add matching traceable mock evidence**

Extend MockParallelSearchClient._FIXTURES with one SearchResult per new exact item:

```python
"Captain Aurelia": SearchResult(
    source=Source(
        title="Captain Aurelia character reference archive (mock)",
        url="https://example.com/captain-aurelia-character-reference",
    ),
    excerpt=(
        "Mock search fixture: Captain Aurelia appears in a fictional character-reference "
        "archive used only for the RightsRadar local workflow."
    ),
),
"The Copper Comet Chronicles": SearchResult(
    source=Source(
        title="The Copper Comet Chronicles franchise reference archive (mock)",
        url="https://example.com/copper-comet-chronicles-franchise-reference",
    ),
    excerpt=(
        "Mock search fixture: The Copper Comet Chronicles appears in a fictional franchise "
        "reference archive used only for the RightsRadar local workflow."
    ),
),
"Rowan Voss": SearchResult(
    source=Source(
        title="Rowan Voss likeness reference archive (mock)",
        url="https://example.com/rowan-voss-likeness-reference",
    ),
    excerpt=(
        "Mock search fixture: Rowan Voss appears in a fictional likeness-reference archive "
        "used only for the RightsRadar local workflow."
    ),
),
```

Keep the category argument unused in MockParallelSearchClient.search; the existing agent service already transfers each source and excerpt into Finding.supporting_evidence and source_urls.

- [ ] **Step 5: Run focused API coverage**

Run:

```bash
cd services/api && UV_CACHE_DIR=$(pwd)/../../.uv-cache uv run python -m pytest tests/test_cases.py -v
```

Expected: PASS, including the five-fixture test and the unchanged legacy brand/quotation test.

- [ ] **Step 6: Commit the backend slice**

```bash
git add services/api/app/integrations/gemini.py services/api/app/integrations/parallel.py services/api/tests/test_cases.py
git commit -m "feat: detect additional research leads"
```

### Task 2: Frame expanded findings as research assistance in the browser

**Files:**
- Modify: apps/web/components/script-review.tsx
- Modify: tests/e2e/review-workflow.spec.ts

**Interfaces:**
- Consumes: the unchanged Case and Finding interfaces exported by @rightsrader/api-client.
- Produces: a visible research-only scope statement while retaining the generic category, evidence, citation, and human-review card behavior.

- [ ] **Step 1: Write the failing browser workflow test**

Add this test beside the current end-to-end finding workflow tests:

```typescript
test('frames cited character leads as research assistance', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Potential research leads')).toBeVisible();
  await expect(page.getByText(/characters, franchises, and likenesses/i)).toBeVisible();
  await expect(page.getByLabel('Legal disclaimer')).toContainText('Research assistance only.');

  await page.getByLabel('Script text').fill('Captain Aurelia enters the archive.');
  await page.getByRole('button', { name: 'Analyze script' }).click();

  const characterFinding = page.getByTestId('finding-card').filter({ hasText: 'Captain Aurelia' });
  await expect(characterFinding).toContainText('character reference');
  await expect(characterFinding).toContainText('character reference archive');
  await expect(characterFinding).toContainText('research');
});
```

- [ ] **Step 2: Run the focused browser test to confirm wording is absent**

Run:

```bash
pnpm exec playwright test tests/e2e/review-workflow.spec.ts --grep "frames cited character leads as research assistance"
```

Expected: FAIL because the hero lacks Potential research leads and the expanded scope copy. The citation assertions become available after Task 1.

- [ ] **Step 3: Update scope and result headings**

In apps/web/components/script-review.tsx, replace the hero paragraph and results heading with the following exact wording:

```tsx
<p className="hero-copy">
  Surface potential research leads for brands, quotations, characters, franchises, and likenesses,
  then let a human reviewer decide what needs follow-up.
</p>

<h2 id="findings-heading">Potential research leads</h2>
```

Do not change the disclaimer, the generic category formatter, evidence/citation markup, reviewer actions, or API calls.

- [ ] **Step 4: Run the focused browser test**

Run:

```bash
pnpm exec playwright test tests/e2e/review-workflow.spec.ts --grep "frames cited character leads as research assistance"
```

Expected: PASS; the browser shows expanded scope, the legal disclaimer, a character category label, and a cited mock source.

- [ ] **Step 5: Commit the browser slice**

```bash
git add apps/web/components/script-review.tsx tests/e2e/review-workflow.spec.ts
git commit -m "feat: frame findings as research leads"
```

### Task 3: Verify the completed FAB-10 change

**Files:**
- Modify: none expected.
- Test: services/api/tests/test_cases.py
- Test: tests/e2e/review-workflow.spec.ts

**Interfaces:**
- Consumes: the completed backend and browser slices.
- Produces: evidence that FAB-10 adds the three research lead types without altering the public API contract or legacy workflows.

- [ ] **Step 1: Confirm API-client freshness**

Run:

```bash
make check-client
```

Expected: PASS with no generated-file diff because the FastAPI contract did not change.

- [ ] **Step 2: Run static checks**

Run:

```bash
make lint
make typecheck
```

Expected: both commands exit zero.

- [ ] **Step 3: Run all unit and browser tests**

Run:

```bash
make test
make e2e
```

Expected: all Python, Vitest, and mocked Playwright tests pass, including the existing brand/quotation flow and the new cited-character flow.

- [ ] **Step 4: Run production build verification**

Run:

```bash
make build
```

Expected: the Python distribution and Next.js production app build successfully.

- [ ] **Step 5: Inspect the final worktree**

Run:

```bash
git diff HEAD~2..HEAD --check
git status --short
```

Expected: no whitespace errors and no uncommitted FAB-10 changes.
