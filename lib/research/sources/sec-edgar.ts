import { addClaim, addEvidence, normalizeLabel, upsertEntity } from '../graph';
import type { ResearchGraph } from '../types';

type SecTicker = { cik_str?: number; ticker?: string; title?: string };
type SecSubmissions = {
  name?: string;
  cik?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      primaryDocument?: string[];
      filingDate?: string[];
    };
  };
};

export type SecExecutiveSignal = { name: string; title: string };
export type SecCompanyResearch = {
  cik: string;
  officialName: string;
  filingUrl?: string;
  executives: SecExecutiveSignal[];
};

const TITLE_PATTERN = /\b(chief executive officer|chief operating officer|chief financial officer|chief investment officer|chief legal officer|president|executive chairman|chairman|managing partner|managing principal|executive vice president|senior vice president|vice president|head of operations|head of property management)\b/i;

export async function researchSecCompany(companyName: string, signal?: AbortSignal): Promise<SecCompanyResearch | undefined> {
  const tickers = await fetchJson<Record<string, SecTicker>>('https://www.sec.gov/files/company_tickers.json', signal);
  const match = bestTickerMatch(companyName, Object.values(tickers));
  if (!match?.cik_str || !match.title) return undefined;
  const cik = String(match.cik_str).padStart(10, '0');
  const submissions = await fetchJson<SecSubmissions>('https://data.sec.gov/submissions/CIK' + cik + '.json', signal);
  const filing = chooseLeadershipFiling(submissions);
  if (!filing) return { cik, officialName: submissions.name ?? match.title, executives: [] };

  const filingUrl = 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + filing.accession.replace(/-/g, '') + '/' + filing.document;
  const html = await fetchText(filingUrl, signal);
  const executives = parseExecutiveSignals(htmlToText(html));
  return { cik, officialName: submissions.name ?? match.title, filingUrl, executives };
}

export function ingestSecCompanyResearch(
  graph: ResearchGraph,
  companyId: string,
  research: SecCompanyResearch,
  observedAt = new Date().toISOString(),
): void {
  const evidenceUrl = research.filingUrl ?? 'https://data.sec.gov/submissions/CIK' + research.cik + '.json';
  const identityEvidenceId = 'evidence:sec:' + research.cik + ':identity';
  addEvidence(graph, {
    id: identityEvidenceId,
    sourceId: 'sec-edgar',
    url: evidenceUrl,
    observedAt,
    authority: 'official',
    confidence: 0.97,
    excerpt: 'SEC CIK ' + research.cik + ' — ' + research.officialName,
  });
  addClaim(graph, {
    id: 'claim:' + companyId + ':identity:sec:' + research.cik,
    subjectId: companyId,
    fact: 'company.identity',
    value: research.officialName,
    state: 'VERIFIED',
    confidence: 0.96,
    evidenceIds: [identityEvidenceId],
    observedAt,
  });

  for (const [index, executive] of research.executives.slice(0, 20).entries()) {
    const personId = 'person:sec:' + research.cik + ':' + token(executive.name);
    const evidenceId = 'evidence:sec:' + research.cik + ':executive:' + index;
    upsertEntity(graph, { id: personId, kind: 'person', label: executive.name });
    addEvidence(graph, {
      id: evidenceId,
      sourceId: 'sec-edgar',
      url: evidenceUrl,
      observedAt,
      authority: 'official',
      confidence: 0.96,
      excerpt: executive.name + ' — ' + executive.title,
    });
    addClaim(graph, {
      id: 'claim:' + personId + ':title:sec:' + token(executive.title),
      subjectId: personId,
      fact: 'person.title',
      value: executive.title,
      state: 'VERIFIED',
      confidence: 0.95,
      evidenceIds: [evidenceId],
      observedAt,
    });
    addClaim(graph, {
      id: 'claim:' + companyId + ':decision-maker:sec:' + token(executive.name),
      subjectId: companyId,
      fact: 'person.decisionMaker',
      objectEntityId: personId,
      state: 'VERIFIED',
      confidence: 0.93,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }
}

export function parseExecutiveSignals(text: string): SecExecutiveSignal[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 2 && line.length <= 180);
  const output: SecExecutiveSignal[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (TITLE_PATTERN.test(line) && looksLikeTitle(line)) {
      const name = [lines[index - 1], lines[index - 2]].find((candidate) => candidate && looksLikeName(candidate));
      if (!name) continue;
      const titleMatch = line.match(TITLE_PATTERN);
      const title = titleMatch?.[0] ?? line;
      const key = name.toLowerCase() + '|' + title.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        output.push({ name, title: title.replace(/\b\w/g, (letter) => letter.toUpperCase()) });
      }
    }

    const combined = line.match(/^([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})\s*[-–—|,]\s*(.+)$/);
    if (combined && TITLE_PATTERN.test(combined[2])) {
      const titleMatch = combined[2].match(TITLE_PATTERN);
      const title = titleMatch?.[0] ?? combined[2];
      const key = combined[1].toLowerCase() + '|' + title.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        output.push({ name: combined[1], title: title.replace(/\b\w/g, (letter) => letter.toUpperCase()) });
      }
    }
  }

  return output.slice(0, 30);
}

function bestTickerMatch(companyName: string, tickers: SecTicker[]): SecTicker | undefined {
  const wanted = normalizeLabel(companyName);
  let best: { item: SecTicker; score: number } | undefined;
  for (const item of tickers) {
    if (!item.title) continue;
    const actual = normalizeLabel(item.title);
    if (!actual) continue;
    let score = actual === wanted ? 1 : 0;
    if (!score) {
      const wantedTokens = wanted.split(' ').filter((token) => token.length >= 3);
      const matched = wantedTokens.filter((token) => actual.includes(token)).length;
      score = wantedTokens.length ? matched / wantedTokens.length : 0;
      if (actual.includes(wanted) || wanted.includes(actual)) score = Math.max(score, 0.9);
    }
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= 0.82 ? best.item : undefined;
}

function chooseLeadershipFiling(submissions: SecSubmissions): { accession: string; document: string } | undefined {
  const recent = submissions.filings?.recent;
  if (!recent?.form || !recent.accessionNumber || !recent.primaryDocument) return undefined;
  const preferred = ['DEF 14A', '10-K', '10-K/A', '8-K'];
  for (const form of preferred) {
    const index = recent.form.findIndex((item) => item === form);
    if (index >= 0 && recent.accessionNumber[index] && recent.primaryDocument[index]) {
      return { accession: recent.accessionNumber[index], document: recent.primaryDocument[index] };
    }
  }
  return undefined;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': process.env.PUMA_SEC_USER_AGENT ?? 'PumaUtilitiesResearch/1.0 public-business-research',
    },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('SEC request failed with ' + response.status + '.');
  return response.json() as Promise<T>;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': process.env.PUMA_SEC_USER_AGENT ?? 'PumaUtilitiesResearch/1.0 public-business-research',
    },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('SEC filing request failed with ' + response.status + '.');
  return (await response.text()).slice(0, 3_000_000);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|p|div|li|h1|h2|h3|h4|tr|td|th)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function looksLikeName(value: string): boolean {
  if (value.length < 4 || value.length > 80 || /\d|executive|officer|director|table|contents/i.test(value)) return false;
  const parts = value.split(/\s+/);
  return parts.length >= 2 && parts.length <= 5 && parts.every((part) => /^[A-Z][A-Za-z'.-]+$/.test(part));
}

function looksLikeTitle(value: string): boolean {
  return value.length <= 120 && !/\d{4}|compensation|committee/i.test(value);
}

function token(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
