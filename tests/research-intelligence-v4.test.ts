import assert from 'node:assert/strict';
import test from 'node:test';
import { addClaim, addEvidence, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { assessResearchRun } from '../lib/research/qualification';
import { planResearch } from '../lib/research/planner';
import { runResearch } from '../lib/research/runner';
import { SOURCE_REGISTRY } from '../lib/research/source-registry';
import { emptyWorkspace } from '../lib/workspace';
import { mergeResearchRunIntoWorkspace } from '../lib/research/workspace-projection';
import { estimatePropertyWaterCost } from '../lib/research/water-cost';

function runResult(graph: ReturnType<typeof createResearchGraph>, rootEntityId: string) {
  return {
    graph,
    rootEntityId,
    tasksExecuted: 0,
    complete: 0,
    blocked: 0,
    failed: 0,
    results: [],
    rootCompleteness: 0,
    stopReason: 'source-exhausted' as const,
  };
}

test('lower-bound portfolio evidence improves fit without masquerading as an exact portfolio count', () => {
  const lowerGraph = createResearchGraph();
  upsertEntity(lowerGraph, { id:'company:lower', kind:'company', label:'Lower Bound Properties', geography:'NJ' });
  addClaim(lowerGraph, { id:'lower', subjectId:'company:lower', fact:'company.portfolioLowerBound', value:60, state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(lowerGraph, { id:'owner', subjectId:'company:lower', fact:'company.ownerOperator', value:'Owner operator; owns and manages its portfolio', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });

  const exactGraph = createResearchGraph();
  upsertEntity(exactGraph, { id:'company:exact', kind:'company', label:'Exact Properties', geography:'NJ' });
  addClaim(exactGraph, { id:'exact', subjectId:'company:exact', fact:'company.portfolio', value:60, state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(exactGraph, { id:'owner2', subjectId:'company:exact', fact:'company.ownerOperator', value:'Owner operator; owns and manages its portfolio', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });

  const lower = assessResearchRun(runResult(lowerGraph, 'company:lower'));
  const exact = assessResearchRun(runResult(exactGraph, 'company:exact'));
  assert.ok(lower.fit >= 70);
  assert.ok(lower.fit < exact.fit);
  assert.ok(lower.reasons.some((reason) => /at least 60/i.test(reason)));
});

test('planner does not spend browser budget on ContactOut when its worker is not configured', () => {
  const previousUrl = process.env.PUMA_BROWSER_RESEARCH_URL;
  const previousToken = process.env.PUMA_BROWSER_RESEARCH_TOKEN;
  delete process.env.PUMA_BROWSER_RESEARCH_URL;
  delete process.env.PUMA_BROWSER_RESEARCH_TOKEN;
  try {
    const planned = planResearch([{ fact:'person.decisionMaker', geography:'NJ', importance:100, subjectId:'company:test' }], 10);
    assert.equal(planned.some((item) => item.source.id === 'contactout-public-directory'), false);
  } finally {
    if (previousUrl === undefined) delete process.env.PUMA_BROWSER_RESEARCH_URL; else process.env.PUMA_BROWSER_RESEARCH_URL = previousUrl;
    if (previousToken === undefined) delete process.env.PUMA_BROWSER_RESEARCH_TOKEN; else process.env.PUMA_BROWSER_RESEARCH_TOKEN = previousToken;
  }
});

test('source registry does not advertise person-level direct facts through company-only adapters', () => {
  const companySite = SOURCE_REGISTRY.find((source) => source.id === 'company-first-party-web');
  const contactOut = SOURCE_REGISTRY.find((source) => source.id === 'contactout-public-directory');
  const njBusiness = SOURCE_REGISTRY.find((source) => source.id === 'nj-dores-business');
  assert.ok(companySite);
  assert.ok(contactOut);
  assert.ok(njBusiness);
  assert.equal(companySite?.capabilities.includes('person.title'), false);
  assert.equal(companySite?.capabilities.includes('person.email'), false);
  assert.equal(companySite?.capabilities.includes('person.phone'), false);
  assert.equal(contactOut?.capabilities.includes('person.title'), false);
  assert.equal(njBusiness?.capabilities.includes('person.decisionMaker'), false);
});

test('research runner does not execute the same subject/source adapter concurrently for different needs', async () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:budget', kind:'company', label:'Budget Properties', geography:'NJ' });
  const active = new Set<string>();
  let duplicateConcurrentExecutions = 0;

  await runResearch(graph, 'company:budget', {
    maxTasks: 20,
    maxBudgetUnits: 20,
    concurrency: 8,
    perNeed: 6,
    targetCompleteness: 1,
    executor: async (_graph, task) => {
      const key = task.subjectId + ':' + task.sourceId;
      if (active.has(key)) duplicateConcurrentExecutions += 1;
      active.add(key);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active.delete(key);
      return {
        taskId: task.id,
        status: 'complete' as const,
        sourceId: task.sourceId,
        discoveredEntityIds: [],
        evidenceAdded: 0,
        claimsAdded: 0,
        message: 'synthetic',
      };
    },
  });

  assert.equal(duplicateConcurrentExecutions, 0);
});

test('saved research preserves property physical evidence and an evidence-gated residential water benchmark', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:one', kind:'company', label:'Example Properties', geography:'NJ' });
  upsertEntity(graph, { id:'property:one', kind:'property', label:'123 Main St, Newark, NJ 07102', geography:'NJ' });
  upsertEntity(graph, { id:'utility:one', kind:'utility', label:'Example Water', geography:'NJ' });

  addEvidence(graph, { id:'portfolio:evidence', sourceId:'company-first-party-web', url:'https://example.com/portfolio', observedAt:'2026-09-22T18:00:00Z', authority:'first-party', confidence:.9 });
  addEvidence(graph, { id:'rate:evidence', sourceId:'utility-first-party-web', url:'https://water.example/rates', observedAt:'2026-09-22T18:00:00Z', authority:'first-party', confidence:.9 });
  addClaim(graph, { id:'lower', subjectId:'company:one', fact:'company.portfolioLowerBound', value:40, state:'SUPPORTED', confidence:.9, evidenceIds:['portfolio:evidence'], observedAt:'2026-09-22T18:00:00Z', qualifier:'at-least', statement:'more than 40 properties', metricLabel:'properties' });
  addClaim(graph, { id:'manager', subjectId:'property:one', fact:'property.manager', objectEntityId:'company:one', state:'SUPPORTED', confidence:.9, evidenceIds:['portfolio:evidence'], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(graph, { id:'units', subjectId:'property:one', fact:'property.units', value:100, state:'SUPPORTED', confidence:.9, evidenceIds:['portfolio:evidence'], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(graph, { id:'sf', subjectId:'property:one', fact:'property.grossSquareFeet', value:120000, state:'SUPPORTED', confidence:.9, evidenceIds:['portfolio:evidence'], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(graph, { id:'provider', subjectId:'property:one', fact:'utility.provider', objectEntityId:'utility:one', state:'SUPPORTED', confidence:.9, evidenceIds:['rate:evidence'], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(graph, { id:'rate', subjectId:'utility:one', fact:'utility.rateSchedule', value:'Water usage charge: $8.42 per 1,000 gallons', state:'SUPPORTED', confidence:.9, evidenceIds:['rate:evidence'], observedAt:'2026-09-22T18:00:00Z' });

  const merged = mergeResearchRunIntoWorkspace(emptyWorkspace(), runResult(graph, 'company:one')).workspace;
  assert.equal(merged.properties[0].units?.value, 100);
  assert.equal(merged.properties[0].grossSquareFeet?.value, 120000);
  assert.equal(merged.companies[0].portfolio?.[0]?.qualifier, 'at-least');
  assert.equal(merged.companies[0].portfolio?.[0]?.label, 'properties');
  assert.ok((merged.utilities[0].benchmarkCost?.annualVariableCost ?? 0) > 0);
});

test('multifamily WUI estimate is withheld when square footage lacks sourced residential-unit evidence', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:commercial', kind:'property', label:'10 Office Plaza, Newark, NJ 07102', geography:'NJ' });
  upsertEntity(graph, { id:'utility:commercial', kind:'utility', label:'Example Water', geography:'NJ' });
  addClaim(graph, { id:'sf', subjectId:'property:commercial', fact:'property.grossSquareFeet', value:200000, state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(graph, { id:'provider2', subjectId:'property:commercial', fact:'utility.provider', objectEntityId:'utility:commercial', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(graph, { id:'rate2', subjectId:'utility:commercial', fact:'utility.rateSchedule', value:'$8.42 per 1,000 gallons', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });
  assert.equal(estimatePropertyWaterCost(graph, 'property:commercial'), undefined);
});


test('water-cost estimate is withheld when separate trusted rate lines imply multiple tiers', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:tiered', kind:'property', label:'20 Main St, Newark, NJ 07102', geography:'NJ' });
  upsertEntity(graph, { id:'utility:tiered', kind:'utility', label:'Tiered Water', geography:'NJ' });
  addClaim(graph, { id:'units-tier', subjectId:'property:tiered', fact:'property.units', value:80, state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(graph, { id:'provider-tier', subjectId:'property:tiered', fact:'utility.provider', objectEntityId:'utility:tiered', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(graph, { id:'rate-tier-1', subjectId:'utility:tiered', fact:'utility.rateSchedule', value:'First block $5.00 per CCF', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });
  addClaim(graph, { id:'rate-tier-2', subjectId:'utility:tiered', fact:'utility.rateSchedule', value:'Second block $8.00 per CCF', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:01:00Z' });
  assert.equal(estimatePropertyWaterCost(graph, 'property:tiered'), undefined);
});


test('company identity claims that differ only by legal suffix do not create a false conflict', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:identity', kind:'company', label:'Acme Properties', geography:'NJ' });
  const first = addClaim(graph, { id:'identity-1', subjectId:'company:identity', fact:'company.identity', value:'Acme Properties LLC', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:00:00Z' });
  const second = addClaim(graph, { id:'identity-2', subjectId:'company:identity', fact:'company.identity', value:'Acme Properties', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T18:01:00Z' });
  assert.equal(first.state, 'SUPPORTED');
  assert.equal(second.state, 'SUPPORTED');
});
