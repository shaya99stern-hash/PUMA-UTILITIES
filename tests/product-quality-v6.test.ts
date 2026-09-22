import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createResearchGraph, upsertEntity } from '../lib/research/graph';
import { canonicalNycBbl, ingestNycPluto, type NycPlutoRecord } from '../lib/research/sources/nyc-pluto';

const layout = readFileSync('app/layout.tsx', 'utf8');
const shell = readFileSync('app/components/puma-workspace-app-v4.tsx', 'utf8');
const research = readFileSync('app/components/puma-research-panel.tsx', 'utf8');

test('responsive V6 stylesheet loads after iOS overrides', () => {
  assert.match(layout, /ios-native\.css['"];[\s\S]*puma-responsive-v6\.css['"];/);
  assert.equal(existsSync('app/puma-responsive-v6.css'), true);
});

test('desktop has persistent navigation while mobile exposes four primary tabs', () => {
  assert.match(shell, /pm-desktop-sidebar/);
  assert.match(shell, /pm-main/);
  assert.match(shell, /aria-label="Desktop navigation"/);
  assert.match(shell, /aria-label="Primary navigation"/);
  for (const label of ['Home', 'Companies', 'Find Leads', 'Monitor']) {
    assert.match(shell, new RegExp(`<span>${label}<\\/span>`));
  }
});

test('responsive CSS turns desktop into a wide workspace and keeps compact mobile navigation', () => {
  const css = readFileSync('app/puma-responsive-v6.css', 'utf8');
  assert.match(css, /@media\s*\(min-width:\s*900px\)/);
  assert.match(css, /\.pm-desktop-sidebar[\s\S]*display:\s*flex/);
  assert.match(css, /\.pm-bottom-nav[\s\S]*display:\s*none/);
  assert.match(css, /\.pm-content[\s\S]*max-width:\s*none/);
  assert.match(css, /\.pm-page[\s\S]*max-width:\s*1400px/);
  assert.match(css, /\.pm-check[\s\S]*(?:width|min-width):\s*44px/);
  assert.match(css, /\.pm-check[\s\S]*(?:height|min-height):\s*44px/);
});

test('Companies has a canonical alias and the 404 page lets users recover', () => {
  assert.equal(existsSync('app/companies/page.tsx'), true);
  assert.equal(existsSync('app/not-found.tsx'), true);
  const companies = readFileSync('app/companies/page.tsx', 'utf8');
  const notFound = readFileSync('app/not-found.tsx', 'utf8');
  assert.match(companies, /redirect\(['"]\/clients['"]\)/);
  assert.match(notFound, /href=["']\/["']/);
  assert.match(notFound, /href=["']\/clients["']/);
});

test('bulk selection exposes select-all and clear-all behavior', () => {
  assert.match(shell, /Select all/);
  assert.match(shell, /Clear all/);
});

test('benchmark currency labels include literal dollar signs everywhere', () => {
  assert.match(shell, /~\$\{Math\.round\(utility\.benchmarkCost\.annualEstimatedWaterCost\)/);
  assert.match(research, /~\$\{Math\.round\(estimate\.annualEstimatedWaterCost\)/);
  assert.match(research, /\$\{Math\.round\(estimate\.monthlyEstimatedWaterCost\)/);
});

test('NYC BBL formatter produces the 10-digit PLUTO key', () => {
  assert.equal(canonicalNycBbl('3', '123', '45'), '3001230045');
  assert.equal(canonicalNycBbl('1', '1', '1'), '1000010001');
  assert.equal(canonicalNycBbl('6', '1', '1'), undefined);
});

test('PLUTO physical facts enrich the existing property without creating a duplicate', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:nyc', kind:'property', label:'10 Example Ave, Brooklyn, NY', geography:'NY', aliases:['BBL 3-123-45'] });
  const record: NycPlutoRecord = {
    bbl:'3001230045',
    address:'10 EXAMPLE AVENUE',
    unitsres:'84',
    bldgarea:'125000',
    borough:'BK',
  };
  ingestNycPluto(graph, 'property:nyc', record, 'https://data.cityofnewyork.us/resource/64uk-42ks.json', '2026-09-22T20:00:00Z');
  assert.equal(graph.entities.filter((entity) => entity.kind === 'property').length, 1);
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:nyc' && claim.fact === 'property.units' && claim.value === 84 && claim.state === 'VERIFIED'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:nyc' && claim.fact === 'property.grossSquareFeet' && claim.value === 125000 && claim.state === 'VERIFIED'));
});

test('PLUTO with zero or invalid physical values does not invent property facts', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:nyc', kind:'property', label:'10 Example Ave', geography:'NY' });
  ingestNycPluto(graph, 'property:nyc', { bbl:'3001230045', unitsres:'0', bldgarea:'not-a-number' }, undefined, '2026-09-22T20:00:00Z');
  assert.equal(graph.claims.some((claim) => claim.subjectId === 'property:nyc' && claim.fact === 'property.units'), false);
  assert.equal(graph.claims.some((claim) => claim.subjectId === 'property:nyc' && claim.fact === 'property.grossSquareFeet'), false);
});

test('source registry advertises PLUTO only for official property physical facts', () => {
  const registry = readFileSync('lib/research/source-registry.ts', 'utf8');
  assert.match(registry, /id:\s*['"]nyc-pluto['"][\s\S]*capabilities:\s*\[['"]property\.units['"],['"]property\.grossSquareFeet['"]\]/);
});


test('PLUTO condominium records do not mislabel net area as gross square footage', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:condo', kind:'property', label:'1 Condo Ave, New York, NY', geography:'NY' });
  ingestNycPluto(graph, 'property:condo', {
    bbl:'1000010001',
    unitsres:'120',
    bldgarea:'210000',
    condono:'44',
  }, undefined, '2026-09-22T20:00:00Z');
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:condo' && claim.fact === 'property.units' && claim.value === 120));
  assert.equal(graph.claims.some((claim) => claim.subjectId === 'property:condo' && claim.fact === 'property.grossSquareFeet'), false);
});

test('property planning explicitly asks for units and physical area', () => {
  const graphSource = readFileSync('lib/research/graph.ts', 'utf8');
  assert.match(graphSource, /PROPERTY_REQUIRED_FACTS[\s\S]*'property\.units'/);
  assert.match(graphSource, /PROPERTY_REQUIRED_FACTS[\s\S]*'property\.grossSquareFeet'/);
});
