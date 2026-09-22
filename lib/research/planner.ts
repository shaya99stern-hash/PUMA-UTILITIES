import { sourcesForFact } from "./source-registry";
import type { PlannedSource, ResearchNeed, SourceDefinition } from "./types";

const AUTHORITY = { official: 1, "first-party": 0.9, "reputable-secondary": 0.72, "discovery-only": 0.48 } as const;

export function sourceCostUnits(source: Pick<SourceDefinition, 'strategy'>): number {
  return source.strategy === 'structured' ? 1
    : source.strategy === 'http' ? 1.6
      : source.strategy === 'web-discovery' ? 2.2
        : 4.5;
}

export function sourceUtility(source: SourceDefinition, need: ResearchNeed): number {
  const latencyPenalty = Math.max(1, Math.log2(source.expectedLatencyMs + 2));
  const freshness = Math.max(0.35, Math.min(1, 90 / Math.max(1, source.freshnessDays)));
  const effortPenalty = Math.sqrt(sourceCostUnits(source));
  return (need.importance * AUTHORITY[source.authority] * source.reliability * source.evidenceStrength * freshness) / (latencyPenalty * effortPenalty);
}

export function planResearch(needs: ResearchNeed[], perNeed = 5): PlannedSource[] {
  return needs.flatMap((need) =>
    sourcesForFact(need.fact, need.geography)
      .map((source) => ({
        source,
        need,
        utility: sourceUtility(source, need),
        reason: `${source.label} can resolve ${need.fact} with ${source.authority} evidence`
      }))
      .sort((a, b) => b.utility - a.utility)
      .slice(0, perNeed)
  ).sort((a, b) => b.utility - a.utility);
}
