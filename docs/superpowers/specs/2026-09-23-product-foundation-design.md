# Puma Utilities — Product Foundation Design

Date: 2026-09-23
Status: Proposed for implementation as PR #27
Branch: `puma/product-foundation-v1`
Base: verified production `main` at `fd3978df5976fd7816c6a2d7df1314836db36f42`

## 1. Purpose

Puma Utilities has reached the point where adding more features on top of the current UI structure would create more regressions than progress. The next phase is therefore not a visual redesign and not a backend rewrite. It is a focused product-foundation refactor that preserves the working CRM, research, monitoring, workspace persistence, and PWA behavior while replacing the patch-on-patch application shell with clear screen boundaries and one dependable navigation system.

The intended outcome is a top-tier, minimal, mobile-first SaaS/PWA experience where every visible control has a clear purpose, every primary route behaves consistently, and future feature work can be added without duplicating shells or hiding old UI with CSS.

## 2. Product principles

1. **Minimal surface area.** Show only current, useful information. Avoid decorative dashboard modules and duplicate calls to action.
2. **Functional over ornamental.** Every visible button, tab, row, and link must either perform a real action, navigate somewhere useful, or be removed.
3. **One app shell.** Home, Companies, Find Leads, Monitor, and Settings must share one navigation/header framework instead of each route rebuilding its own shell.
4. **Preserve trusted logic.** Research, CRM data structures, monitoring rules, workspace persistence, and evidence gating are outside the scope of this foundation refactor unless a shell change requires a narrow adapter.
5. **Mobile PWA first, desktop still first-class.** iPhone standalone mode defines the tightest constraints; desktop should remain spacious and efficient without becoming a separate product.
6. **Progressive disclosure.** Advanced details stay available, but the default screen remains calm and readable.
7. **No hidden duplicate implementation.** A feature must have one canonical rendering path. Old hidden components, portal-injected replacements, or CSS-based duplicate suppression should be removed as part of migration.

## 3. Scope

### In scope

- Create one shared application shell used by the primary product routes.
- Centralize route definitions, primary navigation items, labels, icons, active-state logic, and settings placement.
- Render the Home experience directly from its canonical component instead of overlaying/replacing older Home sections.
- Make the Home screen intentionally minimal: greeting/date plus one `Today at a glance` KPI surface.
- Standardize iPhone safe-area handling, bottom navigation, desktop sidebar, page header spacing, and settings access.
- Move route-specific layout responsibilities out of duplicated inline style blocks where practical.
- Preserve all current route destinations and user data.
- Add regression coverage for shared-shell behavior, navigation targets, active states, safe-area rules, and the minimal Home contract.
- Remove obsolete or unreachable UI code made redundant by the new shell.

### Out of scope

- Rewriting the research engine.
- Changing evidence scoring or qualification logic.
- Replacing the workspace persistence model.
- Redesigning company lifecycle semantics.
- Building new CRM features such as tasks, calendar sync, automation, or email sequencing.
- Redesigning the Data Sources backend.
- Reworking monitoring business rules.
- Changing visual brand assets beyond what is required for consistent shell usage.
- Large schema migrations.

Those items belong to later functionality phases after the foundation is stable.

## 4. Current problems to remove

The current app has several structural issues that increase regression risk:

- The main workspace component still contains older Home rendering while newer Home behavior has been layered on through separate dashboard/portal behavior and CSS suppression.
- Settings routes reuse visual patterns from the workspace, but parts of their shell and navigation have historically depended on route-specific CSS, which caused iPhone overlap/clipping regressions.
- Navigation markup and active-state behavior are duplicated between the workspace and Settings shell.
- App-shell styling is split across inline component styles and several CSS generations, making cascade order part of application correctness.
- Route-specific fixes can unintentionally affect global navigation because `.pm-bottom-nav` and related selectors are shared across old/new implementations.
- Some old UI affordances remain in source even after being visually hidden, increasing confusion and test fragility.

The foundation pass should replace those structural problems rather than add another compatibility layer.

## 5. Architecture

### 5.1 Shared AppShell

Introduce a single reusable `PumaAppShell` component responsible for:

- product brand/header
- mobile safe-area top treatment
- primary mobile bottom navigation
- desktop sidebar navigation
- active-route state
- Settings launcher/location
- page content viewport
- consistent bottom padding for installed PWA mode
- optional global microphone/voice entry point when the current route supports it

The shell receives children/content and route metadata rather than owning business logic.

Conceptually:

```tsx
<PumaAppShell currentRoute="clients" pageLabel="Companies" voiceAction={...}>
  <CompaniesScreen />
</PumaAppShell>
```

Settings pages use the same shell contract rather than a separate bottom-nav implementation.

### 5.2 Central navigation model

Define primary navigation in one module, for example:

```ts
export const PRIMARY_NAV = [
  { id: 'home', href: '/', label: 'Home', icon: ... },
  { id: 'clients', href: '/clients', label: 'Companies', icon: ... },
  { id: 'engine', href: '/engine', label: 'Find Leads', icon: ... },
  { id: 'monitor', href: '/monitor', label: 'Monitor', icon: ... },
];
```

Settings remains visually distinct from the four primary destinations but uses the same route helper/active-state system.

No route component should define a separate primary nav list.

### 5.3 Screen boundaries

Split screen-level rendering from shared workspace state handling.

Target structure:

- `PumaAppShell`
- `PumaHomeScreen`
- `PumaCompaniesScreen`
- `PumaCompanyScreen`
- `PumaBuildingsScreen`
- `PumaBuildingScreen`
- `PumaFindLeadsScreen`
- `PumaMonitorScreen`
- `PumaSettingsScreen` / nested Settings pages

This PR does not need to fully decompose every large business component if doing so would introduce risk. It should, however, establish clean boundaries so the shell and Home are canonical and future PRs can move Companies/Research/Monitor incrementally.

### 5.4 Workspace ownership

Workspace loading/mutation remains client-side and keeps the existing persistence functions. The foundation should avoid introducing a new state-management library.

The workspace owner may remain a high-level client component for this PR, but route screens should receive only the data/actions they need wherever practical.

The key requirement is that the shell itself remains business-logic agnostic.

## 6. Home design

Home should have one job: show the user the current state of work without becoming another module.

### Required content

- Date/time
- `Welcome` or `Welcome, {profileName}`
- One compact `Today at a glance` group containing exactly three real metrics:
  - Follow-ups today
  - Prospects
  - Alerts

Each metric is a real navigation target:

- Follow-ups / Prospects → Companies
- Alerts → Monitor

### Empty state

Even with zero companies, Home should preserve the same visual structure instead of swapping to a large promotional empty-state card. Metrics simply show `0` where appropriate.

The user should navigate with the persistent app navigation, not a large duplicate `Find companies` CTA on Home.

### Explicitly removed from Home

- Tasks
- Next actions
- Quick actions
- Jump back in
- Recent activity
- centered decorative Puma logo
- Profile shortcut inside Home content
- large empty-state explanation cards

## 7. Navigation behavior

### Mobile

- Four persistent primary destinations: Home, Companies, Find Leads, Monitor.
- Settings remains a separate bottom-right control, visually distinct but aligned with the dock.
- Each tap target is at least 44x44 CSS pixels.
- `touch-action: manipulation` for nav controls.
- Bottom dock and Settings respect `env(safe-area-inset-bottom)`.
- Active state is derived from route identity, not duplicated local booleans.
- No hamburger/drawer duplicate navigation on mobile.

### Desktop

- Persistent left sidebar with the same four primary destinations.
- Settings/profile access at the bottom of the sidebar.
- Main content width expands appropriately without changing route semantics.

### Back navigation

Nested pages keep explicit contextual back links where useful, for example:

- Profile → Settings
- Data Sources → Settings
- Building → Buildings
- Buildings → Company

The app should not depend on browser history for essential navigation.

## 8. Settings integration

Settings remains a lightweight hub with dedicated child pages:

- Profile
- Data Sources

These pages must render inside the same AppShell and inherit the same PWA safe areas and navigation rules as every other screen.

The Profile page retains display-name persistence.

Data Sources retains current functional behavior. This foundation PR should not expand its backend capabilities.

## 9. Styling strategy

### Goals

- One canonical shell stylesheet or well-scoped shell module.
- Route screens may keep their own scoped styles.
- Eliminate shell-critical dependencies on CSS load order across multiple old generations where feasible.
- Avoid generic selectors that cause Settings and workspace nav to fight each other.

### Safe-area contract

Top:

```css
padding-top: env(safe-area-inset-top);
```

Bottom:

```css
padding-bottom: calc(var(--dock-space) + env(safe-area-inset-bottom));
```

The exact values can be tuned, but safe-area ownership belongs to the shared shell, not individual pages.

## 10. PWA reliability

The refactor must preserve:

- manifest metadata
- service-worker registration/update behavior
- current Home Screen icon endpoints
- `viewport-fit=cover`
- standalone-friendly status-bar treatment
- existing app update manager

The foundation PR must not change PWA icon generation unless required by a failing regression discovered during implementation.

Any change to service-worker cache names must be deliberate and covered by tests.

## 11. Error and loading behavior

- Initial workspace loading uses one consistent shell-aware loading state.
- Route-level missing entities display a useful recovery action, not just dead text.
- A failed optional feature must not break primary navigation.
- Voice errors remain non-blocking and dismissible.
- Navigation itself should never depend on workspace hydration.

## 12. Testing strategy

### Regression tests

Add or update tests to assert:

- one canonical primary-nav definition
- one shared AppShell used by root and Settings routes
- mobile nav contains Home, Companies, Find Leads, Monitor
- Settings remains separate from the four primary nav items
- every primary route target exists
- Home contains `Today at a glance`
- Home contains only the approved three metrics
- Home does not render Tasks, Next actions, Quick actions, Jump back in, or Recent activity
- Home zero-data state still uses the same compact structure
- shell contains safe-area top and bottom handling
- mobile tap targets meet minimum sizing contract
- desktop nav and mobile nav share route definitions
- no duplicate primary nav implementation remains in Settings

### Existing suite

The full existing test suite, typecheck, and Next.js build must remain green.

### Deployment verification

On the exact final branch head:

- Vercel preview reaches `READY`
- `/` returns 200
- `/clients` returns 200
- `/engine` returns 200
- `/monitor` returns 200
- `/settings` returns 200
- `/settings/profile` returns 200 where preview auth permits direct fetch
- `/settings/data-sources` returns 200 where preview auth permits direct fetch
- `/apple-touch-icon` returns `image/png` and HTTP 200
- production runtime-error baseline remains clean after merge

## 13. Migration sequence

1. Add regression tests for the desired shell/navigation/Home contract.
2. Introduce centralized route/navigation definitions.
3. Introduce `PumaAppShell` with mobile and desktop navigation.
4. Move Settings routes onto the shared shell.
5. Replace layered/portal Home behavior with one direct canonical Home renderer.
6. Remove obsolete Home/dashboard rendering and shell duplication made unreachable.
7. Consolidate shell-critical CSS and safe-area ownership.
8. Run the complete existing test/build pipeline.
9. Verify the exact Vercel preview and primary routes.
10. Open PR #27 for manual merge.

## 14. Acceptance criteria

PR #27 is complete only when all of the following are true:

- There is one shared shell for primary routes and Settings.
- There is one canonical primary navigation model.
- Home directly renders the final minimalist experience without portal replacement or CSS hiding of an older Home.
- Home always shows greeting/date plus one `Today at a glance` surface with Follow-ups, Prospects, and Alerts.
- Settings pages use the same shell and safe-area handling.
- Mobile primary navigation and Settings are reliably tappable in installed-PWA layout.
- Existing CRM/research/monitor behavior is preserved.
- Obsolete duplicate shell/Home code introduced by prior patch generations is removed where it becomes unreachable.
- Full tests, typecheck, and Next build pass on the exact final commit.
- Vercel preview is READY and route smoke tests pass.
- No production merge is performed automatically; the user retains manual merge control.

## 15. Follow-on phases

Once this foundation is merged and stable:

### PR #28 — CRM Functionality

Make Companies fully operational: follow-up workflows, empty-state actions, editing reliability, lifecycle/filter UX, company/building/contact/activity workflows, and removal of dead controls.

### PR #29 — Research + Monitor

Harden Find Leads → research → save → company, loading/failure feedback, source-management behavior, Monitor drill-down, and action confirmation.

### Final visual QA

Run an iPhone-installed-PWA and desktop refinement pass after functionality is stable, so visual polish is applied to the final architecture instead of being used to hide structural problems.
