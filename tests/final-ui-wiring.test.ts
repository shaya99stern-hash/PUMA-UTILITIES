import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWorkspace } from '../lib/workspace';

const componentPath = new URL('../app/components/puma-workspace-app-v4.tsx', import.meta.url);
const routePath = new URL('../app/accounts-payable/page.tsx', import.meta.url);

test('final Puma shell exposes five lifecycle views, accounts payable, and no-cost speech recognition', () => {
  const source = readFileSync(componentPath, 'utf8');
  assert.match(source, /COMPANY_LIFECYCLES/);
  for (const label of ['Prospects', 'Contacted', 'Not Interested', 'Installations', 'Active Clients']) {
    assert.match(source, new RegExp(label.replace(' ', '\\s')));
  }
  assert.match(source, /Accounts Payable/);
  assert.match(source, /\/accounts-payable/);
  assert.match(source, /webkitSpeechRecognition|SpeechRecognition/);
});

test('accounts payable route mounts the dedicated Puma view', () => {
  const source = readFileSync(routePath, 'utf8');
  assert.match(source, /view="accounts-payable"/);
});

test('workspace parsing preserves accounts payable records', () => {
  const parsed = parseWorkspace({
    version: 1,
    companies: [],
    properties: [],
    parcels: [],
    utilities: [],
    meters: [],
    tariffs: [],
    monitorSettings: {},
    inboxNotes: [],
    accountsPayable: [{
      id: 'ap_1',
      companyId: 'company_1',
      description: 'September service',
      amount: 1250,
      currency: 'USD',
      status: 'Paid',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    }],
    updatedAt: '2026-09-10T00:00:00.000Z',
  });

  assert.equal(parsed.accountsPayable?.length, 1);
  assert.equal(parsed.accountsPayable?.[0]?.status, 'Paid');
});
