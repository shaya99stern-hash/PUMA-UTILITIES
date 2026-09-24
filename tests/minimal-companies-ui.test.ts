import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const routePath = 'app/clients/page.tsx';
const crmPath = 'app/components/puma-crm-workspace.tsx';
const detailImplementationPath = 'app/components/puma-workspace-app-v4.tsx';
const homePath = 'app/components/puma-home-screen.tsx';
const shellPath = 'app/components/puma-app-shell.tsx';
const brandMarkPath = 'app/components/puma-brand-mark.tsx';

test('live Companies route uses the functional CRM surface while record details retain V4', () => {
  const route = readFileSync(routePath, 'utf8');
  const crm = readFileSync(crmPath, 'utf8');
  assert.match(route, /PumaCrmWorkspace/);
  assert.match(crm, /PumaWorkspaceAppV4/);
  assert.equal(existsSync(detailImplementationPath), true, 'v4 detail implementation should remain available');
});

test('Companies stays minimal, actionable, and uses real workspace data without legacy Clients copy', () => {
  const source = readFileSync(crmPath, 'utf8');

  assert.match(source, /<h1>\{title\}<\/h1>/);
  assert.match(source, /No companies here yet/);
  assert.match(source, /Add company/);
  assert.match(source, /Find Leads/);
  assert.match(source, /visibleCompanies\.map/);
  assert.match(source, /stripLegacyReleaseOneSeeds\(loadWorkspace\(\)\)/);
  assert.doesNotMatch(source, /Authorized Alerts/);
  assert.doesNotMatch(source, /<SectionTitle>Workspace<\/SectionTitle>/);
});

test('canonical Home owns welcome personalization and current dashboard metrics', () => {
  assert.equal(existsSync(homePath), true, 'canonical Home should exist');
  const home = readFileSync(homePath, 'utf8');
  const workspace = readFileSync(detailImplementationPath, 'utf8');

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
