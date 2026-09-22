import assert from 'node:assert/strict';
import test from 'node:test';
import { createResearchGraph, addClaim, upsertEntity } from '../lib/research/graph';
import { ingestCompanyWebsite } from '../lib/research/ingest';
import { mergeResearchRunIntoWorkspace } from '../lib/research/workspace-projection';
import { extractContacts } from '../lib/research/sources/company-website';
import { extractAmiSignals, extractRateSignals, ingestUtilityWebsite } from '../lib/research/sources/utility-website';
import { parseDuckDuckGoHtml } from '../lib/research/web-search';
import type { ResearchRunResult } from '../lib/research/runner';
import type { Workspace } from '../lib/types';

test('built-in search parser unwraps public DuckDuckGo results', () => {
  const html = `
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdenholtz.com%2F">Denholtz Properties</a>
      <a class="result__snippet">Owner and operator of commercial real estate.</a>
    </div>`;
  const results = parseDuckDuckGoHtml(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'https://denholtz.com/');
  assert.match(results[0].snippet ?? '', /Owner and operator/);
});

test('first-party contact context can attach a published email and phone to a named decision-maker', () => {
  const html = '<section><h2>Jane Smith — Managing Principal</h2><p>Jane Smith · jane@samplepm.com · (212) 555-0100</p></section>';
  const contacts = extractContacts(html, 'https://samplepm.com/team');
  assert.ok(contacts.some((contact) => contact.value === 'jane@samplepm.com' && /Jane Smith/i.test(contact.context ?? '')));

  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:sample', kind: 'company', label: 'Sample Property Management', geography: 'NY' });
  ingestCompanyWebsite(graph, 'company:sample', {
    seedUrl: 'https://samplepm.com/',
    visitedUrls: ['https://samplepm.com/team'],
    contacts,
    leadershipSignals: [{ text: 'Jane Smith — Managing Principal', sourceUrl: 'https://samplepm.com/team' }],
    propertySignals: [],
    socialUrls: [],
    warnings: [],
  }, '2026-09-22T12:00:00.000Z');

  const person = graph.entities.find((entity) => entity.kind === 'person' && entity.label === 'Jane Smith');
  assert.ok(person);
  assert.ok(graph.claims.some((claim) => claim.subjectId === person?.id && claim.fact === 'person.email' && claim.value === 'jane@samplepm.com'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === person?.id && claim.fact === 'person.phone'));
});

test('utility first-party text extracts AMI program and rate evidence independently', () => {
  const url = 'https://water.example.gov/rates';
  const ami = extractAmiSignals('Our Advanced Metering Infrastructure (AMI) program is replacing water meters across the service area.', url);
  const rates = extractRateSignals('Residential water rate $8.42 per 1,000 gallons plus a monthly service charge.', url);
  assert.equal(ami.length, 1);
  assert.equal(rates.length, 1);

  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'utility:one', kind: 'utility', label: 'Example Water Department', geography: 'NJ' });
  ingestUtilityWebsite(graph, 'utility:one', {
    seedUrl: 'https://water.example.gov',
    visitedUrls: [url],
    amiSignals: ami,
    rateSignals: rates,
    warnings: [],
  }, '2026-09-22T12:00:00.000Z');

  assert.ok(graph.claims.some((claim) => claim.subjectId === 'utility:one' && claim.fact === 'utility.amiCapability' && claim.state === 'SUPPORTED'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'utility:one' && claim.fact === 'utility.rateSchedule' && claim.state === 'SUPPORTED'));
});

test('saving utility AMI evidence never claims the building itself has a smart meter', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:one', kind: 'company', label: 'Owner Operator One', geography: 'NJ' });
  upsertEntity(graph, { id: 'property:one', kind: 'property', label: '123 Main St, Newark, NJ 07102', geography: 'NJ' });
  upsertEntity(graph, { id: 'utility:one', kind: 'utility', label: 'Example Water Department', geography: 'NJ' });

  addClaim(graph, {
    id: 'claim:property:manager',
    subjectId: 'property:one',
    fact: 'property.manager',
    objectEntityId: 'company:one',
    state: 'SUPPORTED',
    confidence: 0.9,
    evidenceIds: [],
    observedAt: '2026-09-22T12:00:00.000Z',
  });
  addClaim(graph, {
    id: 'claim:property:utility',
    subjectId: 'property:one',
    fact: 'utility.provider',
    objectEntityId: 'utility:one',
    state: 'SUPPORTED',
    confidence: 0.9,
    evidenceIds: [],
    observedAt: '2026-09-22T12:00:00.000Z',
  });
  addClaim(graph, {
    id: 'claim:utility:provider',
    subjectId: 'utility:one',
    fact: 'utility.provider',
    value: 'Example Water Department',
    state: 'VERIFIED',
    confidence: 0.95,
    evidenceIds: [],
    observedAt: '2026-09-22T12:00:00.000Z',
  });
  addClaim(graph, {
    id: 'claim:utility:ami',
    subjectId: 'utility:one',
    fact: 'utility.amiCapability',
    value: 'Utility operates an AMI smart-meter program.',
    state: 'SUPPORTED',
    confidence: 0.86,
    evidenceIds: [],
    observedAt: '2026-09-22T12:00:00.000Z',
  });
  addClaim(graph, {
    id: 'claim:utility:rate',
    subjectId: 'utility:one',
    fact: 'utility.rateSchedule',
    value: '$8.42 per 1,000 gallons',
    state: 'SUPPORTED',
    confidence: 0.84,
    evidenceIds: [],
    observedAt: '2026-09-22T12:00:00.000Z',
  });

  const result: ResearchRunResult = {
    graph,
    rootEntityId: 'company:one',
    tasksExecuted: 4,
    complete: 4,
    blocked: 0,
    failed: 0,
    results: [],
    rootCompleteness: 0.4,
    stopReason: 'source-exhausted',
  };
  const workspace: Workspace = {
    version: 1,
    companies: [],
    properties: [],
    parcels: [],
    utilities: [],
    meters: [],
    tariffs: [],
    monitorSettings: {},
    updatedAt: '2026-09-22T12:00:00.000Z',
  };

  const merged = mergeResearchRunIntoWorkspace(workspace, result).workspace;
  assert.equal(merged.utilities.length, 1);
  assert.equal(merged.utilities[0].capability, 'unknown');
  assert.equal(merged.utilities[0].amiProgram?.value, 'Utility operates an AMI smart-meter program.');
  assert.equal(merged.utilities[0].rateSummary?.value, '$8.42 per 1,000 gallons');
});
