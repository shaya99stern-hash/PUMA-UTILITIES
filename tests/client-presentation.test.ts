import test from 'node:test';
import assert from 'node:assert/strict';
import { clientSegmentFor, prospectStatusFor, matchesProspectStatus } from '../lib/client-presentation';
import { collectSelectedEmails } from '../lib/bulk-outreach';
import type { Company } from '../lib/types';

function company(stage: Company['stage'], id = `company-${stage}`, emails: string[] = []): Company {
  return {
    id,
    name: stage,
    stage,
    people: emails.map((email, index) => ({ id: `${id}-person-${index}`, name: `Person ${index + 1}`, email })),
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

test('bulk outreach returns unique published emails only for selected companies', () => {
  const companies = [
    company('Research', 'c1', ['owner@example.com', 'ops@example.com']),
    company('Outreach', 'c2', ['owner@example.com', 'sales@example.com']),
    company('Client', 'c3', ['client@example.com']),
  ];

  assert.deepEqual(
    collectSelectedEmails(companies, new Set(['c1', 'c2'])),
    ['owner@example.com', 'ops@example.com', 'sales@example.com'],
  );
});

test('bulk outreach ignores blank and unselected emails', () => {
  const companies = [
    company('Research', 'c1', ['', 'known@example.com']),
    company('Research', 'c2', ['other@example.com']),
  ];

  assert.deepEqual(collectSelectedEmails(companies, new Set(['c1'])), ['known@example.com']);
});
