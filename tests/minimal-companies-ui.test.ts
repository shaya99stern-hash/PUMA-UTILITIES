import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const shimPath = 'app/components/puma-workspace-app.tsx';
const implementationPath = 'app/components/puma-workspace-app-v4.tsx';

test('routes Puma through the final minimal Companies implementation', () => {
  const shim = readFileSync(shimPath, 'utf8');
  assert.match(shim, /puma-workspace-app-v4/);
  assert.equal(existsSync(implementationPath), true, 'v4 implementation should exist');
});

test('minimal implementation uses Companies, a quiet home, and profile personalization', () => {
  assert.equal(existsSync(implementationPath), true, 'v4 implementation should exist');
  const source = readFileSync(implementationPath, 'utf8');

  assert.match(source, /Follow-Ups for Today/);
  assert.match(source, /Active Clients/);
  assert.match(source, />Alerts</);
  assert.match(source, /Welcome, \{profileName\}/);
  assert.match(source, /Profile/);
  assert.match(source, />Companies</);
  assert.doesNotMatch(source, />Clients</);
  assert.doesNotMatch(source, /Authorized Alerts/);
  assert.doesNotMatch(source, /<SectionTitle>Workspace<\/SectionTitle>/);
  assert.doesNotMatch(source, /puma-record-actions/);
});

test('in-app brand mark is a transparent vector without image filter or square-tile hacks', () => {
  assert.equal(existsSync(implementationPath), true, 'v4 implementation should exist');
  const source = readFileSync(implementationPath, 'utf8');
  const block = source.match(/function BrandMark[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(block, /<svg/);
  assert.doesNotMatch(block, /<img\b/);
  assert.doesNotMatch(source, /filter:\s*contrast\(/);
  assert.match(source, /\.pm-brand-mark \{[^}]*background:transparent/);
  assert.match(source, /\.pm-brand-mark \{[^}]*overflow:visible/);
});
