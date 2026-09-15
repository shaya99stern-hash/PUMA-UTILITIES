import type { SourceDefinition } from "./types";

export const SOURCE_REGISTRY: SourceDefinition[] = [
  {
    id: "nyc-acris",
    label: "NYC ACRIS",
    geographies: ["NY", "NYC"],
    authority: "official",
    strategy: "structured",
    capabilities: ["property.identity", "property.owner"],
    reliability: 0.96, evidenceStrength: 0.98, expectedLatencyMs: 450, freshnessDays: 35, maxConcurrency: 6,
    notes: ["Join master, legal and party datasets by document identifiers; use structured endpoints before browser UI."]
  },
  {
    id: "nj-parcel-mod4",
    label: "NJ Parcels + MOD-IV",
    geographies: ["NJ"],
    authority: "official",
    strategy: "structured",
    capabilities: ["property.identity"],
    reliability: 0.94, evidenceStrength: 0.92, expectedLatencyMs: 500, freshnessDays: 120, maxConcurrency: 6,
    notes: ["Public statewide owner names are redacted under Daniel's Law; do not treat missing owner as evidence of no owner."]
  },
  {
    id: "company-first-party-web",
    label: "Company first-party website",
    geographies: ["US"],
    authority: "first-party",
    strategy: "http",
    capabilities: ["company.identity","company.website","company.phone","company.email","company.ownerOperator","company.portfolio","person.decisionMaker","person.title","person.phone","person.email"],
    reliability: 0.86, evidenceStrength: 0.82, expectedLatencyMs: 900, freshnessDays: 45, maxConcurrency: 4
  },
  {
    id: "open-web-discovery",
    label: "Open web discovery",
    geographies: ["US"],
    authority: "discovery-only",
    strategy: "web-discovery",
    capabilities: ["company.identity","company.website","company.phone","company.email","company.ownerOperator","company.portfolio","person.decisionMaker","person.title","person.phone","person.email","property.owner","property.manager","utility.provider","utility.amiCapability"],
    reliability: 0.55, evidenceStrength: 0.40, expectedLatencyMs: 1200, freshnessDays: 14, maxConcurrency: 3,
    notes: ["Discovery results create candidate claims; follow through to authoritative or first-party pages for corroboration."]
  },
  {
    id: "utility-first-party-web",
    label: "Water utility / municipal first-party sources",
    geographies: ["US"],
    authority: "first-party",
    strategy: "http",
    capabilities: ["utility.provider","utility.amiCapability"],
    reliability: 0.90, evidenceStrength: 0.90, expectedLatencyMs: 900, freshnessDays: 60, maxConcurrency: 4,
    notes: ["AMI program capability is not building-specific meter evidence."]
  }
];

export function sourcesForFact(fact: SourceDefinition["capabilities"][number], geography?: string): SourceDefinition[] {
  return SOURCE_REGISTRY.filter((source) =>
    source.capabilities.includes(fact) &&
    (!geography || source.geographies.includes("US") || source.geographies.includes(geography))
  );
}
