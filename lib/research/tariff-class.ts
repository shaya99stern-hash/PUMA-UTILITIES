export type TariffClassEvidence = 'multifamily' | 'residential' | 'commercial' | 'general-service';

export function parseTariffClassEvidence(text: string): TariffClassEvidence | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized || /\b(sewer|wastewater)\b/i.test(normalized)) return undefined;
  if (/\b(multifamily|multi-family|apartment(?:s| building| complex)?)\b/i.test(normalized) && /\bwater\b/i.test(normalized)) return 'multifamily';
  if (/\bresidential\b/i.test(normalized) && /\bwater\b/i.test(normalized)) return 'residential';
  if (/\bcommercial\b/i.test(normalized) && /\bwater\b/i.test(normalized)) return 'commercial';
  if (/\bgeneral\s+service\b/i.test(normalized) && /\bwater\b/i.test(normalized)) return 'general-service';
  return undefined;
}
