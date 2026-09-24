# Puma Research + Monitor Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Puma’s existing discovery/research backend, make research saves explicit and evidence-safe, and make authorized Monitor alerts drill into their exact building context without changing the product architecture.

**Architecture:** Keep the existing Next.js App Router, research graph/runner, local `Workspace`, and `buildMonitorAlerts` authorization boundary. Add one injectable discovery service so partial upstream failures can be tested without network dependence, strengthen the existing graph-to-workspace merge where verified research collides with manual CRM data, then wire compact diagnostics/save summaries into the existing V4 UI.

**Tech Stack:** Node >=20.9.0, TypeScript 5.9.2, Next.js 16.2.12, React 19.2.3, `tsx --test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-24-research-monitor-hardening-design.md`

## Global Constraints

- Do not replace the research graph or runner architecture.
- Do not add fabricated web scraping, contact guessing, or fake integrations.
- Do not auto-save research into CRM.
- Do not treat missing, blocked, redacted, ambiguous, or unavailable source data as a negative finding.
- Do not allow public research evidence to enter client-authorized monitoring.
- Do not redesign the entire Puma shell or CRM in this phase.
- Do not introduce a new external database or deployment dependency.
- Only `VERIFIED`/`SUPPORTED` research claims at the existing confidence threshold may project to `verified-public` CRM facts.
- Only Client-stage companies with `client-authorized` readings may produce Monitor alerts.
- Preserve existing request-size, task-count, crawl-depth, concurrency, result-count, and research-budget bounds.

## Review Focus

1. **One discovery query fails while others work:** return candidates from successful searches plus a warning; never fail the whole request. Covered in Task 1.
2. **Every discovery query fails:** return an operational error, not an empty “no companies found” success. Covered in Task 1.
3. **Verified research matches a manually entered contact/property:** keep the manual value/status manual; never silently relabel it `verified-public`. Covered in Task 2.
4. **The same research is saved twice:** second save must create zero duplicate company/contact/property/utility/parcel/tariff records. Covered in Task 2.
5. **An alert points at one property while another property exists:** render/link only the alert’s own `companyId` + `propertyId` and authorized meter/read-period context. Covered in Task 4.

---

### Task 1: Partial-failure-tolerant discovery service

**Files:**
- Create: `lib/research/discovery-service.ts`
- Modify: `app/api/research/discover/route.ts`
- Create: `tests/research-monitor-hardening.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parseDiscoveryGeographies`, `aggregateDiscoveryCandidates`, `searchWeb(query, { limit, signal })`.
- Produces: `discoverCompanies(input, options)` returning `{ markets, queries, candidates, warnings, diagnostics, allFailed }`.
- HTTP route returns `502` only when every attempted search failed; partial success remains `200` with warnings.

- [ ] **Step 1: Add the new focused test to `npm test`**

Insert `tests/research-monitor-hardening.test.ts` immediately after `tests/research-productization.test.ts` in the existing `test` script in `package.json`.

- [ ] **Step 2: Write failing discovery-service tests**

Create `tests/research-monitor-hardening.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { discoverCompanies } from '../lib/research/discovery-service';

const hit = {
  title: 'Reliable Property Group | Portfolio',
  url: 'https://reliable.example/portfolio',
  snippet: 'Owner-operator multifamily portfolio. Owns and manages communities.',
};

test('discovery keeps successful candidates when one query fails', async () => {
  let calls = 0;
  const outcome = await discoverCompanies(
    { geography: 'NJ, NY', minBuildings: 20, maxBuildings: 100, count: 10 },
    {
      search: async (query) => {
        calls += 1;
        if (calls === 1) throw new Error('temporary upstream failure');
        return { query, results: [hit], backend: 'duckduckgo-html' as const };
      },
    },
  );

  assert.equal(outcome.diagnostics.attempted, 4);
  assert.equal(outcome.diagnostics.succeeded, 3);
  assert.equal(outcome.diagnostics.failed, 1);
  assert.equal(outcome.warnings.length, 1);
  assert.equal(outcome.allFailed, false);
  assert.ok(outcome.candidates.some((candidate) => candidate.website === 'https://reliable.example'));
});

test('discovery reports all searches failed instead of pretending no candidates exist', async () => {
  const outcome = await discoverCompanies(
    { geography: 'NJ', minBuildings: 20, maxBuildings: 100, count: 10 },
    { search: async () => { throw new Error('upstream unavailable'); } },
  );

  assert.equal(outcome.diagnostics.attempted, 2);
  assert.equal(outcome.diagnostics.succeeded, 0);
  assert.equal(outcome.diagnostics.failed, 2);
  assert.equal(outcome.candidates.length, 0);
  assert.equal(outcome.allFailed, true);
});

test('discovery route maps all-failed outcome to a 502 response', () => {
  const source = readFileSync(new URL('../app/api/research/discover/route.ts', import.meta.url), 'utf8');
  assert.match(source, /outcome\.allFailed/);
  assert.match(source, /status:\s*502/);
  assert.match(source, /Lead discovery sources are temporarily unavailable/);
});
```

- [ ] **Step 3: Run the focused test and confirm the intended red state**

Run:

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected: FAIL because `lib/research/discovery-service.ts` does not exist and the route does not yet contain the all-failed branch.

- [ ] **Step 4: Implement the injectable discovery service**

Create `lib/research/discovery-service.ts`:

```ts
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
```

The service intentionally discards raw exception text from the browser-facing result. Search failure is operational state, not business evidence.

- [ ] **Step 5: Replace route fanout with the service**

Keep `MAX_BODY_BYTES`, request parsing, cache headers, and invalid-market handling. Replace the route’s direct `Promise.all(searchWeb(...))` fanout with:

```ts
import { discoverCompanies } from '@/lib/research/discovery-service';

const outcome = await discoverCompanies({
  geography: typeof input.geography === 'string' ? input.geography : 'NJ',
  minBuildings: input.minBuildings as number | undefined,
  maxBuildings: input.maxBuildings as number | undefined,
  count: input.count as number | undefined,
}, { signal: request.signal });

if (outcome.allFailed) {
  return NextResponse.json({
    error: 'Lead discovery sources are temporarily unavailable.',
    warnings: outcome.warnings,
    diagnostics: outcome.diagnostics,
  }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
}

return NextResponse.json({
  ...outcome,
  note: 'Discovery ranks repeated first-party domains across the selected markets. Discovery score is only a routing signal; deep research still verifies portfolio size, ownership/management, contacts, property facts, utilities and rates.',
}, { headers: { 'Cache-Control': 'no-store' } });
```

Delete the route-local `bounded()` helper after the service owns those bounds.

- [ ] **Step 6: Run Task 1 tests**

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected: all three Task 1 tests PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add package.json tests/research-monitor-hardening.test.ts lib/research/discovery-service.ts app/api/research/discover/route.ts
git commit -m "feat: harden lead discovery failures"
```

---

### Task 2: Idempotent, manual-data-safe research projection

**Files:**
- Modify: `tests/research-monitor-hardening.test.ts`
- Modify: `lib/research/workspace-projection.ts`

**Interfaces:**
- Consumes: `mergeResearchRunIntoWorkspace(workspace, result)` and current `EvidenceStatus`, including `user-entered`.
- Produces: stable `companyId`, zero duplicate additions on repeat save, and preservation of matching manual contact/property fields.

- [ ] **Step 1: Add a complete projection fixture**

Append these imports and helper to `tests/research-monitor-hardening.test.ts`:

```ts
import { addClaim, addEvidence, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { emptyWorkspace } from '../lib/workspace';
import { mergeResearchRunIntoWorkspace } from '../lib/research/workspace-projection';
import type { ResearchRunResult } from '../lib/research/runner';

function projectionResult(): ResearchRunResult {
  const graph = createResearchGraph();
  upsertEntity(graph, {
    id: 'company:stable',
    kind: 'company',
    label: 'Stable Property Group',
    geography: 'NJ',
  });
  upsertEntity(graph, {
    id: 'person:stable',
    kind: 'person',
    label: 'Jane Owner',
    geography: 'NJ',
  });
  upsertEntity(graph, {
    id: 'property:stable',
    kind: 'property',
    label: '10 Main St, Newark, NJ 07102',
    geography: 'NJ',
    aliases: ['NJ PAMS 07102-0001'],
  });
  upsertEntity(graph, {
    id: 'utility:stable',
    kind: 'utility',
    label: 'Newark Water',
    geography: 'NJ',
  });

  const evidence = addEvidence(graph, {
    id: 'evidence:stable',
    sourceId: 'company-first-party-web',
    url: 'https://stable.example/portfolio',
    observedAt: '2026-09-24T10:00:00.000Z',
    authority: 'first-party',
    confidence: 0.92,
    excerpt: 'Jane Owner; 10 Main St; Newark Water.',
  });

  const trusted = {
    state: 'SUPPORTED' as const,
    confidence: 0.9,
    evidenceIds: [evidence.id],
    observedAt: '2026-09-24T10:00:00.000Z',
  };

  addClaim(graph, { id:'website', subjectId:'company:stable', fact:'company.website', value:'https://stable.example', ...trusted });
  addClaim(graph, { id:'dm', subjectId:'company:stable', fact:'person.decisionMaker', objectEntityId:'person:stable', ...trusted });
  addClaim(graph, { id:'role', subjectId:'person:stable', fact:'person.title', value:'Owner', ...trusted });
  addClaim(graph, { id:'manager', subjectId:'property:stable', fact:'property.manager', objectEntityId:'company:stable', ...trusted });
  addClaim(graph, { id:'units', subjectId:'property:stable', fact:'property.units', value:88, ...trusted });
  addClaim(graph, { id:'provider', subjectId:'property:stable', fact:'utility.provider', objectEntityId:'utility:stable', ...trusted });
  addClaim(graph, { id:'rate', subjectId:'utility:stable', fact:'utility.rateSchedule', value:'Residential water rate effective 2026: $8.00 per 1,000 gallons', ...trusted });

  return {
    graph,
    rootEntityId: 'company:stable',
    tasksExecuted: 7,
    complete: 7,
    blocked: 0,
    failed: 0,
    results: [],
    rootCompleteness: 0.8,
    budgetUnitsSpent: 12,
    maxBudgetUnits: 82,
    stopReason: 'source-exhausted',
  };
}
```

- [ ] **Step 2: Add the repeat-save idempotency test**

```ts
test('saving equivalent research twice preserves identities and creates no duplicate records', () => {
  const first = mergeResearchRunIntoWorkspace(emptyWorkspace(), projectionResult());
  const second = mergeResearchRunIntoWorkspace(first.workspace, projectionResult());

  assert.equal(first.workspace.companies.length, 1);
  assert.equal(first.workspace.companies[0].people.length, 1);
  assert.equal(first.workspace.properties.length, 1);
  assert.equal(first.workspace.utilities.length, 1);
  assert.equal(first.workspace.parcels.length, 1);
  assert.equal(first.workspace.tariffs.length, 1);

  assert.equal(second.summary.companyId, first.summary.companyId);
  assert.equal(second.workspace.companies.length, 1);
  assert.equal(second.workspace.companies[0].people.length, 1);
  assert.equal(second.workspace.properties.length, 1);
  assert.equal(second.workspace.utilities.length, 1);
  assert.equal(second.workspace.parcels.length, 1);
  assert.equal(second.workspace.tariffs.length, 1);

  assert.equal(second.summary.createdCompany, false);
  assert.equal(second.summary.peopleAdded, 0);
  assert.equal(second.summary.propertiesAdded, 0);
  assert.equal(second.summary.utilitiesAdded, 0);
  assert.equal(second.summary.parcelsAdded, 0);
  assert.equal(second.summary.tariffsAdded, 0);
});
```

- [ ] **Step 3: Add the manual-value preservation test**

```ts
test('verified research does not silently relabel matching user-entered CRM values', () => {
  const first = mergeResearchRunIntoWorkspace(emptyWorkspace(), projectionResult());
  const company = first.workspace.companies[0];
  const property = first.workspace.properties[0];

  company.people = [{
    id: 'manual-person',
    name: 'Jane Owner',
    role: 'Manually entered role',
    email: 'manual@example.com',
    status: 'user-entered',
  }];
  property.address = { value: 'Manual address text', status: 'user-entered' };
  property.units = { value: 77, status: 'user-entered' };

  const merged = mergeResearchRunIntoWorkspace(first.workspace, projectionResult());
  const savedCompany = merged.workspace.companies.find((item) => item.id === company.id)!;
  const savedProperty = merged.workspace.properties.find((item) => item.id === property.id)!;

  assert.deepEqual(savedCompany.people, company.people);
  assert.equal(savedProperty.address.value, 'Manual address text');
  assert.equal(savedProperty.address.status, 'user-entered');
  assert.equal(savedProperty.units?.value, 77);
  assert.equal(savedProperty.units?.status, 'user-entered');
});
```

- [ ] **Step 4: Run the focused file and confirm the safety test exposes the current merge behavior**

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected before the fix: the manual-preservation test fails because the current merge spreads projected `verified-public` values over matching user-entered people/property fields.

- [ ] **Step 5: Preserve matching user-entered people**

Replace `mergePeople` in `lib/research/workspace-projection.ts` with:

```ts
function mergePeople(existing: Person[], incoming: Person[]): Person[] {
  const map = new Map(existing.map((item) => [normalizeLabel(item.name), item]));
  for (const item of incoming) {
    const key = normalizeLabel(item.name);
    const current = map.get(key);
    if (current?.status === 'user-entered') {
      map.set(key, current);
      continue;
    }
    map.set(key, current ? { ...current, ...item, id: current.id } : item);
  }
  return [...map.values()];
}
```

This prevents research provenance/status from being attached to a manually maintained person solely because names normalize to the same value.

- [ ] **Step 6: Preserve user-entered property evidence values field-by-field**

Replace `mergeProperties` with:

```ts
function mergeProperties(existing: Property[], incoming: Property[]): Property[] {
  const next = [...existing];
  for (const property of incoming) {
    const index = next.findIndex((item) =>
      item.companyId === property.companyId && normalizeLabel(item.name) === normalizeLabel(property.name),
    );
    if (index < 0) {
      next.push(property);
      continue;
    }

    const current = next[index];
    next[index] = {
      ...current,
      ...property,
      id: current.id,
      createdAt: current.createdAt,
      address: current.address.status === 'user-entered' ? current.address : property.address,
      units: current.units?.status === 'user-entered' ? current.units : (property.units ?? current.units),
      grossSquareFeet: current.grossSquareFeet?.status === 'user-entered'
        ? current.grossSquareFeet
        : (property.grossSquareFeet ?? current.grossSquareFeet),
    };
  }
  return next;
}
```

Keep the existing `trusted()` function unchanged so only supported/verified claims above the trust threshold reach projection.

- [ ] **Step 7: Run Task 2 tests**

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected: discovery tests, full idempotency test, and manual-preservation test all PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add tests/research-monitor-hardening.test.ts lib/research/workspace-projection.ts
git commit -m "fix: preserve manual CRM evidence on research save"
```

---

### Task 3: Find Leads diagnostics and save-to-company handoff

**Files:**
- Modify: `tests/research-monitor-hardening.test.ts`
- Modify: `app/components/puma-research-panel.tsx`

**Interfaces:**
- Consumes: discovery payload `{ candidates, warnings, diagnostics }`, `ResearchRunResult`, and the already-correct V4 callback `onSave(result): ResearchMergeSummary`.
- Produces: partial-discovery warning UI, stop-reason diagnostics, explicit save success summary, and direct `/clients/[companyId]` navigation.

- [ ] **Step 1: Add UI source regression assertions**

Append:

```ts
test('Find Leads exposes partial discovery diagnostics and direct saved-company handoff', () => {
  const panel = readFileSync(new URL('../app/components/puma-research-panel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /discoveryWarnings/);
  assert.match(panel, /discoveryDiagnostics/);
  assert.match(panel, /result\.stopReason/);
  assert.match(panel, /saveSummary/);
  assert.match(panel, /saveSummary\.companyId/);
  assert.match(panel, /\/clients\//);
});
```

- [ ] **Step 2: Run focused tests and verify the UI assertion fails**

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected: FAIL because the panel does not yet retain discovery warnings/diagnostics or a save summary.

- [ ] **Step 3: Add panel state and typed discovery diagnostics**

Add `next/link` and these types/states near the existing panel declarations:

```ts
import Link from 'next/link';

type DiscoveryDiagnostics = {
  attempted: number;
  succeeded: number;
  failed: number;
  backends: string[];
};

const [discoveryWarnings, setDiscoveryWarnings] = useState<string[]>([]);
const [discoveryDiagnostics, setDiscoveryDiagnostics] = useState<DiscoveryDiagnostics | null>(null);
const [saveSummary, setSaveSummary] = useState<ResearchMergeSummary | null>(null);
```

At the beginning of `discover()`, clear `discoveryWarnings`, `discoveryDiagnostics`, and `saveSummary`. At the beginning of `deepResearch()`, clear `saveSummary`.

Change the discovery payload type to:

```ts
const payload = await response.json() as {
  candidates?: Candidate[];
  warnings?: string[];
  diagnostics?: DiscoveryDiagnostics;
  error?: string;
};
```

After a successful response:

```ts
setCandidates(payload.candidates ?? []);
setDiscoveryWarnings(payload.warnings ?? []);
setDiscoveryDiagnostics(payload.diagnostics ?? null);
setHasDiscovered(true);
setStatus('idle');
```

On a failed response, keep the returned `error` primary and do not set `hasDiscovered` to true.

- [ ] **Step 4: Capture the existing merge summary on explicit save**

Replace the current save function with:

```ts
const save = () => {
  if (!result) return;
  try {
    const summary = onSave(result);
    setSaveSummary(summary);
    setStatus('saved');
    setError('');
  } catch (cause) {
    setStatus('idle');
    setError(cause instanceof Error ? cause.message : 'Could not save this research result.');
  }
};
```

Do not add auto-save or automatic navigation.

- [ ] **Step 5: Render partial-discovery and deep-run diagnostics**

Before the candidates list, render:

```tsx
{discoveryWarnings.length > 0 && (
  <div className="pm-research-error" role="status">
    <strong>Partial discovery</strong>
    <span>
      {discoveryDiagnostics?.succeeded ?? 0} of {discoveryDiagnostics?.attempted ?? 0} searches completed. Results below come only from successful searches.
    </span>
  </div>
)}
```

Extend the existing dossier metadata line with:

```tsx
{' '}· stopped: {result.stopReason}
```

Keep `blocked` and `failed` as execution diagnostics only; do not convert them into negative company facts.

- [ ] **Step 6: Render save summary and company link**

Immediately after the save action/result area, render:

```tsx
{saveSummary && (
  <div className="pm-research-section pm-research-save-summary" role="status">
    <span>{saveSummary.createdCompany ? 'Prospect created' : 'Prospect updated'}</span>
    <div>
      <strong>Saved to Puma CRM</strong>
      <small>
        {saveSummary.peopleAdded} contacts · {saveSummary.propertiesAdded} buildings ·
        {' '}{saveSummary.utilitiesAdded} utilities · {saveSummary.parcelsAdded} parcels ·
        {' '}{saveSummary.tariffsAdded} tariffs added
      </small>
    </div>
    <Link href={`/clients/${encodeURIComponent(saveSummary.companyId)}`}>Open company</Link>
  </div>
)}
```

The existing V4 `onSave` callback already returns `merged.summary`; do not modify it in this task.

- [ ] **Step 7: Run Task 3 tests**

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected: all tests through Task 3 PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add tests/research-monitor-hardening.test.ts app/components/puma-research-panel.tsx
git commit -m "feat: connect research save to CRM handoff"
```

---

### Task 4: Authorized Monitor context and exact building drill-down

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/monitor.ts`
- Modify: `tests/monitor-alerts.test.ts`
- Modify: `tests/research-monitor-hardening.test.ts`
- Modify: `app/components/puma-workspace-app-v4.tsx`

**Interfaces:**
- Consumes: existing Client-stage + `client-authorized` reading gate.
- Produces: `MonitorAlert` with `readingId`, `meterLabel`, optional `periodStart`, existing `periodEnd`, and an exact building-detail link derived from the alert IDs.

- [ ] **Step 1: Strengthen runtime Monitor assertions**

In the existing `only a client-stage, client-authorized reading can create configured alerts` test, append:

```ts
assert.ok(alerts.every((alert) => alert.readingId === 'authorized-reading'));
assert.ok(alerts.every((alert) => alert.meterLabel === 'Authorized meter'));
assert.ok(alerts.every((alert) => alert.periodEnd === '2026-09-10T00:00:00.000Z'));
```

Add:

```ts
test('authorized readings still cannot alert for a non-client company', () => {
  const workspace = createReleaseOneWorkspace();
  const company = workspace.companies[0];
  company.stage = 'Research';
  assert.deepEqual(buildMonitorAlerts(workspace), []);
});
```

- [ ] **Step 2: Add exact-route/context source assertions**

Append to `tests/research-monitor-hardening.test.ts`:

```ts
test('Monitor renders exact alert building drill-down and meter context', () => {
  const source = readFileSync(new URL('../app/components/puma-workspace-app-v4.tsx', import.meta.url), 'utf8');
  assert.match(source, /buildingDetailPath\(alert\.companyId, alert\.propertyId\)/);
  assert.match(source, /alert\.meterLabel/);
  assert.match(source, /alert\.periodEnd/);
});
```

- [ ] **Step 3: Run focused Monitor tests and confirm the intended red state**

```bash
npx tsx --test tests/monitor-alerts.test.ts tests/research-monitor-hardening.test.ts
```

Expected: FAIL because `MonitorAlert` lacks `readingId`/`meterLabel` and V4 Monitor alerts are not links.

- [ ] **Step 4: Extend the alert type with authorized-reading context**

Change `MonitorAlert` in `lib/types.ts` to:

```ts
export type MonitorAlert = {
  id: string;
  companyId: string;
  propertyId: string;
  meterId: string;
  readingId: string;
  meterLabel: string;
  kind: AlertKind;
  title: string;
  detail: string;
  periodStart?: string;
  periodEnd?: string;
  status: 'client-authorized';
  provenanceId?: string;
};
```

- [ ] **Step 5: Populate context inside the existing authorized-reading loop only**

Change the `base` object in `lib/monitor.ts` to:

```ts
const base = {
  companyId: company.id,
  propertyId: property.id,
  meterId: meter.id,
  readingId: reading.id,
  meterLabel: meter.label,
  periodStart: reading.periodStart,
  periodEnd: reading.periodEnd,
  status: 'client-authorized' as const,
  provenanceId: reading.provenanceId,
};
```

Do not move alert construction outside `.filter((reading) => reading.status === 'client-authorized')` and do not add research/estimated fields as alternate alert inputs.

- [ ] **Step 6: Make each V4 Monitor alert link to its exact building**

Replace the existing `alerts.map(...)` body in `renderMonitor()` with:

```tsx
{alerts.map((alert) => {
  const property = workspace!.properties.find((item) => item.id === alert.propertyId);
  return (
    <article key={alert.id}>
      <Bell size={17} />
      <div>
        <strong>{alert.title}</strong>
        <span>{property?.name || 'Building'} · {alert.detail}</span>
        <small>
          {alert.meterLabel}
          {alert.periodStart || alert.periodEnd
            ? ` · ${[alert.periodStart, alert.periodEnd].filter(Boolean).join(' → ')}`
            : ''}
        </small>
      </div>
      <Link
        href={buildingDetailPath(alert.companyId, alert.propertyId)}
        aria-label={`Open ${property?.name || 'building'}`}
      >
        <ChevronRight size={18} />
      </Link>
    </article>
  );
})}
```

The route must come from the alert’s own IDs, never current selection state.

- [ ] **Step 7: Run Task 4 tests**

```bash
npx tsx --test tests/monitor-alerts.test.ts tests/research-monitor-hardening.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add lib/types.ts lib/monitor.ts tests/monitor-alerts.test.ts tests/research-monitor-hardening.test.ts app/components/puma-workspace-app-v4.tsx
git commit -m "feat: add authorized monitor drill-down context"
```

---

### Task 5: Whole-branch regression and CI gate

**Files:**
- Modify only a file whose failure is directly demonstrated by the verification commands below.

**Interfaces:**
- Consumes: final branch head after Tasks 1–4.
- Produces: full repository tests, TypeScript, Next production build, and GitHub Actions green on the exact final SHA.

- [ ] **Step 1: Run the full repository test suite**

```bash
npm test
```

Expected: all configured tests PASS, including `tests/research-monitor-hardening.test.ts`.

- [ ] **Step 2: Run TypeScript independently**

```bash
npm run typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: repository tests, typecheck, and Next.js production build all PASS.

- [ ] **Step 4: Inspect the final diff against merged `main`**

The intended product-code diff is limited to:

```text
app/api/research/discover/route.ts
app/components/puma-research-panel.tsx
app/components/puma-workspace-app-v4.tsx
lib/research/discovery-service.ts
lib/research/workspace-projection.ts
lib/monitor.ts
lib/types.ts
package.json
tests/research-monitor-hardening.test.ts
tests/monitor-alerts.test.ts
```

The two design/plan documents are expected in addition to those product/test files. Remove unrelated edits before final verification.

- [ ] **Step 5: Require GitHub Actions success on the final branch head**

The exact final SHA must show:

```text
Tests: success
TypeScript: success
Next build: success
```

CI proves source/build health only; do not claim live/deployed browser behavior from this phase.

- [ ] **Step 6: Re-check the approved spec against the final diff**

Verify every line below from code/tests before reporting the branch ready:

```text
partial discovery survives
all-failed discovery errors
research remains bounded
auto-save is absent
repeat save is idempotent across company/contact/property/utility/parcel/tariff
user-entered contact/property evidence is preserved
save summary links to exact company
Monitor authorization gate is unchanged
Monitor links to exact alert building
public research cannot manufacture alerts
```

Report the final branch SHA and GitHub Actions run ID only after these checks pass.