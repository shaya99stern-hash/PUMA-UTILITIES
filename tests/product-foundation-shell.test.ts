import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

test('one canonical navigation model owns the four primary destinations', () => {
  assert.ok(existsSync('lib/puma-navigation.ts'));
  const nav = read('lib/puma-navigation.ts');
  assert.match(nav, /PRIMARY_NAV/);
  assert.match(nav, /SETTINGS_ROUTE/);
  for (const href of ['/', '/clients', '/engine', '/monitor']) {
    assert.match(nav, new RegExp(`href:\\s*['\"]${href.replaceAll('/', '\\/')}['\"]`));
  }
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
  for (const removed of ['Tasks', 'Next actions', 'Quick actions', 'Jump back in', 'Recent activity', 'No companies yet']) {
    assert.doesNotMatch(home, new RegExp(removed, 'i'));
  }
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

test('workspace renders the shared shell before hydration and provides recovery links', () => {
  const workspace = read('app/components/puma-workspace-app-v4.tsx');
  assert.match(workspace, /PumaAppShell/);
  assert.doesNotMatch(workspace, /if \(!workspace\) return <main className="pm-shell"/);
  assert.doesNotMatch(workspace, /<nav className="pm-bottom-nav"/);
  assert.doesNotMatch(workspace, /<aside className="pm-desktop-sidebar"/);
  assert.match(workspace, /Back to Companies/);
  assert.match(workspace, /href="\/clients"/);
  assert.match(workspace, /buildingListPath/);
});
