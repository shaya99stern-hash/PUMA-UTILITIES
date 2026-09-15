import { normalizeLabel } from './graph';

export interface CompanyIdentityCandidate {
  name: string;
  domain?: string;
  phone?: string;
  address?: string;
  state?: string;
}

export interface CompanyMatch {
  score: number;
  reasons: string[];
  safeToMerge: boolean;
}

export function normalizeDomain(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return value.toLowerCase().replace(/^www\./, '').replace(/\/$/, '') || undefined;
  }
}

export function normalizePhone(value?: string): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length === 10 ? digits : undefined;
}

export function companyMatch(left: CompanyIdentityCandidate, right: CompanyIdentityCandidate): CompanyMatch {
  let score = 0;
  const reasons: string[] = [];
  let strongIdentifiers = 0;

  const leftDomain = normalizeDomain(left.domain);
  const rightDomain = normalizeDomain(right.domain);
  if (leftDomain && rightDomain && leftDomain === rightDomain) {
    score += 0.55;
    strongIdentifiers += 1;
    reasons.push('same web domain');
  }

  const leftPhone = normalizePhone(left.phone);
  const rightPhone = normalizePhone(right.phone);
  if (leftPhone && rightPhone && leftPhone === rightPhone) {
    score += 0.25;
    strongIdentifiers += 1;
    reasons.push('same business phone');
  }

  const nameScore = tokenSimilarity(normalizeLabel(left.name), normalizeLabel(right.name));
  if (nameScore >= 0.9) {
    score += 0.18;
    reasons.push('near-identical normalized name');
  } else if (nameScore >= 0.7) {
    score += 0.10;
    reasons.push('similar normalized name');
  }

  if (left.address && right.address && normalizeAddress(left.address) === normalizeAddress(right.address)) {
    score += 0.12;
    reasons.push('same business address');
  }

  if (left.state && right.state && left.state.toUpperCase() !== right.state.toUpperCase()) score -= 0.05;

  score = Math.max(0, Math.min(1, score));
  return {
    score,
    reasons,
    safeToMerge: score >= 0.85 && (strongIdentifiers >= 1 || nameScore === 1),
  };
}

function normalizeAddress(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function tokenSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = new Set(left.split(' '));
  const b = new Set(right.split(' '));
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}
