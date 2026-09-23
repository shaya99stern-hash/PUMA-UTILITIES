import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const settingsPath = 'app/settings/page.tsx';
const profilePath = 'app/settings/profile/page.tsx';
const sourcesPath = 'app/settings/data-sources/page.tsx';
const sourceManagerPath = 'app/components/puma-data-sources-settings.tsx';

const read = (path: string) => readFileSync(path, 'utf8');

test('canonical Home removes configuration and promotional clutter instead of hiding it with CSS', () => {
  assert.equal(existsSync('app/components/puma-home-screen.tsx'), true);
  const home = read('app/components/puma-home-screen.tsx');
  assert.doesNotMatch(home, /Profile|No companies yet|Find real companies|pm-zero-state|pm-home-grid|pm-stat-strip/);
});

test('Settings is a dedicated hub with Profile and Data Sources pages on the shared shell', () => {
  assert.equal(existsSync(settingsPath), true);
  assert.equal(existsSync(profilePath), true);
  assert.equal(existsSync(sourcesPath), true);

  const settings = read(settingsPath);
  const profile = read(profilePath);
  const sources = read(sourcesPath);

  assert.match(settings, /PumaSettingsHub/);
  assert.match(settings, /PumaAppShell/);
  assert.match(settings, /pageLabel="Settings"/);
  assert.match(profile, /PumaProfileSettings/);
  assert.match(profile, /PumaAppShell/);
  assert.match(profile, /backHref="\/settings"/);
  assert.match(sources, /PumaDataSourcesSettings/);
  assert.match(sources, /PumaAppShell/);
  assert.match(sources, /backHref="\/settings"/);
});

test('Data Sources keeps real add, enable/disable, and remove behavior', () => {
  assert.equal(existsSync(sourceManagerPath), true);
  const manager = read(sourceManagerPath);
  assert.match(manager, /\/api\/research\/run/);
  assert.match(manager, />Add Source</);
  assert.match(manager, /puma-custom-sources-v1/);
  assert.match(manager, /enabled/);
  assert.match(manager, /remove/i);
  assert.doesNotMatch(manager, /diagnostics/i);
});

test('Find Leads no longer exposes Data Sources as task-screen configuration', () => {
  const research = read('app/components/puma-research-panel.tsx');
  assert.doesNotMatch(research, /pm-research-sources/);
  assert.doesNotMatch(research, />Data sources</i);
});
