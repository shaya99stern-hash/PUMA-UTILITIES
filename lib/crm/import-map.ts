import { normalizeDomain, normalizeEmail, normalizePhone, splitName } from '@/lib/text';
import { STAGES, STAGE_LABELS, COMPANY_TYPES, type Stage, type CompanyType } from './types';

/** Normalized import row: one company, optionally with one contact. */
export type ImportRow = {
  company: string;
  website: string | null;
  domain: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  units: number | null;
  buildings: number | null;
  stage: Stage;
  company_type: CompanyType | null;
  tags: string[];
  contact: null | {
    full_name: string;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
  };
};

const ALIASES: Record<string, string[]> = {
  company: ['company', 'companyname', 'name', 'organization', 'organisation', 'account', 'accountname', 'owner', 'business', 'businessname'],
  website: ['website', 'web', 'url', 'site', 'domain', 'companywebsite', 'companyurl'],
  phone: ['phone', 'companyphone', 'telephone', 'tel', 'mainphone', 'officephone'],
  email: ['email', 'companyemail', 'generalemail', 'infoemail'],
  contact_name: ['contactname', 'contact', 'fullname', 'person', 'decisionmaker', 'primarycontact', 'contactfullname'],
  contact_first: ['firstname', 'contactfirstname', 'first'],
  contact_last: ['lastname', 'contactlastname', 'last', 'surname'],
  title: ['title', 'jobtitle', 'contacttitle', 'role', 'position'],
  contact_email: ['contactemail', 'personemail', 'workemail', 'directemail', 'emailaddress'],
  contact_phone: ['contactphone', 'mobile', 'cell', 'directphone', 'mobilephone'],
  address: ['address', 'streetaddress', 'street', 'address1', 'companyaddress'],
  city: ['city', 'town'],
  state: ['state', 'st', 'province', 'stateprovince'],
  zip: ['zip', 'zipcode', 'postalcode', 'postcode', 'zip5'],
  units: ['units', 'unitcount', 'totalunits', 'apartments', 'portfoliounits', 'numberofunits', 'doors'],
  buildings: ['buildings', 'buildingcount', 'totalbuildings', 'properties', 'numberofbuildings', 'portfoliobuildings'],
  stage: ['stage', 'status', 'pipelinestage', 'leadstatus', 'dealstage'],
  type: ['type', 'companytype', 'category'],
  tags: ['tags', 'tag', 'labels', 'segments', 'lists'],
};

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Maps raw header text -> canonical field. Unknown headers are omitted. */
export function mapHeaders(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const normalized = headers.map((h) => ({ raw: h, key: normalizeHeader(h) }));
  // Pass 1: exact canonical names first so "Contact Email" never steals "Email".
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const hit = normalized.find((h) => h.key === alias && !used.has(h.raw));
      if (hit) { out[hit.raw] = field; used.add(hit.raw); break; }
    }
  }
  return out;
}

export function parseStage(value: string | null | undefined): Stage {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return 'new';
  for (const s of STAGES) if (v === s || v === STAGE_LABELS[s].toLowerCase()) return s;
  if (/^(new|lead|prospect|open)/.test(v)) return 'new';
  if (/qualif/.test(v)) return 'qualified';
  if (/contact|outreach|attempt/.test(v)) return 'contacted';
  if (/meet|demo/.test(v)) return 'meeting';
  if (/propos|quote|negotiat/.test(v)) return 'proposal';
  if (/install|onboard/.test(v)) return 'installation';
  if (/client|customer|won|active/.test(v)) return 'client';
  if (/lost|dead|closed|dnc|disqual/.test(v)) return 'lost';
  return 'new';
}

function parseCount(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value.replace(/[^0-9.-]/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseType(value: string | undefined): CompanyType | null {
  const v = (value ?? '').trim().toLowerCase().replace(/[\s/-]+/g, '_');
  if (!v) return null;
  if ((COMPANY_TYPES as readonly string[]).includes(v)) return v as CompanyType;
  if (/manag/.test(v)) return 'property_manager';
  if (/owner|operator/.test(v)) return 'owner_operator';
  if (/develop/.test(v)) return 'developer';
  if (/reit/.test(v)) return 'reit';
  if (/non.?profit/.test(v)) return 'nonprofit';
  if (/housing|pha|nycha/.test(v)) return 'public_housing';
  if (/invest/.test(v)) return 'investor';
  return 'other';
}

export function parseTags(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(/[;,|]/).map((t) => t.trim()).filter(Boolean))].slice(0, 20);
}

/**
 * Converts loosely-headed rows (from CSV or JSON) into normalized import rows.
 * Rows without a company name (and no domain to derive one from) are returned in `skipped`.
 */
export function mapImportRows(rawRows: Array<Record<string, unknown>>): { rows: ImportRow[]; skipped: Array<{ index: number; reason: string }>; mapping: Record<string, string> } {
  const headers = [...new Set(rawRows.flatMap((r) => Object.keys(r)))];
  const mapping = mapHeaders(headers);
  const rows: ImportRow[] = [];
  const skipped: Array<{ index: number; reason: string }> = [];

  rawRows.forEach((raw, index) => {
    const v: Record<string, string> = {};
    for (const [header, field] of Object.entries(mapping)) {
      const cell = raw[header];
      if (cell !== undefined && cell !== null && String(cell).trim() !== '') v[field] = String(cell).trim();
    }
    const domain = normalizeDomain(v.website) ?? normalizeDomain(v.email);
    let company = v.company ?? '';
    if (!company && domain) company = domain.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (!company) { skipped.push({ index, reason: 'Missing company name' }); return; }

    let contact: ImportRow['contact'] = null;
    const fullName = v.contact_name || [v.contact_first, v.contact_last].filter(Boolean).join(' ');
    const contactEmail = normalizeEmail(v.contact_email);
    if (fullName || contactEmail) {
      const name = fullName || (contactEmail ?? '').split('@')[0].replace(/[._-]+/g, ' ');
      const parts = v.contact_first || v.contact_last ? { first: v.contact_first ?? null, last: v.contact_last ?? null } : splitName(name);
      contact = {
        full_name: name, first_name: parts.first, last_name: parts.last,
        title: v.title ?? null, email: contactEmail, phone: normalizePhone(v.contact_phone),
      };
    }
    const website = v.website ? (/^https?:\/\//i.test(v.website) ? v.website : `https://${v.website.replace(/^\/+/, '')}`) : null;
    rows.push({
      company,
      website: domain ? website : null,
      domain,
      phone: normalizePhone(v.phone),
      email: normalizeEmail(v.email),
      address: v.address ?? null,
      city: v.city ?? null,
      state: v.state ? v.state.toUpperCase().slice(0, 2) : null,
      zip: v.zip ?? null,
      units: parseCount(v.units),
      buildings: parseCount(v.buildings),
      stage: parseStage(v.stage),
      company_type: parseType(v.type),
      tags: parseTags(v.tags),
      contact,
    });
  });
  return { rows, skipped, mapping };
}
