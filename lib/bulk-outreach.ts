import type { Company } from './types';

export function collectSelectedEmails(companies: Company[], selectedIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const company of companies) {
    if (!selectedIds.has(company.id)) continue;
    for (const person of company.people) {
      const email = person.email?.trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emails.push(email);
    }
  }

  return emails;
}
