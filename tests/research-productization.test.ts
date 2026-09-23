import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { addClaim, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { ingestCompanyWebsite } from '../lib/research/ingest';
import { assessResearchRun } from '../lib/research/qualification';
import { emptyWorkspace } from '../lib/workspace';
import { mergeResearchRunIntoWorkspace } from '../lib/research/workspace-projection';

test('first-party portfolio addresses become recursively researchable property entities', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:sample', kind: 'company', label: 'Sample Property Management', geography: 'NJ' });

  ingestCompanyWebsite(graph, 'company:sample', {
    seedUrl: 'https://samplepm.com/',
    visitedUrls: ['https://samplepm.com/portfolio'],
    contacts: [],
    leadershipSignals: [],
    propertySignals: [{
      address: '123 Main St, Newark, NJ 07102',
      state: 'NJ',
      sourceUrl: 'https://samplepm.com/portfolio',
    }],
    socialUrls: [],
    warnings: [],
  }, '2026-09-22T12:00:00.000Z');

  const property = graph.entities.find((entity) => entity.kind === 'property' && entity.label === '123 Main St, Newark, NJ 07102');
  assert.ok(property);
  assert.ok(graph.claims.some((claim) =>
    claim.subjectId === property.id &&
    claim.fact === 'property.manager' &&
    claim.objectEntityId === 'company:sample' &&
    claim.state === 'SUPPORTED'
  ));
});

test('qualification separates target fit from contact actionability', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:one', kind: 'company', label: 'Example Property Group', geography: 'NJ' });
  upsertEntity(graph, { id: 'person:one', kind: 'person', label: 'Jane Smith', geography: 'NJ' });
  addClaim(graph, { id:'portfolio', subjectId:'company:one', fact:'company.portfolio', value:50, state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T12:00:00.000Z' });
  addClaim(graph, { id:'ownerop', subjectId:'company:one', fact:'company.ownerOperator', value:'Owner operator; self-managed', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T12:00:00.000Z' });
  addClaim(graph, { id:'dm', subjectId:'company:one', fact:'person.decisionMaker', objectEntityId:'person:one', state:'SUPPORTED', confidence:.8, evidenceIds:[], observedAt:'2026-09-22T12:00:00.000Z' });
  addClaim(graph, { id:'email', subjectId:'person:one', fact:'person.email', value:'jane@example.com', state:'SUPPORTED', confidence:.8, evidenceIds:[], observedAt:'2026-09-22T12:00:00.000Z' });

  const assessment = assessResearchRun({
    graph,
    rootEntityId:'company:one',
    tasksExecuted:1,
    complete:1,
    blocked:0,
    failed:0,
    results:[],
    rootCompleteness:.5,
    stopReason:'source-exhausted',
  });

  assert.ok(assessment.fit >= 80);
  assert.ok(assessment.actionability >= 60);
});

test('CRM projection refuses to promote inferred contact data into verified-public fields', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:one', kind: 'company', label: 'Example Property Group', geography: 'NJ' });
  addClaim(graph, { id:'verified-site', subjectId:'company:one', fact:'company.website', value:'https://example.com', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T12:00:00.000Z' });
  addClaim(graph, { id:'inferred-email', subjectId:'company:one', fact:'company.email', value:'guess@example.com', state:'INFERRED', confidence:.95, evidenceIds:[], observedAt:'2026-09-22T12:00:00.000Z' });

  const merged = mergeResearchRunIntoWorkspace(emptyWorkspace(), {
    graph,
    rootEntityId:'company:one',
    tasksExecuted:1,
    complete:1,
    blocked:0,
    failed:0,
    results:[],
    rootCompleteness:.2,
    stopReason:'source-exhausted',
  });

  assert.equal(merged.workspace.companies.length, 1);
  assert.equal(merged.workspace.companies[0].website, 'https://example.com');
  assert.equal(merged.workspace.companies[0].publicEmail, undefined);
});

test('product contains bounded APIs, optional browser enrichment, and a focused Find Leads workflow', () => {
  for (const path of [
    '../app/api/research/run/route.ts',
    '../app/api/research/discover/route.ts',
    '../lib/research/browser-research.ts',
    '../lib/research/workspace-projection.ts',
    '../app/components/puma-research-panel.tsx',
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), true, path);
  }

  const panel = readFileSync(new URL('../app/components/puma-research-panel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /\/api\/research\/run/);
  assert.match(panel, /\/api\/research\/discover/);
  assert.match(panel, /Save to Prospects/);
  assert.doesNotMatch(panel, /Browser\/ContactOut enrichment/);

  const adapter = readFileSync(new URL('../lib/research/browser-research.ts', import.meta.url), 'utf8');
  assert.match(adapter, /PUMA_BROWSER_RESEARCH_URL/);
  assert.match(adapter, /Do not reveal or bypass credit-gated contact data/);
});
