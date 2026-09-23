import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const shimPath = 'app/components/puma-workspace-app.tsx';
const implementationPath = 'app/components/puma-workspace-app-v4.tsx';
const homePath = 'app/components/puma-home-screen.tsx';
const shellPath = 'app/components/puma-app-shell.tsx';
const brandMarkPath = 'app/components/puma-brand-mark.tsx';

test('routes Puma through the final minimal Companies implementation', () => {
  const shim = readFileSync(shimPath, 'utf8');
  assert.match(shim, /puma-workspace-app-v4/);
  assert.equal(existsSync(implementationPath), true, 'v4 implementation should exist');
});

test('Companies stays minimal and uses real workspace data without legacy Clients copy', () => {
  const source = readFileSync(implementationPath, 'utf8');

  assert.match(source, /<h1>Companies<\/h1>/);
  assert.match(source, /No companies here yet/);
  assert.match(source, /Companies move here when their status changes/);
  assert.match(source, /visibleCompanies\.map/);
  assert.doesNotMatch(source, />Clients</);
  assert.doesNotMatch(source, /Authorized Alerts/);
  assert.doesNotMatch(source, /<SectionTitle>Workspace<\/SectionTitle>/);
  assert.doesNotMatch(source, /puma-record-actions/);
});

test('canonical Home owns welcome personalization and current dashboard metrics', () => {
  assert.equal(existsSync(homePath), true, 'canonical Home should exist');
  const home = readFileSync(homePath, 'utf8');
  const workspace = readFileSync(implementationPath, 'utf8');

  assert.match(workspace, /import PumaHomeScreen from '.\/puma-home-screen'/);
  assert.match(workspace, /<PumaHomeScreen/);
  assert.match(home, /profileName \? `Welcome, \$\{profileName\}` : 'Welcome'/);
  assert.match(home, /Today at a glance/);
  assert.match(home, />Follow-ups</);
  assert.match(home, />Prospects</);
  assert.match(home, />Alerts</);
  assert.doesNotMatch(home, /Active clients/);
  assert.doesNotMatch(home, /Find real companies/);
  assert.doesNotMatch(home, />Profile</);
});

test('shared shell owns navigation and uses the transparent vector Puma mark', () => {
  assert.equal(existsSync(shellPath), true, 'shared AppShell should exist');
  assert.equal(existsSync(brandMarkPath), true, 'shared Puma brand mark should exist');
  const shell = readFileSync(shellPath, 'utf8');
  const brandMark = readFileSync(brandMarkPath, 'utf8');

  assert.match(shell, /import PumaBrandMark from '.\/puma-brand-mark'/);
  assert.match(shell, /aria-label="Desktop navigation"/);
  assert.match(shell, /aria-label="Primary navigation"/);
  assert.match(shell, /pu-mobile-settings/);
  assert.match(brandMark, /<svg/);
  assert.match(brandMark, /fill="none"/);
  assert.doesNotMatch(brandMark, /<img\b/);
  assert.doesNotMatch(brandMark, /filter:/);
});
