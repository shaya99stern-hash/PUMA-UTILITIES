import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createResearchGraph, upsertEntity } from '../lib/research/graph';
import { ingestCompanyWebsite } from '../lib/research/ingest';

test('first-party portfolio addresses become recursively researchable property entities', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:sample', kind: 'company', label: 'Sample Property Management', geography: 'NJ' });

  ingestCompanyWebsite(graph, 'company:sample', {
    seedUrl: 'https://samplepm.com/',
    visitedUrls: ['https://samplepm.com/portfolio'],
    contacts: [],
    leadershipSignals: [],
    socialUrls: [],
    warnings: [],
    propertySignals: [{
      address: '123 Main St, Newark, NJ 07102',
      state: 'NJ',
      sourceUrl: 'https://samplepm.com/portfolio',
    }],
  } as never, '2026-09-22T12:00:00.000Z');

  const property = graph.entities.find((entity) => entity.kind === 'property' && entity.label === '123 Main St, Newark, NJ 07102');
  assert.ok(property, 'expected a property entity from a first-party portfolio address');
  assert.ok(graph.claims.some((claim) =>
    claim.subjectId === property?.id &&
    claim.fact === 'property.manager' &&
    claim.objectEntityId === 'company:sample' &&
    (claim.state === 'SUPPORTED' || claim.state === 'VERIFIED')
  ));
});

test('main product contains a bounded research API and a live Find Leads workflow', () => {
  const apiPath = new URL('../app/api/research/run/route.ts', import.meta.url);
  const appPath = new URL('../app/components/puma-workspace-app-v4.tsx', import.meta.url);
  assert.equal(existsSync(apiPath), true, 'research run API must exist on the product branch');
  const source = readFileSync(appPath, 'utf8');
  assert.match(source, /\/api\/research\/run/);
  assert.match(source, /Save to Prospects/);
  assert.match(source, /web discovery/i);
});

test('research results have a dedicated safe CRM projection seam', () => {
  const projectionPath = new URL('../lib/research/workspace-projection.ts', import.meta.url);
  assert.equal(existsSync(projectionPath), true, 'workspace projection module must exist');
  const source = readFileSync(projectionPath, 'utf8');
  assert.match(source, /mergeResearchRunIntoWorkspace/);
  assert.match(source, /VERIFIED/);
  assert.match(source, /SUPPORTED/);
  assert.match(source, /verified-public/);
});
