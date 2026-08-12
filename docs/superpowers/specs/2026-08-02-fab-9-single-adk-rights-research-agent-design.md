# FAB-9: Single ADK-powered rights research agent

## Context

RightsRadar currently performs cloud analysis through service-level orchestration:

1. A direct Vertex Gemini request identifies possible research leads.
2. The service calls Parallel Search for each lead.
3. A second direct Vertex Gemini request selects evidence.

FAB-9 replaces that real-cloud orchestration with one native Google ADK agent while preserving the existing `AgentService` API, the multi-finding case response, deterministic mock mode, and the product's research-assistance-only boundary.

## Goals

- Use exactly one Google ADK Gemini agent for each real Gemini analysis request.
- Make Parallel Search a function tool available to that one agent.
- Preserve multiple findings per script and the existing persisted `Finding` shape.
- Keep mock mode deterministic, local, and free of ADK, Gemini, and network requirements.
- Ensure every displayed source URL and evidence excerpt came from a Parallel tool response.
- Never present legal advice, infringement or ownership conclusions, clearance determinations, permission conclusions, fair-use conclusions, or legal-risk conclusions.

## Non-goals

- Multi-agent delegation, subagents, long-running memory, chat history, or cross-case context.
- Changing the HTTP/OpenAPI contract, case-review UI, repositories, or reviewer workflow.
- Replacing Parallel Search or adding another research provider.
- Making legal or clearance decisions.

## Architecture

`AdkRightsResearchAgentService` will implement the existing `AgentService` protocol:

```text
Case route
  -> AgentService.analyze(case_id, script_text)
     -> AdkRightsResearchAgentService (real Gemini only)
        -> one short-lived ADK session + one LlmAgent (Gemini)
           -> search_parallel function tool (existing ParallelSearchClient)
        -> validated agent response
     -> existing list[Finding] response
```

The ADK agent is the only cloud-analysis orchestrator. It identifies possible research leads, invokes its Parallel Search tool one or more times, and selects at most one primary citation for each lead. It has no subagents and does not call back into the former direct Gemini identify/curate flow.

The ADK runner/session is created per analysis and discarded afterward. It does not persist conversational memory, tool history, or script context across cases.

### Mode selection

- **Cloud mode:** select `AdkRightsResearchAgentService` with a real Vertex/Gemini model and real Parallel Search client.
- **Hybrid mode:** select the ADK service whenever the Gemini integration is real; inject the configured real or mock Parallel client as the agent's tool backend.
- **Mock Gemini mode:** retain a deterministic local `AgentService` implementation built from the existing mock detector and configured Parallel client. It makes no ADK or Gemini request.

This preserves current integration-mode semantics while making all real Gemini analysis flow through one ADK agent.

## Agent and tool contract

The agent receives the script and a research-only instruction set. It may call this function tool for each lead:

```text
search_parallel(research_id, detected_item, category, context_excerpt)
```

The tool delegates to the current `ParallelSearchClient`, serializes only its returned candidates, and records them by `research_id` for the service adapter. A tool result includes the same opaque `research_id` plus candidate title, URL, and excerpt data.

The agent's final response is JSON conceptually shaped as:

```json
{
  "findings": [
    {
      "research_id": "lead-1",
      "category": "brand_reference",
      "detected_item": "Example product",
      "context_excerpt": "...",
      "explanation": "A concise research lead for human review.",
      "confidence": 0.0,
      "primary_url": "https://retrieved.example/source-or-null",
      "rationale": "Why this retrieved source may be useful for follow-up."
    }
  ]
}
```

The implementation will validate this response with Pydantic after the final ADK event rather than depending on ADK `output_schema` structured output. Function-tool workflows need a robust post-run validation path, and this keeps the runtime contract explicit.

The service derives the following server-side, never trusts them from model text, and keeps the existing `Finding` model unchanged:

- finding ID, case ID, retrieval timestamp, and `PENDING` reviewer status;
- primary evidence, alternatives, and source URL list;
- all source titles, URLs, and excerpts.

Validation rejects a finding when its `research_id` was not used in a tool call or its selected `primary_url` was not returned by that matching tool call. A null primary URL remains the existing neutral no-source state. A non-null primary URL still requires a non-empty relevance rationale.

## Research-assistance guardrails

The agent instruction will state that RightsRadar offers research assistance only. It must frame outputs as possible research leads for a human reviewer and must not state or imply conclusions about:

- infringement, ownership, registration, trademark validity, or copyright status;
- permission, licensing, fair use, clearance, or legal risk;
- what a user may legally publish, use, or distribute.

The server adapter will validate generated explanatory and rationale text against the research-assistance policy before persistence. It will reject disallowed legal-conclusion phrasing rather than save or silently rewrite a conclusion. Provider failures, invalid JSON, source-provenance failures, and safety-policy failures all map to the existing safe `AnalysisUnavailableError` path; raw provider diagnostics are not returned or logged.

## Dependency and configuration plan

- Add `google-adk` to the API's `cloud` dependency group.
- Reuse the existing server-only Google Cloud project, location, and Gemini model settings for Vertex-backed ADK configuration.
- Reuse `RIGHTSRADAR_PARALLEL_API_KEY` through the current Parallel adapter; never inject credentials into browser code or agent prompts.
- Keep ADK imports and initialization isolated to the real-Gemini path so a normal mock installation and test run do not require the cloud package or credentials.
- Remove the direct `VertexGeminiClient` identify/curate requests from the real path once the ADK service is in place. The deterministic mock behavior stays available behind the same `AgentService` boundary.

## Failure behavior

Analysis remains all-or-nothing. If the agent cannot produce a valid, source-provenanced, research-only result, the case route returns the existing retryable analysis-unavailable response and does not persist a partially analyzed case. Empty valid findings and valid no-source findings remain permissible research outcomes.

## Verification plan

Automated tests will cover:

1. Dependency wiring for cloud, hybrid, and mock modes.
2. One ADK-agent invocation with the Parallel function tool and no subagent configuration.
3. Multiple findings from one script while retaining the current `list[Finding]` contract.
4. Citation provenance: selected primary and supporting evidence must come from the matching Parallel tool result.
5. Rejection of malformed response JSON, unknown research IDs, invented URLs, and a primary URL without rationale.
6. Rejection of legal-conclusion language before persistence.
7. Existing deterministic mock fixtures and case-route behavior.
8. Linting, type checking, API tests, web tests, generated-client freshness, and the mocked browser workflow.

An opt-in cloud smoke remains manual and uses the configured server-side credentials. It should confirm that the real ADK-backed agent creates focused research leads with traceable Parallel evidence, never a legal conclusion.

## Rollout and compatibility

No frontend or API schema migration is required. `AgentService.analyze()` continues to return `list[Finding]`, and current case storage and review pages remain unchanged. The direct cloud orchestration is replaced behind the boundary, which makes the rollout reversible by changing only dependency wiring if a provider issue emerges.
