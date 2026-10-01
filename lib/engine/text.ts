/** Engine-specific text helpers (pure; safe to unit test). */
import { addressKey, companyNameKey, normalizeEmail, normalizePhone, titleCase } from '@/lib/text';
import type { PersonRecord } from './types';

export { companyNameKey, looseNameKey, normalizeDomain, normalizeEmail, normalizePhone, titleCase, splitName } from '@/lib/text';

const UNIT_DESIGNATOR = /\b(SUITE|STE|FLOOR|FL|UNIT|APT|RM|ROOM|DEPT|BLDG|PH)\b[\s.\-#]*[A-Z0-9-]*/g;

/** Splits a "C/O XYZ MANAGEMENT 105 FOULK RD" style street line into the care-of name and the street. */
export function parseCareOf(street: string | null | undefined): { careOf: string | null; street: string } {
  const value = (street ?? '').trim();
  const match = value.match(/^(?:C\/O|CO\/|C\.O\.|ATTN:?|ATTENTION:?)\s+(.+?)\s+(\d[\w-]*\s+.+|P\.?\s*O\.?\s*BOX.+)$/i);
  if (match) return { careOf: match[1].trim(), street: match[2].trim() };
  const only = value.match(/^(?:C\/O|ATTN:?)\s+(.+)$/i);
  if (only) return { careOf: only[1].trim(), street: '' };
  return { careOf: null, street: value };
}

/** Normalized street line used to compare mailing addresses across sources. */
export function streetKey(street: string | null | undefined): string {
  let value = parseCareOf(street).street.toUpperCase();
  if (!value) return '';
  value = value.replace(/\bP\.?\s*O\.?\s*BOX\b/g, 'PO BOX');
  value = value.replace(/\s--\s.*$/, ' ');
  value = value.replace(UNIT_DESIGNATOR, ' ');
  value = value.replace(/#\s*[A-Z0-9-]+/g, ' ');
  value = addressKey(value);
  // A trailing bare number after a street suffix is a unit ("EARLE OVINGTON BL 900").
  value = value.replace(/\b(ST|AVE|BLVD|BL|RD|DR|PL|LN|PKWY|HWY|CT|WAY|TPKE|PLZ|PLAZA|CIR|TER|SQ)\s+\d+[A-Z]?$/, '$1');
  value = value.replace(/\bBL\b/g, 'BLVD').replace(/\bTURNPIKE\b/g, 'TPKE').replace(/\bPLAZA\b/g, 'PLZ').replace(/\bSTT\b/g, 'ST');
  value = value.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1');
  value = value.replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return value;
}

export function zip5(zip: string | number | null | undefined): string | null {
  const digits = String(zip ?? '').replace(/\D/g, '');
  if (digits.length >= 5) return digits.slice(0, 5);
  if (digits.length === 4) return `0${digits}`; // NJ zips lose their leading zero in some datasets.
  return null;
}

/** Stable mailing-address key: normalized street + 5-digit zip (or city when zip is missing). */
export function mailingKey(street: string | null | undefined, cityOrState?: string | null, zip?: string | null): string | null {
  const s = streetKey(street);
  if (!s || s.length < 4) return null;
  const z = zip5(zip);
  if (z) return `${s}|${z}`;
  const city = (cityOrState ?? '').toUpperCase().replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return city ? `${s}|${city}` : null;
}

/** "HACKENSACK, NJ" / "E.ORANGE ,NEW JERSEY" / "TOMS RIVER NJ" -> { city, state }. */
export function splitCityState(value: string | null | undefined): { city: string | null; state: string | null } {
  const raw = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { city: null, state: null };
  const long: Record<string, string> = { 'NEW JERSEY': 'NJ', 'NEW YORK': 'NY', PENNSYLVANIA: 'PA', DELAWARE: 'DE', CONNECTICUT: 'CT', FLORIDA: 'FL', MARYLAND: 'MD', CALIFORNIA: 'CA' };
  const upper = raw.toUpperCase();
  for (const [name, code] of Object.entries(long)) {
    if (upper.endsWith(name)) return { city: cleanCity(raw.slice(0, raw.length - name.length)), state: code };
  }
  const m = upper.match(/^(.*?)[\s,]+(N\s?J|N\s?Y|P\s?A|[A-Z]{2})\.?$/);
  if (m) return { city: cleanCity(m[1]), state: m[2].replace(/\s/g, '') };
  return { city: cleanCity(raw), state: null };
}

function cleanCity(value: string): string | null {
  const v = value.replace(/[,.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return v ? titleCase(v) : null;
}

/** NJ MOD-IV BLDG_DESC like "3S-F-A-6U-NH" or "648U" -> 6 / 648 units. */
export function parseNjUnits(bldgDesc: string | null | undefined): number | null {
  const m = String(bldgDesc ?? '').toUpperCase().match(/(?:^|[^0-9])(\d{1,4})\s?U(?![A-Z])/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n < 10000 ? n : null;
}

/** Philadelphia OPA building code bands -> estimated unit count. */
export function opaUnitEstimate(buildingCode: string | null | undefined, livableArea?: number | null): { units: number | null; estimated: boolean } {
  const code = String(buildingCode ?? '').toUpperCase();
  const area = Number(livableArea ?? 0);
  const fromArea = area > 0 ? Math.round(area / 850) : null;
  const band = (lo: number, hi: number, mid: number) => {
    if (fromArea && fromArea >= lo && fromArea <= hi) return { units: fromArea, estimated: true };
    if (fromArea && fromArea > hi && hi >= 1000) return { units: fromArea, estimated: true };
    return { units: fromArea ? Math.min(hi, Math.max(lo, fromArea)) : mid, estimated: true };
  };
  if (/APTS?\s*100\+/.test(code)) return band(100, 5000, 150);
  if (/APTS?\s*51-100/.test(code)) return band(51, 100, 75);
  if (/APTS?\s*5-50/.test(code)) return band(5, 50, 15);
  if (/APT\s*2-4/.test(code)) return band(2, 4, 3);
  return { units: fromArea && fromArea >= 5 ? fromArea : null, estimated: true };
}

const GENERIC_ORG = /^(N\/?A|NONE|NULL|UNKNOWN|UNAVAILABLE OWNER|OWNER|SAME|SEE ABOVE|TBD|\.|-|0|NOT APPLICABLE|NO NAME|REDACTED)$/i;
export function isGenericName(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  return !v || v.length < 3 || GENERIC_ORG.test(v) || /^UNAVAILABLE/i.test(v);
}

const FREE_MAIL = new Set([
  'gmail.com', 'yahoo.com', 'aol.com', 'hotmail.com', 'outlook.com', 'msn.com', 'live.com', 'icloud.com', 'me.com', 'mac.com',
  'verizon.net', 'comcast.net', 'optonline.net', 'att.net', 'sbcglobal.net', 'earthlink.net', 'protonmail.com', 'ymail.com',
  'rocketmail.com', 'juno.com', 'netzero.net', 'cox.net', 'charter.net', 'bellsouth.net', 'rcn.com', 'optimum.net', 'gmx.com', 'mail.com',
]);
export function isFreeMailDomain(domain: string | null | undefined): boolean {
  const d = (domain ?? '').toLowerCase();
  return !d || FREE_MAIL.has(d);
}

export function emailDomain(email: string | null | undefined): string | null {
  const e = normalizeEmail(email);
  return e ? e.split('@')[1] : null;
}

/** Buckets a job title into the CRM's role categories. */
export function roleCategoryFor(title: string | null | undefined, type?: string | null): NonNullable<PersonRecord['roleCategory']> {
  const t = `${title ?? ''} ${type ?? ''}`.toLowerCase();
  if (/\b(owner|member|managing member|general partner|gen\.?\s?part|shareholder|principal|founder|individualowner|corporateowner)\b/.test(t)) return 'owner';
  if (/\b(ceo|chief|president|chair|chairman|vice president|vp|evp|svp|executive|director|partner|headofficer|officer|managing director|exec)\b/.test(t)) return 'executive';
  if (/\b(cfo|finance|controller|accounting|accounts payable|treasurer)\b/.test(t)) return 'finance';
  if (/\b(maintenance|superintendent|super|engineer|facilit|building services)\b/.test(t)) return 'maintenance';
  if (/\b(operations|ops|regional|asset manager|portfolio manager)\b/.test(t)) return 'operations';
  if (/\b(property manager|site manager|sitemanager|manager|management agent|agent|administrator)\b/.test(t)) return 'property_manager';
  if (/\b(leasing|rental|marketing)\b/.test(t)) return 'leasing';
  return 'other';
}

/** True for titles that typically sign a water-metering contract. */
export function isDecisionMakerTitle(title: string | null | undefined, type?: string | null): boolean {
  const role = roleCategoryFor(title, type);
  if (role === 'owner' || role === 'executive' || role === 'operations') return true;
  return /\b(regional|director|asset|portfolio|vp|president|owner)\b/i.test(title ?? '');
}

const NAME_PARTICLE = /^(de|del|la|van|von|der|di|da|le|st\.?)$/i;
/** Cleans an all-caps public-record name ("MARIA E BLASER") into display form ("Maria E Blaser"). */
export function displayPersonName(first?: string | null, last?: string | null, full?: string | null): string {
  const raw = (full ?? [first, last].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
  return raw
    .split(' ')
    .map((w) => (NAME_PARTICLE.test(w) ? w.toLowerCase() : titleCase(w)))
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());
}

export function personKey(fullName: string): string {
  return fullName
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|mr|mrs|ms|dr)\b\.?/g, ' ')
    .replace(/\b[a-z]\b\.?/g, ' ') // middle initials
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Looks like a real person (two+ alphabetic words, no company suffix). */
export function looksLikePerson(name: string | null | undefined): boolean {
  const v = (name ?? '').trim();
  if (v.length < 4 || v.length > 60) return false;
  if (/\b(llc|inc|corp|company|co\.|lp|llp|trust|realty|management|properties|associates|group|housing|authority|apartments|fund)\b/i.test(v)) return false;
  const words = v.split(/\s+/);
  return words.length >= 2 && words.length <= 5 && words.every((w) => /^[A-Za-zÀ-ÿ'’.-]+$/.test(w));
}

export function displayOrgName(name: string): string {
  const v = name.replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/,+$/, '').trim();
  // Keep mixed-case names as published ("FirstService Residential").
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) return v;
  return titleCase(v).replace(/\bL\.?l\.?c\.?/g, 'LLC').replace(/\bLp\b/g, 'LP');
}

export function cleanPhone(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const normalized = normalizePhone(digits.length > 11 ? digits.slice(0, 10) : digits);
  return normalized && /^\(\d{3}\) \d{3}-\d{4}$/.test(normalized) && !/^\(0|^\(1|555\) 555/.test(normalized) ? normalized : null;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function toInt(value: unknown): number | null {
  const n = toNumber(value);
  return n === null ? null : Math.round(n);
}

export function validYear(value: unknown): number | null {
  const n = toInt(value);
  const now = new Date().getFullYear() + 2;
  return n && n >= 1700 && n <= now ? n : null;
}

export function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return value === null || value === undefined ? null : String(value);
  const v = value.replace(/\s+/g, ' ').trim();
  return v || null;
}

/** Significant tokens of a company name for fuzzy page/domain matching. */
export function nameTokens(name: string): string[] {
  return companyNameKey(name)
    .split(' ')
    .filter((t) => t.length >= 3 && !/^(and|the|for|inc|llc|new|york|jersey|nyc)$/.test(t));
}
