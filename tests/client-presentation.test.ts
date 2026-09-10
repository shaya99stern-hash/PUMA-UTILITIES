import test from 'node:test';
import assert from 'node:assert/strict';
import { clientSegmentFor, prospectStatusFor, matchesProspectStatus } from '../lib/client-presentation';
import type { Company } from '../lib/types';

function company(stage: Company['stage']): Company {
  return {
    id: `company-${stage}`,
    name: stage,
    stage,
    people: [],
    provenance: [],
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  } as Company;
}

test('Client stage is shown under Active Clients', () => {
  assert.equal(clientSegmentFor(company('Client')), 'active');
});

test('research and target stages map to Needs Outreach', () => {
  assert.equal(prospectStatusFor(company('Target')), 'Needs Outreach');
  assert.equal(prospectStatusFor(company('Research')), 'Needs Outreach');
});

test('outreach maps to Contacted', () => {
  assert.equal(prospectStatusFor(company('Outreach')), 'Contacted');
});

test('follow-up maps to Follow-up', () => {
  assert.equal(prospectStatusFor(company('Follow-up')), 'Follow-up');
});

test('qualified and pilot map to Negotiation', () => {
  assert.equal(prospectStatusFor(company('Qualified')), 'Negotiation');
  assert.equal(prospectStatusFor(company('Pilot')), 'Negotiation');
});

test('installation maps to Installation', () => {
  assert.equal(prospectStatusFor(company('Installation')), 'Installation');
});

test('All matches every prospect but not active clients', () => {
  assert.equal(matchesProspectStatus(company('Research'), 'All'), true);
  assert.equal(matchesProspectStatus(company('Client'), 'All'), false);
});
