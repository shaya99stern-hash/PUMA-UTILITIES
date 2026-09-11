import test from 'node:test';
import assert from 'node:assert/strict';
import { companyLifecycle } from '../lib/company-lifecycle';

test('maps persisted pipeline stages into five company lifecycle views', () => {
  assert.equal(companyLifecycle('Target'), 'Prospects');
  assert.equal(companyLifecycle('Research'), 'Prospects');
  assert.equal(companyLifecycle('Qualified'), 'Prospects');
  assert.equal(companyLifecycle('Outreach'), 'Contacted');
  assert.equal(companyLifecycle('Follow-up'), 'Contacted');
  assert.equal(companyLifecycle('Pilot'), 'Contacted');
  assert.equal(companyLifecycle('Not Interested'), 'Not Interested');
  assert.equal(companyLifecycle('Installation'), 'Installations');
  assert.equal(companyLifecycle('Client'), 'Active Clients');
});
