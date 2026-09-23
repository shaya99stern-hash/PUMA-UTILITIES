import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

test('installed iPhone shell owns safe areas and mobile navigation touch targets', () => {
  assert.equal(existsSync('app/components/puma-app-shell.tsx'), true);
  assert.equal(existsSync('app/puma-app-shell.css'), true);
  const shell = read('app/components/puma-app-shell.tsx');
  const css = read('app/puma-app-shell.css');
  assert.match(shell, /pu-mobile-nav/);
  assert.match(shell, /pu-mobile-settings/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /min-(?:width|height):\s*44px/);
  assert.match(css, /touch-action:\s*manipulation/);
});

test('Home stays minimal: Welcome plus Today at a glance only', () => {
  assert.equal(existsSync('app/components/puma-home-screen.tsx'), true);
  const home = read('app/components/puma-home-screen.tsx');
  const page = read('app/page.tsx');
  assert.match(home, /pm-home-today/);
  assert.match(home, /Today at a glance/);
  assert.match(home, /Follow-ups/);
  assert.match(home, /Prospects/);
  assert.match(home, /Alerts/);
  assert.match(home, /href="\/clients"/);
  assert.match(home, /href="\/monitor"/);
  assert.doesNotMatch(home, /Next actions|Quick actions|Jump back in|Recent activity|No companies yet/i);
  assert.doesNotMatch(page, /PumaHomeDashboard/);
});

test('Today metrics come from the workspace owner rather than a second Home data loader', () => {
  const workspace = read('app/components/puma-workspace-app-v4.tsx');
  const home = read('app/components/puma-home-screen.tsx');
  assert.match(workspace, /followUpsToday/);
  assert.match(workspace, /companyLifecycle\(company\.stage\) === 'Prospects'/);
  assert.match(workspace, /alerts\.length/);
  assert.doesNotMatch(home, /loadWorkspace|MutationObserver|createPortal/);
});

test('mobile nav contains the four real primary destinations', () => {
  const nav = read('lib/puma-navigation.ts');
  for (const href of ['/', '/clients', '/engine', '/monitor']) {
    assert.match(nav, new RegExp(`href:\\s*['\"]${href.replaceAll('/', '\\/')}['\"]`));
  }
});
