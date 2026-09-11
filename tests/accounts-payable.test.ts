import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAccountsPayable } from '../lib/accounts-payable';
import type { AccountsPayableItem } from '../lib/types';

const items: AccountsPayableItem[] = [
  {
    id: 'a',
    companyId: 'c1',
    description: 'August service',
    amount: 500,
    currency: 'USD',
    status: 'Due',
    dueDate: '2026-09-01',
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
  },
  {
    id: 'b',
    companyId: 'c1',
    description: 'July service',
    amount: 300,
    currency: 'USD',
    status: 'Paid',
    dueDate: '2026-08-01',
    paidAt: '2026-08-02',
    createdAt: '2026-07-01',
    updatedAt: '2026-08-02',
  },
];

test('summarizes outstanding, paid and overdue accounts payable items', () => {
  assert.deepEqual(summarizeAccountsPayable(items, new Date('2026-09-11T12:00:00Z')), {
    outstandingAmount: 500,
    paidAmount: 300,
    overdueCount: 1,
  });
});
