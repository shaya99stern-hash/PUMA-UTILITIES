# Puma Utilities Product Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Puma Utilities' patch-on-patch shell/Home implementation with one canonical application shell, one route/navigation model, and one direct minimalist Home screen while preserving the existing CRM, research, monitoring, workspace persistence, voice, and PWA behavior.

**Architecture:** Keep Next.js App Router and the existing client-side workspace owner. Introduce a pure navigation model, a shared `PumaAppShell`, a canonical `PumaHomeScreen`, and a content-only Settings page wrapper. Migrate the existing workspace and Settings routes onto the shared shell without rewriting business logic. Use new `pu-*` shell class names so retired `.pm-*` shell selectors cannot control correctness. Remove portal-injected Home, global Settings-launcher patching, duplicate Settings navigation, and CSS that hides obsolete Home implementations.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, lucide-react, local workspace persistence, existing browser voice workflow, Vercel PWA deployment.

**Spec:** `docs/superpowers/specs/2026-09-23-product-foundation-design.md`

## Global Constraints

- Preserve current CRM data structures, company lifecycle semantics, research engine/evidence gating, monitoring rules, Data Sources behavior, local workspace persistence, and voice-note behavior.
- Home must render directly and contain only date/time, Welcome, and one `Today at a glance` surface with Follow-ups, Prospects, and Alerts.
- Home must keep that same structure when all counts are zero; no promotional zero-state card.
- Mobile primary navigation remains exactly Home / Companies / Find Leads / Monitor; Settings remains a separate control.
- Desktop uses the same primary navigation model and a separate Settings entry at the bottom of the sidebar.
- Essential navigation must render even before workspace hydration completes.
- All mobile navigation targets must be at least 44×44 CSS pixels and use `touch-action: manipulation`.
- Shared-shell safe-area ownership must use `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
- Keep current manifest, service-worker update behavior, PWA icon metadata/endpoints, and `viewport-fit=cover` unchanged unless a failing regression requires a narrowly scoped correction.
- Do not add a new state-management dependency.
- Each implementation task must end with its own focused green verification; no task may be committed while its named verification target is expected to remain red.
- Do not automatically merge PR #27; the user retains manual merge control.

## Review Focus

These are the five highest-risk failure modes every implementation/review pass must explicitly check:

1. **Hydration-dependent navigation:** the shell disappears or becomes untappable while local workspace data is loading.
2. **Route-active-state drift:** nested Companies or Settings pages highlight the wrong destination because route identity is duplicated instead of centralized.
3. **CSS cascade regression:** old `.pm-bottom-nav`, `.pm-settings-shell`, or launcher selectors still affect the new shell and recreate iPhone clipping/overlap.
4. **Home duplication/data drift:** portal/duplicate Home logic survives and computes counts independently from the canonical workspace owner.
5. **PWA regression:** shell/layout work changes viewport, safe areas, service-worker registration, or icon endpoints and breaks installed-iPhone behavior.

---

### Task 1: Lock the foundation contract with failing tests

**Files:**
- Create: `tests/product-foundation-shell.test.ts`
- Modify: `tests/iphone-dashboard-polish.test.ts`
- Modify: `tests/minimal-settings-navigation.test.ts`
- Modify: `package.json`

**Interfaces under test:**
- Future `lib/puma-navigation.ts` exports a single `PRIMARY_NAV` model plus a Settings route.
- Future `app/components/puma-app-shell.tsx` renders desktop/mobile navigation from that model.
- Future `app/components/puma-home-screen.tsx` owns direct Home presentation.
- `app/page.tsx` mounts only `PumaWorkspaceApp view="home"` and no portal dashboard.
- Settings pages use `PumaAppShell`, not `PumaSettingsShell`.

- [ ] **Step 1: Create the failing foundation test file**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

test('one canonical navigation model owns the four primary destinations', () => {
  assert.ok(existsSync('lib/puma-navigation.ts'));
  const nav = read('lib/puma-navigation.ts');
  assert.match(nav, /PRIMARY_NAV/);
  assert.match(nav, /SETTINGS_ROUTE/);
  for (const href of ['/', '/clients', '/engine', '/monitor']) assert.match(nav, new RegExp(`href:\\s*['\"]${href.replaceAll('/', '\\/')}['\"]`));
});

test('shared AppShell owns navigation and safe areas', () => {
  assert.ok(existsSync('app/components/puma-app-shell.tsx'));
  const shell = read('app/components/puma-app-shell.tsx');
  const css = read('app/puma-app-shell.css');
  assert.match(shell, /PRIMARY_NAV/);
  assert.match(shell, /SETTINGS_ROUTE/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /min-(?:width|height):\s*44px/);
  assert.match(css, /touch-action:\s*manipulation/);
});

test('Home is direct and contains only the approved operational summary', () => {
  assert.ok(existsSync('app/components/puma-home-screen.tsx'));
  const home = read('app/components/puma-home-screen.tsx');
  const route = read('app/page.tsx');
  assert.match(home, /Today at a glance/);
  for (const label of ['Follow-ups', 'Prospects', 'Alerts']) assert.match(home, new RegExp(label));
  for (const removed of ['Tasks', 'Next actions', 'Quick actions', 'Jump back in', 'Recent activity', 'No companies yet']) assert.doesNotMatch(home, new RegExp(removed, 'i'));
  assert.doesNotMatch(route, /PumaHomeDashboard/);
  assert.doesNotMatch(home, /createPortal|MutationObserver/);
});

test('Settings routes use the shared shell rather than their own navigation shell', () => {
  for (const path of ['app/settings/page.tsx', 'app/settings/profile/page.tsx', 'app/settings/data-sources/page.tsx']) {
    const source = read(path);
    assert.match(source, /PumaAppShell/);
    assert.doesNotMatch(source, /PumaSettingsShell/);
  }
});
```

- [ ] **Step 2: Rewrite legacy UI tests around the approved architecture**

`tests/iphone-dashboard-polish.test.ts` must stop reading `puma-home-dashboard.tsx` or expecting portal injection. Its assertions should target `PumaHomeScreen`, `PumaAppShell`, `pu-*` shell classes, safe areas, and the four real primary hrefs.

`tests/minimal-settings-navigation.test.ts` must stop asserting that old Home blocks are hidden by CSS or that `PumaSettingsLauncher` is globally mounted. It should assert:
- canonical Home contains none of the removed clutter,
- Settings routes use `PumaAppShell`,
- Profile and Data Sources route files still exist,
- `puma-data-sources-settings.tsx` retains Add Source, on/off, and remove behavior.

- [ ] **Step 3: Add the new test to `npm test`**

Add `tests/product-foundation-shell.test.ts` to the explicit test command in `package.json` without removing any existing test.

- [ ] **Step 4: Run the new architecture tests and confirm RED**

```bash
npx tsx --test tests/product-foundation-shell.test.ts tests/iphone-dashboard-polish.test.ts tests/minimal-settings-navigation.test.ts
```

Expected: FAIL because the shared navigation module, AppShell, canonical Home, and Settings migration do not exist yet.

- [ ] **Step 5: Commit the red stage**

```bash
git add tests/product-foundation-shell.test.ts tests/iphone-dashboard-polish.test.ts tests/minimal-settings-navigation.test.ts package.json
git commit -m "test: define shared Puma product foundation"
```

---

### Task 2: Introduce one navigation model and one shared AppShell

**Files:**
- Create: `lib/puma-navigation.ts`
- Create: `app/components/puma-brand-mark.tsx`
- Create: `app/components/puma-app-shell.tsx`
- Create: `app/puma-app-shell.css`
- Modify: `app/layout.tsx`

**Interfaces:**

```ts
export type PumaPrimaryRouteId = 'home' | 'clients' | 'engine' | 'monitor';
export type PumaShellRouteId = PumaPrimaryRouteId | 'settings' | 'accounts-payable';

export const PRIMARY_NAV = [
  { id: 'home', href: '/', label: 'Home' },
  { id: 'clients', href: '/clients', label: 'Companies' },
  { id: 'engine', href: '/engine', label: 'Find Leads' },
  { id: 'monitor', href: '/monitor', label: 'Monitor' },
] as const;

export const SETTINGS_ROUTE = { id: 'settings', href: '/settings', label: 'Settings' } as const;
```

```ts
type PumaAppShellProps = {
  currentRoute: PumaShellRouteId;
  pageLabel: string;
  headerAction?: ReactNode;
  children: ReactNode;
};
```

- [ ] **Step 1: Implement `lib/puma-navigation.ts`**

Keep icons out of the pure route model; map IDs to lucide icons in the shell.

- [ ] **Step 2: Extract `PumaBrandMark`**

Move the current brand-mark JSX into `app/components/puma-brand-mark.tsx`. Preserve `.pm-brand-mark` so existing transparent Puma artwork CSS continues to apply.

- [ ] **Step 3: Implement `PumaAppShell`**

It must:
- render mobile and desktop primary navigation from `PRIMARY_NAV`,
- render Settings separately via `SETTINGS_ROUTE`,
- expose `data-route={currentRoute}` on `.pu-shell`,
- accept optional header action content,
- never load/mutate workspace data,
- use `pu-*` classes for all shell/navigation layout.

Representative structure:

```tsx
<main className="pu-shell" data-route={currentRoute}>
  <aside className="pu-sidebar">...</aside>
  <div className="pu-main">
    <header className="pu-appbar">...</header>
    <section className="pu-content">{children}</section>
    <nav className="pu-mobile-nav" aria-label="Primary navigation">...</nav>
    <Link className="pu-mobile-settings" href={SETTINGS_ROUTE.href} aria-label="Settings">...</Link>
  </div>
</main>
```

- [ ] **Step 4: Implement `app/puma-app-shell.css`**

It owns:
- shell variables and background,
- top safe area,
- bottom dock/Settings safe area,
- 44px minimum tap targets,
- `touch-action: manipulation`,
- mobile bottom content clearance,
- desktop 248px sidebar + scrollable content,
- active states.

It must not depend on `.pm-bottom-nav`, `.pm-settings-shell`, or `.pm-settings-launcher`.

- [ ] **Step 5: Load shell CSS last in `app/layout.tsx`**

Import `./puma-app-shell.css` after the existing polish stylesheet. Do not remove the old global Settings launcher in this task; that happens atomically with Settings migration.

- [ ] **Step 6: Run only the Task 2 contract to GREEN**

```bash
node --import tsx --test --test-name-pattern="one canonical navigation model|shared AppShell" tests/product-foundation-shell.test.ts
npm run typecheck
```

Expected: selected AppShell/navigation tests PASS; typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/puma-navigation.ts app/components/puma-brand-mark.tsx app/components/puma-app-shell.tsx app/puma-app-shell.css app/layout.tsx
git commit -m "feat: add shared Puma application shell"
```

---

### Task 3: Replace portal Home with one canonical direct Home

**Files:**
- Create: `app/components/puma-home-screen.tsx`
- Modify: `app/components/puma-workspace-app-v4.tsx`
- Modify: `app/page.tsx`
- Modify: `app/puma-polish-v12.css`

**Interface:**

```ts
type PumaHomeScreenProps = {
  now: Date | null;
  profileName: string;
  followUpsToday: number;
  prospects: number;
  alerts: number;
};
```

- [ ] **Step 1: Implement `PumaHomeScreen` as a presentational component**

It always renders the same structure, including zero-data workspaces:

```tsx
<div className="pm-page pm-home">
  <section className="pm-welcome">
    <div className="pm-date-line">...</div>
    <h1>{profileName ? `Welcome, ${profileName}` : 'Welcome'}</h1>
  </section>
  <section className="pm-home-today" aria-label="Today at a glance">
    <div className="pm-home-section-head"><strong>Today at a glance</strong></div>
    <div className="pm-home-metrics">
      <Link href="/clients"><strong>{followUpsToday}</strong><span>Follow-ups</span></Link>
      <Link href="/clients"><strong>{prospects}</strong><span>Prospects</span></Link>
      <Link href="/monitor"><strong>{alerts}</strong><span>Alerts</span></Link>
    </div>
  </section>
</div>
```

Move date/time formatting into this component. Do not add tasks, recent activity, quick actions, Profile shortcut, or a large zero-state CTA.

- [ ] **Step 2: Make the existing workspace owner the only Home data source**

In `puma-workspace-app-v4.tsx`:
- keep existing follow-up computation,
- compute `prospects` via `companyLifecycle(company.stage) === 'Prospects'`,
- pass `alerts.length`,
- remove `activeCompanies`, `upcomingCompanies`, and `recentlyUpdatedCompanies` when no longer used,
- replace old conditional `renderHome()` with `PumaHomeScreen`.

- [ ] **Step 3: Remove the extra portal mount from `app/page.tsx`**

```tsx
import PumaWorkspaceApp from './components/puma-workspace-app';

export default function HomePage() {
  return <PumaWorkspaceApp view="home" />;
}
```

- [ ] **Step 4: Preserve the compact direct-Home styling**

In `puma-polish-v12.css`:
- keep `.pm-home-today`, `.pm-home-section-head`, and `.pm-home-metrics` rules,
- remove reliance on `.pm-home-dashboard` as a layout wrapper,
- move its desktop `max-width: 640px` behavior to `.pm-home-today`,
- retain metric tap feedback.

- [ ] **Step 5: Run the Task 3 contract to GREEN**

```bash
node --import tsx --test --test-name-pattern="Home is direct" tests/product-foundation-shell.test.ts
npm run typecheck
```

Expected: direct-Home test PASS; typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/puma-home-screen.tsx app/components/puma-workspace-app-v4.tsx app/page.tsx app/puma-polish-v12.css
git commit -m "refactor: render canonical Puma Home directly"
```

---

### Task 4: Move Settings and Settings access onto the shared shell

**Files:**
- Create: `app/components/puma-settings-page.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `app/settings/profile/page.tsx`
- Modify: `app/settings/data-sources/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/puma-polish-v12.css`

**Interface:**

```ts
type PumaSettingsPageProps = {
  title: string;
  backHref?: string;
  children: ReactNode;
};
```

- [ ] **Step 1: Create a content-only Settings page wrapper**

It owns title/back/content hierarchy only. It must contain no appbar, desktop sidebar, bottom nav, or global Settings launcher.

- [ ] **Step 2: Migrate all three Settings routes to `PumaAppShell`**

Example:

```tsx
<PumaAppShell currentRoute="settings" pageLabel="Profile">
  <PumaSettingsPage title="Profile" backHref="/settings">
    <PumaProfileSettings />
  </PumaSettingsPage>
</PumaAppShell>
```

Use the same structure for Settings hub and Data Sources. Do not change `PumaSettingsHub`, `PumaProfileSettings`, or `PumaDataSourcesSettings` behavior.

- [ ] **Step 3: Migrate Settings content polish in the same commit**

Change content-only selectors such as:

```css
.pm-settings-shell .pm-profile-settings-page
```

to:

```css
.pu-shell[data-route='settings'] .pm-profile-settings-page
```

Do the same for Settings list/source-row/add-source content styling. This prevents an intermediate commit where Settings is functionally migrated but visually unstyled. Do not carry old `.pm-settings-shell .pm-appbar`, `.pm-content`, or `.pm-bottom-nav` ownership into the new shell.

- [ ] **Step 4: Remove the root-level Settings launcher**

Delete the `PumaSettingsLauncher` import/render from `app/layout.tsx`. Keep `PwaUpdateManager` and PWA metadata unchanged.

- [ ] **Step 5: Run the Task 4 contract to GREEN**

```bash
node --import tsx --test --test-name-pattern="Settings routes use the shared shell" tests/product-foundation-shell.test.ts
npx tsx --test tests/minimal-settings-navigation.test.ts
npm run typecheck
```

Expected: all selected tests PASS; typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/puma-settings-page.tsx app/settings/page.tsx app/settings/profile/page.tsx app/settings/data-sources/page.tsx app/layout.tsx app/puma-polish-v12.css
git commit -m "refactor: move Settings onto shared Puma shell"
```

---

### Task 5: Route workspace screens through AppShell and keep nav alive during hydration

**Files:**
- Modify: `app/components/puma-workspace-app-v4.tsx`
- Modify: `tests/product-foundation-shell.test.ts`
- Modify: `tests/final-ui-wiring.test.ts`

**Contract:** `PumaWorkspaceApp` remains the business-state owner for PR #27, but no longer owns shell/navigation markup.

- [ ] **Step 1: Add a failing hydration/recovery test**

Add a test named `workspace renders the shared shell before hydration and provides recovery links` asserting:
- `PumaWorkspaceApp` imports/uses `PumaAppShell`,
- the old early return `<main className="pm-shell">...Loading Puma` is gone,
- old `<nav className="pm-bottom-nav">` and `<aside className="pm-desktop-sidebar">` markup is gone,
- missing company recovery includes `/clients`,
- missing building recovery includes `/clients` or `buildingListPath`.

Run that exact test first and confirm FAIL.

- [ ] **Step 2: Replace workspace-owned shell markup**

Derive shell identity from the existing view:

```ts
const shellRoute = view as PumaShellRouteId;
const pageLabel = view === 'clients' ? 'Companies'
  : view === 'monitor' ? 'Monitor'
  : view === 'engine' ? 'Find Leads'
  : view === 'accounts-payable' ? 'Accounts Payable'
  : view === 'settings' ? 'Settings'
  : 'Home';
```

Render:

```tsx
<PumaAppShell
  currentRoute={shellRoute}
  pageLabel={pageLabel}
  headerAction={workspace ? <button className={...} onClick={...}><Mic ... /></button> : undefined}
>
  {workspace ? content : <div className="pm-loading">Loading Puma…</div>}
</PumaAppShell>
```

Voice review/toast overlays may remain adjacent to the shell inside `PumaWorkspaceApp`; do not change voice state semantics.

- [ ] **Step 3: Remove hydration-dependent navigation**

Delete the standalone pre-shell early return. Shell/navigation must render immediately; only page content waits for workspace hydration.

- [ ] **Step 4: Add useful missing-record recovery**

Company missing:

```tsx
<div className="pm-empty">
  <strong>Company not found.</strong>
  <Link href="/clients">Back to Companies</Link>
</div>
```

Building missing:
- if the company exists, link to `buildingListPath(company.id)`,
- otherwise link to `/clients`.

- [ ] **Step 5: Remove local shell/nav/brand imports and markup**

Remove duplicated local `BrandMark` and navigation icons that became unused. Keep icons still used by route content and voice UI.

- [ ] **Step 6: Run the Task 5 contract to GREEN**

```bash
node --import tsx --test --test-name-pattern="workspace renders the shared shell before hydration" tests/product-foundation-shell.test.ts
npx tsx --test tests/final-ui-wiring.test.ts tests/ios-native-shell.test.ts
npm run typecheck
```

Expected: all selected tests PASS; typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/puma-workspace-app-v4.tsx tests/product-foundation-shell.test.ts tests/final-ui-wiring.test.ts
git commit -m "refactor: route workspace through shared Puma shell"
```

---

### Task 6: Remove superseded components and CSS correctness hacks

**Files:**
- Delete: `app/components/puma-home-dashboard.tsx`
- Delete: `app/components/puma-settings-shell.tsx`
- Delete: `app/components/puma-settings-launcher.tsx`
- Modify: `app/puma-minimal-settings.css`
- Modify: `app/puma-polish-v12.css`
- Modify: `app/puma-responsive-v6.css`
- Modify: `app/components/puma-workspace-app-v4.tsx`
- Modify: `tests/product-foundation-shell.test.ts`
- Modify: `tests/iphone-dashboard-polish.test.ts`
- Modify: `tests/minimal-settings-navigation.test.ts`

**Cleanup contract:** no portal Home, no duplicate Settings shell, no global Settings launcher, no CSS-hiding of old Home, and no new shell dependency on `.pm-bottom-nav`/`.pm-desktop-sidebar`.

- [ ] **Step 1: Delete the three now-unused components**

Delete only after imports were removed in Tasks 3–5.

- [ ] **Step 2: Remove Home-hide and retired launcher/nav overrides from `puma-minimal-settings.css`**

Delete rules that hide `.pm-home .pm-home-settings`, `.pm-home .pm-zero-state`, `.pm-home .pm-stat-strip`, and `.pm-home .pm-home-grid`. Delete old Settings-launcher/mobile-dock positioning rules. Preserve actual Settings-content styles and the deliberate `.pm-research-sources { display: none }` behavior.

- [ ] **Step 3: Finish `puma-polish-v12.css` cleanup**

Remove:
- `.pm-home-dashboard` wrapper rules now superseded by direct Home,
- old `.pm-bottom-nav` tap hardening now owned by `pu-*`,
- `.pm-settings-launcher`,
- `.pm-settings-shell` appbar/content/bottom-nav safe-area blocks.

Retain direct Home metric content styles and Settings content styles already re-scoped to `.pu-shell[data-route='settings']`.

- [ ] **Step 4: Remove retired shell-layout ownership from responsive CSS**

Remove/neutralize old layout selectors that can still conflict:
- `.pm-shell`,
- `.pm-main`,
- `.pm-appbar`,
- `.pm-bottom-nav`,
- `.pm-desktop-sidebar`,
- `.pm-desktop-nav`,
- `.pm-desktop-profile`.

Preserve route-content responsive rules for company lists, research cards, tabs, record details, recovery pages, sheets, and data grids. `.pu-*` shell layout belongs exclusively to `puma-app-shell.css`.

- [ ] **Step 5: Trim the inline `styles` string in `puma-workspace-app-v4.tsx`**

Remove retired shell/nav definitions while keeping still-used content, voice sheet/toast, company, research, monitor, AP, and detail styles.

- [ ] **Step 6: Strengthen cleanup regression assertions**

```ts
for (const removed of [
  'app/components/puma-home-dashboard.tsx',
  'app/components/puma-settings-shell.tsx',
  'app/components/puma-settings-launcher.tsx',
]) assert.equal(existsSync(removed), false);
```

Also assert:
- no `createPortal`/`MutationObserver` Home path,
- no `PumaSettingsShell`,
- no launcher import in `app/layout.tsx`,
- no `.pm-home .pm-zero-state` hide rule,
- new shell files contain no `.pm-bottom-nav` dependency.

- [ ] **Step 7: Run the entire repository verification to GREEN**

```bash
npm test
npm run typecheck
npm run build
```

Expected: full tests PASS, TypeScript PASS, Next build PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "cleanup: remove duplicate Puma shell and Home layers"
```

---

### Task 7: Exact-head deployment verification, independent review, and PR #27

**Files:** No product-code changes expected. If verification finds a regression, add/adjust the narrowest failing test before changing product code, fix it, and restart this task from Step 1.

- [ ] **Step 1: Confirm the branch diff is foundation-only**

Compare `main...puma/product-foundation-v1`. Verify no research-engine, scoring, monitor-rule, workspace-schema, or source-backend implementation changed.

- [ ] **Step 2: Run fresh verification on the exact branch head**

```bash
npm test
npm run typecheck
npm run build
```

Record the exact final commit SHA. Do not reuse evidence from an earlier green preview.

- [ ] **Step 3: Require Vercel READY for that exact SHA**

The preview deployment's `githubCommitSha` must exactly match the final branch head and state must be `READY`.

- [ ] **Step 4: Smoke-test routes on that exact preview**

Require HTTP 200 for:
- `/`
- `/clients`
- `/engine`
- `/monitor`
- `/settings`

Also test `/settings/profile` and `/settings/data-sources` where preview auth allows direct fetch. A Vercel authentication redirect is not an app-route redirect.

- [ ] **Step 5: Verify installed-PWA endpoints remain healthy**

Require:
- `/apple-touch-icon` → HTTP 200, `image/png`
- `/pwa-icon-192` → HTTP 200, `image/png`
- `/pwa-icon-512` → HTTP 200, `image/png`

Confirm `app/layout.tsx` still contains `viewportFit: 'cover'`, current icon metadata, and `PwaUpdateManager`; service-worker behavior remains unchanged.

- [ ] **Step 6: Check runtime errors and request an independent code review**

Use Vercel runtime-error aggregation and a read-only CodeRabbit/fresh-review pass focused on the five Review Focus risks. Address any blocking finding with a regression test before opening the PR.

- [ ] **Step 7: Open PR #27 without merging**

Title:

`[Foundation] Unify Puma app shell and canonical Home`

PR body must state:
- one shared shell,
- one navigation model,
- direct minimalist Home,
- Settings migrated to shared shell,
- obsolete portal/launcher/shell removed,
- preserved CRM/research/monitor/PWA behavior,
- exact final test/build/Vercel evidence.

Do **not** merge. Hand PR #27 to the user for manual merge.

---

## Plan Self-Review Checklist

Before implementation starts, confirm:

- [ ] **Spec coverage:** every approved acceptance criterion maps to a task or verification step.
- [ ] **No placeholders:** no implementation task contains TODO, TBD, or deferred design decisions.
- [ ] **Type consistency:** `PumaShellRouteId`, `PumaView`, `PRIMARY_NAV`, Settings, and non-primary Accounts Payable are compatible.
- [ ] **Review Focus → tests:** hydration navigation, route active states, CSS isolation, Home duplication, and PWA preservation each have an explicit regression/verification check.
- [ ] **Intermediate coherence:** direct Home retains its visual width rules, and Settings content CSS is re-scoped in the same task that removes `PumaSettingsShell`.
- [ ] **Task-level green gates:** Tasks 2–5 each run a selected test name that can become fully green at that stage; Task 6 runs the complete suite/build.
- [ ] **Scope control:** no new tasks/calendar/email automation, research rewrite, monitor-rule rewrite, schema migration, or Data Sources backend expansion is included.
- [ ] **Manual merge:** implementation ends with an open PR, not a merge.
