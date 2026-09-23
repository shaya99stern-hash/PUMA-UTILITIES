import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const shell = readFileSync('app/components/puma-workspace-app-v4.tsx', 'utf8');
const settingsShell = readFileSync('app/components/puma-settings-shell.tsx', 'utf8');
const settingsCss = readFileSync('app/puma-minimal-settings.css', 'utf8');

test('installed iPhone Settings shell owns its safe areas and mobile navigation layout', () => {
  assert.match(settingsCss, /\.pm-settings-shell \.pm-appbar[\s\S]*safe-area-inset-top/);
  assert.match(settingsCss, /\.pm-settings-shell \.pm-content[\s\S]*overflow-y:\s*auto/);
  assert.match(settingsCss, /\.pm-settings-shell \.pm-bottom-nav[\s\S]*safe-area-inset-bottom/);
  assert.match(settingsCss, /\.pm-settings-shell \.pm-bottom-nav a[\s\S]*display:\s*(?:flex|grid)/);
  assert.match(settingsShell, /pm-settings-shell/);
  assert.match(settingsShell, /pm-settings-appbar/);
  assert.match(settingsShell, /pm-settings-bottom-nav/);
});

test('Home is a compact operational dashboard instead of an empty landing page', () => {
  assert.match(shell, /pm-home-dashboard/);
  assert.match(shell, /pm-home-today/);
  assert.match(shell, /pm-home-tasks/);
  assert.match(shell, /pm-home-quick-actions/);
  assert.match(shell, /pm-home-recent/);
  assert.match(shell, /href="\/engine"/);
  assert.match(shell, /href="\/clients"/);
  assert.match(shell, /href="\/monitor"/);
  assert.match(shell, /href="\/settings"/);
  assert.doesNotMatch(shell, /pm-zero-state/);
});

test('Home tasks are derived from actual workspace state rather than demo placeholders', () => {
  assert.match(shell, /followUpsToday/);
  assert.match(shell, /upcomingCompanies/);
  assert.match(shell, /recentlyUpdatedCompanies/);
  assert.match(shell, /alerts\.length/);
  assert.doesNotMatch(shell, /demo task|placeholder task|sample task/i);
});
