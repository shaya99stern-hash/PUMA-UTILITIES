# Minimal Settings Navigation Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Puma Utilities more minimal on iPhone by moving profile and data-source configuration into dedicated Settings pages while simplifying Home and Find Leads.

**Architecture:** Keep `PumaWorkspaceApp` as the shared application shell, add dedicated Settings subroutes for Profile and Data Sources, and keep research capability fetching reusable so Settings can present source status without duplicating lead-finding UI. Preserve the existing bottom navigation and workspace behavior.

**Tech Stack:** Next.js App Router, React/TypeScript, CSS, Node test runner, Vercel.

## Global Constraints

- Home shows only the header, date/time, and Welcome content; remove the visible Profile affordance and empty-state/CTA/decorative center content.
- Settings is a minimal hub with two rows: Profile and Data Sources.
- Profile and Data Sources each open their own dedicated route/page.
- Data Sources is minimal management: source name, status/on-off state where supported, and Add Source. Do not expose diagnostics/capability prose by default.
- Find Leads retains Markets, Advanced filters, Research one company, and Advanced; remove the Data Sources disclosure.
- Keep the bottom-right Settings tab as the sole settings entry point in the main navigation.
- Do not alter research, CRM, billing, monitoring, or workspace data semantics.

---

### Task 1: Lock the minimal navigation behavior with regression tests

**Files:**
- Modify: `tests/product-quality-v9.test.ts`
- Modify: `tests/minimal-companies-ui.test.ts` if required by current assertions

**Interfaces:**
- Consumes: current `PumaWorkspaceApp`, `PumaResearchPanel`, and App Router route files.
- Produces: assertions for the approved Home, Settings hub, Profile route, Data Sources route, and Find Leads behavior.

- [ ] **Step 1: Add the focused failing test**
  - Assert Home no longer renders `pm-home-settings`, `pm-zero-state`, `No companies yet`, or `Find real companies` inside `renderHome`.
  - Assert Settings hub links to `/settings/profile` and `/settings/data-sources`.
  - Assert dedicated route files exist for Profile and Data Sources.
  - Assert `PumaResearchPanel` no longer contains the `Data sources` disclosure.
- [ ] **Step 2: Verify the relevant failure**
  - Run: `npm test -- --test-name-pattern="settings|Home|Data Sources|Find Leads"`
  - Expected: failures proving the old profile/empty-state/source UI still exists and dedicated routes are missing.
- [ ] **Step 3: Implement no production code in this task.**
- [ ] **Step 4: Keep the focused test red until Tasks 2–4 land.**
- [ ] **Step 5: Run the affected integration check after Task 4.**
- [ ] **Step 6: Commit together with the first passing production deliverable.**

### Task 2: Add Settings hub and dedicated Profile/Data Sources routes

**Files:**
- Modify: `app/components/puma-workspace-app-v4.tsx`
- Create: `app/settings/profile/page.tsx`
- Create: `app/settings/data-sources/page.tsx`
- Modify: `app/puma-responsive-v6.css`

**Interfaces:**
- Consumes: `PumaWorkspaceApp` shared shell and `PROFILE_KEY` local-storage behavior.
- Produces: new `PumaView` variants or settings subview handling for the hub, profile page, and data-sources page.

- [ ] **Step 1: Use the failing tests from Task 1.**
- [ ] **Step 2: Verify route-specific assertions fail.**
- [ ] **Step 3: Implement the minimum behavior**
  - Settings hub renders two simple rows with chevrons: Profile and Data Sources.
  - Profile page renders Back to Settings, Display name field, and Save behavior using the existing profile storage logic.
  - Data Sources page renders a compact list of known source groups/statuses plus an Add Source control; status should be derived from the existing research capability endpoint where possible.
  - Avoid nested cards and avoid diagnostics paragraphs.
- [ ] **Step 4: Verify the focused pass for settings navigation.**
- [ ] **Step 5: Run `npm test -- --test-name-pattern="settings|profile|Data Sources"`.**
- [ ] **Step 6: Commit the passing deliverable.**

### Task 3: Simplify Home to the approved minimal surface

**Files:**
- Modify: `app/components/puma-workspace-app-v4.tsx`
- Modify: `app/puma-responsive-v6.css`

**Interfaces:**
- Consumes: existing `profileName`, `now`, `formatLongDate`, and `formatClock` state/helpers.
- Produces: minimal Home rendering with only date/time and Welcome content beneath the shared app header.

- [ ] **Step 1: Use the failing Home assertions from Task 1.**
- [ ] **Step 2: Verify old Profile/empty-state content still fails the test.**
- [ ] **Step 3: Remove Home profile shortcut, zero-state card, centered Puma mark, explanatory copy, CTA, stat strip, follow-up panel, and recent-company panel from `renderHome`.
- [ ] **Step 4: Verify Home-focused tests pass.**
- [ ] **Step 5: Run `npm test -- --test-name-pattern="Home|minimal"`.**
- [ ] **Step 6: Commit the passing deliverable.**

### Task 4: Remove Data Sources from Find Leads and tighten spacing

**Files:**
- Modify: `app/components/puma-research-panel.tsx`
- Modify: `app/puma-responsive-v6.css`
- Modify: `tests/product-quality-v9.test.ts`

**Interfaces:**
- Consumes: current research capability fetch for button enablement and research execution.
- Produces: lead-finding UI containing only Markets, Advanced filters, discovery action, Research one company, State, Advanced/Website hint, and research action.

- [ ] **Step 1: Use the failing Find Leads assertion from Task 1.**
- [ ] **Step 2: Verify `Data sources` is still present before the change.**
- [ ] **Step 3: Remove only the visible Data Sources disclosure; retain capability fetching because discovery availability depends on it. Tighten vertical spacing in the two primary research cards without changing request semantics.
- [ ] **Step 4: Verify focused tests pass.**
- [ ] **Step 5: Run `npm test && npm run build`.
- [ ] **Step 6: Commit the passing deliverable and verify Vercel preview READY.**

## Unresolved externally observable decisions

None. The user approved dedicated Profile and Data Sources pages and selected minimal Data Sources management (Option A).
