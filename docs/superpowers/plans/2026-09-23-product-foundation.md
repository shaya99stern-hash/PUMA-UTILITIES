# Puma Utilities Product Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Puma Utilities' patch-on-patch shell/Home implementation with one canonical application shell, one route/navigation model, and one direct minimalist Home screen while preserving the existing CRM, research, monitoring, workspace persistence, voice, and PWA behavior.

**Architecture:** Keep Next.js App Router and the existing client-side workspace owner. Introduce a pure navigation model, a shared `PumaAppShell`, a canonical `PumaHomeScreen`, and a small Settings page wrapper. Migrate the existing workspace and Settings routes onto the shared shell without rewriting business logic. Use new `pu-*` shell class names so old `.pm-*` shell selectors cannot accidentally control correctness. Remove portal-injected Home, global Settings-launcher patching, duplicate Settings navigation, and CSS that hides obsolete Home implementations.

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
- Do not automatically merge PR #27; the user retains manual merge control.

## Review Focus

These are the five highest-risk failure modes that every implementation/review pass must explicitly check:

1. **Hydration-dependent navigation:** the shell disappears or becomes untappable while local workspace data is loading.
2. **Route-active-state drift:** nested Companies or Settings pages highlight the wrong destination because route identity is duplicated instead of centralized.
3. **CSS cascade regression:** old `.pm-bottom-nav`, `.pm-settings-shell`, or launcher selectors still affect the new shell and recreate iPhone clipping/overlap.
4. **Home duplication/data drift:** portal/duplicate Home logic survives and computes counts independently from the canonical workspace owner.
5. **PWA regression:** shell/layout work changes viewport, safe areas, service-worker registration, or icon endpoints and breaks installed-iPhone behavior.

---

### Task 1: Lock the shared-shell and canonical-Home contract with failing tests

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
- Settings pages must use `PumaAppShell`, not `PumaSettingsShell`.

- [ ] **Step 1: Create a focused failing foundation test**

Add `tests/product-foundation-shell.test.ts` with source-level regression checks:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

test('one canonical navigation model owns the four primary destinations', () => {
  assert.ok(existsSync('lib/puma-navigation.ts'));
  const nav = read('lib/puma-navigation.ts');
  for (const href of ["'/'", "'/clients'", "'/engine'", "'/monitor'"]) assert.match(nav, new RegExp(href.replaceAll('/', '\\/')));
  assert.match(nav, /PRIMARY_NAV/);
  assert.match(nav, /SETTINGS_ROUTE/);
});

test('shared AppShell owns navigation and safe areas', () => {
  assert.ok(existsSync('app/components/puma-app-shell.tsx'));
  const shell = read('app/components/puma-app-shell.tsx');
  const css = read('app/puma-app-shell.css');
  assert.match(shell, /PRIMARY_NAV/);
  assert.match(shell, /Settings/);
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

- [ ] **Step 2: Rewrite the two legacy UI tests to assert architecture, not CSS hiding**

`tests/iphone-dashboard-polish.test.ts` must stop reading `puma-home-dashboard.tsx` or expecting portal injection. It should instead assert `PumaHomeScreen`, `PumaAppShell`, `pu-*` shell classes, safe-area rules, and four real route hrefs.

`tests/minimal-settings-navigation.test.ts` must stop asserting that old Home blocks are hidden by CSS or that `PumaSettingsLauncher` is mounted globally. It should assert:
- old clutter is absent from canonical Home,
- Settings is rendered by `PumaAppShell`,
- Profile and Data Sources routes still exist,
- `puma-data-sources-settings.tsx` still contains Add Source / toggle / remove behavior.

- [ ] **Step 3: Add the new test file to `npm test`**

Add `tests/product-foundation-shell.test.ts` to the explicit test command in `package.json` without removing any current test file.

- [ ] **Step 4: Run the new regression tests and confirm RED**

Run:

```bash
npx tsx --test tests/product-foundation-shell.test.ts tests/iphone-dashboard-polish.test.ts tests/minimal-settings-navigation.test.ts
```

Expected: FAIL because `lib/puma-navigation.ts`, `PumaAppShell`, and `PumaHomeScreen` do not yet exist and Settings still uses the old shell.

- [ ] **Step 5: Commit the red-stage tests**

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

`lib/puma-navigation.ts`:

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

`PumaAppShell` props:

```ts
import type { ReactNode } from 'react';
import type { PumaShellRouteId } from '@/lib/puma-navigation';

type PumaAppShellProps = {
  currentRoute: PumaShellRouteId;
  pageLabel: string;
  headerAction?: ReactNode;
  children: ReactNode;
};
```

- [ ] **Step 1: Implement the pure navigation model**

Keep icons out of `lib/puma-navigation.ts`; map route IDs to lucide icons inside the shell so the navigation module remains pure TypeScript and easy to test.

- [ ] **Step 2: Extract one canonical `PumaBrandMark`**

Move the existing brand-mark JSX into `app/components/puma-brand-mark.tsx` and preserve the current `.pm-brand-mark` class so existing brand artwork CSS remains valid.

- [ ] **Step 3: Implement `PumaAppShell`**

The component must:
- render a desktop sidebar and mobile dock from `PRIMARY_NAV`,
- render Settings separately from the four primary destinations,
- expose `data-route={currentRoute}` on the root shell,
- accept an optional header action (voice mic for workspace routes; none for Settings),
- never load or mutate workspace data,
- use only new `pu-*` classes for shell/navigation layout.

Representative structure:

```tsx
export default function PumaAppShell({ currentRoute, pageLabel, headerAction, children }: PumaAppShellProps) {
  return (
    <main className="pu-shell" data-route={currentRoute}>
      <aside className="pu-sidebar">
        <div className="pu-sidebar-brand"><PumaBrandMark size={30} />...</div>
        <nav className="pu-desktop-nav" aria-label="Desktop navigation">
          {PRIMARY_NAV.map((item) => <PrimaryNavLink key={item.id} item={item} active={currentRoute === item.id} />)}
        </nav>
        <Link className={`pu-desktop-settings ${currentRoute === 'settings' ? 'active' : ''}`} href={SETTINGS_ROUTE.href}>...</Link>
      </aside>
      <div className="pu-main">
        <header className="pu-appbar">...</header>
        <section className="pu-content">{children}</section>
        <nav className="pu-mobile-nav" aria-label="Primary navigation">...</nav>
        <Link className={`pu-mobile-settings ${currentRoute === 'settings' ? 'active' : ''}`} href="/settings" aria-label="Settings">...</Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Create shell-owned CSS with safe-area and touch contracts**

`app/puma-app-shell.css` must own:
- `--pm-bg`, `--pm-line`, `--pm-text`, `--pm-muted`, `--pm-orange` availability on `.pu-shell`,
- `padding-top`/header treatment using `env(safe-area-inset-top)`,
- mobile bottom dock + separate Settings button using `env(safe-area-inset-bottom)`,
- at least 44px tap targets,
- `touch-action: manipulation`,
- mobile content bottom clearance,
- desktop 248px sidebar and scrollable main content,
- no dependency on `.pm-bottom-nav`, `.pm-settings-shell`, or `.pm-settings-launcher`.

- [ ] **Step 5: Load the shell stylesheet globally but do not migrate routes yet**

In `app/layout.tsx`, add:

```ts
import './puma-app-shell.css';
```

Do not remove the old launcher in this task; removal happens atomically with Settings migration in Task 4 so current routes remain navigable during intermediate commits.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
npx tsx --test tests/product-foundation-shell.test.ts
npm run typecheck
```

Expected: foundation tests still partially FAIL because Home/Settings have not migrated, but navigation-model and shell-specific assertions PASS; typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/puma-navigation.ts app/components/puma-brand-mark.tsx app/components/puma-app-shell.tsx app/puma-app-shell.css app/layout.tsx
git commit -m "feat: add shared Puma application shell"
```

---

### Task 3: Replace portal Home with one canonical direct Home screen

**Files:**
- Create: `app/components/puma-home-screen.tsx`
- Modify: `app/components/puma-workspace-app-v4.tsx`
- Modify: `app/page.tsx`
- Delete later in Task 6: `app/components/puma-home-dashboard.tsx`

**Interfaces:**

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

It must always render the same compact structure, including when all counts are zero:

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

Date formatting can move from `puma-workspace-app-v4.tsx` into this component. Do not add tasks, recent activity, quick actions, Profile shortcut, or zero-state CTA.

- [ ] **Step 2: Make workspace state the single source for Home counts**

In `puma-workspace-app-v4.tsx`:
- keep existing `followUpsToday` logic,
- compute `prospects` with `companyLifecycle(company.stage) === 'Prospects'`,
- use `alerts.length`,
- delete `activeCompanies`, `upcomingCompanies`, and `recentlyUpdatedCompanies` if no longer used elsewhere,
- replace old conditional `renderHome()` with `<PumaHomeScreen ... />`.

- [ ] **Step 3: Remove the extra Home mount from `app/page.tsx`**

Final route:

```tsx
import PumaWorkspaceApp from './components/puma-workspace-app';

export default function HomePage() {
  return <PumaWorkspaceApp view="home" />;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx tsx --test tests/product-foundation-shell.test.ts tests/iphone-dashboard-polish.test.ts
```

Expected: Home architecture assertions PASS; Settings assertions may still fail until Task 4.

- [ ] **Step 5: Commit**

```bash
git add app/components/puma-home-screen.tsx app/components/puma-workspace-app-v4.tsx app/page.tsx
git commit -m "refactor: render canonical Puma Home directly"
```

---

### Task 4: Move Settings and global Settings access onto the shared shell

**Files:**
- Create: `app/components/puma-settings-page.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `app/settings/profile/page.tsx`
- Modify: `app/settings/data-sources/page.tsx`
- Modify: `app/layout.tsx`
- Delete later in Task 6: `app/components/puma-settings-shell.tsx`
- Delete later in Task 6: `app/components/puma-settings-launcher.tsx`

**Interfaces:**

`PumaSettingsPage` owns only Settings-page content hierarchy, not navigation:

```ts
type PumaSettingsPageProps = {
  title: string;
  backHref?: string;
  children: ReactNode;
};
```

- [ ] **Step 1: Create the content-only Settings page wrapper**

It renders the current title/back link/page content classes but no sidebar, appbar, bottom nav, or Settings launcher.

- [ ] **Step 2: Migrate each Settings route to `PumaAppShell`**

Example:

```tsx
export default function ProfileSettingsPage() {
  return (
    <PumaAppShell currentRoute="settings" pageLabel="Profile">
      <PumaSettingsPage title="Profile" backHref="/settings">
        <PumaProfileSettings />
      </PumaSettingsPage>
    </PumaAppShell>
  );
}
```

Use the same pattern for Settings hub and Data Sources. Preserve `PumaSettingsHub`, `PumaProfileSettings`, and `PumaDataSourcesSettings` behavior unchanged.

- [ ] **Step 3: Remove the global Settings launcher from root layout**

Delete:

```ts
import PumaSettingsLauncher from './components/puma-settings-launcher';
```

and remove `<PumaSettingsLauncher />` from `<body>`. Keep `<PwaUpdateManager />` unchanged.

- [ ] **Step 4: Run Settings/navigation tests**

Run:

```bash
npx tsx --test tests/product-foundation-shell.test.ts tests/minimal-settings-navigation.test.ts
npm run typecheck
```

Expected: shared-shell Settings assertions PASS and Profile/Data Sources behavior tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/puma-settings-page.tsx app/settings/page.tsx app/settings/profile/page.tsx app/settings/data-sources/page.tsx app/layout.tsx
git commit -m "refactor: move Settings onto shared Puma shell"
```

---

### Task 5: Move workspace routes onto AppShell without changing CRM/research behavior

**Files:**
- Modify: `app/components/puma-workspace-app-v4.tsx`
- Modify: `tests/final-ui-wiring.test.ts`
- Modify: `tests/product-foundation-shell.test.ts`

**Interfaces:**
- `PumaWorkspaceApp` remains the business-state owner for this PR.
- It chooses shell route identity from the existing `PumaView`.
- It passes the existing microphone action through `PumaAppShell.headerAction`.
- It renders navigation before workspace hydration completes.

- [ ] **Step 1: Extend regression tests for hydration and recovery**

Add assertions that:
- `PumaWorkspaceApp` imports/uses `PumaAppShell`,
- it does not return a standalone `.pm-shell` loading page before the shell,
- missing company state includes a `/clients` recovery link,
- missing building state includes a recovery link,
- old `<nav className="pm-bottom-nav">` and `<aside className="pm-desktop-sidebar">` markup is absent from `puma-workspace-app-v4.tsx`.

- [ ] **Step 2: Replace local shell markup with `PumaAppShell`**

Derive:

```ts
const shellRoute = view === 'settings' ? 'settings' : view;
const pageLabel = view === 'clients' ? 'Companies'
  : view === 'monitor' ? 'Monitor'
  : view === 'engine' ? 'Find Leads'
  : view === 'accounts-payable' ? 'Accounts Payable'
  : 'Home';
```

The final rendering shape should be:

```tsx
<PumaAppShell
  currentRoute={shellRoute}
  pageLabel={pageLabel}
  headerAction={workspace ? <button className={...} onClick={...}><Mic ... /></button> : undefined}
>
  {workspace ? content : <div className="pm-loading">Loading Puma…</div>}
</PumaAppShell>
```

Voice review sheet/toasts may remain adjacent to the shell inside the same component; do not change voice state behavior.

- [ ] **Step 3: Ensure navigation exists before hydration**

Remove the current early return:

```tsx
if (!workspace) return <main className="pm-shell">...</main>;
```

Instead, compute content conditionally while always rendering `PumaAppShell`.

- [ ] **Step 4: Add useful missing-record recovery**

Company missing:

```tsx
<div className="pm-empty">
  <strong>Company not found.</strong>
  <Link href="/clients">Back to Companies</Link>
</div>
```

Building missing:
- if company exists, link to `buildingListPath(company.id)`;
- otherwise link to `/clients`.

Do not change the valid company/building data path.

- [ ] **Step 5: Remove shell-specific imports and duplicated local brand/nav markup**

Remove workspace-only imports of navigation icons/components that are no longer used after AppShell owns the shell. Keep icons still used in route content.

- [ ] **Step 6: Run focused and full type checks**

Run:

```bash
npx tsx --test tests/product-foundation-shell.test.ts tests/final-ui-wiring.test.ts tests/ios-native-shell.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/puma-workspace-app-v4.tsx tests/product-foundation-shell.test.ts tests/final-ui-wiring.test.ts
git commit -m "refactor: route workspace through shared Puma shell"
```

---

### Task 6: Remove obsolete portal/shell code and CSS correctness hacks

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

**Required cleanup contract:**
- no `createPortal`/`MutationObserver` Home implementation,
- no `PumaSettingsShell`,
- no globally mounted `PumaSettingsLauncher`,
- no CSS rule hiding `.pm-home .pm-zero-state`, `.pm-home .pm-stat-strip`, or `.pm-home .pm-home-grid` as a correctness mechanism,
- no active new shell dependency on `.pm-bottom-nav` or `.pm-desktop-sidebar`.

- [ ] **Step 1: Delete the three superseded components**

Delete the portal dashboard, duplicate Settings shell, and global Settings launcher only after Tasks 3–5 have removed all imports.

- [ ] **Step 2: Remove Home-hide and launcher/nav overrides from `puma-minimal-settings.css`**

Delete the opening rules that hide old Home sections and the mobile/desktop `.pm-settings-launcher` / `.pm-bottom-nav` positioning overrides. Keep actual Settings content styles (`.pm-settings-list`, `.pm-profile-settings-page`, `.pm-source-*`) and the deliberate `.pm-research-sources { display:none }` rule.

- [ ] **Step 3: Remove obsolete shell-specific polish from `puma-polish-v12.css`**

Delete `.pm-settings-shell` appbar/content/bottom-nav safe-area patches and old launcher tap-target rules. Keep route-content polish still used by Settings/Profile/Data Sources and Home metric content. If a selector currently begins with `.pm-settings-shell` solely to scope content styling, scope it under `.pu-shell[data-route='settings']` instead.

- [ ] **Step 4: Remove obsolete shell selectors from responsive CSS where they can still conflict**

At minimum remove or neutralize shell-layout ownership for:
- `.pm-bottom-nav`,
- `.pm-desktop-sidebar`,
- `.pm-appbar`,
- `.pm-main`,
- `.pm-shell`
when those selectors only describe the retired shell.

Preserve route-content responsive rules such as company rows, research cards, tabs, detail stacks, and recovery pages. New `.pu-*` shell layout remains exclusively in `puma-app-shell.css`.

- [ ] **Step 5: Trim the inline `styles` string in `puma-workspace-app-v4.tsx`**

Remove retired shell/nav definitions (`.pm-shell`, `.pm-appbar`, `.pm-bottom-nav`, desktop sidebar/nav/profile) while retaining content, voice-sheet, toast, company, research, monitor, AP, and detail styles still needed by the workspace screens.

- [ ] **Step 6: Strengthen tests against regression back to hidden duplicates**

Assert:

```ts
for (const removed of [
  'app/components/puma-home-dashboard.tsx',
  'app/components/puma-settings-shell.tsx',
  'app/components/puma-settings-launcher.tsx',
]) assert.equal(existsSync(removed), false);
```

Also assert no `createPortal`, no `MutationObserver`, no `PumaSettingsShell`, no global Settings launcher in layout, and no `.pm-home .pm-zero-state` hide rule.

- [ ] **Step 7: Run the full test suite and build**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all tests PASS, TypeScript PASS, Next build PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "cleanup: remove duplicate Puma shell and Home layers"
```

---

### Task 7: Exact-head verification, review, and PR #27

**Files:**
- No product-code changes expected unless verification exposes a regression.
- If a regression is found, add/adjust the narrowest relevant test first, then fix it and re-run this task from the beginning.

- [ ] **Step 1: Confirm branch diff is foundation-only**

Compare `main...puma/product-foundation-v1` and verify no research-engine, scoring, monitor-rule, workspace-schema, or source-backend files changed except tests/import wiring explicitly required by this plan.

- [ ] **Step 2: Run fresh final verification on the exact head**

Run locally/CI:

```bash
npm test
npm run typecheck
npm run build
```

Record the exact final commit SHA. Do not cite an earlier green preview.

- [ ] **Step 3: Require Vercel preview READY for that exact SHA**

Verify the deployment metadata reports `githubCommitSha` equal to the final branch head and state `READY`.

- [ ] **Step 4: Smoke-test primary routes on that exact preview**

Require HTTP 200 for:
- `/`
- `/clients`
- `/engine`
- `/monitor`
- `/settings`

Also check `/settings/profile` and `/settings/data-sources` when preview authentication allows direct fetch. Protected-preview authentication redirects are not app-route failures.

- [ ] **Step 5: Verify PWA endpoints without changing them**

Require:
- `/apple-touch-icon` → HTTP 200, `image/png`
- `/pwa-icon-192` → HTTP 200, `image/png`
- `/pwa-icon-512` → HTTP 200, `image/png`

Confirm `app/layout.tsx` still declares `viewportFit: 'cover'`, current manifest/icon metadata, and `PwaUpdateManager`.

- [ ] **Step 6: Check runtime errors and code review**

Use Vercel runtime error aggregation for the preview/production baseline and ensure there is no new shell/PWA runtime error cluster. Run a read-only CodeRabbit/reviewer pass focused on the five Review Focus risks at the top of this plan.

- [ ] **Step 7: Open PR #27 without merging**

Title:

`[Foundation] Unify Puma app shell and canonical Home`

PR body must summarize:
- one shared shell,
- one navigation model,
- direct minimal Home,
- Settings migrated to shared shell,
- obsolete portal/launcher/shell removed,
- preserved CRM/research/monitor/PWA behavior,
- exact final test/build/Vercel evidence.

Do **not** merge. Hand PR #27 to the user for manual merge.

---

## Plan Self-Review Checklist

Before implementation starts, confirm:

- [ ] **Spec coverage:** every acceptance criterion in the approved design is represented by at least one task or verification step.
- [ ] **No placeholders:** no implementation task contains TODO/TBD/“figure out later” language.
- [ ] **Type consistency:** `PumaShellRouteId`, `PumaView`, `PRIMARY_NAV`, and Settings route usage are compatible, including non-primary Accounts Payable.
- [ ] **Review Focus → tests:** hydration navigation, route active states, CSS isolation, Home duplication, and PWA preservation each have an explicit regression/verification check.
- [ ] **Migration safety:** old shell components are deleted only after all imports move, keeping intermediate commits buildable wherever practical.
- [ ] **Scope control:** no new task/calendar/email automation, research rewrite, monitor-rule rewrite, schema migration, or Data Sources backend expansion is included.
- [ ] **Manual merge:** implementation ends with an open PR, not a merge.
