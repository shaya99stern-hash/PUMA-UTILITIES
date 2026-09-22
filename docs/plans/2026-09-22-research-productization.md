# Puma Research Productization Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing bounded research engine into a production Find Leads workflow that researches companies, recursively discovers properties/utilities, presents evidence/confidence, and saves trusted results into Puma's CRM without fabricating certainty.

**Architecture:** Keep the current Next.js 16 / React 19 local-workspace architecture and the existing research graph as source truth. Add a bounded server API on `main`, extend first-party crawling with conservative property-address extraction, introduce a pure graph-to-workspace projection layer that only persists supported/verified facts, and wire the existing `/engine` view to run/review/save research. Preserve the iPhone/PWA shell and existing lifecycle, voice, AP, monitoring, and client routes.

**Tech Stack:** TypeScript 5.9, Next.js 16 App Router, React 19, Node test runner via tsx, Vercel Git deployments.

## Global Constraints

- Never convert missing data into a negative finding.
- Never persist INFERRED, CONFLICTED, or UNRESOLVED claims as verified-public CRM facts.
- Public prospect research remains separate from client-authorized monitoring.
- General web discovery is server-controlled via `PUMA_SEARXNG_URL`; never accept an arbitrary search endpoint from the browser.
- All research budgets, request sizes, concurrency, crawl depth, page sizes, and redirects remain bounded.
- Preserve existing local-workspace data and current PWA routes.
- Keep production on the current main deployment until preview verification passes.

---

### Task 1: Productization contract and regression gate

**Files:**
- Create: `tests/research-productization.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: current research graph, company website ingestion, current Puma shell.
- Produces: failing assertions for missing API, missing Find Leads wiring, missing property recursion, and missing workspace projection.

- [ ] **Step 1: Add the focused failing test**
- [ ] **Step 2: Verify the relevant failure** using the Vercel preview build (`npm test && npm run build`).
- [ ] **Step 3: Implement only after the failure is observed.**

### Task 2: Bounded API + first-party property recursion

**Files:**
- Create: `app/api/research/run/route.ts`
- Modify: `lib/research/sources/company-website.ts`
- Modify: `lib/research/ingest.ts`

**Interfaces:**
- Consumes: `runResearch(graph, rootEntityId, options)`, `PUMA_SEARXNG_URL`.
- Produces: GET capability status; POST bounded research runs; optional public website hint; discovered property entities linked to the root company through supported `property.manager` claims.

- [ ] Validate company label/state/website hint and body size.
- [ ] Seed a website hint only as INFERRED; direct crawling must promote it through first-party evidence.
- [ ] Extract only conservative US street-address patterns from first-party pages and retain the exact source URL.
- [ ] Recurse into discovered property entities through the existing runner.

### Task 3: Safe research graph → CRM projection

**Files:**
- Create: `lib/research/workspace-projection.ts`
- Modify: `lib/types.ts`

**Interfaces:**
- Consumes: `ResearchRunResult`, current `Workspace`.
- Produces: `mergeResearchRunIntoWorkspace(workspace, result)` with company/property/utility/provenance additions and a merge summary.

- [ ] Persist only VERIFIED/SUPPORTED claims at confidence >= 0.70 as `verified-public`.
- [ ] Preserve evidence URLs/retrieval times as provenance.
- [ ] Deduplicate by normalized company/property identity without silently merging ambiguous unrelated entities.
- [ ] Keep web discovery candidates visible in the research review but out of verified CRM fields until corroborated.

### Task 4: Live Find Leads workflow in the existing PWA shell

**Files:**
- Modify: `app/components/puma-workspace-app-v4.tsx`

**Interfaces:**
- Consumes: GET/POST `/api/research/run`; `mergeResearchRunIntoWorkspace`.
- Produces: company/state/optional website research form, running/error/result states, evidence summary, trusted contacts/properties/utilities, and explicit `Save to Prospects`.

- [ ] Keep the existing visual system rather than introducing a second design language.
- [ ] Surface whether general web discovery is configured.
- [ ] Show completeness, stop reason, task counts, blocked/failed counts, and source-backed facts.
- [ ] Save only after user presses `Save to Prospects`; never auto-write research into CRM.

### Task 5: Preview verification and production promotion

**Files:** no product files beyond fixes proven necessary by verification.

**Interfaces:**
- Consumes: GitHub/Vercel preview.
- Produces: verified PR and exact production commit/deployment.

- [ ] Run full repository test/build via Vercel.
- [ ] Smoke `/engine`, API GET, validation failure, and a bounded research request on preview.
- [ ] Confirm PWA/client routes still render.
- [ ] Merge only the verified head SHA into `main`.
- [ ] Confirm the exact merged SHA is the Vercel production deployment and scan production runtime errors.
