# Puma Research Engine V1

## Objective

Turn Puma from a seeded CRM/search UI into an evidence-backed prospect intelligence engine for multifamily owner/operators and property managers.

A search must be able to begin with an incomplete company, person, property, address, parcel, LLC, domain, phone, or email and iteratively resolve the missing relationships until the dossier is actionable or the research budget is exhausted.

## Core rule

**A missing field creates a research task; it does not terminate the lead.**

Puma must distinguish verified facts, supported inferences, conflicts, and unresolved fields. Every material fact keeps provenance.

## Target dossier

- company legal/display name, website/domain, business phones and published business emails
- company type and owner/operator vs third-party manager classification
- portfolio size/range, property addresses and geography
- ownership entities/LLCs and their relationships to the operating company
- principals, owners, executives and the best decision-maker(s) for Puma outreach
- public business contact routes for those decision-makers
- parcel/building identifiers and evidence
- water utility/service territory
- utility AMI/smart-meter program capability
- building-specific meter status only when actually evidenced
- Puma fit score, confidence, contradictions and unresolved questions

## Architecture

1. **Query Interpreter** — natural language to explicit filters and target count.
2. **Discovery Planner** — chooses high-yield discovery sources by geography and requested facts.
3. **Source Registry** — capabilities, geography, authority, reliability, latency, access method, rate policy, freshness and parser version.
4. **Fetch Layer** — structured public endpoints first; HTTP HTML second; browser/Playwright only when rendering is necessary.
5. **Extractor** — converts source observations into typed entities, claims and relationships.
6. **Entity Resolver** — deduplicates companies/people/properties and links LLCs, addresses, domains and portfolios without silently merging ambiguous entities.
7. **Research Graph** — stores entities + relationships + unresolved facts.
8. **Task Planner** — converts unresolved high-value facts into follow-up source/search tasks and recursively enriches.
9. **Evidence Engine** — provenance, confidence, freshness, corroboration and contradictions.
10. **Qualification + Scoring** — hard gates first, then rank surviving prospects by Puma fit.
11. **CRM Writer** — persists selected dossiers without destroying source evidence.

## Acquisition ladder

Use the cheapest defensible route that can answer the question:

1. public JSON/OData/Socrata/ArcGIS/CSV/bulk data
2. direct HTTP + HTML parsing
3. structured markup / embedded JSON
4. general web discovery followed by direct fetch of promising pages
5. Playwright for JS-rendered or interactive public pages
6. unresolved/manual when access is blocked, requires authentication, CAPTCHA bypass, or is not appropriate to automate

Do not repeatedly attack blocked sources. Record source health and route around failures.

## Source selection

Each source declares:

- facts/capabilities it can resolve
- geography
- authority: official / first-party / reputable-secondary / discovery-only
- expected latency
- reliability
- evidence strength
- freshness expectation
- fetch strategy
- concurrency/rate policy
- terms/access notes

The planner should rank a source approximately by:

`expected_information_gain * authority * reliability * evidence_strength / expected_cost`

and fan out independent high-value tasks concurrently.

## Research loop

```
seed -> normalize -> create unresolved facts
     -> plan source tasks
     -> fetch in bounded concurrent batches
     -> extract observations
     -> resolve entities/relationships
     -> update evidence/conflicts
     -> recompute unresolved high-value facts
     -> plan follow-ups
     -> stop when dossier threshold, target count, time budget,
        source exhaustion, or diminishing information gain is reached
```

A newly discovered LLC, domain, executive, address, registered address, management company or property may create additional research tasks.

## Evidence states

- VERIFIED: authoritative evidence or strong independent corroboration
- SUPPORTED: credible evidence but not enough for verified
- INFERRED: relationship derived from evidence; inference is explicit
- CONFLICTED: credible sources disagree
- UNRESOLVED: insufficient evidence

Never promote "utility has an AMI program" into "building has a smart meter." These are separate claims.

## Initial source families

### New York / NYC
- NYC ACRIS master, legal and party datasets
- NYC HPD registration/building datasets
- NYC DOF/property datasets
- applicable state/county corporate, assessment and land-record sources
- company websites and public business pages
- utility/municipal water program and service-territory sources

### New Jersey
- NJGIN statewide parcel/MOD-IV composite and municipal/county assessment sources
- county/municipal property and land-record sources as needed
- state business/entity sources
- company websites and public business pages
- water utility/municipal and regulatory service-territory/program sources

Important: statewide NJ public parcel products redact owner names under Daniel's Law. The engine must not assume OWNER_NAME exists; it must route unresolved ownership to other lawful public sources and retain the redaction limitation as provenance.

### Pennsylvania
- county assessment/parcel and recorder sources through county adapters
- state business/entity sources
- company websites and public business pages
- water utility/municipal and regulatory sources

## Contact intelligence

Decision-maker resolution is a first-class objective, not an afterthought.

Prioritize roles such as owner, founder, principal, managing principal, president, CEO, COO, head of property management, asset-management leadership, facilities/operations leadership, and other roles appropriate to the company's size.

Only store contact information obtained from legitimate public/business sources. Each email/phone must keep its source and verification state. Pattern-generated emails remain inferred until independently supported.

## Portfolio reconstruction

Portfolio size must be evidence-backed and may be a range.

Signals may include:
- explicit company portfolio pages
- repeated ownership/management relationships
- common business/registered/mailing addresses
- common domains and phones
- public building registrations
- parcel/deed relationships
- credible first-party announcements

Shared addresses alone are not sufficient to merge entities.

## Utility intelligence

Model separately:
- utility/service provider
- service-territory confidence
- AMI/smart-meter program capability
- building-specific meter evidence
- client-authorized telemetry connection

The prospect engine may research the first four only from lawful/public evidence. Actual customer usage/leak monitoring belongs to the authorized client-monitoring subsystem.

## Execution model

Borrow the proven Property Scout pattern:
- discovery and enrichment are separate
- bounded resumable chunks
- candidate/entity deduplication before expensive enrichment
- concurrency limits per source/domain
- checkpoints and retries
- source health/degradation
- hard gates before scoring
- evidence-backed explainable dossiers

For Puma, generalize this from a one-way property pipeline into a recursive entity/relationship research graph.

## V1 acceptance test

For NJ/NY/PA, a user can request a target prospect profile and Puma:

1. discovers real candidate companies,
2. resolves owner/operator/manager classification where evidence permits,
3. reconstructs useful portfolio information,
4. identifies appropriate decision-makers,
5. finds sourced public business contact routes where available,
6. maps properties/service areas to water utilities,
7. distinguishes utility AMI capability from building-specific meter evidence,
8. shows sources/confidence/conflicts/unknowns,
9. ranks prospects with an explainable Puma score,
10. saves selected dossiers to CRM.

The engine must remain useful when some fields cannot be resolved; unknown is an acceptable result, fabricated certainty is not.
