import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const cssPath = 'app/puma-minimal-settings.css';
const layoutPath = 'app/layout.tsx';
const settingsPath = 'app/settings/page.tsx';
const profilePath = 'app/settings/profile/page.tsx';
const sourcesPath = 'app/settings/data-sources/page.tsx';
const sourceManagerPath = 'app/components/puma-data-sources-settings.tsx';

test('Home and Find Leads hide configuration clutter while preserving their underlying behavior', () => {
  assert.equal(existsSync(cssPath), true, 'minimal settings stylesheet should exist');
  const css = readFileSync(cssPath, 'utf8');
  assert.match(css, /\.pm-home \.pm-home-settings[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.pm-home \.pm-zero-state/);
  assert.match(css, /\.pm-home \.pm-stat-strip/);
  assert.match(css, /\.pm-home \.pm-home-grid/);
  assert.match(css, /\.pm-research-sources[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.pm-desktop-profile[\s\S]*display:\s*none\s*!important/);
});

test('Settings is a dedicated hub with Profile and Data Sources pages', () => {
  assert.equal(existsSync(settingsPath), true);
  assert.equal(existsSync(profilePath), true);
  assert.equal(existsSync(sourcesPath), true);

  const settings = readFileSync(settingsPath, 'utf8');
  const profile = readFileSync(profilePath, 'utf8');
  const sources = readFileSync(sourcesPath, 'utf8');

  assert.match(settings, /PumaSettingsHub/);
  assert.match(settings, /title="Settings"/);
  assert.match(profile, /PumaProfileSettings/);
  assert.match(profile, /backHref="\/settings"/);
  assert.match(sources, /PumaDataSourcesSettings/);
  assert.match(sources, /backHref="\/settings"/);
});

test('bottom-right Settings launcher is mounted globally and source management stays minimal', () => {
  const layout = readFileSync(layoutPath, 'utf8');
  assert.match(layout, /PumaSettingsLauncher/);
  assert.match(layout, /puma-minimal-settings\.css/);
  assert.match(layout, /<PumaSettingsLauncher \/>/);

  assert.equal(existsSync(sourceManagerPath), true);
  const manager = readFileSync(sourceManagerPath, 'utf8');
  assert.match(manager, /\/api\/research\/run/);
  assert.match(manager, />Add Source</);
  assert.match(manager, /puma-custom-sources-v1/);
  assert.doesNotMatch(manager, /diagnostics/i);
});
