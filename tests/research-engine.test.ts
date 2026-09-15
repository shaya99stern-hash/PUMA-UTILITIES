import assert from 'node:assert/strict';
import test from 'node:test';
import { addClaim, addEvidence, createResearchGraph, deriveEntityNeeds, deriveProspectNeeds, graphCompleteness, upsertEntity } from '../lib/research/graph';
import { companyMatch } from '../lib/research/entity-resolution';
import { ingestCompanyWebsite, ingestHpdOwnership, ingestNjParcel } from '../lib/research/ingest';
import { ingestWaterServiceAreas } from '../lib/research/ingest-water';
import { isPublicIp } from '../lib/research/network-safety';
import { runResearch } from '../lib/research/runner';
import { planEntityTasks, planProspectTasks, shouldContinueResearch } from '../lib/research/task-planner';
import { extractContacts, extractLeadershipSignals } from '../lib/research/sources/company-website';
import { isPublicHttpUrl, validateSearchEndpoint } from '../lib/research/web-search';

test('missing prospect fields become research needs instead of terminating the lead', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:one', kind: 'company', label: 'Example Property Group', geography: 'NJ' });

  const needs = deriveProspectNeeds(graph, 'company:one', 'NJ');
  assert.ok(needs.some((need) => need.fact === 'person.decisionMaker'));
  assert.ok(needs.some((need) => need.fact === 'company.portfolio'));
  assert.ok(needs.some((need) => need.fact === 'company.ownerOperator'));
  assert.equal(needs.some((need) => need.fact === 'utility.provider'), false);

  const tasks = planProspectTasks(graph, 'company:one', 'NJ', { maxTasks: 30 });
  assert.ok(tasks.length > 0);
  assert.ok(tasks.some((task) => task.sourceId === 'open-web-discovery'));
});

test('property entities recursively create owner manager and utility tasks', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'property:one', kind: 'property', label: '123 Main St, Newark, NJ', geography: 'NJ' });
  const needs = deriveEntityNeeds(graph, 'property:one');
  assert.ok(needs.some((need) => need.fact === 'property.owner'));
  assert.ok(needs.some((need) => need.fact === 'property.manager'));
  assert.ok(needs.some((need) => need.fact === 'utility.provider'));
  const tasks = planEntityTasks(graph, 'property:one', 'NJ');
  assert.ok(tasks.some((task) => task.sourceId === 'nj-parcel-mod4'));
  assert.ok(tasks.some((task) => task.sourceId === 'njdep-water-purveyor'));
  assert.ok(tasks.some((task) => task.sourceId === 'epa-water-service-areas'));
});

test('conflicting single-valued material claims remain explicit conflicts', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:one', kind: 'company', label: 'Example Property Group', geography: 'NY' });
  addEvidence(graph, {
    id: 'evidence:1', sourceId: 'company-first-party-web', url: 'https://example.com/about', observedAt: '2026-09-15T12:00:00.000Z', authority: 'first-party', confidence: 0.9,
  });
  addEvidence(graph, {
    id: 'evidence:2', sourceId: 'open-web-discovery', url: 'https://example.org/profile', observedAt: '2026-09-15T12:00:00.000Z', authority: 'discovery-only', confidence: 0.5,
  });
  const first = addClaim(graph, {
    id: 'claim:1', subjectId: 'company:one', fact: 'company.portfolio', value: 40, state: 'SUPPORTED', confidence: 0.85, evidenceIds: ['evidence:1'], observedAt: '2026-09-15T12:00:00.000Z',
  });
  const second = addClaim(graph, {
    id: 'claim:2', subjectId: 'company:one', fact: 'company.portfolio', value: 65, state: 'INFERRED', confidence: 0.55, evidenceIds: ['evidence:2'], observedAt: '2026-09-15T12:00:00.000Z',
  });
  assert.equal(first.state, 'CONFLICTED');
  assert.equal(second.state, 'CONFLICTED');
});

test('multi-valued emails ownership and water providers do not become false conflicts', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:one', kind: 'company', label: 'Example Property Group', geography: 'NY' });
  const emailOne = addClaim(graph, { id: 'email:1', subjectId: 'company:one', fact: 'company.email', value: 'info@example.com', state: 'SUPPORTED', confidence: 0.8, evidenceIds: [], observedAt: '2026-09-15T12:00:00.000Z' });
  const emailTwo = addClaim(graph, { id: 'email:2', subjectId: 'company:one', fact: 'company.email', value: 'leasing@example.com', state: 'SUPPORTED', confidence: 0.8, evidenceIds: [], observedAt: '2026-09-15T12:00:00.000Z' });
  assert.equal(emailOne.state, 'SUPPORTED');
  assert.equal(emailTwo.state, 'SUPPORTED');

  upsertEntity(graph, { id: 'property:one', kind: 'property', label: '123 Main St', geography: 'NY' });
  upsertEntity(graph, { id: 'company:owner-a', kind: 'company', label: 'Owner A LLC', geography: 'NY' });
  upsertEntity(graph, { id: 'company:owner-b', kind: 'company', label: 'Owner B LLC', geography: 'NY' });
  const ownerA = addClaim(graph, { id: 'owner:a', subjectId: 'property:one', fact: 'property.owner', objectEntityId: 'company:owner-a', state: 'SUPPORTED', confidence: 0.8, evidenceIds: [], observedAt: '2026-09-15T12:00:00.000Z' });
  const ownerB = addClaim(graph, { id: 'owner:b', subjectId: 'property:one', fact: 'property.owner', objectEntityId: 'company:owner-b', state: 'SUPPORTED', confidence: 0.8, evidenceIds: [], observedAt: '2026-09-15T12:00:00.000Z' });
  assert.equal(ownerA.state, 'SUPPORTED');
  assert.equal(ownerB.state, 'SUPPORTED');

  ingestWaterServiceAreas(graph, 'property:one', [
    { provider: 'Wholesale Water Authority', publicWaterSystemId: 'NY0001', boundarySource: 'epa-national', boundaryConfidence: 'authoritative' },
    { provider: 'Retail Water Department', publicWaterSystemId: 'NY0002', boundarySource: 'epa-national', boundaryConfidence: 'authoritative' },
  ], '2026-09-15T12:00:00.000Z');
  const providerClaims = graph.claims.filter((claim) => claim.subjectId === 'property:one' && claim.fact === 'utility.provider');
  assert.equal(providerClaims.length, 2);
  assert.ok(providerClaims.every((claim) => claim.state === 'SUPPORTED'));
});

test('completeness only credits supported or verified claims', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:one', kind: 'company', label: 'Example Property Group', geography: 'PA' });
  addClaim(graph, {
    id: 'claim:web', subjectId: 'company:one', fact: 'company.website', value: 'https://example.com', state: 'VERIFIED', confidence: 0.95, evidenceIds: [], observedAt: '2026-09-15T12:00:00.000Z',
  });
  addClaim(graph, {
    id: 'claim:email', subjectId: 'company:one', fact: 'company.email', value: 'info@example.com', state: 'INFERRED', confidence: 0.9, evidenceIds: [], observedAt: '2026-09-15T12:00:00.000Z',
  });
  const completeness = graphCompleteness(graph, 'company:one');
  assert.ok(completeness > 0);
  assert.ok(completeness < 0.25);
});

test('company resolver requires strong corroboration before merge', () => {
  const same = companyMatch(
    { name: 'ABC Property Management LLC', domain: 'abcpm.com', phone: '(212) 555-0100', state: 'NY' },
    { name: 'ABC Property Management', domain: 'https://www.abcpm.com', phone: '212-555-0100', state: 'NY' },
  );
  assert.equal(same.safeToMerge, true);
  assert.ok(same.score >= 0.85);

  const weak = companyMatch(
    { name: 'ABC Management', state: 'NY' },
    { name: 'ABC Property Management', state: 'NY' },
  );
  assert.equal(weak.safeToMerge, false);
});

test('NJ parcel ingestion creates property and owner entities without inventing missing owners', () => {
  const graph = createResearchGraph();
  const propertyId = ingestNjParcel(graph, { pamsPin: '0901_1_2', propertyLocation: '10 Market St', ownerName: 'Market Street Holdings LLC' }, undefined, '2026-09-15T12:00:00.000Z');
  assert.ok(graph.entities.some((entity) => entity.id === propertyId && entity.kind === 'property'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === propertyId && claim.fact === 'property.owner'));

  const second = createResearchGraph();
  const redactedId = ingestNjParcel(second, { pamsPin: '0901_1_3', propertyLocation: '12 Market St' }, undefined, '2026-09-15T12:00:00.000Z');
  assert.equal(second.claims.some((claim) => claim.subjectId === redactedId && claim.fact === 'property.owner'), false);
});

test('HPD contact ingestion preserves owner and managing-agent roles', () => {
  const graph = createResearchGraph();
  const propertyId = ingestHpdOwnership(graph, {
    registration: { registrationId: '100', boroughId: '1', block: '100', lot: '1' },
    contacts: [
      { registrationId: '100', type: 'CorporateOwner', corporationName: 'Owner LLC' },
      { registrationId: '100', type: 'Agent', corporationName: 'Manager Co' },
    ],
    sourceUrls: ['https://data.cityofnewyork.us/resource/tesw-yqqr.json', 'https://data.cityofnewyork.us/resource/feu5-w2e2.json'],
  }, '100 Broadway', '2026-09-15T12:00:00.000Z');
  assert.ok(graph.claims.some((claim) => claim.subjectId === propertyId && claim.fact === 'property.owner'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === propertyId && claim.fact === 'property.manager'));
});

test('first-party website extraction and ingestion captures public contacts and explicit leadership', () => {
  const html = '<h2>Jane Smith — Managing Principal</h2><a href="mailto:jane@samplepm.com">Email</a><p>(212) 555-0100</p>';
  assert.ok(extractContacts(html, 'https://samplepm.com/about').some((contact) => contact.value === 'jane@samplepm.com'));
  assert.ok(extractLeadershipSignals(html, 'https://samplepm.com/about').some((signal) => /Managing Principal/i.test(signal.text)));

  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:sample', kind: 'company', label: 'Sample Property Management', geography: 'NY' });
  ingestCompanyWebsite(graph, 'company:sample', {
    seedUrl: 'https://samplepm.com/',
    visitedUrls: ['https://samplepm.com/', 'https://samplepm.com/about'],
    contacts: [
      { type: 'email', value: 'jane@samplepm.com', sourceUrl: 'https://samplepm.com/about' },
      { type: 'phone', value: '+12125550100', sourceUrl: 'https://samplepm.com/about' },
    ],
    leadershipSignals: [{ text: 'Jane Smith — Managing Principal', sourceUrl: 'https://samplepm.com/about' }],
    socialUrls: [],
    warnings: [],
  }, '2026-09-15T12:00:00.000Z');
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'company:sample' && claim.fact === 'company.email'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'company:sample' && claim.fact === 'person.decisionMaker'));
});

test('research runner executes each non-retryable task once', async () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:runner', kind: 'company', label: 'Runner Property Group', geography: 'NJ' });
  const counts = new Map<string, number>();
  const result = await runResearch(graph, 'company:runner', {
    maxTasks: 80,
    concurrency: 6,
    executor: async (_graph, task) => {
      const key = `${task.subjectId}:${task.need.fact}:${task.sourceId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { taskId: task.id, status: 'complete', sourceId: task.sourceId, discoveredEntityIds: [], evidenceAdded: 0, claimsAdded: 0, message: 'synthetic complete' };
    },
  });
  assert.equal(result.stopReason, 'source-exhausted');
  assert.ok(counts.size > 0);
  assert.ok([...counts.values()].every((count) => count === 1));
});

test('recursive research stops at bounded limits', () => {
  assert.equal(shouldContinueResearch({ depth: 1, maxDepth: 4, tasksCompleted: 10, maxTasks: 100, completeness: 0.4 }), true);
  assert.equal(shouldContinueResearch({ depth: 4, maxDepth: 4, tasksCompleted: 10, maxTasks: 100, completeness: 0.4 }), false);
  assert.equal(shouldContinueResearch({ depth: 1, maxDepth: 4, tasksCompleted: 10, maxTasks: 100, completeness: 0.9 }), false);
  assert.equal(shouldContinueResearch({ depth: 1, maxDepth: 4, tasksCompleted: 10, maxTasks: 100, completeness: 0.4, marginalInformationGain: 0.005 }), false);
});

test('web and network safety reject obvious private destinations', () => {
  assert.throws(() => validateSearchEndpoint('http://127.0.0.1:8080'));
  assert.throws(() => validateSearchEndpoint('http://192.168.1.2'));
  assert.equal(isPublicHttpUrl('https://example.com/about'), true);
  assert.equal(isPublicHttpUrl('http://localhost/admin'), false);
  assert.equal(isPublicIp('127.0.0.1'), false);
  assert.equal(isPublicIp('10.1.2.3'), false);
  assert.equal(isPublicIp('192.168.0.4'), false);
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('::1'), false);
});
