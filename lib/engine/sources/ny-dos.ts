/** NY Department of State active corporations (data.ny.gov n9v6-gdp6): LLC -> process address, chairman, agent. */
import { displayOrgName, displayPersonName, mailingKey, titleCase, trimOrNull, zip5 } from '../text';
import type { SourceInfo } from '../types';
import { socrataRows, soql, type FetchCtx } from './common';

export const nyDos: SourceInfo = {
  id: 'ny-dos',
  name: 'NY Dept. of State Active Corporations',
  kind: 'enrichment',
  coverage: ['NY', 'NJ', 'PA', 'US'],
  coverageLabel: 'Entities registered in New York',
  capabilities: ['legal_entity', 'process_address', 'chairman', 'registered_agent', 'formation_date'],
  description: 'Every active NY corporation/LLC (incl. foreign entities registered in NY): service-of-process address, chairman/CEO and registered agent.',
  homepage: 'https://data.ny.gov/Economic-Development/Active-Corporations-Beginning-1800/n9v6-gdp6',
  verified: 'live',
};

export const NY_DOS_URL = 'https://data.ny.gov/resource/n9v6-gdp6.json';

export type DosEntity = {
  dosId: string;
  name: string;
  entityType: string | null;
  county: string | null;
  filedOn: string | null;
  processName: string | null;
  processAddress: string | null;
  processKey: string | null;
  chairman: string | null;
  chairmanAddress: string | null;
  registeredAgent: string | null;
  url: string;
};

export function parseDosRows(rows: Record<string, string>[], url: string): DosEntity[] {
  return rows.map((r) => {
    const street = [r.dos_process_address_1, r.dos_process_address_2].filter(Boolean).join(' ');
    const processAddress = street ? `${titleCase(street)}, ${titleCase(r.dos_process_city ?? '')} ${r.dos_process_state ?? ''} ${r.dos_process_zip ?? ''}`.replace(/\s+/g, ' ').trim() : null;
    const chairStreet = [r.chairman_address_1, r.chairman_address_2].filter(Boolean).join(' ');
    return {
      dosId: String(r.dos_id),
      name: displayOrgName(r.current_entity_name ?? ''),
      entityType: trimOrNull(r.entity_type),
      county: trimOrNull(r.county),
      filedOn: r.initial_dos_filing_date ? r.initial_dos_filing_date.slice(0, 10) : null,
      processName: r.dos_process_name ? displayOrgName(r.dos_process_name) : null,
      processAddress,
      processKey: r.dos_process_address_1 ? mailingKey(r.dos_process_address_1, r.dos_process_city, r.dos_process_zip) : null,
      chairman: r.chairman_name ? displayPersonName(null, null, r.chairman_name) : null,
      chairmanAddress: chairStreet ? `${titleCase(chairStreet)}, ${titleCase(r.chairman_city ?? '')} ${r.chairman_state ?? ''} ${r.chairman_zip ?? ''}`.replace(/\s+/g, ' ').trim() : null,
      registeredAgent: r.registered_agent_name ? displayOrgName(r.registered_agent_name) : null,
      url,
    };
  });
}

export function dosNameTerm(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function searchDosByName(name: string, ctx: FetchCtx, limit = 10) {
  const term = dosNameTerm(name);
  if (term.length < 3) return [];
  const { rows, url } = await socrataRows(nyDos, NY_DOS_URL, {
    $where: `current_entity_name like ${soql(`${term}%`)}`,
    $limit: limit,
  }, ctx, { ttlMs: 14 * 24 * 3_600_000 });
  return parseDosRows(rows, url);
}

/** Entities whose service-of-process address is a given street address (house number + street start + zip). */
export async function searchDosByAddress(street: string, zip: string | null, ctx: FetchCtx, limit = 25) {
  const s = street.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d+[A-Z]?)\s+(.{3,})$/);
  if (!m) return [];
  const firstWords = m[2].split(' ').slice(0, 2).join(' ');
  const z = zip5(zip);
  const where = [`dos_process_address_1 like ${soql(`${m[1]} ${firstWords}%`)}`, z ? `dos_process_zip like ${soql(`${z}%`)}` : null].filter(Boolean).join(' AND ');
  const { rows, url } = await socrataRows(nyDos, NY_DOS_URL, { $where: where, $limit: limit }, ctx, { ttlMs: 14 * 24 * 3_600_000 });
  return parseDosRows(rows, url);
}
