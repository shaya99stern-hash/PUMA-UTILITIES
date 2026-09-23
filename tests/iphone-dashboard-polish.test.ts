import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync('app/components/puma-home-dashboard.tsx', 'utf8');
const page = readFileSync('app/page.tsx', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');
const settingsShell = readFileSync('app/components/puma-settings-shell.tsx', 'utf8');
const settingsCss = readFileSync('app/puma-polish-v12.css', 'utf8');
const minimalCss = readFileSync('app/puma-minimal-settings.css', 'utf8');

test('installed iPhone Settings shell owns its safe areas and mobile navigation layout', () => {
  assert.match(settingsCss, /\.pm-settings-shell \.pm-appbar[\s\S]*safe-area-inset-top/);
  assert.match(settingsCss, /\.pm-settings-shell \.pm-content[\s\S]*overflow-y:\s*auto/);
  assert.match(settingsCss, /\.pm-settings-shell \.pm-bottom-nav[\s\S]*safe-area-inset-bottom/);
  assert.match(settingsCss, /\.pm-settings-shell \.pm-bottom-nav a[\s\S]*display:\s*(?:flex|grid)/);
  assert.match(settingsShell, /pm-settings-shell/);
  assert.match(settingsShell, /pm-settings-appbar/);
  assert.match(settingsShell, /pm-settings-bottom-nav/);
  assert.match(layout, /puma-polish-v12\.css/);
});

test('Home is a compact operational dashboard instead of an empty landing page', () => {
  assert.match(page, /PumaHomeDashboard/);
  assert.match(dashboard, /pm-home-dashboard/);
  assert.match(dashboard, /pm-home-today/);
  assert.match(dashboard, /pm-home-tasks/);
  assert.match(dashboard, /pm-home-quick-actions/);
  assert.match(dashboard, /pm-home-recent/);
  assert.match(dashboard, /href="\/engine"/);
  assert.match(dashboard, /href="\/clients"/);
  assert.match(dashboard, /href="\/monitor"/);
  assert.match(dashboard, /href="\/settings"/);
  assert.match(minimalCss, /\.pm-home \.pm-zero-state[\s\S]*display:\s*none\s*!important/);
});

test('Home tasks are derived from actual workspace state rather than demo placeholders', () => {
  assert.match(dashboard, /followUpsToday/);
  assert.match(dashboard, /upcomingCompanies/);
  assert.match(dashboard, /recentlyUpdatedCompanies/);
  assert.match(dashboard, /alerts\.length/);
  assert.match(dashboard, /loadWorkspace/);
  assert.doesNotMatch(dashboard, /demo task|placeholder task|sample task/i);
});
