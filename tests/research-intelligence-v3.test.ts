import assert from 'node:assert/strict';
import test from 'node:test';
import { addClaim, addEvidence, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { rankDecisionMakers } from '../lib/research/decision-maker';
import { extractPortfolioSignals, extractPropertySignals } from '../lib/research/sources/company-website';
import { estimatePropertyWaterCost, parseVariableWaterRate } from '../lib/research/water-cost';
import { parseExecutiveSignals } from '../lib/research/sources/sec-edgar';
import { sourceCostUnits } from '../lib/research/planner';
import { runResearch } from '../lib/research/runner';
import type { ResearchTask } from '../lib/research/types';

test('first-party portfolio extraction preserves exact vs at-least semantics', () => {
  const exact = extractPortfolioSignals('<p>Our portfolio includes 42 properties across New Jersey.</p>', 'https://example.com/portfolio');
  assert.ok(exact.some((signal) => signal.count === 42 && signal.qualifier === 'exact'));

  const lower = extractPortfolioSignals('<p>We own and manage more than 60 buildings.</p>', 'https://example.com/about');
  assert.ok(lower.some((signal) => signal.count === 60 && signal.qualifier === 'at-least'));
});

test('property extraction captures nearby units and gross square feet', () => {
  const html = '<article><h2>Maple Court</h2><p>123 Main St, Newark, NJ 07102</p><p>124 apartments · 156,000 square feet</p></article>';
  const properties = extractPropertySignals(html, 'https://example.com/portfolio');
  assert.equal(properties.length, 1);
  assert.equal(properties[0].units, 124);
  assert.equal(properties[0].grossSquareFeet, 156000);
});

test('decision-maker ranking favors operational principals with verified contact paths', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:one', kind:'company', label:'Example Properties', geography:'NJ' });
  upsertEntity(graph, { id:'person:owner', kind:'person', label:'Alex Owner', geography:'NJ' });
  upsertEntity(graph, { id:'person:director', kind:'person', label:'Dana Director', geography:'NJ' });
  addClaim(graph, { id:'dm1', subjectId:'company:one', fact:'person.decisionMaker', objectEntityId:'person:owner', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T12:00:00Z' });
  addClaim(graph, { id:'title1', subjectId:'person:owner', fact:'person.title', value:'Managing Principal', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T12:00:00Z' });
  addClaim(graph, { id:'email1', subjectId:'person:owner', fact:'person.email', value:'alex@example.com', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T12:00:00Z' });
  addClaim(graph, { id:'dm2', subjectId:'company:one', fact:'person.decisionMaker', objectEntityId:'person:director', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T12:00:00Z' });
  addClaim(graph, { id:'title2', subjectId:'person:director', fact:'person.title', value:'Director of Marketing', state:'SUPPORTED', confidence:.9, evidenceIds:[], observedAt:'2026-09-22T12:00:00Z' });

  const ranked = rankDecisionMakers(graph, 'company:one');
  assert.equal(ranked[0].personId, 'person:owner');
  assert.equal(ranked[0].contactStatus, 'email');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('water-cost estimate uses EPA multifamily benchmark only with sourced property and rate inputs', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:one', kind:'property', label:'123 Main St, Newark, NJ 07102', geography:'NJ' });
  upsertEntity(graph, { id:'utility:one', kind:'utility', label:'Example Water', geography:'NJ' });
  addEvidence(graph, { id:'property:evidence', sourceId:'company-first-party-web', url:'https://example.com/portfolio', observedAt:'2026-09-22T12:00:00Z', authority:'first-party', confidence:.9 });
  addEvidence(graph, { id:'rate:evidence', sourceId:'utility-first-party-web', url:'https://water.example.gov/rates', observedAt:'2026-09-22T12:00:00Z', authority:'first-party', confidence:.9 });
  addClaim(graph, { id:'units', subjectId:'property:one', fact:'property.units', value:100, state:'SUPPORTED', confidence:.9, evidenceIds:['property:evidence'], observedAt:'2026-09-22T12:00:00Z' });
  addClaim(graph, { id:'provider', subjectId:'property:one', fact:'utility.provider', objectEntityId:'utility:one', state:'SUPPORTED', confidence:.9, evidenceIds:['rate:evidence'], observedAt:'2026-09-22T12:00:00Z' });
  addClaim(graph, { id:'rate', subjectId:'utility:one', fact:'utility.rateSchedule', value:'Water usage charge: $8.42 per 1,000 gallons', state:'SUPPORTED', confidence:.9, evidenceIds:['rate:evidence'], observedAt:'2026-09-22T12:00:00Z' });

  const estimate = estimatePropertyWaterCost(graph, 'property:one');
  assert.ok(estimate);
  assert.equal(estimate?.basis, 'epa-multifamily-gallons-per-unit');
  assert.equal(estimate?.benchmarkAnnualGallons, 4_360_000);
  assert.ok((estimate?.annualVariableCost ?? 0) > 36000);
  assert.equal(estimate?.includesFixedCharges, false);
});

test('rate parser supports gallon and CCF billing units and rejects ambiguous tiered rates', () => {
  assert.equal(parseVariableWaterRate('$8.42 per 1,000 gallons')?.dollarsPer1000Gallons, 8.42);
  assert.ok(Math.abs((parseVariableWaterRate('$6.00 per CCF')?.dollarsPer1000Gallons ?? 0) - (6 / 748 * 1000)) < 0.001);
  assert.equal(parseVariableWaterRate('First tier $5.00 per CCF; second tier $8.00 per CCF'), undefined);
});

test('SEC executive parser identifies named officers adjacent to titles', () => {
  const text = 'Executive Officers\nJane Smith\nChief Operating Officer\nJohn Jones\nChief Executive Officer\n';
  const people = parseExecutiveSignals(text);
  assert.deepEqual(people.map((item) => [item.name, item.title]), [
    ['Jane Smith', 'Chief Operating Officer'],
    ['John Jones', 'Chief Executive Officer'],
  ]);
});

test('research effort budget stops expensive low-value work before task count exhaustion', async () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:budget', kind:'company', label:'Budget Properties', geography:'NJ' });
  const result = await runResearch(graph, 'company:budget', {
    maxTasks: 50,
    maxBudgetUnits: 3,
    concurrency: 4,
    executor: async (_graph, task: ResearchTask) => ({
      taskId: task.id,
      status: 'complete',
      sourceId: task.sourceId,
      discoveredEntityIds: [],
      evidenceAdded: 0,
      claimsAdded: 0,
      message: 'synthetic',
    }),
  });
  assert.ok((result.budgetUnitsSpent ?? Number.POSITIVE_INFINITY) <= 3);
  assert.equal(result.stopReason, 'research-budget');
});

test('browser sources cost materially more budget than structured official sources', () => {
  assert.ok(sourceCostUnits({ strategy:'browser' } as never) > sourceCostUnits({ strategy:'structured' } as never));
});
