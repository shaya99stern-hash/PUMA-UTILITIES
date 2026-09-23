const DIRECTORY_HOSTS = [
  'linkedin.com','facebook.com','instagram.com','yelp.com','yellowpages.com',
  'zillow.com','apartments.com','loopnet.com','crunchbase.com','bloomberg.com'
];

export type DiscoverySearchHit = {
  geography: string;
  result: { title: string; url: string; snippet?: string };
};

export type DiscoveryCandidate = {
  name: string;
  website: string;
  snippet?: string;
  sourceUrl: string;
  confidence: number;
  score: number;
  hits: number;
  markets: string[];
  reasons: string[];
};

export function parseDiscoveryGeographies(input: string): string[] {
  const values = input
    .toUpperCase()
    .split(/[\s,;|/]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length) return ['NJ'];
  if (values.length > 5) throw new Error('Use at most 5 two-letter state codes.');
  if (values.some((value) => !/^[A-Z]{2}$/.test(value))) throw new Error('Markets must use two-letter state codes.');
  return [...new Set(values)];
}

export function aggregateDiscoveryCandidates(hits: DiscoverySearchHit[], count = 10): DiscoveryCandidate[] {
  const byHost = new Map<string, {
    name: string;
    website: string;
    snippet?: string;
    sourceUrl: string;
    rawScore: number;
    hits: number;
    markets: Set<string>;
    reasons: Set<string>;
  }>();

  for (const hit of hits) {
    let url: URL;
    try { url = new URL(hit.result.url); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!/^https?:$/.test(url.protocol)) continue;
    if (DIRECTORY_HOSTS.some((blocked) => host === blocked || host.endsWith('.' + blocked))) continue;

    const text = `${hit.result.title} ${hit.result.snippet ?? ''}`.toLowerCase();
    const reasons = new Set<string>();
    let signal = 0;
    if (/owner[- ]?operator|owner and operator/.test(text)) {
      signal += 0.28;
      reasons.add('Owner-operator language appears in discovery evidence.');
    }
    if (/owns? and manages?|acquires?.{0,45}owns?.{0,45}manages?/.test(text)) {
      signal += 0.24;
      reasons.add('Owns/manages language appears in discovery evidence.');
    }
    if (/portfolio|properties|buildings|communities/.test(text)) {
      signal += 0.12;
      reasons.add('Portfolio/property language appears in discovery evidence.');
    }
    if (/multifamily|commercial real estate|property management/.test(text)) {
      signal += 0.08;
      reasons.add('Relevant real-estate operating language appears in discovery evidence.');
    }
    if (/reit|fortune 500|global real estate|thousands of properties|nationwide platform/.test(text)) {
      signal -= 0.32;
      reasons.add('Large-enterprise language lowers fit pending deeper qualification.');
    }

    const existing = byHost.get(host);
    if (existing) {
      existing.rawScore += signal;
      existing.hits += 1;
      existing.markets.add(hit.geography);
      for (const reason of reasons) existing.reasons.add(reason);
      if (!existing.snippet && hit.result.snippet) existing.snippet = hit.result.snippet;
      continue;
    }

    byHost.set(host, {
      name: hit.result.title.split(/\s+[|–—-]\s+/)[0]?.trim() || host,
      website: url.origin,
      snippet: hit.result.snippet,
      sourceUrl: hit.result.url,
      rawScore: signal,
      hits: 1,
      markets: new Set([hit.geography]),
      reasons,
    });
  }

  return [...byHost.values()]
    .filter((candidate) => {
      const repetition = Math.min(0.24, Math.max(0, candidate.hits - 1) * 0.08);
      const marketBreadth = Math.min(0.12, Math.max(0, candidate.markets.size - 1) * 0.04);
      const normalized = Math.max(0, Math.min(1, 0.32 + candidate.rawScore + repetition + marketBreadth));
      return candidate.reasons.size > 0 && (candidate.hits >= 2 || normalized >= 0.55);
    })
    .map((candidate) => {
      const repetition = Math.min(0.24, Math.max(0, candidate.hits - 1) * 0.08);
      const marketBreadth = Math.min(0.12, Math.max(0, candidate.markets.size - 1) * 0.04);
      const normalized = Math.max(0, Math.min(1, 0.32 + candidate.rawScore + repetition + marketBreadth));
      return {
        name:candidate.name,
        website:candidate.website,
        snippet:candidate.snippet,
        sourceUrl:candidate.sourceUrl,
        confidence:Math.max(0.35, Math.min(0.9, 0.4 + normalized * 0.5)),
        score:Math.round(normalized * 100),
        hits:candidate.hits,
        markets:[...candidate.markets].sort(),
        reasons:[...candidate.reasons],
      };
    })
    .sort((left, right) => right.score - left.score || right.hits - left.hits || left.name.localeCompare(right.name))
    .slice(0, Math.max(1, Math.min(30, Math.floor(count))));
}
