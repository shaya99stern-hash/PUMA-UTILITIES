import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createReleaseOneWorkspace, RELEASE_ONE_COMPANY_IDS, stripLegacyReleaseOneSeeds } from '../lib/seed';

const shell = readFileSync('app/components/puma-workspace-app-v4.tsx', 'utf8');
const panel = readFileSync('app/components/puma-research-panel.tsx', 'utf8');
const responsive = readFileSync('app/puma-responsive-v6.css', 'utf8');
const globals = readFileSync('app/globals.css', 'utf8');

test('live workspace no longer auto-injects release-one demo companies', () => {
  assert.doesNotMatch(shell, /mergeReleaseOneSeeds/);
  assert.match(shell, /stripLegacyReleaseOneSeeds/);
  const stripped = stripLegacyReleaseOneSeeds(createReleaseOneWorkspace());
  assert.equal(stripped.companies.length, 0);
  assert.ok(RELEASE_ONE_COMPANY_IDS.every((id) => stripped.companies.every((company) => company.id !== id)));
});

test('legacy seed cleanup preserves non-seed user companies', () => {
  const workspace = createReleaseOneWorkspace();
  workspace.companies.push({
    id:'user-company',
    name:'Real Saved Company',
    stage:'Research',
    headquarters:{ status:'unknown' },
    portfolioBuildings:{ status:'unknown' },
    portfolioUnits:{ status:'unknown' },
    people:[],
    provenance:[],
    createdAt:'2026-09-22T22:00:00Z',
    updatedAt:'2026-09-22T22:00:00Z',
  });
  const stripped = stripLegacyReleaseOneSeeds(workspace);
  assert.deepEqual(stripped.companies.map((company) => company.id), ['user-company']);
});

test('empty home has one intentional action instead of zero-stat dashboard clutter', () => {
  assert.match(shell, /No companies yet/);
  assert.match(shell, /Find real companies/);
  assert.match(shell, /allCompanies\.length === 0/);
});

test('Find Leads hides implementation knobs under progressive disclosure', () => {
  assert.match(panel, /Find real companies/);
  assert.doesNotMatch(panel, />Known website \(optional\)</);
  assert.match(panel, /<details className="pm-research-advanced"/);
  assert.match(panel, />Website hint</);
  assert.match(panel, />Advanced filters</);
  assert.match(panel, />Data sources</);
});

test('profile name is directly editable in Settings and no hard-coded Pinny state remains', () => {
  assert.doesNotMatch(shell, /useState\('Pinny'\)/);
  assert.match(shell, /pm-profile-settings/);
  assert.match(shell, />Display name</);
  assert.match(shell, /Save name/);
});

test('mobile navigation is four primary destinations without a duplicate hamburger drawer', () => {
  assert.doesNotMatch(shell, /aria-label="Menu"/);
  for (const label of ['Home','Companies','Find Leads','Monitor']) {
    assert.match(shell, new RegExp(`<span>${label}<\\/span>`));
  }
});

test('Puma uses a serif product font and neutral primary actions', () => {
  assert.match(globals, /--pm-serif:/);
  assert.match(globals, /font-family:\s*var\(--pm-serif\)/);
  assert.match(responsive, /\.pm-shell[\s\S]*font-family:\s*var\(--pm-serif\)/);
  assert.match(responsive, /\.pm-research-primary[\s\S]*background:\s*#151719/);
  assert.doesNotMatch(responsive, /\.pm-research-primary[\s\S]*background:\s*var\(--pm-orange\)/);
});

test('low-signal discovery results are withheld rather than surfaced as pseudo-leads', () => {
  const ranking = readFileSync('lib/research/discovery-ranking.ts', 'utf8');
  assert.match(ranking, /candidate\.reasons\.size > 0/);
  assert.match(ranking, /candidate\.hits >= 2 \|\| normalized >= 0\.55/);
});

test('production Vercel hosts canonicalize to the stable Puma origin without affecting previews', () => {
  const proxy = readFileSync('proxy.ts', 'utf8');
  assert.match(proxy, /VERCEL_ENV === 'production'/);
  assert.match(proxy, /puma-utilities\.vercel\.app/);
  assert.match(proxy, /NextResponse\.redirect/);
});
