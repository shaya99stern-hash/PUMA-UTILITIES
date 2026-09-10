import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonitorAlerts } from '../lib/monitor';
import { createReleaseOneWorkspace } from '../lib/seed';

test('public research workspace cannot manufacture monitoring alerts', () => {
  const workspace = createReleaseOneWorkspace();
  assert.deepEqual(buildMonitorAlerts(workspace), []);
});

test('only a client-stage, client-authorized reading can create configured alerts', () => {
  const workspace = createReleaseOneWorkspace();
  const company = workspace.companies[0];
  company.stage = 'Client';
  workspace.properties.push({
    id: 'property-1',
    companyId: company.id,
    name: 'Authorized building',
    address: { status: 'client-authorized' },
    state: 'NY',
    parcelIds: [],
    provenance: [],
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  });
  workspace.utilities.push({
    id: 'utility-1',
    propertyId: 'property-1',
    provider: 'Client-confirmed utility',
    capability: 'unknown',
    portal: 'unknown',
    status: 'client-authorized',
  });
  workspace.meters.push({
    id: 'meter-1',
    utilityServiceId: 'utility-1',
    label: 'Authorized meter',
    readings: [
      {
        id: 'public-reading',
        meterId: 'meter-1',
        gallons: 200,
        expectedGallons: 100,
        continuousFlow: true,
        cost: 500,
        status: 'verified-public',
      },
      {
        id: 'authorized-reading',
        meterId: 'meter-1',
        gallons: 150,
        expectedGallons: 100,
        continuousFlow: true,
        cost: 500,
        periodEnd: '2026-09-10T00:00:00.000Z',
        status: 'client-authorized',
      },
    ],
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  });
  workspace.monitorSettings = { spendThreshold: 300, varianceThresholdPercent: 25 };

  const alerts = buildMonitorAlerts(workspace);
  assert.equal(alerts.length, 3);
  assert.ok(alerts.every((alert) => alert.status === 'client-authorized'));
  assert.ok(alerts.every((alert) => alert.id.includes('authorized-reading')));
});
