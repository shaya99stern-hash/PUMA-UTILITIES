/** Shared text normalization used by the CRM and the research engine. */

const ENTITY_SUFFIXES = /\b(l\.?l\.?c\.?|inc\.?|incorporated|corp\.?|corporation|co\.?|company|l\.?p\.?|ltd\.?|limited|llp|pllc|plc|trust|the|assoc(iates)?|associates?|holdings?|group|partners(hip)?|properties|realty|management|mgmt|residential|apartments?|real estate|enterprises?)\b/g;

/** Stable dedupe key for company names ("The Kushner Cos., LLC" -> "kushner cos"). */
export function companyNameKey(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const stripped = base.replace(ENTITY_SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
  return stripped || base;
}

/** Looser key for fuzzy matching (drops real-estate words too). */
export function looseNameKey(name: string) {
  return companyNameKey(name).replace(/\b(and|of|at|llc|ny|nj|pa)\b/g, ' ').replace(/\s+/g, '').trim();
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])([a-z']*)/g, (_, a: string, b: string) => a.toUpperCase() + b)
    .replace(/\b(Llc|Lp|Llp|Inc|Nyc|Usa|Ii|Iii|Iv|Hoa|Nj|Ny|Pa)\b/g, (m) => m.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c: string) => `Mc${c.toUpperCase()}`);
}

export function normalizeDomain(input?: string | null): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (value.includes('@')) value = value.split('@')[1] ?? '';
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] ?? '';
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : null;
}

export function normalizePhone(input?: string | null): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (d.length !== 10) return input.trim() || null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function normalizeEmail(input?: string | null): string | null {
  const value = input?.trim().toLowerCase();
  return value && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(value) ? value : null;
}

export function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().replace(/\s+/g, ' ').split(' ');
  if (parts.length === 1) return { first: parts[0] || null, last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/** Normalizes a street address for cross-referencing mailing addresses. */
export function addressKey(address: string): string {
  return address
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\b(SUITE|STE|FL|FLOOR|UNIT|APT|RM|ROOM)\s*\w+/g, ' ')
    .replace(/\bSTREET\b/g, 'ST').replace(/\bAVENUE\b/g, 'AVE').replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bROAD\b/g, 'RD').replace(/\bDRIVE\b/g, 'DR').replace(/\bPLACE\b/g, 'PL').replace(/\bLANE\b/g, 'LN')
    .replace(/\bPARKWAY\b/g, 'PKWY').replace(/\bHIGHWAY\b/g, 'HWY').replace(/\bCOURT\b/g, 'CT')
    .replace(/\bEAST\b/g, 'E').replace(/\bWEST\b/g, 'W').replace(/\bNORTH\b/g, 'N').replace(/\bSOUTH\b/g, 'S')
    .replace(/\s+/g, ' ')
    .trim();
}
