import assert from 'node:assert/strict';
import test from 'node:test';
import { addClaim, addEvidence, createResearchGraph, deriveProspectNeeds, graphCompleteness, upsertEntity } from '../lib/research/graph';
import { companyMatch } from '../lib/research/entity-resolution';
import { planProspectTasks, shouldContinueResearch } from '../lib/research/task-planner';
import { isPublicHttpUrl, validateSearchEndpoint } from '../lib/research/web-search';

test('missing prospect fields become research needs instead of terminating the lead', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:one', kind: 'company', label: 'Example Property Group', geography: 'NJ' });

  const needs = deriveProspectNeeds(graph, 'company:one', 'NJ');
  assert.ok(needs.some((need) => need.fact === 'person.decisionMaker'));
  assert.ok(needs.some((need) => need.fact === 'company.portfolio'));
  assert.ok(needs.some((need) => need.fact === 'utility.provider'));

  const tasks = planProspectTasks(graph, 'company:one', 'NJ', { maxTasks: 30 });
  assert.ok(tasks.length > 0);
  assert.ok(tasks.some((task) => task.sourceId === 'open-web-discovery'));
});

test('conflicting material claims remain explicit conflicts', () => {
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
  assert.ok(completeness < 0.2);
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

test('recursive research stops at bounded limits', () => {
  assert.equal(shouldContinueResearch({ depth: 1, maxDepth: 4, tasksCompleted: 10, maxTasks: 100, completeness: 0.4 }), true);
  assert.equal(shouldContinueResearch({ depth: 4, maxDepth: 4, tasksCompleted: 10, maxTasks: 100, completeness: 0.4 }), false);
  assert.equal(shouldContinueResearch({ depth: 1, maxDepth: 4, tasksCompleted: 10, maxTasks: 100, completeness: 0.9 }), false);
  assert.equal(shouldContinueResearch({ depth: 1, maxDepth: 4, tasksCompleted: 10, maxTasks: 100, completeness: 0.4, marginalInformationGain: 0.005 }), false);
});

test('web search backend rejects obvious local/private destinations', () => {
  assert.throws(() => validateSearchEndpoint('http://127.0.0.1:8080'));
  assert.throws(() => validateSearchEndpoint('http://192.168.1.2'));
  assert.equal(isPublicHttpUrl('https://example.com/about'), true);
  assert.equal(isPublicHttpUrl('http://localhost/admin'), false);
});
