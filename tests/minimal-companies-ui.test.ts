import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const shimPath = 'app/components/puma-workspace-app.tsx';
const v3Path = 'app/components/puma-workspace-app-v3.tsx';

test('routes Puma through the minimal Companies implementation', () => {
  const shim = readFileSync(shimPath, 'utf8');
  assert.match(shim, /puma-workspace-app-v3/);
  assert.equal(existsSync(v3Path), true, 'v3 implementation should exist');
});

test('minimal implementation uses Companies, a quiet home, and profile personalization', () => {
  assert.equal(existsSync(v3Path), true, 'v3 implementation should exist');
  const source = readFileSync(v3Path, 'utf8');

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

test('in-app brand mark visually suppresses the old gray icon tile', () => {
  assert.equal(existsSync(v3Path), true, 'v3 implementation should exist');
  const source = readFileSync(v3Path, 'utf8');
  assert.match(source, /pm-brand-mark/);
  assert.match(source, /contrast\(/);
  assert.match(source, /overflow:\s*hidden/);
});
