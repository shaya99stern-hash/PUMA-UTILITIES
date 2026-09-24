import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { discoverCompanies } from '../lib/research/discovery-service';
import { addClaim, addEvidence, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { emptyWorkspace } from '../lib/workspace';
import { mergeResearchRunIntoWorkspace } from '../lib/research/workspace-projection';
import type { ResearchRunResult } from '../lib/research/runner';

const hit = {
  title: 'Reliable Property Group | Portfolio',
  url: 'https://reliable.example/portfolio',
  snippet: 'Owner-operator multifamily portfolio. Owns and manages communities.',
};

test('discovery keeps successful candidates when one query fails', async () => {
  let calls = 0;
  const outcome = await discoverCompanies(
    { geography: 'NJ, NY', minBuildings: 20, maxBuildings: 100, count: 10 },
    {
      search: async (query) => {
        calls += 1;
        if (calls === 1) throw new Error('temporary upstream failure');
        return { query, results: [hit], backend: 'duckduckgo-html' as const };
      },
    },
  );

  assert.equal(outcome.diagnostics.attempted, 4);
  assert.equal(outcome.diagnostics.succeeded, 3);
  assert.equal(outcome.diagnostics.failed, 1);
  assert.equal(outcome.warnings.length, 1);
  assert.equal(outcome.allFailed, false);
  assert.ok(outcome.candidates.some((candidate) => candidate.website === 'https://reliable.example'));
});

test('discovery reports all searches failed instead of pretending no candidates exist', async () => {
  const outcome = await discoverCompanies(
    { geography: 'NJ', minBuildings: 20, maxBuildings: 100, count: 10 },
    { search: async () => { throw new Error('upstream unavailable'); } },
  );

  assert.equal(outcome.diagnostics.attempted, 2);
  assert.equal(outcome.diagnostics.succeeded, 0);
  assert.equal(outcome.diagnostics.failed, 2);
  assert.equal(outcome.candidates.length, 0);
  assert.equal(outcome.allFailed, true);
});

test('discovery route maps all-failed outcome to a 502 response', () => {
  const source = readFileSync(new URL('../app/api/research/discover/route.ts', import.meta.url), 'utf8');
  assert.match(source, /outcome\.allFailed/);
  assert.match(source, /status:\s*502/);
  assert.match(source, /Lead discovery sources are temporarily unavailable/);
});

function projectionResult(): ResearchRunResult {
  const graph = createResearchGraph();
  upsertEntity(graph, {
    id: 'company:stable',
    kind: 'company',
    label: 'Stable Property Group',
    geography: 'NJ',
  });
  upsertEntity(graph, {
    id: 'person:stable',
    kind: 'person',
    label: 'Jane Owner',
    geography: 'NJ',
  });
  upsertEntity(graph, {
    id: 'property:stable',
    kind: 'property',
    label: '10 Main St, Newark, NJ 07102',
    geography: 'NJ',
    aliases: ['NJ PAMS 07102-0001'],
  });
  upsertEntity(graph, {
    id: 'utility:stable',
    kind: 'utility',
    label: 'Newark Water',
    geography: 'NJ',
  });

  const evidence = addEvidence(graph, {
    id: 'evidence:stable',
    sourceId: 'company-first-party-web',
    url: 'https://stable.example/portfolio',
    observedAt: '2026-09-24T10:00:00.000Z',
    authority: 'first-party',
    confidence: 0.92,
    excerpt: 'Jane Owner; 10 Main St; Newark Water.',
  });

  const trusted = {
    state: 'SUPPORTED' as const,
    confidence: 0.9,
    evidenceIds: [evidence.id],
    observedAt: '2026-09-24T10:00:00.000Z',
  };

  addClaim(graph, { id:'website', subjectId:'company:stable', fact:'company.website', value:'https://stable.example', ...trusted });
  addClaim(graph, { id:'dm', subjectId:'company:stable', fact:'person.decisionMaker', objectEntityId:'person:stable', ...trusted });
  addClaim(graph, { id:'role', subjectId:'person:stable', fact:'person.title', value:'Owner', ...trusted });
  addClaim(graph, { id:'manager', subjectId:'property:stable', fact:'property.manager', objectEntityId:'company:stable', ...trusted });
  addClaim(graph, { id:'units', subjectId:'property:stable', fact:'property.units', value:88, ...trusted });
  addClaim(graph, { id:'provider', subjectId:'property:stable', fact:'utility.provider', objectEntityId:'utility:stable', ...trusted });
  addClaim(graph, { id:'rate', subjectId:'utility:stable', fact:'utility.rateSchedule', value:'Residential water rate effective 2026: $8.00 per 1,000 gallons', ...trusted });

  return {
    graph,
    rootEntityId: 'company:stable',
    tasksExecuted: 7,
    complete: 7,
    blocked: 0,
    failed: 0,
    results: [],
    rootCompleteness: 0.8,
    budgetUnitsSpent: 12,
    maxBudgetUnits: 82,
    stopReason: 'source-exhausted',
  };
}

test('saving equivalent research twice preserves identities and creates no duplicate records', () => {
  const first = mergeResearchRunIntoWorkspace(emptyWorkspace(), projectionResult());
  const second = mergeResearchRunIntoWorkspace(first.workspace, projectionResult());

  assert.equal(first.workspace.companies.length, 1);
  assert.equal(first.workspace.companies[0].people.length, 1);
  assert.equal(first.workspace.properties.length, 1);
  assert.equal(first.workspace.utilities.length, 1);
  assert.equal(first.workspace.parcels.length, 1);
  assert.equal(first.workspace.tariffs.length, 1);

  assert.equal(second.summary.companyId, first.summary.companyId);
  assert.equal(second.workspace.companies.length, 1);
  assert.equal(second.workspace.companies[0].people.length, 1);
  assert.equal(second.workspace.properties.length, 1);
  assert.equal(second.workspace.utilities.length, 1);
  assert.equal(second.workspace.parcels.length, 1);
  assert.equal(second.workspace.tariffs.length, 1);
  assert.equal(second.summary.createdCompany, false);
  assert.equal(second.summary.peopleAdded, 0);
  assert.equal(second.summary.propertiesAdded, 0);
  assert.equal(second.summary.utilitiesAdded, 0);
  assert.equal(second.summary.parcelsAdded, 0);
  assert.equal(second.summary.tariffsAdded, 0);
});

test('verified research does not silently relabel matching user-entered CRM values', () => {
  const first = mergeResearchRunIntoWorkspace(emptyWorkspace(), projectionResult());
  const company = first.workspace.companies[0];
  const property = first.workspace.properties[0];

  company.people = [{
    id: 'manual-person',
    name: 'Jane Owner',
    role: 'Manually entered role',
    email: 'manual@example.com',
    status: 'user-entered',
  }];
  property.address = {
    value: 'Manual address text',
    status: 'user-entered',
    updatedAt: '2026-09-24T10:30:00.000Z',
  };
  property.units = {
    value: 77,
    status: 'user-entered',
    updatedAt: '2026-09-24T10:30:00.000Z',
  };

  const merged = mergeResearchRunIntoWorkspace(first.workspace, projectionResult());
  const savedCompany = merged.workspace.companies.find((item) => item.id === company.id)!;
  const savedProperty = merged.workspace.properties.find((item) => item.id === property.id)!;

  assert.deepEqual(savedCompany.people, company.people);
  assert.equal(savedProperty.address.value, 'Manual address text');
  assert.equal(savedProperty.address.status, 'user-entered');
  assert.equal(savedProperty.units?.value, 77);
  assert.equal(savedProperty.units?.status, 'user-entered');
});
