import { parseTariffClassEvidence, type TariffClassEvidence } from './tariff-class';

export type TariffFreshness = 'current' | 'expired' | 'future' | 'unknown';
export type ParsedTariffMetadata = {
  customerClass?: TariffClassEvidence;
  effectiveFrom?: string;
  effectiveTo?: string;
};

const DATE_TOKEN = '(?:[A-Z][a-z]+\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\/\\d{1,2}\\/\\d{4}|\\d{4}-\\d{2}-\\d{2})';

export function parseTariffMetadata(text: string): ParsedTariffMetadata {
  const normalized = text.replace(/\s+/g,' ').trim();
  const effective = normalized.match(new RegExp(`\\beffective(?:\\s+(?:from|on))?\\s+(${DATE_TOKEN})`, 'i'))?.[1];
  const through = normalized.match(new RegExp(`\\b(?:through|until|expires?|expiration(?:\\s+date)?)\\s+(${DATE_TOKEN})`, 'i'))?.[1];
  return {
    customerClass: parseTariffClassEvidence(normalized),
    effectiveFrom: effective ? explicitDate(effective) : undefined,
    effectiveTo: through ? explicitDate(through) : undefined,
  };
}

export function tariffFreshness(metadata: ParsedTariffMetadata, asOf = new Date().toISOString()): TariffFreshness {
  const day = asOf.slice(0,10);
  if (metadata.effectiveFrom && metadata.effectiveFrom > day) return 'future';
  if (metadata.effectiveTo && metadata.effectiveTo < day) return 'expired';
  if (metadata.effectiveFrom || metadata.effectiveTo) return 'current';
  return 'unknown';
}

export function tariffTextUsableNow(text: string, asOf = new Date().toISOString()): boolean {
  const freshness = tariffFreshness(parseTariffMetadata(text), asOf);
  return freshness !== 'expired' && freshness !== 'future';
}

function explicitDate(value: string): string | undefined {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return validDate(Number(slash[3]), Number(slash[1]), Number(slash[2]));
  const months: Record<string, number> = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
  const named = value.replace(',','').match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (!named) return undefined;
  const month = months[named[1].toLowerCase()];
  return month ? validDate(Number(named[3]), month, Number(named[2])) : undefined;
}

function validDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year.toString().padStart(4,'0')}-${month.toString().padStart(2,'0')}-${day.toString().padStart(2,'0')}`;
}
