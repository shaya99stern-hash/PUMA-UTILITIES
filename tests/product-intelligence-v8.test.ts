import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { addClaim, addEvidence, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { aggregateDiscoveryCandidates, parseDiscoveryGeographies } from '../lib/research/discovery-ranking';
import { linkedCompanyPropertyIds } from '../lib/research/portfolio-links';
import { ingestCompanyWebsite } from '../lib/research/ingest';
import { ingestNysTaxParcel, normalizeNysParcelStreet, type NysTaxParcelRecord } from '../lib/research/sources/nys-tax-parcels';
import { buildOpportunityIntelligence } from '../lib/research/opportunity';
import { estimatePropertyWaterCost, parseFixedWaterCharge, parseVariableWaterRate } from '../lib/research/water-cost';
import { mergeResearchRunIntoWorkspace } from '../lib/research/workspace-projection';
import type { Workspace } from '../lib/types';

test('multi-market discovery accepts a bounded set of state codes and removes duplicates', () => {
  assert.deepEqual(parseDiscoveryGeographies('NJ, NY PA; NJ'), ['NJ','NY','PA']);
  assert.deepEqual(parseDiscoveryGeographies('nj'), ['NJ']);
  assert.throws(() => parseDiscoveryGeographies('NJ, NEW YORK'), /two-letter state/i);
  assert.throws(() => parseDiscoveryGeographies('NJ,NY,PA,CT,MA,RI'), /at most 5/i);
});

test('discovery aggregation rewards repeated owner-operator signals across markets without inventing qualification', () => {
  const candidates = aggregateDiscoveryCandidates([
    { geography:'NJ', result:{ title:'Acme Properties | Owner Operator', url:'https://acme.example/about', snippet:'Owner and operator of multifamily properties.' } },
    { geography:'PA', result:{ title:'Acme Properties', url:'https://acme.example/portfolio', snippet:'Our portfolio includes apartment communities.' } },
    { geography:'NJ', result:{ title:'Huge REIT', url:'https://huge.example/', snippet:'Global REIT with thousands of properties.' } },
  ], 10);
  assert.equal(candidates[0]?.website, 'https://acme.example');
  assert.deepEqual(candidates[0]?.markets.sort(), ['NJ','PA']);
  assert.ok((candidates[0]?.hits ?? 0) >= 2);
  assert.ok(candidates[0]?.reasons.some((reason) => /owner.?operator/i.test(reason)));
  assert.ok((candidates.find((item) => item.website === 'https://huge.example')?.score ?? 0) < (candidates[0]?.score ?? 0));
});

test('exact legal-suffix equivalents link official owner entities back to the researched company', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:root', kind:'company', label:'Acme Properties', geography:'NY' });
  upsertEntity(graph, { id:'company:owner', kind:'company', label:'ACME PROPERTIES LLC', geography:'NY' });
  upsertEntity(graph, { id:'property:one', kind:'property', label:'1 Main St, Albany, NY 12207', geography:'NY' });
  addClaim(graph, { id:'owner', subjectId:'property:one', fact:'property.owner', objectEntityId:'company:owner', state:'VERIFIED', confidence:.95, evidenceIds:[], observedAt:'2026-09-22T21:00:00Z' });
  assert.deepEqual(linkedCompanyPropertyIds(graph, 'company:root'), ['property:one']);
});

test('different organization names are never collapsed by portfolio reconciliation', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:root', kind:'company', label:'Acme Properties', geography:'NY' });
  upsertEntity(graph, { id:'company:other', kind:'company', label:'Acme Capital Partners', geography:'NY' });
  upsertEntity(graph, { id:'property:one', kind:'property', label:'1 Main St', geography:'NY' });
  addClaim(graph, { id:'owner', subjectId:'property:one', fact:'property.owner', objectEntityId:'company:other', state:'VERIFIED', confidence:.95, evidenceIds:[], observedAt:'2026-09-22T21:00:00Z' });
  assert.deepEqual(linkedCompanyPropertyIds(graph, 'company:root'), []);
});

test('published first-party email can attach across pages when its local part exactly matches the leader name', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:root', kind:'company', label:'Acme Properties', geography:'NJ' });
  ingestCompanyWebsite(graph, 'company:root', {
    seedUrl:'https://acme.example/',
    visitedUrls:['https://acme.example/team','https://acme.example/contact'],
    contacts:[
      { type:'email', value:'alex.morgan@acme.example', sourceUrl:'https://acme.example/contact', context:'Leadership contacts' },
      { type:'email', value:'info@acme.example', sourceUrl:'https://acme.example/contact', context:'General inquiries' },
    ],
    leadershipSignals:[{ text:'Alex Morgan — Chief Property Officer', sourceUrl:'https://acme.example/team' }],
    propertySignals:[], portfolioSignals:[], ownerOperatorSignals:[], socialUrls:[], warnings:[],
  }, '2026-09-22T21:00:00Z');
  const person = graph.entities.find((entity) => entity.kind === 'person' && entity.label === 'Alex Morgan');
  assert.ok(person);
  assert.ok(graph.claims.some((claim) => claim.subjectId === person?.id && claim.fact === 'person.email' && claim.value === 'alex.morgan@acme.example'));
  assert.equal(graph.claims.some((claim) => claim.subjectId === person?.id && claim.fact === 'person.email' && claim.value === 'info@acme.example'), false);
});

test('NYS parcel address normalization is conservative and drops only mailing suffixes', () => {
  assert.equal(normalizeNysParcelStreet('123 Main Street, Albany, NY 12207'), '123 MAIN ST');
  assert.equal(normalizeNysParcelStreet('77-79 North Broadway, White Plains, NY 10603'), '77-79 NORTH BROADWAY');
});

test('NYS official tax parcel enriches the existing property with owner, parcel alias and GFA', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:ny', kind:'property', label:'123 Main St, Albany, NY 12207', geography:'NY' });
  const record: NysTaxParcelRecord = {
    printKey:'76.10-1-12',
    parcelAddress:'123 MAIN ST',
    zip:'12207',
    county:'Albany',
    primaryOwner:'ACME PROPERTIES LLC',
    gfa:88000,
    propertyClass:'411',
    rollYear:2025,
  };
  ingestNysTaxParcel(graph, 'property:ny', record, undefined, '2026-09-22T21:00:00Z');
  assert.ok(graph.entities.find((entity) => entity.id === 'property:ny')?.aliases?.includes('NYS tax parcel 76.10-1-12'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:ny' && claim.fact === 'property.owner' && claim.state === 'VERIFIED'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:ny' && claim.fact === 'property.grossSquareFeet' && claim.value === 88000));
  assert.equal(graph.claims.some((claim) => claim.subjectId === 'property:ny' && claim.fact === 'property.units'), false);
});

test('tariff parsing covers additional common water billing units without accepting wastewater', () => {
  assert.ok(Math.abs((parseVariableWaterRate('Water charge $4.25 per 100 cubic feet')?.dollarsPer1000Gallons ?? 0) - (4.25 / 748 * 1000)) < 0.02);
  assert.equal(parseVariableWaterRate('Water usage $62.00 per 10,000 gallons')?.dollarsPer1000Gallons, 6.2);
  assert.equal(parseVariableWaterRate('Sewer $4.25 per 100 cubic feet'), undefined);
  assert.equal(parseFixedWaterCharge('Bimonthly water service charge $48 every two months')?.monthlyDollars, 24);
});

test('opportunity intelligence converts sourced research into actionable coverage and benchmark totals', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:root', kind:'company', label:'Acme Properties', geography:'NJ' });
  upsertEntity(graph, { id:'person:ops', kind:'person', label:'Alex Morgan', geography:'NJ' });
  upsertEntity(graph, { id:'property:one', kind:'property', label:'123 Main St, Newark, NJ 07102', geography:'NJ' });
  upsertEntity(graph, { id:'utility:one', kind:'utility', label:'Example Water', geography:'NJ' });
  addEvidence(graph, { id:'ev:first', sourceId:'company-first-party-web', url:'https://acme.example', observedAt:'2026-09-22T21:00:00Z', authority:'first-party', confidence:.9 });
  addEvidence(graph, { id:'ev:official', sourceId:'nj-parcel-mod4', url:'https://nj.gov/', observedAt:'2026-09-22T21:00:00Z', authority:'official', confidence:.95 });
  addEvidence(graph, { id:'ev:rate', sourceId:'utility-first-party-web', url:'https://water.example/rates', observedAt:'2026-09-22T21:00:00Z', authority:'first-party', confidence:.9 });
  addClaim(graph, { id:'portfolio', subjectId:'company:root', fact:'company.portfolio', value:45, state:'SUPPORTED', confidence:.9, evidenceIds:['ev:first'], observedAt:'2026-09-22T21:00:00Z', metricLabel:'properties', qualifier:'exact' });
  addClaim(graph, { id:'oo', subjectId:'company:root', fact:'company.ownerOperator', value:'Owner and manager', state:'SUPPORTED', confidence:.9, evidenceIds:['ev:first'], observedAt:'2026-09-22T21:00:00Z' });
  addClaim(graph, { id:'dm', subjectId:'company:root', fact:'person.decisionMaker', objectEntityId:'person:ops', state:'SUPPORTED', confidence:.9, evidenceIds:['ev:first'], observedAt:'2026-09-22T21:00:00Z' });
  addClaim(graph, { id:'title', subjectId:'person:ops', fact:'person.title', value:'Chief Property Officer', state:'SUPPORTED', confidence:.9, evidenceIds:['ev:first'], observedAt:'2026-09-22T21:00:00Z' });
  addClaim(graph, { id:'email', subjectId:'person:ops', fact:'person.email', value:'alex@acme.example', state:'SUPPORTED', confidence:.9, evidenceIds:['ev:first'], observedAt:'2026-09-22T21:00:00Z' });
  addClaim(graph, { id:'manager', subjectId:'property:one', fact:'property.manager', objectEntityId:'company:root', state:'SUPPORTED', confidence:.9, evidenceIds:['ev:first'], observedAt:'2026-09-22T21:00:00Z' });
  addClaim(graph, { id:'owner', subjectId:'property:one', fact:'property.owner', objectEntityId:'company:root', state:'VERIFIED', confidence:.95, evidenceIds:['ev:official'], observedAt:'2026-09-22T21:00:00Z' });
  addClaim(graph, { id:'units', subjectId:'property:one', fact:'property.units', value:100, state:'VERIFIED', confidence:.95, evidenceIds:['ev:official'], observedAt:'2026-09-22T21:00:00Z' });
  addClaim(graph, { id:'provider', subjectId:'property:one', fact:'utility.provider', objectEntityId:'utility:one', state:'SUPPORTED', confidence:.93, evidenceIds:['ev:official'], observedAt:'2026-09-22T21:00:00Z' });
  addClaim(graph, { id:'rate', subjectId:'utility:one', fact:'utility.rateSchedule', value:'Water usage charge $8.00 per 1,000 gallons', state:'SUPPORTED', confidence:.9, evidenceIds:['ev:rate'], observedAt:'2026-09-22T21:00:00Z' });
  const run = { graph, rootEntityId:'company:root', tasksExecuted:10, complete:10, blocked:0, failed:0, results:[], rootCompleteness:.9, stopReason:'source-exhausted' as const };
  assert.ok(estimatePropertyWaterCost(graph, 'property:one'));
  const intelligence = buildOpportunityIntelligence(run);
  assert.equal(intelligence.linkedProperties, 1);
  assert.equal(intelligence.officialOwnershipProperties, 1);
  assert.equal(intelligence.utilityResolvedProperties, 1);
  assert.equal(intelligence.benchmarkedProperties, 1);
  assert.ok((intelligence.annualWaterSpendBenchmark ?? 0) > 0);
  assert.equal(intelligence.topContact?.name, 'Alex Morgan');
  assert.ok(intelligence.nextActions.length >= 1);
  assert.ok(intelligence.priority >= 60);
});

test('V8 UI persists and displays opportunity intelligence and multi-market discovery', () => {
  const panel = readFileSync('app/components/puma-research-panel.tsx', 'utf8');
  const shell = readFileSync('app/components/puma-workspace-app-v4.tsx', 'utf8');
  const types = readFileSync('lib/types.ts', 'utf8');
  assert.match(panel, /Opportunity intelligence/);
  assert.match(panel, /Markets/);
  assert.match(panel, /annualWaterSpendBenchmark/);
  assert.match(shell, /opportunityIntelligence/);
  assert.match(shell, /Next best action/);
  assert.match(types, /opportunityIntelligence\?:/);
});

test('V8 deep research uses a larger single-run budget and requires operational coverage before early stop', () => {
  const panel = readFileSync('app/components/puma-research-panel.tsx', 'utf8');
  const route = readFileSync('app/api/research/run/route.ts', 'utf8');
  const runner = readFileSync('lib/research/runner.ts', 'utf8');
  assert.match(panel, /maxTasks:\s*60/);
  assert.match(panel, /maxBudgetUnits:\s*82/);
  assert.match(panel, /maxDepth:\s*4/);
  assert.match(route, /maxTasks,\s*60/);
  assert.match(route, /maxBudgetUnits,\s*82/);
  assert.match(runner, /rootHasOperationalCoverage/);
});

test('NYS source is registered as official owner and gross-area corroboration only', () => {
  const registry = readFileSync('lib/research/source-registry.ts', 'utf8');
  const block = registry.match(/id:\s*['"]nys-tax-parcels-public['"][\s\S]*?\n\s*\},/)?.[0] ?? '';
  assert.match(block, /property\.owner/);
  assert.match(block, /property\.grossSquareFeet/);
  assert.doesNotMatch(block, /property\.units/);
});


test('workspace projection preserves official parcel aliases and opportunity intelligence', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:root', kind:'company', label:'Acme Properties', geography:'NY' });
  upsertEntity(graph, { id:'property:one', kind:'property', label:'123 Main St, Albany, NY 12207', geography:'NY', aliases:['NYS tax parcel 76.10-1-12'] });
  addEvidence(graph, { id:'ev:first', sourceId:'company-first-party-web', url:'https://acme.example', observedAt:'2026-09-22T21:00:00Z', authority:'first-party', confidence:.9 });
  addEvidence(graph, { id:'ev:official', sourceId:'nys-tax-parcels-public', url:'https://gisservices.its.ny.gov/', observedAt:'2026-09-22T21:00:00Z', authority:'official', confidence:.95 });
  addClaim(graph, { id:'manager', subjectId:'property:one', fact:'property.manager', objectEntityId:'company:root', state:'SUPPORTED', confidence:.9, evidenceIds:['ev:first'], observedAt:'2026-09-22T21:00:00Z' });
  addClaim(graph, { id:'owner', subjectId:'property:one', fact:'property.owner', objectEntityId:'company:root', state:'VERIFIED', confidence:.95, evidenceIds:['ev:official'], observedAt:'2026-09-22T21:00:00Z' });
  const run = { graph, rootEntityId:'company:root', tasksExecuted:2, complete:2, blocked:0, failed:0, results:[], rootCompleteness:.4, stopReason:'source-exhausted' as const };
  const workspace: Workspace = { version:1, companies:[], properties:[], parcels:[], utilities:[], meters:[], tariffs:[], monitorSettings:{}, updatedAt:'2026-09-22T20:00:00Z' };
  const merged = mergeResearchRunIntoWorkspace(workspace, run);
  assert.equal(merged.workspace.properties.length, 1);
  assert.equal(merged.workspace.parcels.length, 1);
  assert.match(merged.workspace.parcels[0].identifier, /76\.10-1-12/);
  assert.equal(merged.workspace.properties[0].parcelIds.length, 1);
  assert.ok(merged.workspace.companies[0].opportunityIntelligence);
});
