import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync('app/components/puma-home-dashboard.tsx', 'utf8');
const page = readFileSync('app/page.tsx', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');
const settingsShell = readFileSync('app/components/puma-settings-shell.tsx', 'utf8');
const polishCss = readFileSync('app/puma-polish-v12.css', 'utf8');
const minimalCss = readFileSync('app/puma-minimal-settings.css', 'utf8');

test('installed iPhone Settings shell owns its safe areas and mobile navigation layout', () => {
  assert.match(polishCss, /\.pm-settings-shell \.pm-appbar[\s\S]*safe-area-inset-top/);
  assert.match(polishCss, /\.pm-settings-shell \.pm-content[\s\S]*overflow-y:\s*auto/);
  assert.match(polishCss, /\.pm-settings-shell \.pm-bottom-nav[\s\S]*safe-area-inset-bottom/);
  assert.match(polishCss, /\.pm-settings-shell \.pm-bottom-nav a[\s\S]*display:\s*(?:flex|grid)/);
  assert.match(settingsShell, /pm-settings-shell/);
  assert.match(settingsShell, /pm-settings-appbar/);
  assert.match(settingsShell, /pm-settings-bottom-nav/);
  assert.match(layout, /puma-polish-v12\.css/);
});

test('Home stays minimal: Welcome plus Today at a glance only', () => {
  assert.match(page, /PumaHomeDashboard/);
  assert.match(dashboard, /pm-home-dashboard/);
  assert.match(dashboard, /pm-home-today/);
  assert.match(dashboard, /Today at a glance/);
  assert.match(dashboard, /Follow-ups/);
  assert.match(dashboard, /Prospects/);
  assert.match(dashboard, /Alerts/);
  assert.match(dashboard, /href="\/clients"/);
  assert.match(dashboard, /href="\/monitor"/);
  assert.doesNotMatch(dashboard, /pm-home-tasks/);
  assert.doesNotMatch(dashboard, /pm-home-quick-actions/);
  assert.doesNotMatch(dashboard, /pm-home-recent/);
  assert.doesNotMatch(dashboard, /Next actions|Quick actions|Jump back in|Recent activity/);
  assert.match(minimalCss, /\.pm-home \.pm-zero-state[\s\S]*display:\s*none\s*!important/);
});

test('Today metrics are derived from real workspace state rather than placeholders', () => {
  assert.match(dashboard, /followUpsToday/);
  assert.match(dashboard, /prospects/);
  assert.match(dashboard, /alerts\.length/);
  assert.match(dashboard, /loadWorkspace/);
  assert.doesNotMatch(dashboard, /demo|placeholder|sample/i);
});

test('mobile bottom navigation keeps a reliable touch target above app content', () => {
  assert.match(polishCss, /\.pm-bottom-nav\s*\{[\s\S]*pointer-events:\s*auto/);
  assert.match(polishCss, /\.pm-bottom-nav a\s*\{[\s\S]*min-height:\s*44px/);
  assert.match(polishCss, /\.pm-bottom-nav a\s*\{[\s\S]*touch-action:\s*manipulation/);
  assert.match(polishCss, /\.pm-settings-launcher\s*\{[\s\S]*touch-action:\s*manipulation/);
});
