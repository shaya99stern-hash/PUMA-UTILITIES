import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildMonitorAlerts } from '../lib/monitor';
import { createReleaseOneWorkspace } from '../lib/seed';

function workspaceWithAuthorizedReading(stage: 'Client' | 'Research') {
  const workspace = createReleaseOneWorkspace();
  const company = workspace.companies[0];
  company.stage = stage;
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
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-09-10T00:00:00.000Z',
        status: 'client-authorized',
      },
    ],
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  });
  workspace.monitorSettings = { spendThreshold: 300, varianceThresholdPercent: 25 };
  return workspace;
}

test('public research workspace cannot manufacture monitoring alerts', () => {
  const workspace = createReleaseOneWorkspace();
  assert.deepEqual(buildMonitorAlerts(workspace), []);
});

test('only a client-stage, client-authorized reading can create configured alerts', () => {
  const alerts = buildMonitorAlerts(workspaceWithAuthorizedReading('Client'));
  assert.equal(alerts.length, 3);
  assert.ok(alerts.every((alert) => alert.status === 'client-authorized'));
  assert.ok(alerts.every((alert) => alert.id.includes('authorized-reading')));
  assert.ok(alerts.every((alert) => alert.readingId === 'authorized-reading'));
  assert.ok(alerts.every((alert) => alert.meterLabel === 'Authorized meter'));
  assert.ok(alerts.every((alert) => alert.periodStart === '2026-09-01T00:00:00.000Z'));
  assert.ok(alerts.every((alert) => alert.periodEnd === '2026-09-10T00:00:00.000Z'));
});

test('authorized readings still cannot alert for a non-client company', () => {
  assert.deepEqual(buildMonitorAlerts(workspaceWithAuthorizedReading('Research')), []);
});

test('Monitor renders exact alert building drill-down and authorized meter context', () => {
  const source = readFileSync(new URL('../app/components/puma-monitor-workspace.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../app/monitor/page.tsx', import.meta.url), 'utf8');
  assert.match(route, /PumaMonitorWorkspace/);
  assert.match(source, /buildingDetailPath\(alert\.companyId, alert\.propertyId\)/);
  assert.match(source, /alert\.meterLabel/);
  assert.match(source, /alert\.periodEnd/);
  assert.match(source, /buildMonitorAlerts\(workspace\)/);
});
