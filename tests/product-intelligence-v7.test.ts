import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { addClaim, addEvidence, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { rankDecisionMakers } from '../lib/research/decision-maker';
import { ingestCompanyWebsite } from '../lib/research/ingest';
import { parseFixedWaterCharge, parseVariableWaterRate } from '../lib/research/water-cost';
import { ingestPhiladelphiaOpa, normalizePhiladelphiaStreetAddress, type PhiladelphiaOpaRecord } from '../lib/research/sources/philadelphia-opa';

const shell = readFileSync('app/components/puma-workspace-app-v4.tsx', 'utf8');
const research = readFileSync('app/components/puma-research-panel.tsx', 'utf8');
const ios = readFileSync('app/ios-native.css', 'utf8');
const responsive = readFileSync('app/puma-responsive-v6.css', 'utf8');

test('in-app Puma mark uses the transparent uploaded artwork without a square app-icon tile', () => {
  const brand = readFileSync('app/puma-brand.css', 'utf8');
  assert.match(brand, /--puma-brand-logo:\s*url\("data:image\/png;base64,/);
  assert.match(ios, /\.pm-brand-mark\s*\{[\s\S]*background-image:\s*var\(--puma-brand-logo\)\s*!important/);
  assert.match(ios, /\.pm-brand-mark svg\s*\{[\s\S]*display:\s*none\s*!important/);
  assert.doesNotMatch(ios, /apple-touch-icon/);
});

test('desktop sidebar and mobile active navigation use the same black surface without boxed icon tiles', () => {
  const sidebarBlock = responsive.match(/\.pm-desktop-sidebar\s*\{[^}]*\}/g)?.join('\n') ?? '';
  const activeNavBlock = responsive.match(/\.pm-bottom-nav a\.active\s*\{[^}]*\}/g)?.join('\n') ?? '';
  const brandBlock = responsive.match(/\.pm-brand-mark\s*\{[^}]*\}/g)?.join('\n') ?? '';
  assert.match(sidebarBlock, /background:\s*var\(--pm-bg\)/);
  assert.match(activeNavBlock, /background:\s*transparent/);
  assert.doesNotMatch(brandBlock, /background:\s*#(?:fff|ffffff|101214)/i);
});

test('water benchmark labels always include literal currency symbols', () => {
  assert.match(shell, /~\$\$\{Math\.round\(utility\.benchmarkCost\.annualEstimatedWaterCost\)/);
  assert.match(research, /~\$\$\{Math\.round\(estimate\.annualEstimatedWaterCost\)/);
  assert.match(research, /\$\$\{Math\.round\(estimate\.monthlyEstimatedWaterCost\)/);
});

test('raw research evidence is progressively disclosed', () => {
  assert.match(research, /<details className="pm-research-evidence"/);
  assert.match(research, /<summary>Evidence/);
});

test('mobile primary navigation labels remain legible', () => {
  const match = responsive.match(/\.pm-bottom-nav a span\s*\{[^}]*font-size:\s*([\d.]+)px/);
  assert.ok(match);
  assert.ok(Number(match?.[1]) >= 10);
});

test('variable water rate parser handles 1,000 cubic feet and rejects non-water-only charges', () => {
  const parsed = parseVariableWaterRate('General water usage charge $52.36 per 1,000 cubic feet');
  assert.ok(parsed);
  assert.ok(Math.abs((parsed?.dollarsPer1000Gallons ?? 0) - 7) < 0.05);
  assert.equal(parseVariableWaterRate('Wastewater charge $8.20 per CCF'), undefined);
  assert.equal(parseVariableWaterRate('Irrigation-only service $7.10 per 1,000 gallons'), undefined);
});

test('fixed water charge parser normalizes quarterly and annual charges', () => {
  assert.equal(parseFixedWaterCharge('Water service charge $60.00 per quarter')?.monthlyDollars, 20);
  assert.equal(parseFixedWaterCharge('Annual water customer charge $120 per year')?.monthlyDollars, 10);
  assert.equal(parseFixedWaterCharge('5/8 inch meter $18 per month; 1 inch meter $42 per month'), undefined);
});

test('newer operating real-estate leadership titles survive ingestion', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:roles', kind:'company', label:'Operator Group', geography:'NJ' });
  ingestCompanyWebsite(graph, 'company:roles', {
    seedUrl:'https://operator.example/',
    visitedUrls:['https://operator.example/team'],
    contacts:[],
    leadershipSignals:[
      { text:'Alex Morgan — Chief Property Officer', sourceUrl:'https://operator.example/team' },
      { text:'Taylor Reed — Director of Asset Management', sourceUrl:'https://operator.example/team' }
    ],
    propertySignals:[],
    portfolioSignals:[],
    ownerOperatorSignals:[],
    socialUrls:[],
    warnings:[],
  }, '2026-09-22T22:00:00Z');
  const titles = graph.claims.filter((claim) => claim.fact === 'person.title').map((claim) => claim.value);
  assert.ok(titles.includes('Chief Property Officer'));
  assert.ok(titles.includes('Director of Asset Management'));
});

test('operating real-estate leadership ranks as an actionable contact', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:ops', kind:'company', label:'Operator Group', geography:'PA' });
  upsertEntity(graph, { id:'person:cpo', kind:'person', label:'Alex Morgan', geography:'PA' });
  addEvidence(graph, { id:'ev:ops', sourceId:'company-first-party-web', url:'https://operator.example/team', observedAt:'2026-09-22T22:00:00Z', authority:'first-party', confidence:.9 });
  addClaim(graph, { id:'dm:cpo', subjectId:'company:ops', fact:'person.decisionMaker', objectEntityId:'person:cpo', state:'SUPPORTED', confidence:.9, evidenceIds:['ev:ops'], observedAt:'2026-09-22T22:00:00Z' });
  addClaim(graph, { id:'title:cpo', subjectId:'person:cpo', fact:'person.title', value:'Chief Property Officer', state:'SUPPORTED', confidence:.9, evidenceIds:['ev:ops'], observedAt:'2026-09-22T22:00:00Z' });
  const ranked = rankDecisionMakers(graph, 'company:ops');
  assert.equal(ranked[0]?.name, 'Alex Morgan');
  assert.ok((ranked[0]?.score ?? 0) >= 60);
});

test('Philadelphia address normalization preserves the street and drops city/state', () => {
  assert.equal(normalizePhiladelphiaStreetAddress('2041 Wharton Street, Philadelphia, PA 19146'), '2041 WHARTON ST');
  assert.equal(normalizePhiladelphiaStreetAddress('3138 N 9th St, Philadelphia, PA'), '3138 N 9TH ST');
});

test('Philadelphia OPA enriches the existing property with official owner and parcel alias only', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:phila', kind:'property', label:'2041 Wharton St, Philadelphia, PA 19146', geography:'PA' });
  const record: PhiladelphiaOpaRecord = {
    parcelNumber:'871167400',
    location:'2041 WHARTON ST',
    owner1:'PRIMESTONE INVESTMENTS LLC',
    totalLivableArea:2400,
  };
  ingestPhiladelphiaOpa(graph, 'property:phila', record, 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/OPA_PROPERTIES_PUBLIC/FeatureServer/0', '2026-09-22T22:00:00Z');
  assert.equal(graph.entities.filter((entity) => entity.kind === 'property').length, 1);
  assert.ok(graph.entities.find((entity) => entity.id === 'property:phila')?.aliases?.includes('Philadelphia OPA 871167400'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:phila' && claim.fact === 'property.owner' && claim.state === 'VERIFIED'));
  assert.equal(graph.claims.some((claim) => claim.subjectId === 'property:phila' && claim.fact === 'property.grossSquareFeet'), false);
});

test('Philadelphia OPA registry capability never promises gross-area evidence', () => {
  const registry = readFileSync('lib/research/source-registry.ts', 'utf8');
  const sourceBlock = registry.match(/id:\s*['"]phila-opa-properties['"][\s\S]*?\n\s*\},/)?.[0] ?? '';
  assert.match(sourceBlock, /property\.owner/);
  assert.doesNotMatch(sourceBlock, /property\.grossSquareFeet/);
});


test('install metadata uses PNG icon endpoints rendering the uploaded Puma artwork', () => {
  const layout = readFileSync('app/layout.tsx', 'utf8');
  const manifest = readFileSync('app/manifest.ts', 'utf8');
  const worker = readFileSync('public/sw.js', 'utf8');
  const iconResponse = readFileSync('app/components/puma-icon-response.tsx', 'utf8');
  assert.match(layout, /\/apple-touch-icon\?v=20260923-2/);
  assert.match(layout, /\/pwa-icon-192\?v=20260923-2/);
  assert.match(layout, /\/pwa-icon-512\?v=20260923-2/);
  assert.match(manifest, /pwa-icon-192\?v=20260923-2/);
  assert.match(manifest, /pwa-icon-512\?v=20260923-2/);
  assert.doesNotMatch(layout, /puma-home-icon\.jpeg/);
  assert.doesNotMatch(manifest, /puma-home-icon\.jpeg/);
  assert.match(iconResponse, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(iconResponse, /new URL\('\/puma-home-icon\.jpeg'/);
  assert.match(iconResponse, /<img/);
  assert.doesNotMatch(iconResponse, /<svg/);
  assert.match(worker, /shell-v6/);
  assert.match(worker, /apple-touch-icon/);
  assert.match(worker, /pwa-icon-192/);
  assert.match(worker, /pwa-icon-512/);
});
