import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingDetailPath, buildingListPath, companyPath } from '../lib/client-routing';

test('company route is stable and URL encoded', () => {
  assert.equal(companyPath('inline management'), '/clients/inline%20management');
});

test('building list route nests under the company', () => {
  assert.equal(buildingListPath('company-1'), '/clients/company-1/buildings');
});

test('building detail route nests property under company buildings', () => {
  assert.equal(buildingDetailPath('company-1', 'property 9'), '/clients/company-1/buildings/property%209');
});
