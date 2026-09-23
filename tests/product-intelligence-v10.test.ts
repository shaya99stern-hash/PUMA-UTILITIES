import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { addClaim, addEvidence, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { ingestBucksParcel, normalizeBucksParcelStreet, type BucksParcelRecord } from '../lib/research/sources/bucks-parcels';
import { rankPropertyOpportunities } from '../lib/research/property-priority';
import { buildResearchSnapshot, companyResearchRecency, researchRecencyStatus } from '../lib/research/research-snapshot';
import { workspaceProspectsCsv } from '../lib/export-prospects';
import { parseTariffClassEvidence } from '../lib/research/tariff-class';
import { planEntityTasks } from '../lib/research/task-planner';
import type { ResearchRunResult } from '../lib/research/runner';
import type { Workspace } from '../lib/types';

test('Bucks parcel normalization handles directional street variants', () => {
  assert.equal(normalizeBucksParcelStreet('55 East State Street, Doylestown, PA 18901'), '55 E STATE ST');
  assert.equal(normalizeBucksParcelStreet('2500 Bristol Pike, Bensalem, PA 19020'), '2500 BRISTOL PIKE');
});

test('Bucks official parcel evidence enriches one existing property with owner and parcel identity only', () => {
  const graph = createResearchGraph(); upsertEntity(graph, { id:'property:bucks', kind:'property', label:'55 E State St, Doylestown, PA 18901', geography:'PA' });
  const record: BucksParcelRecord = { parcelNumber:'09-005-001', address:'55 E STATE ST', municipality:'DOYLESTOWN BORO', owner1:'EXAMPLE PROPERTIES LLC', totalValue:1200000, landUseCode:'4100' };
  ingestBucksParcel(graph, 'property:bucks', record, undefined, '2026-09-22T23:00:00Z');
  assert.ok(graph.entities.find((entity) => entity.id === 'property:bucks')?.aliases?.includes('Bucks County parcel 09-005-001'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:bucks' && claim.fact === 'property.owner' && claim.state === 'VERIFIED'));
  assert.equal(graph.claims.some((claim) => claim.subjectId === 'property:bucks' && claim.fact === 'property.units'), false);
  assert.equal(graph.claims.some((claim) => claim.subjectId === 'property:bucks' && claim.fact === 'property.grossSquareFeet'), false);
});

test('PA county planner only spends the county-adapter task on likely Bucks addresses', () => {
  const bucks = createResearchGraph(); upsertEntity(bucks, { id:'p:b', kind:'property', label:'55 E State St, Doylestown, PA 18901', geography:'PA' });
  assert.ok(planEntityTasks(bucks, 'p:b', 'PA', { perNeed:10, maxTasks:50 }).some((task) => task.sourceId === 'pa-county-assessment'));
  const pgh = createResearchGraph(); upsertEntity(pgh, { id:'p:p', kind:'property', label:'100 Forbes Ave, Pittsburgh, PA 15222', geography:'PA' });
  assert.equal(planEntityTasks(pgh, 'p:p', 'PA', { perNeed:10, maxTasks:50 }).some((task) => task.sourceId === 'pa-county-assessment'), false);
});

test('property opportunity ranking promotes sourced high-spend buildings without converting gaps into facts', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:one', kind:'company', label:'Operator One', geography:'NJ' }); upsertEntity(graph, { id:'property:high', kind:'property', label:'100 Main St, Newark, NJ 07102', geography:'NJ' }); upsertEntity(graph, { id:'property:low', kind:'property', label:'200 Main St, Newark, NJ 07102', geography:'NJ' }); upsertEntity(graph, { id:'utility:high', kind:'utility', label:'Example Water', geography:'NJ' });
  addEvidence(graph, { id:'official', sourceId:'nj-parcel-mod4', url:'https://nj.gov', observedAt:'2026-09-22T23:00:00Z', authority:'official', confidence:.95 }); addEvidence(graph, { id:'rate-evidence', sourceId:'utility-first-party-web', url:'https://water.example/rates', observedAt:'2026-09-22T23:00:00Z', authority:'first-party', confidence:.9 });
  for (const propertyId of ['property:high','property:low']) addClaim(graph, { id:`manager:${propertyId}`, subjectId:propertyId, fact:'property.manager', objectEntityId:'company:one', state:'SUPPORTED', confidence:.9, evidenceIds:['official'], observedAt:'2026-09-22T23:00:00Z' });
  addClaim(graph, { id:'owner-high', subjectId:'property:high', fact:'property.owner', objectEntityId:'company:one', state:'VERIFIED', confidence:.95, evidenceIds:['official'], observedAt:'2026-09-22T23:00:00Z' }); addClaim(graph, { id:'units-high', subjectId:'property:high', fact:'property.units', value:250, state:'VERIFIED', confidence:.95, evidenceIds:['official'], observedAt:'2026-09-22T23:00:00Z' }); addClaim(graph, { id:'provider-high', subjectId:'property:high', fact:'utility.provider', objectEntityId:'utility:high', state:'SUPPORTED', confidence:.9, evidenceIds:['official'], observedAt:'2026-09-22T23:00:00Z' }); addClaim(graph, { id:'rate-high', subjectId:'utility:high', fact:'utility.rateSchedule', value:'Multifamily water usage $9.50 per 1,000 gallons', state:'SUPPORTED', confidence:.9, evidenceIds:['rate-evidence'], observedAt:'2026-09-22T23:00:00Z' });
  const ranked = rankPropertyOpportunities(graph, 'company:one'); assert.equal(ranked[0]?.propertyId, 'property:high'); assert.ok((ranked[0]?.annualWaterSpendBenchmark ?? 0) > 0); assert.ok(ranked[0]?.score > (ranked[1]?.score ?? 0)); assert.ok(ranked[1]?.gaps.includes('Water provider unresolved.'));
});

test('research snapshot and persisted provenance expose research recency', () => {
  const graph = createResearchGraph(); upsertEntity(graph, { id:'company:one', kind:'company', label:'Operator One', geography:'NJ' }); addEvidence(graph, { id:'one', sourceId:'company-first-party-web', url:'https://one.example', observedAt:'2026-09-21T12:00:00Z', authority:'first-party', confidence:.9 }); addEvidence(graph, { id:'two', sourceId:'nj-parcel-mod4', url:'https://two.example', observedAt:'2026-09-22T12:00:00Z', authority:'official', confidence:.95 });
  const run: ResearchRunResult = { graph, rootEntityId:'company:one', tasksExecuted:9, complete:7, blocked:1, failed:1, results:[], rootCompleteness:.72, stopReason:'source-exhausted', budgetUnitsSpent:18, maxBudgetUnits:82 }; const snapshot = buildResearchSnapshot(run, '2026-09-22T23:00:00Z'); assert.equal(snapshot.evidenceCount, 2); assert.equal(snapshot.sourceCount, 2); assert.equal(researchRecencyStatus(snapshot.researchedAt, '2026-10-07T23:00:00Z'), 'aging');
  const workspace: Workspace = { version:1, companies:[{ id:'c', name:'C', stage:'Research', headquarters:{status:'unknown'}, portfolioBuildings:{status:'unknown'}, portfolioUnits:{status:'unknown'}, people:[], provenance:[{id:'p',label:'source',status:'verified-public',reference:'https://one.example',retrievedAt:'2026-09-22T12:00:00Z'}], createdAt:'2026-09-22T00:00:00Z', updatedAt:'2026-09-22T00:00:00Z' }], properties:[], parcels:[], utilities:[], meters:[], tariffs:[], monitorSettings:{}, updatedAt:'2026-09-22T00:00:00Z' }; assert.equal(companyResearchRecency(workspace, 'c', '2026-09-25T12:00:00Z').status, 'fresh');
});

test('prospect CSV export contains evidence-backed operating fields and escapes spreadsheet text', () => {
  const workspace: Workspace = { version:1, companies:[{ id:'company:1', name:'Acme, "North"', stage:'Research', market:'NJ', headquarters:{status:'unknown'}, portfolioBuildings:{status:'unknown'}, portfolioUnits:{status:'unknown'}, people:[{id:'person:1',name:'Alex Morgan',role:'COO',email:'alex@acme.example',status:'verified-public'}], provenance:[{id:'p',label:'source',status:'verified-public',reference:'https://acme.example',retrievedAt:'2026-09-22T23:00:00Z'}], nextAction:'Verify owner', opportunityIntelligence:{ priority:82, confidence:'high', annualWaterSpendBenchmark:125000, linkedProperties:4, officialOwnershipProperties:3, utilityResolvedProperties:4, rateResolvedProperties:3, benchmarkedProperties:2, directContactCount:1, coverage:{ownershipPercent:75,utilityPercent:100,ratePercent:75,benchmarkPercent:50,contactPercent:100}, topContact:{name:'Alex Morgan',title:'COO',score:91,contactStatus:'email'}, nextActions:['Verify owner'], gaps:[], rationale:[] }, createdAt:'2026-09-22T23:00:00Z', updatedAt:'2026-09-22T23:00:00Z' }], properties:[], parcels:[], utilities:[], meters:[], tariffs:[], monitorSettings:{}, updatedAt:'2026-09-22T23:00:00Z' }; const csv = workspaceProspectsCsv(workspace); assert.match(csv, /Company,Market,Stage,Priority,Confidence/); assert.match(csv, /"Acme, ""North"""/); assert.match(csv, /alex@acme\.example/); assert.match(csv, /125000/); assert.match(csv, /2026-09-22T23:00:00Z/);
});

test('tariff class parser records only explicit water customer-class language', () => { assert.equal(parseTariffClassEvidence('Multifamily residential water service — $8.25 per 1,000 gallons'), 'multifamily'); assert.equal(parseTariffClassEvidence('General service water rate $7.20 per CCF'), 'general-service'); assert.equal(parseTariffClassEvidence('Commercial water service charge'), 'commercial'); assert.equal(parseTariffClassEvidence('Water usage charge $8.00 per 1,000 gallons'), undefined); assert.equal(parseTariffClassEvidence('Wastewater residential charge'), undefined); });

test('PR17 surfaces export, research recency, and top-building intelligence', () => { const intelligence = readFileSync('app/components/puma-intelligence-page.tsx', 'utf8'); const panel = readFileSync('app/components/puma-research-panel.tsx', 'utf8'); assert.match(intelligence, /Export CSV/); assert.match(intelligence, /Research recency/); assert.match(intelligence, /Top buildings/); assert.match(panel, /Top buildings to investigate/); assert.match(panel, /~\$\$\{opportunity\.annualWaterSpendBenchmark/); });

test('Pennsylvania county source has an executable Bucks adapter without promising physical facts', () => { const registry = readFileSync('lib/research/source-registry.ts', 'utf8'); const executor = readFileSync('lib/research/executor.ts', 'utf8'); const block = registry.match(/id:\s*['"]pa-county-assessment['"][\s\S]*?\n\s*\},/)?.[0] ?? ''; assert.match(block, /property\.owner/); assert.doesNotMatch(block, /property\.units/); assert.doesNotMatch(block, /property\.grossSquareFeet/); assert.match(executor, /task\.sourceId === 'pa-county-assessment'/); assert.match(executor, /lookupBucksParcelByAddress/); });

test('independent GitHub CI verifies tests typecheck and Next build', () => { assert.equal(existsSync('.github/workflows/ci.yml'), true); const ci = readFileSync('.github/workflows/ci.yml', 'utf8'); assert.match(ci, /npm test/); assert.match(ci, /npm run typecheck/); assert.match(ci, /next build/); });
