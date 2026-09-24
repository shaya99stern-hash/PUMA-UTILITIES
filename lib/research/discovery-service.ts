import {
  aggregateDiscoveryCandidates,
  parseDiscoveryGeographies,
  type DiscoverySearchHit,
} from './discovery-ranking';
import { searchWeb, type WebSearchResponse } from './web-search';

export type DiscoveryInput = {
  geography?: string;
  minBuildings?: number;
  maxBuildings?: number;
  count?: number;
};

export type DiscoveryDiagnostics = {
  attempted: number;
  succeeded: number;
  failed: number;
  backends: Array<WebSearchResponse['backend']>;
};

type SearchFunction = typeof searchWeb;

export async function discoverCompanies(
  input: DiscoveryInput,
  options: { search?: SearchFunction; signal?: AbortSignal } = {},
) {
  const search = options.search ?? searchWeb;
  const markets = parseDiscoveryGeographies(input.geography ?? 'NJ');
  const minBuildings = bounded(input.minBuildings, 20, 1, 1000);
  const maxBuildings = bounded(input.maxBuildings, 100, minBuildings, 5000);
  const count = bounded(input.count, 10, 1, 20);

  const querySpecs = markets.flatMap((geography) => [
    {
      geography,
      query: `real estate owner operator self managed portfolio ${minBuildings} ${maxBuildings} buildings ${geography}`,
    },
    {
      geography,
      query: `multifamily commercial real estate owner principal owns manages portfolio properties ${geography}`,
    },
  ]);

  const settled = await Promise.all(querySpecs.map(async (spec) => {
    try {
      const response = await search(spec.query, {
        limit: Math.min(20, Math.max(10, count * 2)),
        signal: options.signal,
      });
      return { ok: true as const, spec, response };
    } catch {
      return { ok: false as const, spec };
    }
  }));

  const successes = settled.filter(
    (item): item is Extract<(typeof settled)[number], { ok: true }> => item.ok,
  );
  const failures = settled.filter(
    (item): item is Extract<(typeof settled)[number], { ok: false }> => !item.ok,
  );
  const hits: DiscoverySearchHit[] = successes.flatMap(({ spec, response }) =>
    response.results.map((result) => ({ geography: spec.geography, result })),
  );

  return {
    markets,
    queries: querySpecs.map((item) => item.query),
    candidates: aggregateDiscoveryCandidates(hits, count),
    warnings: failures.map((item) => `${item.spec.geography} discovery source was temporarily unavailable.`),
    diagnostics: {
      attempted: querySpecs.length,
      succeeded: successes.length,
      failed: failures.length,
      backends: [...new Set(successes.map((item) => item.response.backend))],
    } satisfies DiscoveryDiagnostics,
    allFailed: successes.length === 0 && failures.length > 0,
  };
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : fallback;
}
