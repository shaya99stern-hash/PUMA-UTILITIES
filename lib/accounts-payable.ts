import type { AccountsPayableItem } from './types';

export type AccountsPayableSummary = {
  outstandingAmount: number;
  paidAmount: number;
  overdueCount: number;
};

function dueDateIsPast(dueDate: string | undefined, now: Date) {
  if (!dueDate) return false;
  const parsed = new Date(`${dueDate.slice(0, 10)}T23:59:59`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() < now.getTime();
}

export function summarizeAccountsPayable(
  items: readonly AccountsPayableItem[],
  now = new Date(),
): AccountsPayableSummary {
  let outstandingAmount = 0;
  let paidAmount = 0;
  let overdueCount = 0;

  for (const item of items) {
    if (item.status === 'Paid') {
      paidAmount += item.amount;
      continue;
    }
    if (item.status === 'Void' || item.status === 'Draft') continue;

    outstandingAmount += item.amount;
    if (item.status === 'Overdue' || (item.status === 'Due' && dueDateIsPast(item.dueDate, now))) {
      overdueCount += 1;
    }
  }

  return { outstandingAmount, paidAmount, overdueCount };
}
