# Puma Research + Monitor Hardening Design

## Context

Puma Utilities already has a real bounded research engine, evidence graph, safe graph-to-CRM projection, a Find Leads UI, CRM persistence, and client-authorized Monitor alerts. This phase does not replace those foundations. It hardens the existing backend and connects the workflow more cleanly from discovery through saved CRM records and into Monitor drill-down.

This design continues the approved Puma product model: Puma itself is the CRM, public research remains evidence-backed, unknown remains unknown, and client-authorized monitoring stays strictly separated from public prospect research.

## Goals

1. Make multi-market lead discovery resilient to partial upstream failures instead of failing the whole request when one search fails.
2. Improve research-run diagnostics without exposing unsafe implementation details or weakening bounded execution.
3. Make the Find Leads → Research → Save → Company workflow explicit and operational, with clear success, partial-success, and error states.
4. Preserve safe/idempotent research projection so repeat saves update existing records instead of duplicating companies, contacts, buildings, utilities, parcels, or tariffs.
5. Make Monitor alerts drill into the exact company/building context while preserving the existing Client-stage + client-authorized data gate.
6. Add focused regression coverage, then require full Tests + TypeScript + Next build before the branch is considered ready.

## Non-goals

- Do not replace the research graph or runner architecture.
- Do not add fabricated web scraping, contact guessing, or fake integrations.
- Do not auto-save research into CRM.
- Do not treat missing, blocked, redacted, ambiguous, or unavailable source data as a negative finding.
- Do not allow public research evidence to enter client-authorized monitoring.
- Do not redesign the entire Puma shell or CRM in this phase.
- Do not introduce a new external database or deployment dependency.

## Architecture

### 1. Discovery hardening

`app/api/research/discover/route.ts` remains the bounded server entry point. The current all-or-nothing fanout is replaced with a partial-failure-tolerant aggregation model.

Each market/query attempt produces either a normal search response or a structured failure diagnostic. Successful hits are still passed through the existing `aggregateDiscoveryCandidates` logic. A failed query does not discard successful results from other markets. The endpoint returns candidates plus a compact warning/diagnostic summary when any query fails.

The route still enforces request size, geography limits, result-count bounds, and server-controlled search configuration. Client input never controls arbitrary search endpoints.

If every search attempt fails, the route returns a failure response rather than pretending that an empty candidate list means no companies exist.

### 2. Research-run diagnostics

The deep runner already isolates source-task failures and retries bounded retryable tasks. That behavior stays intact.

The UI should surface existing run information more clearly: stop reason, completed/blocked/failed task counts, effort/budget consumption, evidence count, unresolved gaps, and a concise warning when the run ended with partial source failure.

No diagnostic text should promote failed/blocked source attempts into negative business facts.

### 3. Find Leads → Research → Save → Company

`PumaResearchPanel` remains the Find Leads surface.

The workflow becomes explicit:

1. Discover candidate companies.
2. Select a candidate or enter a company manually.
3. Run deep research.
4. Review evidence-backed results and unresolved gaps.
5. Press `Save to Prospects` explicitly.
6. Receive a save summary showing created/updated company state and counts of contacts, properties, utilities, parcels, and tariffs added.
7. Offer a direct link/action into the saved company record.

Save must remain user-triggered. Research results are never auto-written into CRM.

The existing `mergeResearchRunIntoWorkspace` remains the projection boundary. Manual/user-entered CRM edits and research-owned verified-public fields retain their distinct semantics.

### 4. Idempotent projection and evidence safety

Repeat-saving the same research run or a later run for the same company must update/merge rather than create duplicate CRM entities.

The projection layer must continue to persist only supported/verified claims that meet the existing trust threshold. INFERRED, CONFLICTED, UNRESOLVED, discovery-only, ambiguous, or below-threshold claims must remain out of verified-public CRM fields.

Existing user-entered data must not be silently relabeled as verified-public. Existing verified-public provenance must not be attached to newly edited manual values.

Deduplication continues to use normalized identity within the appropriate parent scope:

- company by normalized company identity,
- contact/person by stable research identity and existing merge rules,
- property by normalized identity within company,
- utility by provider within property,
- parcel by identifier within property,
- tariff by normalized published text/label within utility.

Ambiguous unrelated entities must never be silently merged.

### 5. Monitor drill-down hardening

`buildMonitorAlerts(workspace)` remains the authoritative alert-generation boundary.

Only companies at stage `Client` and readings with status `client-authorized` may produce Monitor alerts. Public research, inferred utility capability, tariff research, estimated benchmarks, or prospect data must never create a Monitor alert.

The Monitor UI should make each alert actionable by linking to the alert's company/building route and showing the relevant building, meter/read-period context available on the alert. The drill-down must not expose data from a different company/property through mismatched IDs.

No change in this phase should broaden alert eligibility.

### 6. Failure states

The product should distinguish:

- complete success,
- partial success with source/query warnings,
- no credible candidates found,
- all discovery attempts failed,
- deep research returned evidence but with blocked/failed tasks,
- research request failed entirely,
- save succeeded with a merge summary,
- save could not complete because the result lacks a valid company root.

Messages should explain what happened operationally without inventing factual conclusions about the researched company.

## Data flow

### Discovery

Browser → `POST /api/research/discover` → bounded market/query fanout → search backend(s) → partial-failure-tolerant aggregation → ranked candidates + diagnostics → browser.

### Deep research

Browser → `POST /api/research/run` → research graph seed → bounded runner/task planner → source adapters → evidence/claims/entities → `ResearchRunResult` → browser review.

### Save

Browser result + current local workspace → `mergeResearchRunIntoWorkspace` → evidence-safe merged workspace + `ResearchMergeSummary` → `saveWorkspace` → direct company navigation available.

### Monitor

Local workspace → `buildMonitorAlerts` → client-authorized alerts only → Monitor list → exact building detail route.

## Files expected to change

Primary implementation targets:

- `app/api/research/discover/route.ts`
- `app/components/puma-research-panel.tsx`
- `app/components/puma-workspace-app-v4.tsx`
- `lib/research/workspace-projection.ts`
- `lib/monitor.ts` only if additional safe alert context is needed
- focused tests under `tests/`
- `package.json` only if the new focused regression test is not already included by the existing test pattern/script

The implementation should avoid unrelated refactors.

## Testing requirements

Focused tests must cover at least:

1. One failed discovery query does not discard successful candidates from other queries.
2. All discovery queries failing returns an error instead of a false `no candidates` success.
3. Discovery diagnostics do not alter candidate evidence/trust semantics.
4. Saving a research result creates the expected CRM records without persisting unsupported claims.
5. Saving the same/equivalent result again does not duplicate company/property/utility/parcel/tariff records.
6. Existing user-entered data is not upgraded to verified-public merely because research is saved nearby.
7. Save summary exposes the correct target company ID/counts for direct navigation.
8. Monitor alerts still require both Client stage and client-authorized readings.
9. Public research/estimated/unknown data cannot create Monitor alerts.
10. Each rendered Monitor alert links to the exact company/building route represented by the alert IDs.

Final verification requires:

- full repository test suite,
- TypeScript typecheck,
- production Next.js build,
- GitHub Actions success on the final branch head.

## Success criteria

This phase is successful when Puma can tolerate degraded discovery sources, still return trustworthy candidates from successful searches, research a company with bounded/evidence-aware diagnostics, save the research into the existing CRM with a clear merge summary and direct company handoff, and let authorized Monitor alerts drill into their exact building without weakening evidence or authorization boundaries.
