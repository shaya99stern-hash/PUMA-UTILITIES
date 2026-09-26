# Puma Lead Engine V2 — Architecture Design

Date: 2026-09-24
Status: Approved in conversation; written-spec review required before implementation planning
Branch: `puma/lead-engine-v2`
Base: `main` at `825e93cae4dec93c997dacae19ec9e54e172dfd6`

## 1. Purpose

Puma Utilities must become a real lead-intelligence and CRM system, not a browser-local CRM wrapped around a small number of web searches.

The target product behavior is:

1. Discover many plausible owner/operators, property managers, multifamily owners, and related real-estate organizations.
2. Research each organization across many independent sources.
3. Resolve and deduplicate companies, people, properties, utilities, tariffs, parcels, and contact methods.
4. Preserve exact evidence and provenance for every promoted fact.
5. Rank the best companies, buildings, and decision makers.
6. Spend limited enrichment credits only where they materially improve a high-priority lead.
7. Persist jobs, evidence, CRM state, and source health server-side.
8. Allow Puma to keep working when one search provider, browser source, or enrichment provider fails.
9. Keep all existing evidence discipline: unknown stays unknown; inferred data never masquerades as verified public evidence; manual CRM data is not overwritten by research.

This design replaces the current discovery bottleneck, where production effectively depends on a small number of DuckDuckGo HTML searches and where the browser-enrichment worker exists in source but is not connected to production.

## 2. Current production diagnosis

Observed against the deployed app on 2026-09-24:

- `/api/research/discover` is called successfully from Find Leads.
- The production discovery backend reports `duckduckgo-html`.
- Browser enrichment reports `browserEnrichmentConfigured: false`.
- Find Leads can return HTTP 200 with zero useful candidates and show only `No strong candidates found.`
- The repository already contains a ContactOut-oriented Node/Playwright worker, but that worker is not deployed or connected to production.
- CRM persistence is currently browser `localStorage`; there is no canonical server-side CRM database.
- There is no application authentication layer protecting future server-side CRM/research data.

Therefore the main issue is architectural, not a missing button handler.

## 3. Architectural principles

### 3.1 Hybrid source orchestrator

Puma should never depend on one search engine or one commercial enrichment provider.

Sources are divided into three classes:

- **Official/free evidence backbone** — government, municipal, regulatory, public datasets, first-party company and utility sites.
- **Search/discovery providers** — broad candidate generation and web discovery.
- **Enrichment providers** — people/company/contact data with explicit quota and credit controls.
- **Browser adapters** — dynamic public sites that cannot be read reliably with ordinary HTTP and whose terms permit the intended automation.

### 3.2 Search discovers; evidence verifies

A search result is never a verified company, person, property, or contact fact by itself.

Search creates candidate entities and candidate source URLs. Verification comes from stronger evidence such as official datasets, first-party sites, or reputable enrichment providers with explicit provenance.

### 3.3 Portfolio size is researched downstream

`minBuildings` and `maxBuildings` must not be encoded as literal search-engine keywords and then treated as if snippets prove portfolio size.

The pipeline should discover plausible companies broadly, then research actual portfolio evidence from:

- official property/registration data,
- company portfolio/property pages,
- HUD datasets,
- parcel/assessment records,
- repeated owner/manager relationships,
- structured company/provider datasets.

### 3.4 Cheap/free first; credits last

The engine must maintain source costs and quotas and use the cheapest reliable source first.

Example decision-maker waterfall:

1. official public contact/officer records,
2. company first-party team/leadership pages,
3. zero/low-cost people search,
4. cross-source corroboration,
5. paid email/phone reveal only for the best-ranked people.

### 3.5 Long-running work does not live inside one Vercel request

Vercel remains the UI/control plane and thin API layer.

Research orchestration moves to a separate Node worker capable of long-running jobs, retries, remote browser sessions, and provider-specific throttling.

## 4. Target system topology

```text
PWA / Next.js UI on Vercel
        |
        | authenticated API
        v
Puma API / control plane
        |
        +------------------------+
        |                        |
        v                        v
Postgres canonical store     Provider secrets/config
        |
        | queued research jobs
        v
Node Lead Worker
        |
        +--> official structured adapters
        +--> first-party HTTP crawler
        +--> search providers
        +--> enrichment providers
        +--> remote Playwright/browser provider
        |
        v
Evidence graph + entity resolution + ranking
        |
        v
Canonical CRM / lead records in Postgres
```

## 5. Canonical persistence

### 5.1 Database

Use Postgres as the canonical application store. The implementation plan may choose a managed Postgres service that integrates cleanly with Vercel and the worker; Supabase Postgres is preferred if we want database + authentication in one managed service, while the schema must remain portable Postgres.

`localStorage` becomes only a temporary migration/cache compatibility layer, not the source of truth.

### 5.2 Core tables

Minimum schema groups:

#### CRM

- `workspaces`
- `companies`
- `people`
- `company_people`
- `properties`
- `company_properties`
- `utilities`
- `property_utilities`
- `tariffs`
- `activity_notes`
- `follow_ups`
- `pipeline_events`

#### Research

- `research_runs`
- `research_tasks`
- `research_sources`
- `research_evidence`
- `research_claims`
- `research_entities`
- `entity_aliases`
- `entity_links`
- `source_health_events`

#### Provider control

- `provider_accounts`
- `provider_quota_snapshots`
- `provider_usage_events`
- `provider_backoff_state`

Secrets themselves stay in deployment secret stores, not database rows. Database rows store provider identity, enabled state, quota metadata, and usage counters only.

### 5.3 Local-storage migration

On first authenticated server-backed launch:

1. Read existing browser workspace.
2. Present/import it into the canonical workspace.
3. Deduplicate companies, people, and properties.
4. Preserve `user-entered` provenance.
5. Mark migration complete.
6. Continue to read/write canonical server state thereafter.

No migration step may silently overwrite server records.

## 6. Authentication and access control

A server-backed CRM cannot remain anonymously writable.

Requirements:

- owner-authenticated Puma session,
- all CRM/research write endpoints require a valid session,
- provider tokens never reach browser JavaScript,
- browser worker uses a separate service credential,
- Postgres row access is restricted to the authenticated Puma workspace,
- worker writes use a service role or dedicated DB credential,
- rate-limit expensive research endpoints per workspace.

The first implementation may target a single owner/workspace, but the data model should not hardcode a global singleton.

## 7. Research job model

### 7.1 Job lifecycle

`queued -> running -> partial | completed | failed | cancelled`

A Find Leads request immediately creates a job and returns a `runId`. The UI does not wait for a single 60-second serverless request to finish everything.

### 7.2 Task lifecycle

Each source task independently records:

- source adapter,
- subject entity,
- requested fact/capability,
- attempt count,
- start/finish timestamps,
- cost estimate,
- actual provider usage,
- output entities/evidence/claims,
- retryability,
- failure class,
- next retry time.

One source failing must not discard successful results from other sources.

### 7.3 Worker lease

Workers atomically lease queued tasks with expiry timestamps. Expired leases can be reclaimed after crashes.

This avoids duplicate work and allows one worker today and multiple workers later.

## 8. Provider adapter contract

All providers implement a common contract conceptually equivalent to:

```ts
type ProviderAdapter = {
  id: string;
  kind: 'official' | 'search' | 'enrichment' | 'first-party' | 'browser';
  capabilities: FactCapability[];
  geographies: string[];
  costModel: ProviderCostModel;
  health(): Promise<ProviderHealth>;
  estimate(task): ProviderEstimate;
  execute(task, context): Promise<ProviderResult>;
};
```

`ProviderResult` always includes:

- structured entities,
- claims,
- evidence URLs/source identifiers,
- raw provider IDs where permitted,
- observed timestamp,
- confidence/authority class,
- provider usage/cost metadata,
- warnings and partial failures.

## 9. Source matrix

This is the target adapter universe. Not every adapter must ship in one PR; the implementation plan will stage them. The registry must support all of them cleanly without architecture changes.

### 9.1 Search and candidate discovery

| Source | Role | Cost posture | Notes |
|---|---|---:|---|
| Brave Search API | general web discovery | free monthly credit + metered | Preferred dependable general search backend when configured. |
| Exa Search | semantic company/person/web discovery | free monthly credit + metered | Strong fit for agentic search, people/company queries, and extracting relevant pages. |
| User-controlled SearXNG | metasearch fallback | infrastructure-only | Keep existing support. |
| DuckDuckGo HTML | last-resort fallback | free | Never the only production discovery source. Treat blocking/zero results as source-health degradation. |
| Company first-party sitemap/schema | company/portfolio discovery | free | Crawl bounded same-domain pages and structured data. |
| Hunter Discover | company discovery | currently free-to-search API path | Optional configured provider. |

Search providers create candidates, never verified facts by themselves.

### 9.2 National official/public backbone

| Source | Capabilities |
|---|---|
| SEC EDGAR | company identity, executives/decision makers for filers |
| HUD multifamily active-property datasets | property discovery, portfolio corroboration, multifamily signals |
| HUD FHA-insured multifamily datasets | property/financing corroboration |
| HUD LIHTC database | multifamily property discovery and program context |
| US Census Geocoder | normalized address/geocoding |
| EPA public water system / ECHO web services | water-system identity, compliance/public-system context |
| EPA public water service-area datasets | utility service territory |
| first-party utility websites | utility identity, tariffs, AMI/smart-meter program evidence |
| first-party company websites | company identity, portfolio, leadership, public contacts |

### 9.3 New York / NYC

- NYC ACRIS/Open Data
- NYC HPD Registrations
- NYC HPD Registration Contacts
- NYC PLUTO
- NYC DOF property/rolling-sales datasets where useful for ownership-change signals
- NYC DOB public permit/property datasets when useful for property corroboration
- NYS Public Tax Parcels
- NYS Department of State business entities
- NYS Active Real Estate Salespersons and Brokers public dataset
- NYC energy/water benchmarking datasets where a building can be matched defensibly

### 9.4 New Jersey

- NJ parcel/MOD-IV data
- NJ Division of Revenue business records
- NJDEP public community water-purveyor service areas
- county/municipal assessment/GIS adapters as available
- public professional/license sources where terms and structured access permit use
- state/local benchmarking datasets when a defensible building-level match exists

### 9.5 Pennsylvania

- PA Department of State business entities
- Philadelphia OPA
- Philadelphia energy/water benchmarking datasets
- Bucks County parcel adapter
- county-specific parcel/assessment adapters added behind a common Pennsylvania county interface, including Montgomery, Delaware, Chester, Allegheny, and other priority counties as structured/public access permits
- PADEP public water supplier service areas
- state professional/license sources where appropriate

### 9.6 People/contact enrichment

| Provider | Intended use | Credit policy |
|---|---|---|
| Apollo People Search | identify likely people by company/title | Prefer search before enrichment; current People Search documents 0-credit search. |
| Apollo People Enrichment | reveal/complete high-priority people | Spend only after ranking; record provider-reported usage. |
| Apollo Organization Search/Enrichment | company corroboration | Use selectively because organization search/enrichment can consume credits. |
| ContactOut People/Decision Makers | identify decision makers and optional contact reveal | Official API only when credentials/access permit. No scraping or bypass of restricted data. |
| ContactOut manual/free-credit assist | reveal a small number of top-ranked contacts | User-controlled reveal; Puma records provenance and never automates around a credit gate. |
| Hunter Discover | company discovery | Search can be used before paid contact lookup. |
| Hunter Domain Search / Email Finder | work email discovery | Spend only for ranked people/domains; duplicate lookups should be cached. |
| Hunter Email Verifier | deliverability verification | Use after an address exists; do not verify every speculative pattern. |

Provider prices/quotas change. The quota engine must use configured/current provider metadata rather than hardcoding marketing-plan assumptions into business logic.

### 9.7 Optional future enrichment adapters

The registry should allow additional providers such as People Data Labs, RocketReach, Crunchbase, or other licensed datasets without changing core entity/evidence logic. These remain disabled until credentials, cost, and allowed usage are explicitly configured.

## 10. ContactOut design

ContactOut is a first-class connector, but not a scraping target.

### 10.1 API mode

When `CONTACTOUT_API_TOKEN` is configured and the account has endpoint access:

- company search,
- people search,
- decision-maker lookup,
- people enrichment,
- optional contact reveal,
- API usage/remaining-credit checks where exposed.

The adapter must distinguish a profile result from revealed contact data.

### 10.2 Assisted-credit mode

When the user has ordinary ContactOut credits but no suitable API access:

1. Puma ranks likely decision makers using other sources.
2. UI shows `Reveal externally` only on the best candidates.
3. User performs the reveal in ContactOut.
4. Puma accepts pasted/imported contact data and records `ContactOut` provenance as user-authorized imported evidence.

Puma must not automate clicking credit-gated reveal controls or bypass authentication/paywalls.

### 10.3 Cross-reference mode

A name/title discovered elsewhere may be cross-referenced through permitted sources without revealing contact data. A ContactOut profile/name is not promoted as first-party truth by itself; first-party or official corroboration raises confidence.

## 11. Apollo design

Apollo is used as a quota-aware identity/enrichment provider, not the canonical CRM.

Preferred sequence:

1. Resolve company domain through first-party/search evidence.
2. Use People Search for roles such as owner, principal, president, COO, operations, facilities, property management, asset management, regional manager, director/VP operations.
3. Rank returned people before enrichment.
4. Enrich only the top candidates that are missing actionable contact data.
5. Store Apollo IDs and observed timestamps for deduplication/re-use.

Do not automatically request mobile phone waterfalls for every person.

## 12. Hunter design

Hunter is the primary email-specific fallback after person identity and company domain are known.

Sequence:

1. Domain/Discover can expose company/person signals.
2. Email Finder is used only for named, ranked people.
3. Email Verifier is used on an existing candidate address.
4. Cache repeated provider results for the applicable billing period where allowed.
5. Never promote an inferred email pattern to verified merely because it matches a format.

## 13. Browser / Playwright subsystem

### 13.1 Purpose

Browser automation exists for public dynamic pages that cannot be handled reliably by normal HTTP and whose terms permit the intended automation.

It is **not** a general anti-bot/paywall bypass layer.

### 13.2 Runtime

Replace the current ContactOut-specific `chromium.launch()` worker architecture with a generic browser adapter host.

Preferred production browser backend:

- Node worker uses `playwright-core`.
- Connect to Browserless through `chromium.connectOverCDP()` or native Playwright protocol when the adapter needs route interception.
- Local development may launch local Chromium.
- Cloudflare Browser Rendering may be supported later through the same browser-provider abstraction.

The worker remains independent of the Next.js deployment so Vercel does not need Chromium binaries.

### 13.3 Browser adapter rules

Every browser adapter declares:

- allowed hostnames,
- whether authentication is permitted,
- whether a user-owned authenticated session is required,
- robots/terms notes,
- maximum pages,
- maximum wall time,
- navigation allowlist,
- fields it may extract,
- whether persistent cookies/profile are permitted.

Default policy:

- public pages only,
- no CAPTCHA bypass as a default behavior,
- no paywall bypass,
- no hidden/restricted contact reveal,
- no automated actions that consume credits unless the provider adapter explicitly supports and budgets them.

### 13.4 Browser source examples

Appropriate examples include:

- JS-rendered public company portfolio/team pages,
- public county GIS viewers lacking a usable structured endpoint after one has been searched for,
- public utility tariff/program pages requiring client-side rendering.

ContactOut website scraping is excluded; use its official API or assisted workflow.

## 14. Entity resolution

### 14.1 Company identity

Strong match keys, in descending order:

1. verified official entity ID + jurisdiction,
2. confirmed domain,
3. normalized legal name + official address,
4. normalized operating name + domain/corroborating geography,
5. fuzzy name match only as a candidate link.

Never merge companies solely because names are similar.

### 14.2 People identity

Strong match keys:

1. provider/official stable person ID,
2. exact work email,
3. first-party profile URL,
4. normalized name + same company + corroborating title/location.

A common name alone never causes an automatic merge.

### 14.3 Property identity

Prefer:

1. parcel/BBL/APN + jurisdiction,
2. normalized address + geocode,
3. official property ID,
4. fuzzy address only as candidate.

### 14.4 Evidence-safe conflicts

Conflicting facts remain separate claims. Promotion uses source authority, recency, corroboration, and evidence strength.

Manual `user-entered` values remain protected from automatic overwrite. Research may create a competing verified claim without rewriting the manual value silently.

## 15. Evidence model

Every promoted fact must be traceable to evidence.

Evidence includes:

- source adapter ID,
- source URL or official record identifier,
- observed timestamp,
- authority class,
- excerpt/structured payload hash where appropriate,
- provider entity ID,
- confidence,
- whether data was public, client-authorized, user-entered, or provider-enriched.

Provider-enriched contact data is not relabeled `verified-public` unless the underlying source really supports that classification.

## 16. Lead funnel

### Stage A — Candidate generation

Generate a broad pool from multiple discovery sources. Example target for a request asking for 20 leads: 100–300 candidate organizations before qualification.

### Stage B — Company resolution

Resolve:

- legal/operating identity,
- website/domain,
- geography,
- broad real-estate role,
- obvious disqualifiers.

### Stage C — Portfolio research

Collect property relationships and portfolio evidence. Estimate/verify portfolio size only from actual evidence.

### Stage D — Fit scoring

Fit features may include:

- multifamily/residential exposure,
- target geography,
- approximate portfolio size,
- self-managed/owner-operator signal,
- property-management responsibility,
- number of verified properties,
- water-utility resolvability,
- company scale penalties if outside ICP.

### Stage E — Decision-maker research

Find/rank people using official, first-party, and enrichment sources.

### Stage F — Contact enrichment

Spend limited credits only on the top-ranked people for top-ranked companies.

### Stage G — Water opportunity intelligence

For top buildings, resolve:

- water provider/service area,
- published tariff/rates,
- AMI/smart-meter program capability,
- defensible benchmark signals,
- unresolved evidence gaps.

### Stage H — CRM save

The research run updates one canonical Company and related records idempotently.

## 17. Lead scoring

Separate scores instead of one opaque number:

- `fitScore` — how closely the company matches ICP.
- `evidenceScore` — confidence/coverage of verified facts.
- `contactabilityScore` — quality of available decision-maker routes.
- `waterOpportunityScore` — quality of utility/building opportunity evidence.
- `priorityScore` — final action priority derived from the above.

Every score exposes its reasons; there is no black-box score without explanation.

## 18. Quota and cost engine

Each provider declares units and current configured budget.

Example dimensions:

- requests,
- search credits,
- enrichment credits,
- email credits,
- phone credits,
- browser minutes/units.

The engine must support:

- per-run budget,
- daily budget,
- monthly budget,
- reserve threshold,
- `free-only` mode,
- `allow-email-enrichment` mode,
- `allow-phone-enrichment` mode,
- explicit manual override.

Before a costly task, the scheduler asks whether expected information gain justifies the provider cost.

Provider usage is recorded after every call so the UI can show where credits were spent.

## 19. Source health and observability

Puma must visibly distinguish:

- source succeeded with results,
- source succeeded with zero results,
- rate limited,
- authentication missing,
- credit exhausted,
- blocked/terms-disabled,
- timeout,
- parser/schema changed,
- upstream 5xx,
- worker unavailable.

The UI should never collapse these into `No strong candidates found.`

Source Health screen/status data should expose:

- enabled/disabled,
- last success,
- last failure,
- rolling success rate,
- median latency,
- recent error class,
- quota remaining if known.

## 20. Find Leads V2 UX

### 20.1 Search form

Primary fields:

- markets,
- target company/operator type,
- desired lead count.

Advanced:

- approximate min/max portfolio size,
- multifamily/residential emphasis,
- owner/operator vs third-party manager,
- free-only vs enrichment-enabled,
- minimum evidence threshold.

### 20.2 Live run view

A run displays funnel progress, for example:

```text
214 candidates discovered
143 company identities resolved
82 relevant real-estate operators
47 portfolio evidence found
29 fit size/geography criteria
24 decision-maker research complete
20 ranked leads ready
```

Beside it, source status shows which collectors are running/degraded.

### 20.3 Lead result card

Every lead card includes:

- company,
- target markets,
- fit score,
- evidence score,
- verified/estimated portfolio size,
- count of linked properties,
- top decision makers,
- best available contact route,
- water opportunity summary,
- exact reasons it ranked,
- source/evidence drill-down,
- unresolved gaps,
- `Open company`, `Research deeper`, and `Save/Update` actions.

## 21. CRM integration

Puma remains the CRM.

Research updates the same canonical Company rather than exporting to a separate CRM product.

Company detail must be able to show:

- research freshness,
- evidence provenance,
- linked properties,
- people and ranked roles,
- contact methods and verification state,
- utilities/tariffs,
- research history,
- source failures/gaps,
- activities/follow-ups.

Manual CRM edits and evidence-backed research claims remain distinguishable.

## 22. Monitoring and refresh

The same job system supports refresh jobs later:

- stale company refresh,
- leadership change detection,
- new property/portfolio evidence,
- utility/tariff refresh,
- water-program changes,
- client-authorized monitoring.

Research refresh should be incremental and source-aware rather than rerunning every source blindly.

## 23. Failure behavior

### Discovery source failure

Continue with remaining sources and show degraded-source warning.

### Enrichment provider unavailable

Keep the person/company lead with a weaker contactability score; do not drop the lead.

### Browser worker unavailable

HTTP/structured/API sources continue. Browser-only tasks remain retryable and visible.

### Credit exhausted

Mark the provider budget-exhausted and continue free sources. Never silently charge another provider without configured permission.

### Conflicting data

Store competing claims and expose the conflict; do not guess.

## 24. Security and compliance boundaries

- Keep provider tokens server-side.
- Encrypt/seal secrets in deployment secret storage.
- Validate all outbound URLs against SSRF/private-network rules.
- Restrict browser adapters to declared host allowlists.
- Do not automate prohibited paywall, CAPTCHA, or credit-gate bypass.
- Do not scrape ContactOut web pages; use official API or user-assisted import.
- Respect provider rate limits and account-level restrictions.
- Store the minimum necessary personal contact data for legitimate business lead workflow.
- Keep a provenance trail for contact data and deletion/update capability.

## 25. API surface

Illustrative control-plane endpoints:

- `POST /api/lead-runs` — create Find Leads run
- `GET /api/lead-runs/:id` — status/funnel/results
- `POST /api/lead-runs/:id/cancel`
- `POST /api/companies/:id/research` — deeper company run
- `GET /api/providers/status`
- `POST /api/providers/:id/test` — authenticated health test
- `GET /api/companies/:id/evidence`
- `POST /api/companies/:id/enrich-person/:personId` — budget-aware explicit enrichment

Long tasks are worker jobs; these endpoints do not perform the entire crawl synchronously.

## 26. Worker packages

Target repo structure:

```text
lib/lead-engine/
  adapters/
  scheduler/
  quota/
  entity-resolution/
  scoring/
  persistence/
  evidence/
workers/lead-engine/
  server.mjs or TypeScript entrypoint
  browser/
  jobs/
```

Existing `lib/research/*` algorithms should be reused/migrated where sound rather than discarded.

The current `workers/browser-research` code becomes either part of the generic lead worker/browser package or is retired after migration.

## 27. Testing strategy

### Unit

- source normalization,
- entity matching,
- conflict handling,
- evidence promotion,
- scoring,
- provider cost calculation,
- quota decisions,
- retry classification.

### Adapter contract

Each adapter gets deterministic fixture tests so parser/provider changes are visible.

### Integration

- mock Postgres + worker lease lifecycle,
- partial provider failure,
- zero-result vs provider-failed distinction,
- idempotent CRM save,
- manual-data protection,
- provider credit exhausted behavior,
- browser-worker unavailable behavior.

### End-to-end

A synthetic Find Leads run must demonstrate:

1. multi-source candidate generation,
2. company resolution,
3. portfolio evidence,
4. decision-maker ranking,
5. optional enrichment,
6. persistent CRM result,
7. evidence drill-down.

Tests must never depend on consuming real paid credits.

## 28. Delivery slices

The implementation plan should stage this architecture so each merged PR is useful.

Recommended sequence:

### Slice 1 — Backend foundation

- authentication,
- Postgres schema,
- workspace migration,
- research job/task persistence,
- provider registry/health/quota interfaces,
- worker skeleton.

### Slice 2 — Real discovery fan-out

- Brave/Exa/SearXNG/DDG provider abstraction,
- HUD + existing official source candidate discovery,
- proper candidate funnel,
- live run status UI.

### Slice 3 — Portfolio/entity intelligence

- portfolio/property expansion,
- official property adapters,
- entity-resolution persistence,
- fit/evidence scoring.

### Slice 4 — People and contact waterfall

- Apollo connector,
- ContactOut API connector and assisted mode,
- Hunter connector,
- decision-maker scoring,
- quota-aware explicit reveals.

### Slice 5 — Generic Playwright worker

- Browserless-backed Playwright provider,
- dynamic permitted-site adapters,
- browser source health and retry controls.

### Slice 6 — Full CRM and water-opportunity integration

- server-backed company detail,
- property/utility/tariff evidence,
- research history,
- refresh jobs,
- final localStorage compatibility removal after migration confidence.

## 29. Acceptance criteria

Lead Engine V2 is successful when all of the following are true:

1. Find Leads no longer depends on one HTML search backend.
2. A single broken provider cannot reduce a healthy run to an unexplained empty state.
3. Puma can generate a broad candidate pool and research portfolio size downstream.
4. The UI shows live funnel progress and source health.
5. ContactOut is actually connected through an allowed integration path when credentials/access exist.
6. Apollo/Hunter/ContactOut spending is quota-aware and visible.
7. Browser automation runs outside Vercel and is generic, bounded, and policy-aware.
8. Research/CRM data survives devices and browser storage loss.
9. Re-running research updates existing entities idempotently.
10. Manual data is not silently overwritten by research.
11. Every promoted fact can be drilled back to evidence/provenance.
12. A lead remains useful even when paid contact enrichment is unavailable.
13. Companies, people, properties, utilities, and tariffs are cross-referenced rather than stored as disconnected search results.
14. Tests and CI cover partial failure, quotas, evidence integrity, and persistence.

## 30. Current external provider notes captured for planning

These are planning observations as of 2026-09-24 and must be rechecked at implementation time because provider plans change:

- Apollo documents People API Search as a zero-credit endpoint; organization search consumes credits per page and enrichment can consume credits depending on returned data.
- ContactOut exposes official People Search, People Enrich, Decision Makers, Company Search, contact-availability/reveal functionality, and usage endpoints; access and credit behavior vary by account/endpoint.
- Hunter currently exposes Discover, Domain Search, Email Finder, Email Verifier, and enrichment APIs and advertises a free monthly credit allowance.
- Brave Search API currently advertises monthly free credits and a metered search API.
- Exa currently advertises free monthly credits and search/company/people-oriented search use cases.
- Browserless supports remote Playwright through `playwright-core` and `chromium.connectOverCDP()` so the Puma worker does not need local Chromium binaries in the Vercel app.

These facts are provider configuration inputs, not assumptions hardcoded into Puma logic.

## 31. Non-goals

- Do not build a mass-email sequencer in this phase.
- Do not clone Apollo or ContactOut UI.
- Do not fabricate portfolio counts from snippets.
- Do not infer emails and label them verified without evidence.
- Do not automate prohibited authentication/paywall/contact-credit bypass.
- Do not make one commercial provider mandatory for basic Puma usefulness.
- Do not discard the existing research graph/evidence work that already functions correctly.

## 32. Design decision summary

Lead Engine V2 is a **persistent, multi-source, quota-aware research orchestration system**.

Vercel serves the Puma UI and authenticated control plane. Postgres stores canonical CRM/research state. A separate Node worker executes long-running research. Search providers generate candidates; official/first-party sources verify them; enrichment providers add ranked people/contact data; permitted dynamic sources use a generic remote Playwright layer. Every result passes through shared entity resolution, evidence, cost, and ranking logic before it reaches the CRM.

The system is intentionally designed so adding source number 30 does not require rewriting the engine.