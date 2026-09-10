import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addActivityNote,
  classifyPortfolioFit,
  summarizeMeterCoverage,
} from '../lib/client-workflow';
import { createReleaseOneWorkspace } from '../lib/seed';
import type { Company, Property, UtilityService, Workspace } from '../lib/types';

function companyWithBuildings(count?: number): Company {
  const now = '2026-09-10T18:00:00.000Z';
  return {
    id: `company-${count ?? 'unknown'}`,
    name: 'Example Management',
    stage: 'Research',
    market: 'TX',
    headquarters: { status: 'unknown' },
    portfolioBuildings: count === undefined ? { status: 'unknown' } : { value: count, status: 'verified-public' },
    portfolioUnits: { status: 'unknown' },
    portfolio: count === undefined ? [] : [{ value: count, label: 'buildings', qualifier: 'exact', status: 'verified-public' }],
    people: [],
    provenance: [],
    createdAt: now,
    updatedAt: now,
  };
}

test('portfolio fit targets 12+ properties without treating very large portfolios as the default ICP', () => {
  assert.equal(classifyPortfolioFit(companyWithBuildings(8)).status, 'too-small');
  assert.equal(classifyPortfolioFit(companyWithBuildings(12)).status, 'ideal');
  assert.equal(classifyPortfolioFit(companyWithBuildings(80)).status, 'ideal');
  assert.equal(classifyPortfolioFit(companyWithBuildings(400)).status, 'corporate-scale');
  assert.equal(classifyPortfolioFit(companyWithBuildings()).status, 'unknown');
});

test('meter coverage is property-level and preserves unknowns instead of turning them into no-smart-meter findings', () => {
  const properties: Property[] = [
    { id: 'p1', companyId: 'c1', name: 'One', address: { value: '1 Main St', status: 'verified-public' }, state: 'TX', parcelIds: [], provenance: [], createdAt: 'x', updatedAt: 'x' },
    { id: 'p2', companyId: 'c1', name: 'Two', address: { value: '2 Main St', status: 'verified-public' }, state: 'TX', parcelIds: [], provenance: [], createdAt: 'x', updatedAt: 'x' },
    { id: 'p3', companyId: 'c1', name: 'Three', address: { value: '3 Main St', status: 'verified-public' }, state: 'TX', parcelIds: [], provenance: [], createdAt: 'x', updatedAt: 'x' },
  ];
  const utilities: UtilityService[] = [
    { id: 'u1', propertyId: 'p1', provider: 'Example Water', capability: 'smart-meter', portal: 'public-portal', status: 'verified-public' },
    { id: 'u2', propertyId: 'p2', provider: 'Example Water', capability: 'newly-installed', portal: 'authorized-interval', status: 'verified-public' },
    { id: 'u3', propertyId: 'p3', provider: 'Example Water', capability: 'unknown', portal: 'unknown', status: 'unknown' },
  ];

  assert.deepEqual(summarizeMeterCoverage(properties, utilities), {
    properties: 3,
    smartReady: 2,
    manual: 0,
    unknown: 1,
    smartReadyPercentOfKnown: 100,
  });
});

test('activity notes can be captured by voice and attached to the company CRM record', () => {
  const seed = createReleaseOneWorkspace();
  const workspace: Workspace = { ...seed, inboxNotes: [] };
  const updated = addActivityNote(workspace, {
    companyId: 'algin-ny',
    text: 'Spoke with operations. Follow up Friday.',
    source: 'voice',
    now: '2026-09-10T18:30:00.000Z',
  });

  const company = updated.companies.find((item) => item.id === 'algin-ny');
  assert.equal(company?.activityNotes?.length, 1);
  assert.equal(company?.activityNotes?.[0]?.source, 'voice');
  assert.match(company?.activityNotes?.[0]?.text ?? '', /Follow up Friday/);
  assert.equal(updated.updatedAt, '2026-09-10T18:30:00.000Z');
});
