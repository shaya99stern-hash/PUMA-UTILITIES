import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { addClaim, addEvidence, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { estimatePropertyWaterCost } from '../lib/research/water-cost';
import { ingestPaCountyParcel, normalizePaCountyParcelStreet, supportedPaCountyForAddress, type PaCountyParcelRecord } from '../lib/research/sources/pa-county-parcels';
import { parseTariffMetadata, tariffFreshness } from '../lib/research/tariff-metadata';
import { mergeResearchRunIntoWorkspace } from '../lib/research/workspace-projection';
import { serializeWorkspaceBackup, parseWorkspaceBackup } from '../lib/workspace-backup';
import { emptyWorkspace } from '../lib/workspace';
import type { ResearchRunResult } from '../lib/research/runner';

test('PA county normalization and routing cover Bucks, Montgomery, Chester, and Delaware', () => {
  assert.equal(normalizePaCountyParcelStreet('55 East State Street, Doylestown, PA 18901'), '55 E STATE ST');
  assert.equal(supportedPaCountyForAddress('55 E State St, Doylestown, PA 18901'), 'Bucks');
  assert.equal(supportedPaCountyForAddress('1 Montgomery Plaza, Norristown, PA 19401'), 'Montgomery');
  assert.equal(supportedPaCountyForAddress('313 W Market St, West Chester, PA 19380'), 'Chester');
  assert.equal(supportedPaCountyForAddress('201 W Front St, Media, PA 19063'), 'Delaware');
  assert.equal(supportedPaCountyForAddress('100 Forbes Ave, Pittsburgh, PA 15222'), undefined);
});

test('Montgomery official parcel evidence can add owner, parcel identity, and explicit residential units', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:montco', kind:'property', label:'1 Main St, Norristown, PA 19401', geography:'PA' });
  const record: PaCountyParcelRecord = { county:'Montgomery', parcelNumber:'13-00-01234-00-1', address:'1 MAIN ST', owner1:'EXAMPLE OWNER LLC', residentialUnits:84, sourceUrl:'https://services1.arcgis.com/kOChldNuKsox8qZD/arcgis/rest/services/Montgomery_County_Parcels/FeatureServer/6' };
  ingestPaCountyParcel(graph, 'property:montco', record, '2026-09-22T23:30:00Z');
  assert.ok(graph.entities.find((entity) => entity.id === 'property:montco')?.aliases?.includes('Montgomery County parcel 13-00-01234-00-1'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:montco' && claim.fact === 'property.owner' && claim.state === 'VERIFIED'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:montco' && claim.fact === 'property.units' && claim.value === 84 && claim.state === 'VERIFIED'));
});

test('Chester and Delaware parcel records never invent units or gross area', () => {
  for (const record of [
    { county:'Chester', parcelNumber:'01-02-0034', address:'313 W MARKET ST', owner1:'CHESTER OWNER LLC', sourceUrl:'https://services.arcgis.com/G4S1dGvn7PIgYd6Y/arcgis/rest/services/Parcels_owners/FeatureServer/0' },
    { county:'Delaware', parcelNumber:'01-00-00123-00', address:'201 W FRONT ST', owner1:'DELAWARE OWNER LLC', sourceUrl:'https://gis.delcopa.gov/arcgis/rest/services/Hosted/Delaware_County_Parcel_319_Project/FeatureServer/0' },
  ] as PaCountyParcelRecord[]) {
    const graph = createResearchGraph(); upsertEntity(graph, { id:'property:test', kind:'property', label:record.address ?? 'property', geography:'PA' });
    ingestPaCountyParcel(graph, 'property:test', record, '2026-09-22T23:30:00Z');
    assert.ok(graph.claims.some((claim) => claim.fact === 'property.owner'));
    assert.equal(graph.claims.some((claim) => claim.fact === 'property.units'), false);
    assert.equal(graph.claims.some((claim) => claim.fact === 'property.grossSquareFeet'), false);
  }
});

test('tariff metadata only parses explicit effective/expiration language and class evidence', () => {
  const metadata = parseTariffMetadata('Multifamily water service effective January 1, 2026 through December 31, 2026 — $8.20 per 1,000 gallons');
  assert.equal(metadata.customerClass, 'multifamily');
  assert.equal(metadata.effectiveFrom, '2026-01-01');
  assert.equal(metadata.effectiveTo, '2026-12-31');
  assert.equal(tariffFreshness(metadata, '2026-09-22T12:00:00Z'), 'current');
  assert.equal(tariffFreshness(metadata, '2027-01-02T12:00:00Z'), 'expired');
  assert.equal(parseTariffMetadata('Updated January 1, 2026. Water usage $8.20 per 1,000 gallons').effectiveFrom, undefined);
});

test('explicitly expired water tariffs are withheld from benchmark estimates', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:one', kind:'property', label:'1 Main St, Newark, NJ 07102', geography:'NJ' });
  upsertEntity(graph, { id:'utility:one', kind:'utility', label:'Example Water', geography:'NJ' });
  addEvidence(graph, { id:'ev', sourceId:'utility-first-party-web', url:'https://water.example/rates', observedAt:'2026-09-22T12:00:00Z', authority:'first-party', confidence:.9 });
  addClaim(graph, { id:'units', subjectId:'property:one', fact:'property.units', value:100, state:'SUPPORTED', confidence:.9, evidenceIds:['ev'], observedAt:'2026-09-22T12:00:00Z' });
  addClaim(graph, { id:'provider', subjectId:'property:one', fact:'utility.provider', objectEntityId:'utility:one', state:'SUPPORTED', confidence:.9, evidenceIds:['ev'], observedAt:'2026-09-22T12:00:00Z' });
  addClaim(graph, { id:'rate', subjectId:'utility:one', fact:'utility.rateSchedule', value:'Residential water rate $8.00 per 1,000 gallons effective January 1, 2020 through December 31, 2020', state:'SUPPORTED', confidence:.9, evidenceIds:['ev'], observedAt:'2026-09-22T12:00:00Z' });
  assert.equal(estimatePropertyWaterCost(graph, 'property:one'), undefined);
});

test('workspace projection persists tariff class, source, dates, and freshness', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:one', kind:'company', label:'Operator One', geography:'NJ' });
  upsertEntity(graph, { id:'property:one', kind:'property', label:'1 Main St, Newark, NJ 07102', geography:'NJ' });
  upsertEntity(graph, { id:'utility:one', kind:'utility', label:'Example Water', geography:'NJ' });
  addEvidence(graph, { id:'site', sourceId:'company-first-party-web', url:'https://operator.example', observedAt:'2026-09-22T12:00:00Z', authority:'first-party', confidence:.9 });
  addEvidence(graph, { id:'rate-ev', sourceId:'utility-first-party-web', url:'https://water.example/rates', observedAt:'2026-09-22T12:00:00Z', authority:'first-party', confidence:.9 });
  addClaim(graph, { id:'manager', subjectId:'property:one', fact:'property.manager', objectEntityId:'company:one', state:'SUPPORTED', confidence:.9, evidenceIds:['site'], observedAt:'2026-09-22T12:00:00Z' });
  addClaim(graph, { id:'provider', subjectId:'property:one', fact:'utility.provider', objectEntityId:'utility:one', state:'SUPPORTED', confidence:.9, evidenceIds:['rate-ev'], observedAt:'2026-09-22T12:00:00Z' });
  addClaim(graph, { id:'rate', subjectId:'utility:one', fact:'utility.rateSchedule', value:'Multifamily water service effective January 1, 2026 through December 31, 2026 — $8.20 per 1,000 gallons', state:'SUPPORTED', confidence:.9, evidenceIds:['rate-ev'], observedAt:'2026-09-22T12:00:00Z' });
  const run: ResearchRunResult = { graph, rootEntityId:'company:one', tasksExecuted:3, complete:3, blocked:0, failed:0, results:[], rootCompleteness:.4, stopReason:'source-exhausted' };
  const merged = mergeResearchRunIntoWorkspace(emptyWorkspace(), run).workspace;
  assert.equal(merged.tariffs.length, 1);
  assert.equal(merged.tariffs[0].customerClass, 'multifamily');
  assert.equal(merged.tariffs[0].effectiveFrom, '2026-01-01');
  assert.equal(merged.tariffs[0].effectiveTo, '2026-12-31');
  assert.equal(merged.tariffs[0].sourceUrl, 'https://water.example/rates');
  assert.equal(merged.tariffs[0].freshness, 'current');
});

test('full workspace backup round-trips through the guarded workspace parser', () => {
  const workspace = emptyWorkspace();
  workspace.companies.push({ id:'company:one', name:'Acme', stage:'Research', headquarters:{status:'unknown'}, portfolioBuildings:{status:'unknown'}, portfolioUnits:{status:'unknown'}, people:[], provenance:[], createdAt:'2026-09-22T00:00:00Z', updatedAt:'2026-09-22T00:00:00Z' });
  const text = serializeWorkspaceBackup(workspace, '2026-09-22T23:45:00Z');
  const restored = parseWorkspaceBackup(text);
  assert.equal(restored.companies[0].name, 'Acme');
  assert.match(text, /puma-utilities-workspace-backup/);
  assert.throws(() => parseWorkspaceBackup('{"format":"other"}'), /Puma Utilities workspace backup/);
});

test('PR18 UI exposes backup restore, continue research, tariff freshness, and prefilled engine params', () => {
  const intelligence = readFileSync('app/components/puma-intelligence-page.tsx', 'utf8');
  const panel = readFileSync('app/components/puma-research-panel.tsx', 'utf8');
  assert.match(intelligence, /Download workspace backup/);
  assert.match(intelligence, /Restore backup/);
  assert.match(intelligence, /Continue research/);
  assert.match(intelligence, /Tariff freshness/);
  assert.match(panel, /window\.location\.search/);
  assert.match(panel, /searchParams\.get\('company'\)/);
  assert.match(panel, /searchParams\.get\('state'\)/);
});

test('PA county task planning routes all four supported southeastern counties and withholds unsupported PA', () => {
  const planner = readFileSync('lib/research/task-planner.ts', 'utf8');
  const adapter = readFileSync('lib/research/sources/pa-county-parcels.ts', 'utf8');
  assert.match(planner, /isLikelySupportedPaCountyAddress/);
  for (const county of ['Bucks','Montgomery','Chester','Delaware']) assert.match(adapter, new RegExp(county));
  assert.match(adapter, /rows\.length === 1/);
});
